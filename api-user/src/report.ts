import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { sanitizeText } from "./sanitize";

/**
 * **不適切な投稿の通報。**
 *
 * `block.ts` が「通報（誰かが読んで裁く仕組みが要る。利用者1人の今は
 * 空回りする）」として見送っていたもの。**前提が変わった**——確認済みの
 * 利用者は5人になり、他人の投稿が並ぶ画面ができた。
 * App Store のガイドライン 1.2（利用者が作る中身を扱うアプリ）も、
 * ブロック・問い合わせ先に加えて**通報の口**を求めている。
 *
 * **作りは最小にする。** 通報は「運営が読んで判断する」ためのもので、
 * 自動で何かを消す仕組みは作らない——誤報や嫌がらせで正当な投稿が
 * 消える方が、対応が数日遅れるより悪い。
 */

/** 通報の理由。**画面と同じ一覧**（増やすときは両方） */
export const REPORT_REASONS = [
    "copyright",   // 自分の写真を無断で使われている
    "privacy",     // 写っている人・場所の権利を害している
    "sexual",      // わいせつな内容
    "violence",    // 暴力的・残虐な内容
    "harassment",  // 特定の人への攻撃・いやがらせ
    "spam",        // 広告・勧誘・スパム
    "other",       // その他
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function isReportReason(v: unknown): v is ReportReason {
    return typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
}

/** 通報の行のキー。**1人1投稿につき1件**（同じ人が押し直しても増えない） */
export const reportId = (photoId: string, reporterId: string) => `report#${photoId}#${reporterId}`;

/** 補足の説明の上限。長い文章を溜めるところではない */
export const REPORT_NOTE_MAX = 500;

/**
 * POST /photos/{id}/report
 *
 * **ログインが要る。** 未認証で受けると、誰でも無限に行を作れる
 * ——このテーブルは公開一覧が全表 Scan で端から端まで読むので、
 * 増えるほど全員の表示が遅くなる（`block.ts` が同じ理由で形を見ている）。
 */
export const reportPhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!me || !photoId) return jsonError(400, "不正なリクエスト");
    // 写真以外は触らせない（読み側・削除側・管理API と同じ）
    if (photoId.includes("#")) return jsonError(404, "写真が見つかりません");

    let body: { reason?: unknown; note?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}");
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    if (!isReportReason(body.reason)) return jsonError(400, "理由を選んでください");

    try {
        // **実在する写真か確かめる。** 見ないと、任意の文字列を写真に
        // 見立てて行を作れる（`block.ts` が形を見ているのと同じ理由）。
        // 非公開・下書きも通す——通報したい相手が直後に隠すことがある
        const photo = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE, Key: { id: photoId },
            ProjectionExpression: "id, src, userId, uploadedBy, story",
        }));
        if (!photo.Item?.src) return jsonError(404, "写真が見つかりません");

        const ownerId = (photo.Item.userId ?? photo.Item.uploadedBy) as string | undefined;
        // **自分の投稿は通報できない。** 通す意味が無く、運営の手間だけ増える
        if (ownerId && ownerId === me) return jsonError(400, "自分の投稿は通報できません");

        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: {
                id: reportId(photoId, me),
                photoId,
                reporterId: me,
                ...(ownerId ? { ownerId } : {}),
                reason: body.reason,
                ...(() => { const n = sanitizeText(body.note, REPORT_NOTE_MAX); return n ? { note: n } : {}; })(),
                ...(photo.Item.story === true ? { story: true } : {}),
                createdAt: new Date().toISOString(),
            },
            // 条件は付けない。**同じ人が押し直したら上書き**でよい
            // （理由を選び直したいことがある）。1人1件に保たれる
        }));

        // **受け付けたことだけ返す。** 「対応しました」とは言わない
        // ——読むのは人で、すぐには終わらない
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("reportPhoto failed:", (e as Error)?.name);
        return jsonError(500, "通報を受け付けられませんでした");
    }
};
