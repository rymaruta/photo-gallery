import { describe, it, expect } from "vitest";
import { isIOS, isIOSSafari, shouldShowIosInstallHint, canAddToHomeScreen, isInAppBrowser, iosVersion } from "../pwa";

const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const IPHONE_CHROME_16_3 =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/112.0 Mobile/15E148 Safari/604.1";
const IPHONE_LINE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0";
const IPHONE_GSA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/320.0.648785217 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.108 (iPhone15,2; iOS 17_5; ja_JP)";
const MAC_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("isIOS", () => {
    it("iPhone/iPad/iPod を判定する", () => {
        expect(isIOS(IPHONE_SAFARI)).toBe(true);
        expect(isIOS(IPHONE_CHROME)).toBe(true);
    });
    it("Android / Mac は false", () => {
        expect(isIOS(ANDROID_CHROME)).toBe(false);
        expect(isIOS(MAC_SAFARI)).toBe(false);
    });
});

describe("isIOSSafari", () => {
    it("iOS Safari 本体のみ true", () => {
        expect(isIOSSafari(IPHONE_SAFARI)).toBe(true);
    });
    it("iOS Chrome(CriOS) は false", () => {
        expect(isIOSSafari(IPHONE_CHROME)).toBe(false);
    });
    it("Android Chrome / Mac Safari は false", () => {
        expect(isIOSSafari(ANDROID_CHROME)).toBe(false);
        expect(isIOSSafari(MAC_SAFARI)).toBe(false);
    });
});

describe("shouldShowIosInstallHint", () => {
    it("iOS Safari・非スタンドアロン・未dismiss なら表示", () => {
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI, standalone: false, dismissed: false })).toBe(true);
    });
    it("スタンドアロン起動中は非表示", () => {
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI, standalone: true, dismissed: false })).toBe(false);
    });
    it("一度閉じたら非表示", () => {
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_SAFARI, standalone: false, dismissed: true })).toBe(false);
    });
    // iOS 16.4 からは Chrome も共有メニューからホーム画面に追加できる（#13）
    it("iOS 16.4 以降の Chrome では表示、それより前・Android では非表示", () => {
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_CHROME, standalone: false, dismissed: false })).toBe(true);
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_CHROME_16_3, standalone: false, dismissed: false })).toBe(false);
        expect(shouldShowIosInstallHint({ userAgent: ANDROID_CHROME, standalone: false, dismissed: false })).toBe(false);
    });
});

// docs/ios-bug-audit-2026-09-25.md #13: 出し分けが iOS の実態と合っていなかった
describe("ホーム画面に追加できるブラウザの見分け", () => {
    it("iPad（Mac を名乗る）はタッチ点の数で見分ける。Mac は 0", () => {
        expect(isIOS(MAC_SAFARI, 5), "iPad を Mac と見ている").toBe(true);
        expect(isIOS(MAC_SAFARI, 0)).toBe(false);
        expect(shouldShowIosInstallHint({ userAgent: MAC_SAFARI, standalone: false, dismissed: false, maxTouchPoints: 5 })).toBe(true);
        expect(shouldShowIosInstallHint({ userAgent: MAC_SAFARI, standalone: false, dismissed: false, maxTouchPoints: 0 })).toBe(false);
    });

    it("アプリの中のブラウザ（LINE・Google アプリ・Instagram）では出さない（追加できない）", () => {
        for (const ua of [IPHONE_LINE, IPHONE_GSA, IPHONE_INSTAGRAM]) {
            expect(isInAppBrowser(ua), ua).toBe(true);
            expect(canAddToHomeScreen(ua), ua).toBe(false);
            expect(isIOSSafari(ua), ua).toBe(false);
        }
        expect(isInAppBrowser(IPHONE_SAFARI)).toBe(false);
    });

    it("版は UA の OS か、iPad の Version から読む", () => {
        expect(iosVersion(IPHONE_SAFARI)).toEqual([17, 5]);
        expect(iosVersion(MAC_SAFARI)).toEqual([17, 5]);
        expect(iosVersion(ANDROID_CHROME)).toBeNull();
    });
});
