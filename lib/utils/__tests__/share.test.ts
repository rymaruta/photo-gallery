import { describe, it, expect, vi, beforeEach } from "vitest";
import { shareToTwitter, shareToLine, shareUrl } from "../share";

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

describe("shareUrl", () => {
    it("navigator.share がない場合は clipboardにコピーして true を返す", async () => {
        const clipMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: clipMock },
            writable: true,
            configurable: true,
        });
        Object.defineProperty(navigator, "share", {
            value: undefined,
            writable: true,
            configurable: true,
        });

        const result = await shareUrl("https://example.com");
        expect(result).toBe(true);
        expect(clipMock).toHaveBeenCalledWith("https://example.com");
    });
});
