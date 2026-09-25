// lib/utils/pwa.ts
// PWA / ホーム画面追加まわりの純関数（テスト可能）。

/**
 * iPhone / iPad / iPod か。
 *
 * **iPadOS 13 以降の Safari は既定で Mac を名乗る**（`Macintosh; Intel Mac OS X`）。
 * UA だけでは Mac と区別できないので、タッチ点の数（`maxTouchPoints`）も見る
 * ——Mac は 0（トラックパッドは数えない）、iPad は 5。渡さなければ UA だけで判定する。
 */
export function isIOS(ua: string, maxTouchPoints = 0): boolean {
    if (/iP(hone|ad|od)/.test(ua)) return true;
    return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** iOS Safari 本体か（Chrome/Firefox/Edge/Opera の iOS 版や Android を除外） */
export function isIOSSafari(ua: string, maxTouchPoints = 0): boolean {
    if (!isIOS(ua, maxTouchPoints)) return false;
    return /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android)/.test(ua) && !isInAppBrowser(ua);
}

/**
 * アプリの中のブラウザか（LINE・Instagram・Facebook・X・Google アプリなど）。
 * **ここからはホーム画面に追加できない。** UA に `Safari` を含むもの
 * （LINE の `Safari Line/…`、Google アプリの `GSA/… Safari/604.1`）もあるので、
 * Safari かどうかより先に見る。
 */
export function isInAppBrowser(ua: string): boolean {
    return /(FBAN|FBAV|Instagram|\bLine\/|GSA\/|Twitter|MicroMessenger|KAKAOTALK|; wv\))/i.test(ua);
}

/** iOS の版（UA の `OS 17_5` か、iPad の Mac 表記の `Version/17.5`）。読めなければ null */
export function iosVersion(ua: string): [number, number] | null {
    const m = ua.match(/OS (\d+)[_.](\d+)/) ?? ua.match(/Version\/(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * このブラウザからホーム画面に追加できるか。
 * Safari 本体はいつでも。iOS 16.4 からは Chrome・Firefox・Edge も
 * 共有メニューから追加できる。アプリの中のブラウザはできない。
 */
export function canAddToHomeScreen(ua: string, maxTouchPoints = 0): boolean {
    if (!isIOS(ua, maxTouchPoints) || isInAppBrowser(ua)) return false;
    if (isIOSSafari(ua, maxTouchPoints)) return true;
    if (!/(CriOS|FxiOS|EdgiOS)/.test(ua)) return false;
    const v = iosVersion(ua);
    return !!v && (v[0] > 16 || (v[0] === 16 && v[1] >= 4));
}

/**
 * 「ホーム画面に追加」ヒントを出すべきか。
 * ホーム画面に追加できるブラウザ かつ 未インストール（非スタンドアロン）かつ
 * 未 dismiss のときだけ true。
 */
export function shouldShowIosInstallHint(opts: {
    userAgent: string;
    standalone: boolean;
    dismissed: boolean;
    /** `navigator.maxTouchPoints`（iPad が Mac を名乗るのを見分ける） */
    maxTouchPoints?: number;
}): boolean {
    const { userAgent, standalone, dismissed, maxTouchPoints = 0 } = opts;
    if (standalone) return false; // 既にホーム画面アプリとして起動中
    if (dismissed) return false;
    return canAddToHomeScreen(userAgent, maxTouchPoints);
}
