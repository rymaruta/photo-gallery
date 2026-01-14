// lib/utils/string.ts
// 文字列操作ユーティリティ

/**
 * 文字列の最初の文字を大文字に変換
 */
export function capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
