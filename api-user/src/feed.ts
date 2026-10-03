import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";
import { PUBLIC_INDEX, PUBLIC_FEED_KEY } from "./publicFeed";
import { JSON_HEADERS, jsonError } from "./http";
import { stripForPublicList } from "./privateFields";

const USERS_TABLE = requireEnv("USERS_TABLE");

/**
 * GET /feed?limit=&cursor= — 公開写真の一覧を、新しい順に**ページで**返す（認証なし）。
 *
 * ## なぜ要るのか
 *
 * 写真の一覧は静的な `photos.json`（ビルド時に全件）と、管理APIの `GET /photos`
 * （呼ばれるたびに全表 Scan して全件）しか無かった。どちらも「全部」を一度に返すので、
 * 写真が増えるほどアプリの初回表示が重くなる。ここは**決まった枚数ずつ**返す。
 *
 * ## 索引を足していない
 *
 * 既にある `publicFeed-createdAt-index` の仕切り `"1"`（公開中の写真）を
 * `createdAt` の新しい順に Query する。`GET /feed/restricted` は同じ索引の
 * 別の仕切り（`"restricted"`）を引いているので、混ざらない。
 *
 * ## 返す形
 *
 *     200 { "items": Photo[], "nextCursor": string | null }
 *
 * - `items` の各行は **`photos.json` と同じ項目**（`stripForPublicList`）。
 *   表示名は sync と同じく users テーブルの**いまの名前**に差し替える
 * - `nextCursor` が null なら終わり。**`items` が `limit` より少なくても
 *   `nextCursor` があれば続きがある**（読む上限 `MAX_ROUNDS` で打ち切った回）
 *
 * ## ふるい
 *
 * 索引の仕切り `"1"` に載っているのは公開中の写真だけのはずだが、**印は行の写し**
 * なので、非公開化・ストーリー・公開範囲の変更と書き違えた行が残る可能性はある。
 * 静的な一覧（sync）と同じ条件で**もう一度ふるう**（`isPublicListPhoto`）。
 * ふるいはコード側で見る——`Limit` はふるう**前**に効くので、
 * 落ちた分だけ続きを読む（上限つき）。
 */
export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 60;
/**
 * 1回の呼び出しで Query を打つ上限。ふるいで落ちる行が続いても、
 * Lambda の時間と読み取り費用を際限なく使わない。届かなかった分は
 * `nextCursor` で次の呼び出しに回す（取りこぼしではない）。
 */
export const MAX_ROUNDS = 5;
/** カーソルの長さの上限（base64url の文字数）。中身は id と日時だけなので十分 */
const MAX_CURSOR_LENGTH = 512;

/**
 * 静的な一覧（`scripts/sync-photos-from-ddb.js` の `scan()`）と同じ条件。
 * **写真（`src` を持つ）・公開中（`published !== false`）・ストーリーでない・
 * 公開範囲を絞っていない**。`audience` は中身を見ず、持っていれば落とす
 * （知らない値でも隠す側に倒す。`api/src/photos.ts` の `isRestricted` と同じ構え）。
 */
export function isPublicListPhoto(item: Record<string, unknown>): boolean {
    if (!item.src) return false;
    if (item.published === false) return false;
    if (item.story === true) return false;
    const a = item.audience;
    if (typeof a === "string" ? a.trim() !== "" : a != null) return false;
    return true;
}

type CursorKey = { id: string; createdAt: string };

/**
 * LastEvaluatedKey → 不透明な文字列。
 *
 * **仕切りの値（`publicFeed`）は入れない。** 読むときにこちらで `"1"` を
 * 入れ直すので、カーソルを書き換えて別の仕切り（`"restricted"`）を
 * 引かせることはできない。
 */
export function encodeCursor(key: Record<string, unknown>): string {
    const body: CursorKey & { v: 1 } = { v: 1, id: String(key.id), createdAt: String(key.createdAt) };
    return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/**
 * 不透明な文字列 → ExclusiveStartKey。**壊れている・書き換えられていれば null。**
 *
 * 署名はしていない（中身は公開の写真の id と投稿日時だけで、書き換えても
 * 「公開一覧の別の位置から読める」以上のことは起きない）。そのかわり形を
 * 厳しく見る: base64url の文字だけ・JSON・鍵がちょうど `v`/`id`/`createdAt`・
 * `v` が 1・`id` が写真の id として使える文字だけ・`createdAt` が ISO 8601 の日時で始まる。
 */
export function decodeCursor(raw: string): Record<string, unknown> | null {
    if (!raw || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    if (keys.join(",") !== "createdAt,id,v") return null;
    if (o.v !== 1) return null;
    // **こちらが出したカーソルを自分で弾かない**よう、形は緩めに見る
    // （写真の id は uuid だが、古い行や管理APIの行で形が違っても読めるように）。
    // `#` は写真以外の文書（`notifs#…` など）のキーにしか使わないので弾く
    if (typeof o.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(o.id)) return null;
    if (typeof o.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]{1,40}$/.test(o.createdAt)) return null;
    return { id: o.id, createdAt: o.createdAt, publicFeed: PUBLIC_FEED_KEY };
}

/** `limit` を読む。無ければ既定、上限を超えたら上限。**数でなければ null（400）** */
export function parseLimit(raw: string | undefined): number | null {
    if (raw === undefined || raw === "") return DEFAULT_LIMIT;
    if (!/^\d{1,4}$/.test(raw)) return null;
    const n = Number(raw);
    if (n < 1) return null;
    return Math.min(n, MAX_LIMIT);
}

/**
 * 1ページぶんを読む。ふるいで落ちた分だけ続きを読み、`MAX_ROUNDS` で打ち切る。
 *
 * **`Limit` には「あと何枚要るか」を渡す。** ふるいで減ることはあっても増えることは
 * ないので、集まった時点の LastEvaluatedKey が**ちょうど次の読み始め**になる
 * （多めに読んで捨てると、捨てた行が次のページから抜ける）。
 */
export async function readPage(limit: number, startKey: Record<string, unknown> | undefined) {
    const items: Record<string, unknown>[] = [];
    let lastKey = startKey;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: PUBLIC_INDEX,
            KeyConditionExpression: "publicFeed = :k",
            ExpressionAttributeValues: { ":k": PUBLIC_FEED_KEY },
            // 新しい順
            ScanIndexForward: false,
            Limit: limit - items.length,
            ExclusiveStartKey: lastKey as never,
        }));
        for (const item of (res.Items ?? []) as Record<string, unknown>[]) {
            if (isPublicListPhoto(item)) items.push(item);
        }
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!lastKey || items.length >= limit) break;
    }
    return { items, lastKey };
}

/**
 * 写真の行に焼かれた表示名を、users テーブルの**いまの値**で置き換える。
 *
 * `scripts/sync-photos-from-ddb.js` の `freshDisplayNames` と同じ規則
 * （別の言語・別のパッケージなので import はできない）:
 *   - 行が無い・退会済み（`deletedAt`）→ 写真の値のまま
 *   - 名前が空 → 写真の `displayName` を消す
 *   - 読めなかった → 写真の値のまま（**一覧は止めない**。1人ずつ見張る）
 */
export async function withCurrentDisplayNames(photos: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const ids = [...new Set(photos.map((p) => p.userId).filter((v): v is string => typeof v === "string" && v !== ""))];
    if (ids.length === 0) return photos;
    const names = new Map<string, string | undefined>();
    await Promise.all(ids.map(async (userId) => {
        try {
            const res = await ddb.send(new GetCommand({
                TableName: USERS_TABLE,
                Key: { userId },
                ProjectionExpression: "displayName, deletedAt",
            }));
            const item = res.Item as { displayName?: unknown; deletedAt?: unknown } | undefined;
            if (!item || item.deletedAt) return;
            const name = typeof item.displayName === "string" ? item.displayName.trim() : "";
            names.set(userId, name || undefined);
        } catch (e) {
            console.warn(`getFeed: ${userId} の表示名を読めませんでした:`, (e as Error)?.name ?? e);
        }
    }));
    return photos.map((p) => {
        const uid = typeof p.userId === "string" ? p.userId : "";
        if (!names.has(uid)) return p;
        const next = names.get(uid);
        if (p.displayName === next) return p;
        const copy = { ...p };
        if (next) copy.displayName = next;
        else delete copy.displayName;
        return copy;
    });
}

export const getFeed: APIGatewayProxyHandlerV2 = async (event) => {
    const q = event.queryStringParameters ?? {};
    const limit = parseLimit(q.limit);
    if (limit === null) return jsonError(400, "limit が不正です");
    let startKey: Record<string, unknown> | undefined;
    if (q.cursor !== undefined) {
        const decoded = decodeCursor(q.cursor);
        if (!decoded) return jsonError(400, "cursor が不正です");
        startKey = decoded;
    }
    try {
        const { items, lastKey } = await readPage(limit, startKey);
        const named = await withCurrentDisplayNames(items.map(stripForPublicList));
        return {
            statusCode: 200,
            // 誰が来ても同じ答え（公開写真だけ）。`getLikeCount` と同じ約束
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify({ items: named, nextCursor: lastKey ? encodeCursor(lastKey) : null }),
        };
    } catch (e) {
        console.error("getFeed error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
