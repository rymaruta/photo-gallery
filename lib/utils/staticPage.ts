/**
 * 「消したのに、検索から開けるページはまだ残っている」を利用者に伝える。
 *
 * このサイトは写真ごとに静的HTML（`/photo/<id>`）を配っている。非公開・削除で
 * DynamoDB の行と S3 の実体は消えるが、**その HTML はサイトを作り直すまで
 * 残る**（本文・撮影地・EXIF・表示名入りの JSON-LD ごと）。サーバーは削除の
 * たびに再ビルドを頼むが、頼めないことがある——トークン未設定・今月の上限・
 * 直近の依頼にまとめられた・GitHub 側の失敗。
 *
 * **本番は今まさにトークンが未設定**（2026-09-01 に診断で確認）なので、
 * 毎回残る。それでも画面は「非公開にしました」とだけ言っていた。
 * 隠せていないものを「隠した」と言わないための一文を、サーバーの印
 * （`staticStale`）が立っているときだけ添える。
 */

/** 非公開・削除の応答に「静的ページがまだ残る」印があるか */
export function staticPagePending(data: unknown): boolean {
    return !!data && typeof data === "object" && (data as { staticStale?: unknown }).staticStale === true;
}

/**
 * 上の印が立っているときだけ、文言に一文を足す。
 *
 * **「必ず残る」とは言わない**——まとめられた依頼は先に走っているビルドが
 * 拾うことが多い。逆に「もう見えません」と言い切ると、トークン未設定の今は
 * 毎回嘘になる。「残ることがある」がどちらの場合も正しい。
 */
export function withStaticPageNotice(message: string, pending: boolean, isJa: boolean): string {
    if (!pending) return message;
    return isJa
        ? `${message}。検索から開ける個別ページは、次のサイト更新まで残ることがあります`
        : `${message}. The photo's own page may stay reachable until the next site update.`;
}
