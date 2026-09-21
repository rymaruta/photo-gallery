import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { putPhoto } from "./ddb-photos";
import { photoLimitError } from "./photoLimit";
import { idFromUploadKey, keyFromUploadUrl, isOwnUploadUrlFromEnv as isOwnUploadUrl, canonicalUploadUrl } from "./uploadPolicy";
import { sanitizeTitle, sanitizeBlurDataURL } from "./sanitize";
import { lookupDisplayNameIfSet } from "./notify";
import type { Photo } from "./types";

/**
 * ストーリーの1枚を、ギャラリーの写真として残す。
 *
 * **このサイトにしかない向き。** Instagram が持っているのは
 * 「投稿 → ストーリーへシェア」だけで、逆は無い（ハイライトは
 * 「消えるものを消えないように見せる」だけで、中身はストーリーのまま）。
 *
 * ここでは段差の向きが逆になっている:
 *
 *     写真     個別ページ・サイトマップ・地図・撮影地/機材/タグの集約ページ
 *              ＝**検索から人が来る**（CLAUDE.md の優先度そのもの）
 *     ストーリー 24時間で消える。検索にはまったく出ない
 *
 * だから「消えるもの → 残るもの」を作る。新しい概念は増やさない
 * ——できるのは**普通の写真の行**なので、編集画面も地図も年表も
 * サイトマップも、既存の機械がそのまま働く。
 *
 * **下書き（`published: false`）で作る。** その場のノリで上げたものが
 * 黙って検索に出るのは驚きが大きいし、撮影地もタイトルも無いままでは
 * SEO の価値も無い。公開は本人が編集画面で押す（既存の経路）。
 *
 * **24時間で消える約束は壊さない。** 残るのは本人が選んだ1枚だけで、
 * ストーリーの行は予定どおり消える。変わるのは「S3 の実体を消すかどうか」
 * だけ——`keptAs` が立っていれば、その実体の持ち主は写真になったので
 * ストーリー側は消さない（`stories.ts` の `storyMediaKeys`）。
 */

/** POST /stories/{id}/keep — このストーリーをギャラリーに残す（投稿者だけ） */
export const keepStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!userId || !storyId) return jsonError(400, "不正なリクエスト");

    // **一覧用のサムネを受け取る。** 無くても残せるが、無いまま公開すると
    // ホームの一覧が**1440px の原寸**を読む（普通のアップロードは端末側で
    // 512px の WebP を作って送る）。補う `generate-thumbnails.js` は
    // ビルド時にしか走らないので、`REBUILD_DISPATCH_TOKEN` が未設定の本番では
    // **最大7日**そのまま——訪問者全員が毎回その差を払う。
    // 検証は写真の保存（`savePhoto`）とまったく同じものを通す。
    let body: { thumbUrl?: unknown; dominantColor?: unknown; blurDataURL?: unknown } = {};
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch { /* 本文は任意。壊れていても残す方は続ける */ }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const story = res.Item as Record<string, unknown> | undefined;
        if (!story || story.story !== true) return jsonError(404, "ストーリーが見つかりません");
        // 持ち主でない相手には実在を教えない（`getStoryViewers` と同じ）。
        // **`userId ?? uploadedBy`**——`createStory` は必ず `userId` を書くが、
        // 所有権の判定はリポジトリ全体でこの形に揃っている
        if ((story.userId ?? story.uploadedBy) !== userId) return jsonError(404, "ストーリーが見つかりません");

        // **期限切れは断る**（`postStoryReply` に揃える）。
        // 意図の話ではなく**掃除の作り**の問題——`cleanupExpiredStories` は
        // 期限切れを**一度に読んだスナップショット**で回すので、`keptAs` の
        // 判定は読み取り時点の値。「掃除がその行を読んだ後・消す前」に
        // 印が立つと、**S3 だけ消えた写真**ができる。期限切れの行は
        // `getStories` が返さない＝画面から押せないので、断っても失うものは無い
        //
        // **アーカイブ済みも断る。** 一度は通したが、残した写真とストーリーは
        // **S3 の実体を共有する**ので、あとで下書きの写真を消すと
        // `deleteMyPhoto` の `keptFrom` がストーリーの行ごと消す
        // ——生きているストーリーなら「どうせ24時間で消える」で済むが、
        // アーカイブは本人が残すつもりのものなので黙って消えては困る。
        // 実体を複製して切り離すまでは、残せるのは生きている間だけ
        if (typeof story.expiresAt === "string" && story.expiresAt <= new Date().toISOString()) {
            return jsonError(404, "ストーリーが見つかりません");
        }

        // **動画は残せない。** 写真の行は画像を前提にしていて、サムネも
        // 派生（AVIF）も `sharp` が作る。動画を写真として置くと、
        // 一覧にも個別ページにも**再生できない静止画の枠**が並ぶ
        if (story.mediaType === "video") {
            return jsonError(400, "動画はギャラリーに残せません（写真だけ）");
        }

        // **既に残してあれば、そのまま返す（冪等）。** 二度押しても2枚に
        // ならない。押した側からは1回目と同じ結果に見える
        if (typeof story.keptAs === "string" && story.keptAs) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ photoId: story.keptAs, already: true }) };
        }

        // 枚数の上限は写真の口と同じものを使う（複製した規則は静かにずれる）
        const limit = await photoLimitError(userId, false);
        if (limit) return limit;

        const src = String(story.src ?? "");
        const key = typeof story.key === "string" && story.key ? story.key : keyFromUploadUrl(src);
        if (!src || !key) return jsonError(400, "この投稿は残せません");

        // **写真IDは鍵から導出する**（`upload.ts` と同じ規則）。同じ実体からは
        // 必ず同じIDになるので、二度押しは `putPhoto` の
        // `attribute_not_exists(id)` が自然に弾く——新しい仕掛けを作らない
        const photoId = idFromUploadKey(key);
        const safeThumb = isOwnUploadUrl(body.thumbUrl, userId) && String(body.thumbUrl).length <= 500
            ? canonicalUploadUrl(String(body.thumbUrl), process.env.CLOUDFRONT_URL ?? "")
            : undefined;
        const safeColor = typeof body.dominantColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.dominantColor)
            ? body.dominantColor.toLowerCase()
            : undefined;
        const safeBlur = sanitizeBlurDataURL(body.blurDataURL);
        const now = new Date().toISOString();
        // 表示名はサーバーで引く（申告を保存しない）。未設定なら持たない
        const displayName = await lookupDisplayNameIfSet(userId);

        const photo: Photo = {
            id: photoId,
            src,
            key,
            // キャプションがあれば題に。**撮影日は作らない**——ストーリーの
            // 投稿時刻から撮影日をこしらえると、年表と JSON-LD が嘘の日付で
            // 並ぶ（台帳が「捏造の UTC 0時の行」として一度踏んでいる形）
            // **題が無いなら属性ごと持たない。** 以前ここは「無題」を入れていたが、
            // それは**利用者が名付けた語ではない**のに一覧にも読み上げにも出ていた
            // （owner:「タイトルなくてもいいよ」）。編集の経路（`photoUpdate.ts`）は
            // 前から空を REMOVE に倒しているので、保存形もそちらに揃う
            ...(() => { const t = sanitizeTitle(story.caption); return t ? { title: t } : {}; })(),
            userId,
            uploadedBy: userId,
            ...(displayName ? { displayName } : {}),
            // **撮影地はそのまま引き継ぐ。** ここが要——このサイトの価値は
            // 撮影地 → 地図 → `/location/<スラッグ>` → **検索流入**なので、
            // ストーリーで場所を付けておけば、残した瞬間に地図に載る写真になる
            // （空だと、本人が編集画面で打つまで何にも繋がらない）。
            // 座標は保存の時点で約1kmに丸めてある（`sanitizeCoords`）。
            // **`geoApprox` は立てない**——あれは「地名から機械が引いた値」の印で、
            // ここは撮影時の GPS 由来（`geocode-locations.js` が後から補うのとは別物）
            ...(typeof story.location === "string" && story.location ? { location: story.location } : {}),
            ...(story.coords && typeof story.coords === "object" ? { coords: story.coords as { lat: number; lng: number } } : {}),
            // 一覧用のサムネ・代表色・ぼかし（端末が作って送ったもの）。
            // **判定は写真の保存と同じものを使う**——`thumbUrl` は
            // 「自分のアップロード領域を指すURLか」まで見る（見ないと、
            // 外部の任意URLを入れて一覧を見た人全員の IP を集められる）
            ...(safeThumb ? { thumbSrc: safeThumb } : {}),
            ...(safeColor ? { dominantColor: safeColor } : {}),
            ...(safeBlur ? { blurDataURL: safeBlur } : {}),
            // **下書きで作る。** 公開は本人が編集画面で押す
            published: false,
            // **出どころ。** この写真を消すときに、まだ生きているストーリーも
            // 一緒に消すために要る（`deleteMyPhoto`）——実体は共有なので、
            // 写真だけ消すと**自分のストーリーが全員に割れた画像で出続ける**
            // うえ、`keptAs` が死んだIDを指したまま残って**二度と残せなくなる**
            keptFrom: storyId,
            // 投稿の時刻はストーリーのものを引き継ぐ（一覧の並びが
            // 「その日に上げたもの」として正しい位置に来る）
            createdAt: typeof story.createdAt === "string" ? story.createdAt : now,
            updatedAt: now,
        };

        try {
            await putPhoto(photo);
        } catch (e) {
            // 同じ鍵から既に写真が作られている（`keptAs` を書けなかった回の
            // 押し直しなど）。**その写真を指して成功にする**——ここで 500 に
            // すると、印だけが立たないまま永久に残せなくなる
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
        }

        // ストーリーに印を立てる。**これが「S3 の実体を消さない」の根拠**
        // （`storyMediaKeys` が見る）。既に立っていれば何もしない
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET keptAs = :p",
            ConditionExpression: "attribute_exists(id) AND attribute_not_exists(keptAs)",
            ExpressionAttributeValues: { ":p": photoId },
        })).catch(async (e) => {
            // **例外の名前で決め打ちしない。** 条件は
            // `attribute_exists(id) AND attribute_not_exists(keptAs)` の2つを
            // 見ているので、`ConditionalCheckFailedException` は
            //   (a) もう印が立っている（＝成功と同じ）
            //   (b) **ストーリーの行がもう無い**（掃除と競合した）
            // のどちらでも起きる。(b) を成功として通すと、S3 は掃除に消された
            // 後なので**割れた写真がギャラリーに残る**——このコミットが塞いだ
            // と書いている形そのもの。ネットワークの失敗も、DynamoDB では
            // 書けているのに失敗が返ることがある（そのまま写真を消すと
            // 印だけが残り、**誰も辿れない S3 の孤児**になる）。
            // **どちらも「読み直して現物を見る」で分かる。**
            const after = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }))
                .then((r) => r.Item as Record<string, unknown> | undefined)
                .catch(() => undefined);
            if (after && after.keptAs === photoId) return;   // 実は立っていた
            console.error(`keepStory: 印を立てられませんでした（${storyId}）:`, e);
            // **印が立っていないなら、作った写真を片付ける。**
            // そのままだと、ストーリーの期限切れで S3 の実体が消えて
            // 割れた画像の行だけが残る（`createAlbum` が同じ理由で
            // 後片付けをしている。あちらは例外を選り好みしない）
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } })).catch(() => undefined);
            throw e;
        });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ photoId }) };
    } catch (e) {
        console.error("keepStory error:", e);
        return jsonError(500, "残せませんでした。もう一度お試しください");
    }
};
