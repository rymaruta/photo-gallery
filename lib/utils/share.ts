// lib/utils/share.ts
// 共有機能用のユーティリティ

/** 共有の結果。呼び出し側はこれを見て出すメッセージを決める。 */
export type ShareResult =
    | "shared"     // 共有シートで共有できた
    | "copied"     // 共有シートが使えずクリップボードにコピーした
    | "cancelled"  // 利用者が共有シートを閉じた（何も出さない）
    | "failed";    // 共有もコピーもできなかった

/**
 * URL を共有する。共有シートが使えなければクリップボードに落とす。
 *
 * 以前は navigator.share の失敗を全部握りつぶして false を返していた。
 * そのため Instagram のアプリ内ブラウザのように「navigator.share は在るが
 * 呼ぶと NotAllowedError で拒否される」環境では、共有ボタンを押しても
 * 本当に何も起きなかった（トーストも出ない、コピーにも落ちない）。
 * 利用者のキャンセルだけは区別して、何も出さない。
 */
export async function shareUrl(url: string, title?: string, text?: string): Promise<ShareResult> {
    if (typeof window === "undefined") return "failed";

    if (navigator.share) {
        try {
            await navigator.share({ title: title || "", text: text || "", url });
            return "shared";
        } catch (error) {
            // 利用者が閉じただけ。エラー扱いしない
            if ((error as { name?: string })?.name === "AbortError") return "cancelled";
            // 共有シートを出せない環境。下のコピーに落とす
        }
    }

    return (await copyToClipboard(url)) ? "copied" : "failed";
}

/**
 * クリップボードにコピーする。成功したかどうかを返す。
 *
 * 以前は失敗しても何も返さなかったため、呼び出し側の catch は死んでいて、
 * クリップボードが空のままでも「コピーしました」と出ていた。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    if (typeof window === "undefined") return false;

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // フォールバック: 古い方法を使用（非セキュアコンテキスト等）
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (err) {
            console.error("Failed to copy:", err);
        }
        document.body.removeChild(textArea);
        return ok;
    }
}

/**
 * Twitterで共有
 */
export function shareToTwitter(url: string, text?: string): void {
    if (typeof window === "undefined") return;
    const tweetText = text ? `${text} ${url}` : url;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    window.open(twitterUrl, "_blank", "width=550,height=420");
}

/**
 * Facebookで共有
 */

/**
 * LINEで共有
 */
export function shareToLine(url: string, text?: string): void {
    if (typeof window === "undefined") return;
    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || "")}`;
    window.open(lineUrl, "_blank", "width=550,height=420");
}
