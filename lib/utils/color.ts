// テーマカラー用の色ヘルパー

/** #rrggbb を白と混ぜて明るくする（ratio=0で元色、1で白） */
export function mixWithWhite(hex: string, ratio = 0.5): string {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = (v: number) => Math.round(v + (255 - v) * Math.min(1, Math.max(0, ratio)));
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** テーマカラーからアバターリング用の回転グラデーションを作る */
export function themeRingGradient(themeColor?: string): string {
    if (themeColor && /^#[0-9a-fA-F]{6}$/.test(themeColor)) {
        const light = mixWithWhite(themeColor, 0.55);
        return `conic-gradient(from 0deg, ${themeColor}, ${light}, ${themeColor})`;
    }
    // 既定: 真鍮（デザインシステム「黒塗りの真鍮」。以前は旅パレットの sky → emerald）
    return "conic-gradient(from 0deg, #c9a66b, #e3c98f, #796440, #c9a66b)";
}
