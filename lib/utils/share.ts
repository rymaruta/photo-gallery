// lib/utils/share.ts
// 共有機能用のユーティリティ

/**
 * Web Share APIを使用してURLを共有
 */
export function shareUrl(url: string, title?: string, text?: string): void {
    if (typeof window === "undefined") return;

    if (navigator.share) {
        navigator.share({
            title: title || "",
            text: text || "",
            url: url,
        }).catch((error) => {
            console.error("Error sharing:", error);
        });
    } else {
        // Web Share APIがサポートされていない場合はクリップボードにコピー
        copyToClipboard(url);
    }
}

/**
 * クリップボードにURLをコピー
 */
export async function copyToClipboard(text: string): Promise<void> {
    if (typeof window === "undefined") return;

    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
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
export function shareToFacebook(url: string): void {
    if (typeof window === "undefined") return;
    const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(facebookUrl, "_blank", "width=550,height=420");
}

/**
 * LINEで共有
 */
export function shareToLine(url: string, text?: string): void {
    if (typeof window === "undefined") return;
    const lineText = text ? `${text} ${url}` : url;
    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || "")}`;
    window.open(lineUrl, "_blank", "width=550,height=420");
}
