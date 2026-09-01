import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shareToTwitter, shareToLine } from "../share";

// 切り詰めが絵文字を割った表示名（修正前に保存されたもの）が混ざると、
// `encodeURIComponent` が `URIError` で投げる。ハンドラの中なので
// **共有ボタンが無反応になる**。入口は塞いだが、既に保存されている値には
// 効かない。

const broken = ("あ".repeat(99) + "👍").slice(0, 100);   // 末尾が上位サロゲート

let opened: string[] = [];
beforeEach(() => {
    opened = [];
    vi.stubGlobal("window", {
        ...globalThis.window,
        open: (url: string) => { opened.push(url); return null; },
    });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("共有: 壊れた表示名でもボタンが死なない", () => {
    it("Twitter: 投げずに開く", () => {
        expect(() => shareToTwitter("https://journey-photo.com/users/u1", broken)).not.toThrow();
        expect(opened).toHaveLength(1);
        expect(opened[0].startsWith("https://twitter.com/intent/tweet?text=")).toBe(true);
    });

    it("LINE: 投げずに開く", () => {
        expect(() => shareToLine("https://journey-photo.com/users/u1", broken)).not.toThrow();
        expect(opened).toHaveLength(1);
    });

    it("正当な絵文字は落とさない", () => {
        shareToTwitter("https://x.test/", "旅する人😊");
        expect(decodeURIComponent(opened[0].split("text=")[1])).toContain("旅する人😊");
    });
});
