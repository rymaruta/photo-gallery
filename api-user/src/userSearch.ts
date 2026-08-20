// ユーザー検索。@ユーザー名・表示名から人を探す。
//
// 公開エンドポイント（未ログインでも使える）。返すのは公開プロフィールの
// 一部だけで、メールアドレス等は元々テーブルに持っていない。

import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { JSON_HEADERS } from "./http";
import { requireEnv } from "./env";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const USERS_TABLE = requireEnv("USERS_TABLE");

/** 検索結果1件。プロフィール全体ではなく、一覧に必要な項目だけ返す。 */
export type UserSearchHit = {
    userId: string;
    username?: string;
    displayName?: string;
    bio?: string;
    themeColor?: string;
};

const MAX_RESULTS = 20;
// 1ページあたりの読み取り件数。ユーザー数が増えたら GSI に置き換える。
const SCAN_PAGE_SIZE = 500;
// 走査するページ数の上限。青天井にすると、1文字違いの検索語を並べるだけで
// テーブル全体のスキャンを何度でも起こせてしまうため、上限は要る。
const SCAN_MAX_PAGES = 10;

/** ユーザー名の予約アイテム（userId="username#xxx"）は検索結果に出さない */
function isReservationItem(userId: unknown): boolean {
    return typeof userId === "string" && userId.startsWith("username#");
}

function toHit(item: Record<string, unknown>): UserSearchHit | null {
    const userId = item.userId;
    if (typeof userId !== "string" || !userId || isReservationItem(userId)) return null;
    return {
        userId,
        ...(typeof item.username === "string" ? { username: item.username } : {}),
        ...(typeof item.displayName === "string" ? { displayName: item.displayName } : {}),
        ...(typeof item.bio === "string" ? { bio: item.bio.slice(0, 100) } : {}),
        ...(typeof item.themeColor === "string" ? { themeColor: item.themeColor } : {}),
    };
}

/**
 * 検索語にどれだけ強く一致するかを点数化する。
 * 完全一致 > 前方一致 > 部分一致 の順。@ユーザー名は表示名より優先する。
 * 一致しなければ 0（＝結果に含めない）。
 */
export function scoreUser(hit: UserSearchHit, q: string): number {
    const needle = q.toLowerCase();
    const username = (hit.username ?? "").toLowerCase();
    const displayName = (hit.displayName ?? "").toLowerCase();

    if (username && username === needle) return 100;
    if (displayName && displayName === needle) return 90;
    if (username.startsWith(needle)) return 80;
    if (displayName.startsWith(needle)) return 70;
    if (username.includes(needle)) return 60;
    if (displayName.includes(needle)) return 50;
    return 0;
}

/** 検索を始めてよい語かどうか。英数字は2文字以上、日本語などは1文字以上。 */
export function isSearchableQuery(q: string): boolean {
    if (!q) return false;
    if (/[^\u0000-\u007F]/.test(q)) return q.length >= 1;
    return q.length >= 2;
}

/** 検索語の正規化。先頭の @ を落とし、前後の空白を削る。 */
export function normalizeQuery(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.trim().replace(/^@+/, "").trim().slice(0, 50);
}

// GET /users/search?q=...
export const searchUsers: APIGatewayProxyHandlerV2 = async (event) => {
    const q = normalizeQuery(event.queryStringParameters?.q);
    // 英数字は2文字から（1文字では候補が多すぎる）。
    // 日本語などASCII外を含む場合は1文字でも十分絞り込めるので許可する。
    if (!isSearchableQuery(q)) {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ users: [] }) };
    }

    try {
        const hits = new Map<string, { hit: UserSearchHit; score: number }>();

        // @ユーザー名の完全一致は予約アイテムから直接引ける（スキャン不要・確実）
        if (/^[a-z0-9_]{3,20}$/.test(q)) {
            const res = await ddb.send(new GetItemCommand({
                TableName: USERS_TABLE,
                Key: marshall({ userId: `username#${q}` }),
            }));
            const ownerId = res.Item ? (unmarshall(res.Item) as { ownerId?: string }).ownerId : undefined;
            if (ownerId) {
                const owner = await ddb.send(new GetItemCommand({
                    TableName: USERS_TABLE,
                    Key: marshall({ userId: ownerId }),
                }));
                const hit = owner.Item ? toHit(unmarshall(owner.Item)) : null;
                if (hit) hits.set(hit.userId, { hit, score: 100 });
            }
        }

        // 部分一致はスキャンで拾う。件数が少ないうちはこれで十分速い。
        //
        // 以前は1ページ読んで LastEvaluatedKey を捨てていた。ユーザー名を
        // 登録した人は予約アイテム（username#<handle>）でもう1行増えるので、
        // 実質500人ほどで打ち切られ、それ以降に登録した人は表示名で検索しても
        // 出てこなかった。しかも @ハンドル完全一致だけは別経路で引けるため、
        // 「一部の人だけ検索できない」という分かりにくい壊れ方をしていた。
        // 予約アイテムはサーバー側で弾いて、読み取り枠を食わせない。
        let lastKey: Record<string, unknown> | undefined;
        let pages = 0;
        do {
            const scan = await ddb.send(new ScanCommand({
                TableName: USERS_TABLE,
                Limit: SCAN_PAGE_SIZE,
                ProjectionExpression: "userId, username, displayName, bio, themeColor",
                FilterExpression: "NOT begins_with(userId, :reserved)",
                ExpressionAttributeValues: marshall({ ":reserved": "username#" }),
                ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
            }));
            for (const raw of scan.Items ?? []) {
                const hit = toHit(unmarshall(raw));
                if (!hit || hits.has(hit.userId)) continue;
                const score = scoreUser(hit, q);
                if (score > 0) hits.set(hit.userId, { hit, score });
            }
            lastKey = scan.LastEvaluatedKey as Record<string, unknown> | undefined;
            pages++;
        } while (lastKey && pages < SCAN_MAX_PAGES);
        if (lastKey) {
            console.warn(`searchUsers: ${SCAN_MAX_PAGES}ページで打ち切りました（GSI への移行時期）`);
        }

        const users = Array.from(hits.values())
            .sort((a, b) => b.score - a.score || (a.hit.displayName ?? "").localeCompare(b.hit.displayName ?? ""))
            .slice(0, MAX_RESULTS)
            .map((x) => x.hit);

        return {
            statusCode: 200,
            // 同じ検索語なら短時間キャッシュしてよい（プロフィール更新の反映は1分以内）
            headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=60" },
            body: JSON.stringify({ users }),
        };
    } catch (e) {
        console.error("searchUsers error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "検索に失敗しました" }) };
    }
};
