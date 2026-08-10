// lib/utils/pwa.ts
// PWA / ホーム画面追加まわりの純関数（テスト可能）。

/** iPhone / iPad / iPod か（UA 判定・主要ケースのみ） */
export function isIOS(ua: string): boolean {
    return /iP(hone|ad|od)/.test(ua);
}

/** iOS Safari 本体か（Chrome/Firefox/Edge/Opera の iOS 版や Android を除外）。
 *  A2HS（ホーム画面に追加）は Safari 本体からのみ実用的なため。 */
export function isIOSSafari(ua: string): boolean {
    if (!isIOS(ua)) return false;
    return /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android)/.test(ua);
}

/**
 * 「ホーム画面に追加」ヒントを出すべきか。
 * iOS Safari かつ 未インストール（非スタンドアロン）かつ 未 dismiss のときだけ true。
 */
export function shouldShowIosInstallHint(opts: {
    userAgent: string;
    standalone: boolean;
    dismissed: boolean;
}): boolean {
    const { userAgent, standalone, dismissed } = opts;
    if (standalone) return false; // 既にホーム画面アプリとして起動中
    if (dismissed) return false;
    return isIOSSafari(userAgent);
}
