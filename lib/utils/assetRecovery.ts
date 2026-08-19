// アセット読み込み失敗からの自動復旧。
// デプロイ直後の食い違いや一時的なネットワーク断で CSS/JS が 404 になると、
// 「スタイルの無い壊れたページ」や「タップが効かないページ」になる。
// その場合に1回だけ自動リロードして自己修復する（手動リロードで直る問題の自動化）。

const KEY = "jp_asset_reload_at";
const RELOAD_COOLDOWN_MS = 60_000; // 連続リロードのループ防止

/** script / stylesheet の読み込み失敗か（IMG 等の失敗では発火させない） */
export function isAssetElement(target: EventTarget | null): boolean {
    if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
    const tag = (target as HTMLElement).tagName.toUpperCase();
    if (tag === "SCRIPT") return true;
    if (tag === "LINK") {
        const rel = ((target as HTMLLinkElement).rel ?? "").toLowerCase();
        return rel.includes("stylesheet");
    }
    return false;
}

function getStorage(): Storage | null {
    try {
        return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
        return null;
    }
}

/** 直近にリロード済みでなければ true（無限リロードループの防止） */
export function shouldAutoReload(now = Date.now(), storage: Storage | null = getStorage()): boolean {
    if (!storage) return false;
    try {
        const last = Number(storage.getItem(KEY) ?? 0);
        return !(Number.isFinite(last) && last > 0 && now - last < RELOAD_COOLDOWN_MS);
    } catch {
        return false;
    }
}

/** リロード実行を記録する */
export function markReloaded(now = Date.now(), storage: Storage | null = getStorage()): void {
    try {
        storage?.setItem(KEY, String(now));
    } catch { /* ignore */ }
}

/**
 * CSS が実際に効いているかを確かめる。
 *
 * error イベントだけに頼ると取りこぼす場合がある:
 * - <link rel=stylesheet> は HTML の先頭に置かれるため、error が
 *   リスナー登録より先に発火しうる（キャッシュ済みの 404 など）
 * - CDN/WAF が 200 + HTML 本文を返した場合、ブラウザによっては
 *   error にならず「読み込めたが規則ゼロ」になる
 *
 * JS だけ動いて CSS が無い状態は水和ウォッチドッグでも検知できないため、
 * 「規則が1つも無い＝当たっていない」を直接見る。
 */
export function stylesheetsApplied(doc: Document): boolean {
    const links = doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]');
    if (links.length === 0) return true; // そもそも外部CSSが無いページは対象外
    for (const link of Array.from(links)) {
        const sheet = link.sheet;
        if (!sheet) continue; // 読み込み失敗 or 未完了
        try {
            if (sheet.cssRules && sheet.cssRules.length > 0) return true;
        } catch {
            // クロスオリジンで規則を読めない = 読み込みは成功している
            return true;
        }
    }
    return false;
}
