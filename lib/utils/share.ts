// lib/utils/share.ts
// 共有機能用のユーティリティ

/**
 * Web Share APIを使用してURLを共有。
 * Web Share API が利用不可の場合はクリップボードにコピーし true を返す（呼び出し元でトーストを表示する）。
 */
export async function shareUrl(url: string, title?: string, text?: string): Promise<boolean> {
    if (typeof window === "undefined") return false;

    if (navigator.share) {
        try {
            await navigator.share({ title: title || "", text: text || "", url });
        } catch (error) {
            // ユーザーがキャンセルした場合も含む — 無視してよい
            console.error("Error sharing:", error);
        }
        return false;
    }

    // フォールバック: クリップボードにコピー
    await copyToClipboard(url);
    return true;
}

/**
 * クリップボードにURLをコピー
 */
export async function copyToClipboard(text: string): Promise<void> {
    if (typeof window === "undefined") return;

    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // フォールバック: 古い方法を使用
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand("copy");
        } catch (err) {
            console.error("Failed to copy:", err);
        }
        document.body.removeChild(textArea);
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
