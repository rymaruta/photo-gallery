import { describe, it, expect } from "vitest";
import { isIOS, isIOSSafari, shouldShowIosInstallHint } from "../pwa";

const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
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
    it("iOS Chrome / Android では非表示", () => {
        expect(shouldShowIosInstallHint({ userAgent: IPHONE_CHROME, standalone: false, dismissed: false })).toBe(false);
        expect(shouldShowIosInstallHint({ userAgent: ANDROID_CHROME, standalone: false, dismissed: false })).toBe(false);
    });
});
