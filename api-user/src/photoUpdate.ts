import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId } from "./http";
import { sanitizeText, sanitizeTags, sanitizeTitle, sanitizeDescription, sanitizeCoords, sanitizeDate, sameStoredValue } from "./sanitize";
import { requestSiteRebuild } from "./rebuild";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl } from "./mediaHosts";

type PhotoSong = { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string };

// 下書き編集で更新できるメタデータ項目。キーが body にあれば更新対象。
const META_KEYS = ["title", "description", "location", "category", "tags", "date", "coords"] as const;

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

    let body: {
        published?: boolean; song?: unknown; songYoutubeUrl?: unknown;
        title?: unknown; description?: unknown; location?: unknown;
        category?: unknown; tags?: unknown; date?: unknown; coords?: unknown;
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
            const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
            if (!previewUrl || !title) {
                return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な曲データです" }) };
            }
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
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
        if (hasPublished) { sets.push("published = :p"); values[":p"] = body.published; }
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
        const applyMeta = (col: string, present: boolean, value: unknown) => {
            if (!present) return;
            const willRemove = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
            // 「変わったか」は**書いたあとの姿**で見る。空配列をそのまま比べていた頃は、
            // タグ属性を持たない写真（タグ未入力の下書きは全部これ）に対して
            // /user/edit が必ず送る tags: [] が毎回「変わった」になり、
            // 実際には REMOVE が何もしないので次の保存でも同じ判定になった
            // ——何も書き換えずに保存するだけでビルドが走り続ける。
            if (!sameStoredValue(willRemove ? undefined : value, existing.Item?.[col])) metaChanged = true;
            names[`#${col}`] = col;
            if (willRemove) {
                removes.push(`#${col}`);
            } else {
                sets.push(`#${col} = :${col}`);
                values[`:${col}`] = value;
            }
        };
        applyMeta("title", "title" in body, sanitizeTitle(body.title));
        applyMeta("description", "description" in body, sanitizeDescription(body.description));
        applyMeta("location", "location" in body, sanitizeText(body.location, 200));
        applyMeta("category", "category" in body, sanitizeText(body.category, 100));
        applyMeta("tags", "tags" in body, sanitizeTags(body.tags));
        // 撮影日は upload.ts と同じ検証を通す。sanitizeText だと40文字までの
        // 任意の文字列が入り、年表の並び順が壊れる
        applyMeta("date", "date" in body, sanitizeDate(body.date));
        applyMeta("coords", "coords" in body, sanitizeCoords(body.coords) ?? undefined);

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
        // 「毎回」と同じだった——/user/edit は保存のたびに全項目を送るので、
        // 何も変えずに保存を2回押すだけでビルドが2本走る（1本8分・月2,000分）。
        // metaChanged は applyMeta の中で保存済みの値と突き合わせている。
        const wasPublished = existing.Item.published !== false;
        const visibilityChanged = hasPublished && body.published !== wasPublished;
        if (visibilityChanged || metaChanged) {
            await requestSiteRebuild(`photo updated: ${id}`, { coalesce: true });
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
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
