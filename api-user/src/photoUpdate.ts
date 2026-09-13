import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { UpdateCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { PUBLIC_FEED_KEY } from "./publicFeed";
import { removePhotoFromAlbum, addPhotoToAlbum, isAlbumMember } from "./albums";
import { JSON_HEADERS, getUserId } from "./http";
import { sanitizeText, sanitizeTags, sanitizeTitle, sanitizeDescription, sanitizeCoords, sanitizeFocalPoint, sanitizeDate, dateWasRejected, sameStoredValue, truncate } from "./sanitize";
import { requestSiteRebuild } from "./rebuild";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl } from "./mediaHosts";
import { mediaKeys } from "./mediaKeys";
import { s3DeleteMany } from "./s3Delete";
import { removePinnedPhoto } from "./userProfile";

type PhotoSong = { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string };

// 下書き編集で更新できるメタデータ項目。キーが body にあれば更新対象。
// **ここに足し忘れると 400「更新項目がありません」で断られる。**
// 切り抜き位置だけを直す保存は、この配列に `focalPoint` が無いと
// 本文に入っていても「何も送られていない」と見なされる
const META_KEYS = ["title", "description", "location", "category", "tags", "date", "coords", "focalPoint"] as const;

// YouTube URL の検証（フル再生MV用）。youtube.com/watch?v= と youtu.be/ を許可。
// lib/utils/music.ts の parseYouTube と同等の安全策（ホワイトリスト + ID書式）。
export function isValidYouTubeUrl(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    const s = raw.trim().slice(0, 500);
    if (!/^https:\/\//.test(s)) return undefined;
    let u: URL;
    try { u = new URL(s); } catch { return undefined; }
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") id = u.searchParams.get("v") ?? "";
    else return undefined;
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? s : undefined;
}

// PUT /photos/{id} — 自分の写真の更新（公開/非公開・写真BGM）
export const updatePhotoVisibility: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // 写真以外は触らせない（読み側・削除側・管理API と同じ）。
    //
    // **今は別の一枚で塞がっている。** 通知・コメント・フォロー・いいねの
    // 文書は所有者を `uid` という別名で持ち、`userId` を持たないので、
    // 下の `ownerId = item.userId ?? item.uploadedBy` が undefined になって
    // `!ownerId` で 403 になる。つまり「`uid` と `userId` を使い分ける」
    // という**暗黙の約束1本**で持っている状態だった。次に誰かが内部文書に
    // `userId` を書いた瞬間に開くので、他の入口と同じ守りをここにも置く。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }

    let body: {
        published?: boolean; song?: unknown; songYoutubeUrl?: unknown;
        title?: unknown; description?: unknown; location?: unknown;
        category?: unknown; tags?: unknown; date?: unknown; coords?: unknown; focalPoint?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const hasPublished = typeof body.published === "boolean";
    const hasSong = "song" in body;
    const hasYoutube = "songYoutubeUrl" in body;
    const hasMeta = META_KEYS.some((k) => k in body);
    if (!hasPublished && !hasSong && !hasYoutube && !hasMeta) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新項目がありません" }) };
    }

    // フル再生MV: 有効な YouTube URL のみ保存、null/空で解除
    let youtubeUrl: string | undefined;
    let removeYoutube = false;
    if (hasYoutube) {
        if (body.songYoutubeUrl === null || body.songYoutubeUrl === "") {
            removeYoutube = true;
        } else {
            youtubeUrl = isValidYouTubeUrl(body.songYoutubeUrl);
            if (!youtubeUrl) {
                return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なYouTube URLです" }) };
            }
        }
    }

    // 写真BGM: null で解除、オブジェクトなら title + https の previewUrl 必須
    let song: PhotoSong | undefined;
    let removeSong = false;
    if (hasSong) {
        if (body.song === null) {
            removeSong = true;
        } else if (body.song && typeof body.song === "object" && !Array.isArray(body.song)) {
            const o = body.song as Record<string, unknown>;
            // ホストまで確かめる。https だけを見ていた頃は、任意のURLを
            // 仕込んで「開いた人全員の IP を集める」ことができた
            // （音源は先読みされ、アートワークは <img> で読み込まれる）。
            const previewUrl = safeSongPreviewUrl(o.previewUrl);
            const title = typeof o.title === "string" ? truncate(o.title.trim(), 200) : "";
            if (!previewUrl || !title) {
                return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な曲データです" }) };
            }
            const artist = typeof o.artist === "string" ? truncate(o.artist.trim(), 200) : "";
            const artwork = safeSongArtworkUrl(o.artwork);
            const trackUrl = safeSongTrackUrl(o.trackUrl);
            song = {
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
            };
        } else {
            return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な曲データです" }) };
        }
    }

    // **読めない撮影日は断る。** `sanitizeDate` は「消したい（空）」と
    // 「読めない（1990年より前・未来）」の両方に undefined を返すので、
    // そのまま書き込みに使うと**入れ直しただけで保存済みの日付が消える**
    // ——画面は「保存しました」と出す。フィルムの取り込みなど 1990年より前の
    // 日付は実在するのに、黙って落ちていた（実測: `1985-06-01` → undefined）
    if (dateWasRejected(body.date)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "撮影日が正しくありません（日付として読み取れないか、1990年より前・未来の日付です）" }) };
    }

    try {
        // 所有権チェック
        const existing = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        if (!existing.Item) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        const callerId = getUserId(event);
        const ownerId = (existing.Item.userId ?? existing.Item.uploadedBy) as string | undefined;
        if (!ownerId || ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }
        // ストーリーはこのAPIの対象外。published:true を書き込むと
        // 永久の写真ページになり、24時間後の期限切れ掃除が実体だけ消して
        // 壊れたページが残る。いいね・コメントと同じ扱いにする。
        if (existing.Item.story === true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const sets: string[] = ["updatedAt = :t"];
        const values: Record<string, unknown> = { ":t": new Date().toISOString() };
        const names: Record<string, string> = {};
        const removes: string[] = [];
        if (hasPublished) {
            sets.push("published = :p");
            values[":p"] = body.published;
            // **公開一覧用 GSI の印も一緒に動かす。** ここを忘れると、
            // 非公開にした写真が一覧に出続ける／公開に戻した写真が
            // 二度と一覧に出ない、という静かな壊れ方をする（索引にしか
            // 現れないので、行を見ても分からない）。
            if (body.published === false) {
                names["#publicFeed"] = "publicFeed";
                removes.push("#publicFeed");
            } else {
                sets.push("publicFeed = :pf");
                values[":pf"] = PUBLIC_FEED_KEY;
            }
        }
        if (song) { sets.push("song = :s"); values[":s"] = song; }
        if (youtubeUrl) { sets.push("songYoutubeUrl = :yt"); values[":yt"] = youtubeUrl; }
        if (removeSong) removes.push("song");
        if (removeYoutube) removes.push("songYoutubeUrl");

        // 下書き編集: キーが来ていれば、有効値は SET、空なら REMOVE（クリア）。
        // 予約語（location 等）を避けるため属性名は #プレースホルダで指定する。
        //
        // あわせて「本当に値が変わったか」も数える。静的ページの作り直しを
        // 頼むかの判定に使う（下の requestSiteRebuild）。
        let metaChanged = false;
        // **項目をまるごと空にしたか。** 「非公開にした・削除した」と同じで、
        // 消す意図の操作が公開ページに反映されないのは約束違反になる
        // （説明を空にしても、静的HTMLと JSON-LD には残る）。
        // 書き換え（別の文に直す）は「更新が遅れている」だけなので数えない
        // ——公開中の写真を保存するたびに断りが出ると、肝心のときに読まれない。
        // **拾えるのは項目まるごとの削除だけ**——説明の一文だけ消す・タグを1つ外す、
        // といった部分編集は値が非空のままなので数えない。そこまで拾うには
        // 「何が減ったか」を項目ごとに見ることになり、線が引けなくなる。
        // 根本の直し方は文言ではなく `REBUILD_DISPATCH_TOKEN` の設定
        let metaRemoved = false;
        const applyMeta = (col: string, present: boolean, value: unknown): boolean => {
            if (!present) return false;
            const willRemove = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
            // 「変わったか」は**書いたあとの姿**で見る。空配列をそのまま比べていた頃は、
            // タグ属性を持たない写真（タグ未入力の下書きは全部これ）に対して
            // /user/edit が必ず送る tags: [] が毎回「変わった」になり、
            // 実際には REMOVE が何もしないので次の保存でも同じ判定になった
            // ——何も書き換えずに保存するだけでビルドが走り続ける。
            const changed = !sameStoredValue(willRemove ? undefined : value, existing.Item?.[col]);
            if (changed) metaChanged = true;
            if (changed && willRemove) metaRemoved = true;
            names[`#${col}`] = col;
            if (willRemove) {
                removes.push(`#${col}`);
            } else {
                sets.push(`#${col} = :${col}`);
                values[`:${col}`] = value;
            }
            return changed;
        };
        applyMeta("title", "title" in body, sanitizeTitle(body.title));
        applyMeta("description", "description" in body, sanitizeDescription(body.description));
        const locationChanged = applyMeta("location", "location" in body, sanitizeText(body.location, 200));
        applyMeta("category", "category" in body, sanitizeText(body.category, 100));
        applyMeta("tags", "tags" in body, sanitizeTags(body.tags));
        // 撮影日は upload.ts と同じ検証を通す。sanitizeText だと40文字までの
        // 任意の文字列が入り、年表の並び順が壊れる
        applyMeta("date", "date" in body, sanitizeDate(body.date));
        // 一覧での切り抜き位置。**送られてきたときだけ触る**（`applyMeta` の
        // `present` がそれを見ている）。使えない値は `undefined` ＝ REMOVE に
        // 倒れるので、「中央に戻す」は `focalPoint: null` を送れば足りる
        applyMeta("focalPoint", "focalPoint" in body, sanitizeFocalPoint(body.focalPoint) ?? undefined);
        const newCoords = sanitizeCoords(body.coords) ?? undefined;
        applyMeta("coords", "coords" in body, newCoords);
        // **地名から補った座標（geoApprox）は地名に付随する。**
        // `scripts/geocode-locations.js` が「パリ」から引いた街の中心は、
        // 撮影地を「ロンドン」に直した瞬間に嘘になる（地図で「ロンドン
        // （おおよそ）」のピンがパリに立つ）。編集画面は座標を送らないので、
        // 利用者にはそれを直す手段が無い。地名が変わったら座標ごと捨てる
        // （次の補填で引き直す）。正確な座標を書く口を通ったなら、
        // 「おおよそ」の印だけ下ろす
        // 座標に触った（消した場合も含む）なら印は残さない——座標が無いのに
        // `geoApprox: true` だけが孤立する形を作らない（レビュー指摘）
        if (existing.Item?.geoApprox === true && (locationChanged || "coords" in body)) {
            names["#geoApprox"] = "geoApprox";
            removes.push("#geoApprox");
            if (!("coords" in body)) {
                names["#coords"] = "coords";
                removes.push("#coords");
            }
            // 静的ページ（JSON-LD の geo・「地図で見る」）が変わるので作り直しを頼む。
            // 丸めた座標が同値で `applyMeta` が「変わっていない」と見た場合でも、
            // 印が下りるぶんは変わっている
            metaChanged = true;
        }

        let expr = `SET ${sets.join(", ")}`;
        if (removes.length) expr += ` REMOVE ${removes.join(", ")}`;
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            UpdateExpression: expr,
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
            // **DynamoDB の UpdateItem は、キーが無ければ行を作る。**
            // ここは「Get で所有権を確かめる → Update」の2段なので、その間に
            // 写真が消えると（別タブで削除・退会の掃除と競合）、
            // `{ id, updatedAt, published, title... }` という **src も userId も
            // 持たない行**ができる。一覧（attribute_exists(src)）・GSI（userId 無し）・
            // 詳細（!photo.src で404）のどれからも辿れず、本人には消す手段がない。
            // 対の api/src/ddb-photos.ts:115 は同じ理由で同じ条件を付けている。
            // stories.ts の viewStory も同型の穴をこれで塞いだ。
            ConditionExpression: "attribute_exists(id)",
        }));
        // 静的ページに焼かれる内容が変わったら、作り直しを頼む。
        //
        // 一度「published が実際に変わったときだけ」に絞ったが、これは狭すぎた。
        // この口は下書き編集（タイトル・説明・撮影地・タグ・日付）も通り、
        // /user/edit は保存のたびに published を必ず同梱する。つまり
        // 「説明に書いてしまった自宅の最寄り駅を消して保存」しても
        // published は変わらないので依頼されず、**消したはずの文言が
        // /photo/<id> の静的HTMLと JSON-LD に残り続ける**。
        //
        // かといって「指定されたら毎回」に戻すと、同じ値を送り続けるだけで
        // Actions の枠を使い切れる。だから条件は「実際に変わったか」で見つつ、
        // 対象を静的ページに載る項目まで広げ、連打は coalesce で畳む。
        //
        // 「キーが body にあるか」で見ていた時期があるが、それは
        // 「毎回」と同じだった——当時の /user/edit は保存のたびに全項目を
        // 送っていたので、何も変えずに保存を2回押すだけでビルドが2本走った
        // （1本8分・月2,000分）。metaChanged は applyMeta の中で保存済みの
        // 値と突き合わせている。
        //
        // **画面は今、変えた項目だけ送る**（7232340）。それでも値で見るのは
        // やめない——`published` は毎回同梱されるし、古いタブが読み込んだ
        // ままの JS は今も全項目を送ってくる。
        const wasPublished = existing.Item.published !== false;
        const visibilityChanged = hasPublished && body.published !== wasPublished;
        // **隠す操作は畳んでよい。ただし「届かなかった」ことは残す。**
        //
        // 一度ここを素通し（coalesce 無し）にしたが、**逆向きに倒していた**。
        // クールダウン（`claimRebuildSlot`）は `coalesce` を指定したときしか
        // 効かないのに、月次予算（`claimMonthlyBudget`）は**指定の有無に
        // 関わらず1加算される**。つまりクールダウンは畳み込みだけでなく
        // 「予算を減らす速度の唯一の歯止め」でもあった。素通しにすると
        // 公開⇄非公開のトグル200回で月の予算を使い切れる（連打を止める
        // 仕掛けは画面にもAPIにも無い）。使い切ると、その月いっぱい
        // **写真削除・退会・管理者削除の掃除が全部落ちる**——「隠すのが
        // 遅れる」を直して「消したのに残る」を月単位で作る取り引きだった。
        //
        // 畳まれた場合は「直近10分に誰かが依頼した」＝**ビルドがもう走って
        // いる**ということなので、たいていはその1本が拾う。拾えない窓
        // （そのビルドがテーブルを読んだ後〜ロックを下ろす前）は残るが、
        // そこは下の印で削除時に取り返す。
        const requested = visibilityChanged || metaChanged;
        const dispatched = requested
            ? await requestSiteRebuild(`photo updated: ${id}`, { coalesce: true })
            : false;

        // **下書きから公開に変えたら、共同アルバムに入れる。**
        //
        // `savePhoto` は `albumId && isPublished` のときだけ入れるので、
        // 招待から入った人が「下書き保存」した写真は**あとで公開しても
        // 一生アルバムに入らない**（招待ページにも一覧にも出ない）。
        // 本人の行には `albumId` が付いているので、**入ったつもりになる**
        // ——画面上は成功して見える壊れ方。
        // `addPhotoToAlbum` は冪等（既に入っていれば条件で落ちる）なので、
        // 二度押しでも増えない。**失敗しても公開は成功で返す**
        // （写真はもう公開されている。`savePhoto` の同じ呼び出しと同じ扱い）。
        //
        // **いまもメンバーかを確かめてから足す。** `savePhoto` は
        // 「ここを通さずに `albumId` を保存できると、誰でも他人のアルバムに
        // 写真を差し込める」として `isAlbumMember` を通している。こちらは
        // 行に書いてある `albumId` を信じて素通しだった。**いまは脱退の口が
        // 無いので悪用できない**が、片側だけの防御は「脱退」を足した日に
        // 静かに穴になる（このリポジトリが何度も踏んでいる形）。
        //
        // **「変わった回」ではなく「いま公開か」で見る。** `visibilityChanged`
        // を条件にすると、1回目でここが落ちた（スロットル・500枚上限）あとに
        // 押し直しても `wasPublished` が true なので二度と来ない
        // ——**公開されているのにアルバムには一生入らない**。しかも 500 を
        // 消したぶん、気づく手がかりも無い。`upload.ts` の再送は同じ場面に
        // 「再送でもアルバムに足す（`addPhotoToAlbum` は冪等）」で答えていて、
        // その理由もそこに書いてある。**同じ判断を隣で逆に書かない。**
        //
        // 代償はアルバムの写真を編集するたびに GetItem 1回と、条件で落ちる
        // 書き込み1回。アルバムに入っている写真は数が少ないので飲む。
        //
        // **判定は投げさせない。** ここは `UpdateCommand`（上の 238行）の
        // **あと**なので、裸の `await` を置くと写真はもう公開されているのに
        // 外側の catch に落ちて **500「更新に失敗しました」**になる。
        // すぐ下の `addPhotoToAlbum` が `.catch` で「失敗しても公開は成功で
        // 返す」と書いているのに、その直前に投げうる await を足していた。
        const albumId = typeof existing.Item.albumId === "string" ? existing.Item.albumId : "";
        // 今回の指定が無ければ、保存されている状態がそのまま残る
        const willBePublished = hasPublished ? body.published !== false : wasPublished;
        const stillMember = willBePublished && albumId
            ? await isAlbumMember(albumId, callerId).catch((e) => {
                console.error(`updatePhotoVisibility: メンバー判定に失敗（${id}）:`, e);
                return false;
            })
            : false;
        if (stillMember) {
            await addPhotoToAlbum(albumId, id).catch((e) => {
                console.error(`updatePhotoVisibility: アルバムに足せませんでした（${id}）:`, e);
            });
        }

        // **届かなかったことを行に残す。** 畳まれた・予算切れ・設定漏れ・
        // dispatch の失敗、どれでも false が返る。削除側は「非公開だった
        // 写真には静的ページが無い」と決め打ちして掃除を省くので、その前提が
        // 崩れたことを伝えないと、**非公開 →（依頼が届かない）→ 削除**で
        // 静的ページが誰にも消されないまま残る。
        // **画面に伝える**（`staticStale` として返す）。行に印が書けたかとは
        // 別に、「静的ページがまだ残りうる」ことは変わらない。ここを黙ると
        // 「非公開にしました」だけが出て、実際には検索から開ける状態が続く
        const hiding = visibilityChanged && body.published === false;
        const staticStale = hiding && !dispatched;
        // 公開のまま項目を消した場合。ページ自体は残ってよいが、**消した中身が残る**。
        // `staticStale`（非公開にした）とは**排他**——あちらは `hiding`、こちらは
        // `stillPublished` が要るので、同時には立たない。「強い方を優先する」と
        // 書きかけたが、そんな規則は要らなかった（変異で気づいた: 応答の三項の
        // 順番を入れ替えても何も変わらない）
        // **そもそも静的ページがあるか。** 下書きを「公開する」で出しながら項目を
        // 消すと、これが無いと「消した内容がページに残る」と言ってしまう
        // ——そのページはまだ作られていない。判定は `deleteMyPhoto` と同じ形
        // （非公開でも、掃除が届いていなければページは在る）。
        //
        // **「公開のままか」は見ない。** 一度そう書いたが、非公開にしたのに掃除が
        // 届かなかった写真（本番では毎回そうなる）を下書きとして編集し、項目を
        // 消したときに黙ってしまう——そのページは公開されたままで、消した内容も
        // 出ている。ページが在るなら、公開状態に関係なく伝える
        const staticPageExists = wasPublished || existing.Item.staticStale === true;
        const staticOutdated = metaRemoved && staticPageExists && !dispatched;
        if (staticStale) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id },
                    UpdateExpression: "SET staticStale = :t",
                    ExpressionAttributeValues: { ":t": true },
                    // Get → Update の間に写真が消えると、`staticStale` だけを
                    // 持つ幽霊行ができる（上の本体更新と同じ理由）
                    ConditionExpression: "attribute_exists(id)",
                }));
            } catch (e) {
                // 印が書けなくても非公開そのものは成立している。
                // ここで 500 にすると「隠せていないのに隠せたと思う」より
                // 「隠したのに失敗と出る」方を選ぶことになり、押し直しで
                // 二重に頼むだけなので、記録に留める
                console.error(`updatePhotoVisibility: staticStale の記録に失敗 (${id}):`, e);
            }
        }

        // **印を下ろすのは、実際に依頼を出して届いたときだけ。**
        //
        // 一度 `dispatched` の初期値を `true` にしていて、**何も変えずに
        // 「保存」を押しただけ**で（依頼は1本も出ていないのに）印が下りた
        // ——そのあと削除しても掃除を頼まず、塞いだはずの穴が印を消す側から
        // 戻ってきていた。いまは `requested` でないとき `dispatched` が
        // false なので、条件はこれ1つでよい（`requested &&` を足すと
        // **到達しない守り**になり、片方を壊しても緑になる）。
        if (dispatched && existing.Item.staticStale === true) {
            try {
                await ddb.send(new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id },
                    UpdateExpression: "REMOVE staticStale",
                    ConditionExpression: "attribute_exists(id)",
                }));
            } catch (e) {
                console.error(`updatePhotoVisibility: staticStale の解除に失敗 (${id}):`, e);
            }
        }

        return {
            statusCode: 200,
            headers: JSON_HEADERS,
            // **順番がそのまま規則。** 非公開にしながら項目も消した場合は両方
            // 立つので、強い方——「隠したはずのページがまだ取れる」——を出す
            // （消した内容の話はその中に含まれる）。
            // 一度「2つは排他だから順番に意味は無い」と書いたが、それは
            // `staticOutdated` に「公開のままか」を要求していたときの話で、
            // その条件は上のとおり外した
            body: JSON.stringify(
                staticStale ? { success: true, staticStale: true }
                    : staticOutdated ? { success: true, staticOutdated: true }
                        : { success: true }),
        };
    } catch (e) {
        // 条件が外れた＝Get と Update の間に写真が消えた。作り直さずに
        // 「見つかりません」と返す（stories.ts の viewStory と同じ扱い）。
        // 500 のままだと、利用者は「失敗したので再試行」と読んで押し直す。
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        console.error("updatePhotoVisibility error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};


// **`UPLOAD_BUCKET` の確認と S3 クライアントは `s3Delete.ts` が持つ。**
// ここで持っていた頃の削除は自前で、エッジの掃除が抜けていた。
// 未設定なら止める守りは向こうの `requireEnv` が効く（import で走る）。

/**
 * 自分の写真を1枚消す。
 *
 * **これまで一般ユーザーには消す手段が無かった。** 写真削除は管理API
 * （api/src/photosMutate.ts の deletePhoto、admin 限定）にしか無く、
 * api-user 側には deleteStory / deleteComment / deleteAccount はあるのに
 * deletePhoto が無い。できるのは「非公開にする」だけで、S3 の実体は残る。
 * つまり「撮影地に自宅の最寄り駅が写り込んでいた」と気づいた人の選択肢は
 * 「隠す（原本は公開URLに残る）」か「退会する」の二択だった。
 * 24時間で消えるストーリーは消せるのに、永久に残る写真が消せない。
 *
 * 順序と条件は account.ts の退会と同じにする（新しい機構は作らない）:
 *  - S3 を先、DynamoDB の行を後。逆にすると途中で切れたときに
 *    **GPS 入りの原本だけが公開URLに残る**（行はキーの唯一の手がかり）
 *  - S3 が1つでも消せなかったら行を残して 500。押し直せば続きから消える
 *  - comments# は行より先に消す（逆だと再実行で拾う手がかりが無くなる）
 */
export const deleteMyPhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには通知 notifs# / コメント comments# / フォロー関係も
    // 同じキー空間に入っている。写真以外は触らせない（読み側・更新側と同じ）。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }
    const callerId = getUserId(event);
    if (!callerId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    try {
        const existing = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        if (!existing.Item) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        const item = existing.Item as Record<string, unknown>;
        const ownerId = (item.userId ?? item.uploadedBy) as string | undefined;
        // !ownerId まで見る（updatePhotoVisibility と同じ）。無いと
        // 「持ち主が空の行 × sub の無いトークン」で "" === "" が成立する。
        if (!ownerId || ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }
        // ストーリーは deleteStory の担当。ここで消すと期限切れ掃除と
        // 二重管理になる（updatePhotoVisibility と同じ扱い）。
        if (item.story === true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        // 1. S3 の実体（本体・原本・派生すべて）。mediaKeys は退会と共通。
        //
        // **`s3DeleteMany` を通す。** ここは同じことを自前で書いていたので、
        // **エッジの掃除（`invalidateUploads`）だけが抜けていた**
        // ——退会とストーリーの削除は通っているのに、写真1枚の削除だけが
        // 素通り。`/uploads/*` は maxTTL 31536000秒（365日）で、実体は
        // `max-age=31536000` で置かれるので（本番実測 2026-09-05）、
        // **消したはずの写真が最大1年 公開URLで取れる**。`mediaKeys` は
        // `srcOriginal`（GPS 入りの原本）も含むので、消えていないのは
        // 見た目の1枚だけではない。
        const keys = mediaKeys(item);
        const s3Failures = await s3DeleteMany(keys, `deleteMyPhoto(${id})`);
        if (s3Failures > 0) {
            // 行は S3 キーの唯一の手がかり。消し残したまま行を消すと、
            // GPS 入りの原本が公開URLに孤児で残る（誰も辿れない）。
            return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像の削除を完了できませんでした。時間をおいてもう一度お試しください" }) };
        }

        // 1b. **ストーリーから残した写真なら、元のストーリーも消す。**
        //
        // 実体（S3）は**共有**している（`storyKeep.ts`）。写真だけ消すと、
        // まだ生きているストーリーが**全員のトレイに割れた画像で出続ける**
        // ——しかも `keptAs` が消した写真のIDを指したまま残るので、
        // 画面は「残した · 仕上げる」を出し、押すと「写真が見つかりません」、
        // 押し直しても冪等の分岐が死んだIDを返す＝**二度と残せない**。
        // 実体はもう無いのでストーリーは描けない。**行ごと消すのが正しい。**
        // 消せなくても写真の削除は成功で返す（最大24時間で掃除が拾う）。
        // **返信の文書も消す。ストーリーの行より先に。**
        // ここだけ行しか消していなかった——他の3経路（`deleteStory`・
        // 期限切れの掃除・退会）は全部 `storyreplies#` を先に消している。
        // 行が消えると返信の文書は `storyFeed` も `story` も `src` も
        // 持たないので **GSI にも Scan にも一覧にも出ない**＝どの削除経路
        // からも二度と辿れない（TTL も無い）。24時間で消えるはずの
        // 他人の文章とその人の `uid` が、無期限に残っていた。
        if (typeof item.keptFrom === "string" && item.keptFrom) {
            const storyId = item.keptFrom;
            try {
                await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: `storyreplies#${storyId}` } }));
                await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
            } catch (e) {
                // **消せなければ行を残す**（次に辿る手がかりになる）。
                // 写真の削除そのものは成功で返す——実体はもう消えていて、
                // ここで 500 にすると「写真が消えていない」という別の嘘になる
                console.error(`deleteMyPhoto: 元のストーリーを消せませんでした（${storyId}）:`, e);
            }
        }

        // 2. 自分のピン留めから外す（**行を消す前に**）。
        //    applyPinOp は上限(3)を配列長だけで数え、写真の実在を見ない。
        //    一方で画面は見つからないピンを黙って落とすので、消した写真が
        //    **枠を1つ永久に食い潰す**（「3枚留めた → 1枚消した → もう1枚
        //    留めようとすると 409。でも画面には2枚しか出ていない」で詰む。
        //    解除ボタンは表示された写真にしか無く、増減方式なので外せない）。
        //    行を消したあとでは、どのピンが宙に浮いたか分からなくなる。
        if (!await removePinnedPhoto(callerId, id)) {
            return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました。時間をおいてもう一度お試しください" }) };
        }

        // 3. その写真に付いたコメント（行より先）
        try {
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: `comments#${id}` } }));
        } catch (e) {
            console.error(`deleteMyPhoto: comments delete failed for ${id}:`, e);
            return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました。時間をおいてもう一度お試しください" }) };
        }

        // 4. 写真の行
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id } }));

        // 5. 静的ページの掃除。実体を消しても、配ってある /photo/<id> の HTML は
        //    残る（本文・撮影地・EXIF・表示名入りの JSON-LD まで焼き込み済み）。
        //    非公開だった写真には静的ページが無いので頼まない（A-5d と同じ判定）。
        //    **ただしその前提は「非公開化の依頼が実際に届いた場合」だけ成り立つ。**
        //    届かなかったときは `staticStale` が立っているので、そこは頼む。
        // **共同アルバムからも取り除く**（案C）。残すと、死んだ ID が
        // 500枚の枠を食い、招待ページの直近24枚の窓を埋める。
        // 削除そのものは止めない——写真はもう消えているので、ここで 500 を
        // 返すのは嘘になる（掃除の失敗を握らずログには残す）。
        if (typeof item.albumId === "string" && item.albumId) {
            await removePhotoFromAlbum(item.albumId, id).catch((e) => {
                console.error(`deleteMyPhoto: アルバムから取り除けませんでした（${id}）:`, e);
            });
        }

        // 頼めたかどうかを画面に返す（`updatePhotoVisibility` と同じ `staticStale`）。
        // 頼まなかった場合（非公開のまま印も無い）は静的ページが無いので false
        let staticStale = false;
        if (item.published !== false || item.staticStale === true) {
            // **coalesce を付けてはいけない。** rebuild.ts が明記している
            // とおり「削除・退会は実データを1件消さないと起こせない → 素通し」。
            // 付けると、同じ画面の『保存』が直前にロックを取っているだけで
            // 掃除の依頼が**見送られ、後から実行されない**——消したのに
            // /photo/<id> の静的HTML（本文・撮影地・EXIF・表示名入り JSON-LD）が
            // 残り、cron を止めている今は誰かが次に依頼するまで消えない。
            // 3枚まとめて消したときに1枚目しか飛ばない、という形でも踏む。
            // 対の api/src/photosMutate.ts も account.ts も coalesce 無し。
            staticStale = !await requestSiteRebuild(`photo deleted: ${id}`);
        }

        return {
            statusCode: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(staticStale ? { success: true, staticStale: true } : { success: true }),
        };
    } catch (e) {
        console.error("deleteMyPhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
