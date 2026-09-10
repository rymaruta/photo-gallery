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

/**
 * 応答の印。
 * - `pending`  : 隠した／消したのに、ページがまだ取れる（`staticStale`）
 * - `outdated` : 公開のままだが、**消した項目が**まだ出ている（`staticOutdated`）
 * - `fresh`    : 掃除を頼めた（か、そもそも静的ページが無い）
 */
export type StaticPageState = "fresh" | "pending" | "outdated";

export function staticPageState(data: unknown): StaticPageState {
    if (!data || typeof data !== "object") return "fresh";
    const d = data as { staticStale?: unknown; staticOutdated?: unknown };
    if (d.staticStale === true) return "pending";
    if (d.staticOutdated === true) return "outdated";
    return "fresh";
}

/**
 * 上の印が立っているときだけ、文言に一文を足す。
 *
 * **「必ず残る」とは言わない**——まとめられた依頼は先に走っているビルドが
 * 拾うことが多い。逆に「もう見えません」と言い切ると、トークン未設定の今は
 * 毎回嘘になる。「残ることがある」がどちらの場合も正しい。
 */
export const STATIC_NOTICE_TOAST_MS = 8000;

/** `useToast` の `showToast`（この util から画面の型を引かないための構造型） */
type ShowToast = (message: string, type?: "success" | "error" | "info", duration?: number) => void;

/**
 * 応答の印を見てトーストを出す。**3つの呼び出しはこれを通す**——文言と
 * 表示時間を各画面に書き写すと、片方だけ直して静かにずれる（この台帳の型2）。
 * 印が無いときは普段どおり（既定の3秒）。一文が付くと45文字あり、3秒では
 * 後半を読み切れないので伸ばす
 */
export function toastWithStaticPage(showToast: ShowToast, message: string, data: unknown, isJa: boolean): void {
    const state = staticPageState(data);
    if (state === "fresh") {
        showToast(message, "success");
        return;
    }
    showToast(withStaticPageNotice(message, state, isJa), "success", STATIC_NOTICE_TOAST_MS);
}

export function withStaticPageNotice(message: string, state: StaticPageState, isJa: boolean): string {
    if (state === "fresh") return message;
    if (state === "outdated") {
        return isJa
            ? `${message}。消した内容は、検索から開けるページに次のサイト更新まで残ることがあります`
            : `${message}. What you removed may still show on the photo's own page until the next site update.`;
    }
    return isJa
        ? `${message}。検索から開ける個別ページは、次のサイト更新まで残ることがあります`
        : `${message}. The photo's own page may stay reachable until the next site update.`;
}
