import { usableRows } from "./apiRows";

/**
 * 利用者の一覧の行（フォロー中・ブロックした人）。
 *
 * **同じ形を2つ書きかけた。** `FollowingSheet` と `BlockedUsers` が
 * それぞれローカルに `usableRows` / `usableUsers` を持っていて、しかも
 * 片方は**共有実装と同名で契約が違った**（共有版は配列でなければ `null` を
 * 返して「取れなかった」と扱わせるのに、こちらは `[]` を返して黙る）。
 * その結果、`{users: <配列でない>, total: 5}` を返されると
 * **「まだ誰もフォローしていません」と「5人のうち、はじめの0人」を
 * 同時に出す**——自分で掲げた「読み込み中・失敗・0人を分ける」に反していた。
 *
 * 判定は共有の `usableRows` に通したうえで、`id` を持つ行だけ残す。
 */
export type UserRow = { id: string; name?: string; username?: string; deleted?: boolean };

/** @returns 配列でなければ `null`（呼び出し側が「取れなかった」と扱えるように） */
export function usableUserRows(data: unknown, label: string): UserRow[] | null {
    const rows = usableRows<{ id?: unknown; name?: unknown; username?: unknown; deleted?: unknown }>(data, label);
    if (!rows) return null;
    const out: UserRow[] = [];
    for (const r of rows) {
        if (typeof r.id !== "string" || !r.id) continue;
        out.push({
            id: r.id,
            ...(typeof r.name === "string" && r.name ? { name: r.name } : {}),
            ...(typeof r.username === "string" && r.username ? { username: r.username } : {}),
            ...(r.deleted === true ? { deleted: true } : {}),
        });
    }
    return out;
}
