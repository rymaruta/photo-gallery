import { describe, it, expect, vi, beforeEach } from "vitest";
import { shareToTwitter, shareToLine, shareUrl, copyToClipboard } from "../share";

const openMock = vi.fn();
Object.defineProperty(window, "open", { value: openMock, writable: true });

beforeEach(() => openMock.mockClear());

describe("shareToTwitter", () => {
    it("twitter.com の URL を window.open で開く", () => {
        shareToTwitter("https://example.com", "写真のタイトル");
        expect(openMock).toHaveBeenCalledOnce();
        const url = openMock.mock.calls[0][0] as string;
        expect(url).toContain("twitter.com/intent/tweet");
        expect(url).toContain(encodeURIComponent("https://example.com"));
        expect(url).toContain(encodeURIComponent("写真のタイトル"));
    });

    it("text が省略されてもエラーにならない", () => {
        expect(() => shareToTwitter("https://example.com")).not.toThrow();
        expect(openMock).toHaveBeenCalledOnce();
    });
});

describe("shareToLine", () => {
    it("line.me の URL を window.open で開く", () => {
        shareToLine("https://example.com", "シェアテキスト");
        expect(openMock).toHaveBeenCalledOnce();
        const url = openMock.mock.calls[0][0] as string;
        expect(url).toContain("line.me");
        expect(url).toContain(encodeURIComponent("https://example.com"));
    });
});

function stubClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
        value: { writeText }, writable: true, configurable: true,
    });
}
function stubShare(share: unknown) {
    Object.defineProperty(navigator, "share", { value: share, writable: true, configurable: true });
}

// 以前は navigator.share の失敗を全部握りつぶして false を返していた。
// Instagram のアプリ内ブラウザのように「share は在るが呼ぶと拒否される」環境で、
// 共有ボタンを押しても本当に何も起きなかった（トーストもコピーも無し）。
describe("shareUrl", () => {
    it("共有シートが無ければクリップボードに落として copied", async () => {
        const clip = vi.fn().mockResolvedValue(undefined);
        stubClipboard(clip);
        stubShare(undefined);

        expect(await shareUrl("https://example.com")).toBe("copied");
        expect(clip).toHaveBeenCalledWith("https://example.com");
    });

    it("共有できたら shared", async () => {
        stubShare(vi.fn().mockResolvedValue(undefined));
        expect(await shareUrl("https://example.com")).toBe("shared");
    });

    it("利用者が閉じたら cancelled（何も出さないため）", async () => {
        const abort = Object.assign(new Error("cancel"), { name: "AbortError" });
        stubShare(vi.fn().mockRejectedValue(abort));
        expect(await shareUrl("https://example.com")).toBe("cancelled");
    });

    it("共有シートが拒否されたらクリップボードに落とす（回帰ガード）", async () => {
        const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
        stubShare(vi.fn().mockRejectedValue(denied));
        const clip = vi.fn().mockResolvedValue(undefined);
        stubClipboard(clip);

        expect(await shareUrl("https://example.com")).toBe("copied");
        expect(clip).toHaveBeenCalledWith("https://example.com");
    });

    it("共有もコピーもできなければ failed", async () => {
        stubShare(undefined);
        stubClipboard(vi.fn().mockRejectedValue(new Error("no clipboard")));
        // 旧方式（execCommand）も失敗させる
        Object.defineProperty(document, "execCommand", {
            value: () => false, writable: true, configurable: true,
        });
        expect(await shareUrl("https://example.com")).toBe("failed");
    });
});

// 以前は失敗しても何も返さず、呼び出し側の catch が死んでいた。
// クリップボードが空でも「コピーしました」と出ていた。
describe("copyToClipboard", () => {
    it("成功したら true", async () => {
        stubClipboard(vi.fn().mockResolvedValue(undefined));
        expect(await copyToClipboard("x")).toBe(true);
    });

    it("失敗したら false（成功を騙らない）", async () => {
        stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
        Object.defineProperty(document, "execCommand", {
            value: () => false, writable: true, configurable: true,
        });
        expect(await copyToClipboard("x")).toBe(false);
    });

    it("古い方法で成功すれば true", async () => {
        stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
        Object.defineProperty(document, "execCommand", {
            value: () => true, writable: true, configurable: true,
        });
        expect(await copyToClipboard("x")).toBe(true);
    });
});
