import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getPhotoById, updatePhotoFields, deletePhotoById } from "./ddb-photos";
import { PUBLIC_FEED_KEY } from "./publicFeed";
import { isAdmin, getCallerUserId } from "./auth";
import { requestSiteRebuild } from "./rebuild";
import { invalidateUploads } from "./cdnInvalidate";
import { requireEnv } from "./env";
import {
    sanitizeExif, sanitizeText, sanitizeDate, dateWasRejected, sanitizeTags,
    sanitizeTitle, sanitizeDescription, sameStoredValue,
} from "./sanitize";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
// **未設定なら起動時に止める。** `?? ""` / `!` にしていた頃は、環境変数が
// 空でも S3 の削除を**黙って飛ばして** DynamoDB の行だけ消し、成功を返していた。
// GPS 入りの原本（srcOriginal）を含む実体が公開URLに残り、項目が消えている
// ので**どの削除経路からも二度と辿れない**。
// 取り返しのつかない削除なので「分からないなら止める」に倒す
// （profile.ts と同じ扱い。CLAUDE.md の方針）。
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * body から書き換えてよい項目だけを取り出し、**値も整える**（undefined は「触らない」）。
 *
 * 通すのは「編集画面で触れるもの」だけ。素性（id / userId / src 系）・
 * 集計値（likes / commentCount）・種別（story / expiresAt）は受け付けない。
 * 以前はリクエストの中身をそのまま SET していたので、自分の写真に
 * {"userId": "他人のsub"} を送るだけで、その写真を他人のギャラリーへ
 * 移せた（userId は GSI のハッシュキー）。
 *
 * キー名だけ見て値を素通ししていた頃は、この経路だけがサニタイズを通らず、
 * ユーザーAPI側（api-user/src/photoUpdate.ts）と保存されるものが違っていた。
 * どちらのホストもクライアントのバンドルに入っているので、利用者はどちらでも
 * 叩ける——つまり「緩い方」が実際の仕様になっていた。具体的には:
 *   - exif に gpsLatitude / gpsLongitude を入れると、そのまま保存され
 *     公開の GET /photos で配られ、静的HTMLにも焼き込まれた
 *     （sanitizeExif は既知のキーだけを通し、GPS を明示的に落とす）
 *   - tags を数千件、title を深くネストしたオブジェクト、なども通った
 */
export function pickEditableFields(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
        // キーが body にあるときだけ触る。値が空になった場合も
        // 「その項目を空にする」意図なので、undefined のまま入れる
        if (key in body && body[key] !== undefined) out[key] = value;
    };
    put("title", sanitizeTitle(body.title));
    put("description", sanitizeDescription(body.description));
    put("location", sanitizeText(body.location, 200));
    put("category", sanitizeText(body.category, 100));
    put("date", sanitizeDate(body.date));
    // 空配列は「そのタグを外す」指定。undefined にしておくと
    // updatePhotoFields が REMOVE を組み立てる（ユーザーAPI側と同じ姿になる）。
    // SET tags = [] にしていた頃は、同じ写真でも叩いたAPIによって
    // 「属性が空配列」と「属性が無い」に分かれ、再ビルドの判定が食い違った。
    const tags = sanitizeTags(body.tags);
    put("tags", Array.isArray(tags) && tags.length === 0 ? undefined : tags);
    put("exif", sanitizeExif(body.exif));
    // 公開状態は真偽値だけ。文字列の "false" などを通さない
    if (typeof body.published === "boolean") out.published = body.published;
    return out;
}

export const updatePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには写真以外（通知 notifs#... / コメント comments#... /
    // フォロー関係 following#... など）も同じキー空間に入っている。
    // 読み側（api/src/photos.ts の getPhoto）は同じ理由で弾いているのに、
    // 書き側だけ素通りだった。所有権の判定は `!isAdmin && ownerId !== callerId`
    // なので、**管理者だけ**が `PUT /photos/notifs%23<sub>` で他人の通知文書に
    // title を生やしたり、`DELETE` で丸ごと消したりできた（元に戻せない）。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    // 読めない撮影日は断る（ユーザーAPI側と同じ。理由はあちらのコメント）。
    // **写真を読みに行く前**——api-user と位置を揃える（片方だけ後ろだと、
    // 同じリクエストが 400 と 404/403 に割れる）
    if (dateWasRejected(body.date)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "撮影日が正しくありません（日付として読み取れないか、1990年より前・未来の日付です）" }) };
    }

    try {
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        // !ownerId まで見る（対の api-user/src/photoUpdate.ts:109 と同じ）。
        // 無いと「持ち主が空の行 × sub の無いトークン」で "" === "" が
        // 成立して所有チェックを通過する（callerId の "" 化で薄くなった一枚）
        if (!isAdmin(event) && (!ownerId || ownerId !== callerId)) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "編集権限がありません" }) };
        }
        // ストーリーはこのAPIの対象外。published:true を書き込むと
        // 永久の写真ページになり、24時間後の期限切れ掃除が実体だけ消して
        // 壊れたページとサイトマップの項目が残る。しかもストーリーは動画も
        // 許しているので、写真ギャラリーに動画を差し込む経路にもなる。
        // ユーザーAPI側（api-user/src/photoUpdate.ts）と同じ扱いにする。
        if (photo.story === true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const fields = pickEditableFields(body);
        const updates: Record<string, unknown> = { ...fields, updatedAt: new Date().toISOString() };
        // 公開一覧用 GSI の印（対の api-user/src/photoUpdate.ts と同じ）。
        // `updatePhotoFields` は undefined を REMOVE に倒すので、
        // 非公開にしたら索引から落ちる。
        if ("published" in fields) {
            updates.publicFeed = fields.published === false ? undefined : PUBLIC_FEED_KEY;
        }
        // 地名から補った座標（geoApprox）は地名に付随する。地名を直したら
        // 座標ごと捨てる（ユーザーAPI側 api-user/src/photoUpdate.ts と同じ扱い。
        // 管理画面は座標を送らないので、残すと嘘のピンを直す手段が無い）
        if (photo.geoApprox === true && "location" in fields && !sameStoredValue(fields.location, photo.location)) {
            updates.coords = undefined;
            updates.geoApprox = undefined;
        }
        const updated = await updatePhotoFields(id, updates);

        // 静的ページに焼かれる内容が変わったら作り直しを頼む。
        // 「公開状態が変わったときだけ」では狭い——本文や撮影地を消しても
        // 静的HTMLに残ってしまう。連打は coalesce で畳む
        // （ユーザーAPI側 api-user/src/photoUpdate.ts と同じ扱い）。
        //
        // 「キーが fields にあるか」で見ていた時期があるが、それは
        // 「毎回」と同じだった——当時の /admin/edit は保存のたびに全項目
        // （exif を含む）を送っていたので、何も変えずに保存を押すだけで
        // ビルドが走った（1本8分・月2,000分）。値そのものを突き合わせる。
        //
        // **画面は今、変えた項目だけ送る**（9df0ec2）。それでも値で見るのは
        // やめない——`published` は毎回同梱されるし、古いタブが読み込んだ
        // ままの JS は今も全項目を送ってくる。
        const visibilityChanged = "published" in fields && fields.published !== (photo.published !== false);
        // 比べるのは**書いたあとの姿**。pickEditableFields が空を undefined に
        // 揃えてあり、updatePhotoFields はそれを REMOVE にする。
        const metaChanged = ["title", "description", "location", "category", "date", "tags", "exif"]
            .some((k) => k in fields && !sameStoredValue(fields[k], (photo as Record<string, unknown>)[k]));
        // **届かなかったら行に印を残す**（api-user 側と同じ）。畳まれた・
        // 予算切れ・dispatch 失敗のどれでも false が返る。印が無いと、
        // 非公開 →（依頼が届かない）→ 削除 で `/photo/<id>` の静的HTML が
        // 誰にも消されないまま残る（削除側は「非公開だった写真には静的
        // ページが無い」と決め打ちして掃除を省く経路がある）。
        // **presign が3か所あったのと同じで、ここだけ抜けていた。**
        const dispatched = (visibilityChanged || metaChanged)
            ? await requestSiteRebuild(`photo updated: ${id}`, { coalesce: true })
            : false;
        const hiding = visibilityChanged && fields.published === false;
        if (hiding && !dispatched) {
            try {
                // `updatePhotoFields` を通す（`attribute_exists(id)` 付き。
                // Get → Update の間に写真が消えたときに幽霊行を作らない）
                await updatePhotoFields(id, { staticStale: true });
            } catch (e) {
                console.error(`updatePhoto: staticStale の記録に失敗 (${id}):`, e);
            }
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: updated }) };
    } catch (e) {
        // 条件が外れた＝Get と Update の間に写真が消えた。
        // 対の api-user/src/photoUpdate.ts と同じく 404 で返す
        // （500 のままだと利用者は「失敗したので再試行」と読んで押し直す）。
        // 条件（attribute_exists(id)）は揃えてあったのに、エラーの
        // 読み替えだけ揃っていなかった（調査ラウンド2の指摘）。
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        console.error("updatePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

export const deletePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには写真以外（通知 notifs#... / コメント comments#... /
    // フォロー関係 following#... など）も同じキー空間に入っている。
    // 読み側（api/src/photos.ts の getPhoto）は同じ理由で弾いているのに、
    // 書き側だけ素通りだった。所有権の判定は `!isAdmin && ownerId !== callerId`
    // なので、**管理者だけ**が `PUT /photos/notifs%23<sub>` で他人の通知文書に
    // title を生やしたり、`DELETE` で丸ごと消したりできた（元に戻せない）。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }

    try {
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        // !ownerId まで見る（対の api-user/src/photoUpdate.ts:109 と同じ）。
        // 無いと「持ち主が空の行 × sub の無いトークン」で "" === "" が
        // 成立して所有チェックを通過する（callerId の "" 化で薄くなった一枚）
        if (!isAdmin(event) && (!ownerId || ownerId !== callerId)) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除権限がありません" }) };
        }

        // S3 から画像ファイルを削除する。**消せなければ行も消さない。**
        //
        // ここは一度「失敗しても DynamoDB レコードは削除する」だった。
        // 行は S3 キーの唯一の手がかりなので、消し残したまま行を消すと、
        // GPS 入りの原本（srcOriginal）が公開URLに孤児で残り、
        // **どの削除経路からも二度と辿れない**。同じ理由で UPLOAD_BUCKET を
        // requireEnv にしたのに（設定ミスには倒したのに）、S3 の一時失敗には
        // 倒していなかった。api-user の deleteMyPhoto と deleteAccount は
        // 既に 500 で止めている——同じ写真でも、本人が消すと守られ、
        // 管理者に頼むと守られない、という食い違いだった。
        //
        // 本体だけでなく派生画像も消す。特に srcOriginal は EXIF を落とす前の原本で
        // GPS が入ったままなので、消し残すと削除後も公開URLで取得できてしまう。
        // api-user/src/mediaKeys.ts の MEDIA_FIELDS と**対**。派生を足すときは
        // 両方を直すこと（片方だけ直すと admin 削除だけ消し残す）。
        // "key" と生キー（"uploads/..."）も受けるのはあちらと同じ理由。
        // **並びは「機微なものから」。** 途中で失敗すると 500 で止まるので、
        // src を先に消すと「公開ページは割れた画像／GPS 入りの原本は生きたまま」
        // ——一番避けたい形が部分失敗のときに出る。srcOriginal を先頭に置けば、
        // 部分失敗しても「見た目は無事・機微なものは消えている」に倒れる。
        const mediaFields = [
            "srcOriginal", "key", "src", "srcAvif", "src256",
            "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
        ] as const;
        const keys = new Set<string>();
        for (const field of mediaFields) {
            const v = (photo as Record<string, unknown>)[field];
            if (typeof v !== "string" || !v) continue;
            if (v.startsWith("uploads/")) {
                let raw = v;
                try { raw = decodeURIComponent(v); } catch { /* 不正な % はそのまま */ }
                if (!raw.includes("..")) keys.add(raw);
                continue;
            }
            if (!v.startsWith("http")) continue;
            try {
                // パスはデコードしてから見る。生のままだと、保存時の検証
                // （デコードして判定している）と食い違い、
                // https://cdn/up%6Coads/... のようなURLが「保存はできるが
                // 削除では対象外」になる。CloudFront は %6C をデコードして
                // 解決するので、実体だけが公開URLに残り続ける。
                let key = new URL(v).pathname.substring(1);
                try { key = decodeURIComponent(key); } catch { /* 不正な % はそのまま */ }
                // 消してよいのはアップロード領域だけ。src は過去に検証なしで保存された
                // ものがあり、そのままキーにすると他人のアイコン（profiles/...）まで
                // 消せてしまう。
                if (key.startsWith("uploads/") && !key.includes("..")) keys.add(key);
                else console.warn(`deletePhoto: skip S3 delete for unexpected key ${key}`);
            } catch { /* URL でなければ無視 */ }
        }
        let s3Failures = 0;
        // **消せたキーだけをエッジの掃除に回す。** 消えていない実体の
        // キャッシュを捨てても取り直されるだけで、無効化は**パス単位で課金**される
        const deleted: string[] = [];
        for (const key of keys) {
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
                deleted.push(key);
            } catch (s3Err) {
                console.error(`deletePhoto: S3 delete failed for ${key}:`, s3Err);
                s3Failures++;
            }
        }
        // **エッジからも消す（LEFT-4）。** S3 から消しただけでは、
        // `/uploads/*` の maxTTL（本番実測 31536000秒＝365日）と実体の
        // `max-age=31536000` のぶん、**URL を知っていれば取れ続ける**
        // ——GPS 入りの原本（`srcOriginal`）も同じ。退会・ストーリー掃除は
        // 前から通っていて（`deleteMyPhoto` は直前の `8b23757d` で塞いだ）、
        // **ここだけ抜けていた**。
        // 失敗しても削除は成功として扱う（`invalidateUploads` は投げない）。
        await invalidateUploads(deleted, `deletePhoto(${id})`);
        if (s3Failures > 0) {
            return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像の削除を完了できませんでした。時間をおいてもう一度お試しください" }) };
        }

        await deletePhotoById(id);

        // 静的ページの掃除を頼む。実体を消しても、既に配ってある
        // /photo/<id> の HTML はそのまま残る（本文・撮影地・EXIF・
        // 表示名入りの JSON-LD まで焼き込まれている）。定期ビルドは
        // 止めてあるので、頼まないと誰かが push するまで消えない。
        await requestSiteRebuild(`photo deleted: ${id}`);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deletePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
