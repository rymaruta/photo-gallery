import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { preloadImage, preloadImages, useImagePreloader } from "../useImagePreloader";

type MockImg = {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
};

let lastImg: MockImg;

beforeEach(() => {
    lastImg = { src: "", onload: null, onerror: null };
    vi.stubGlobal("Image", function () {
        lastImg = { src: "", onload: null, onerror: null };
        return new Proxy(lastImg, {
            set(target, prop, value) {
                (target as Record<string, unknown>)[prop as string] = value;
                // src が設定されたら何もしない（onload/onerror はテストで手動発火）
                return true;
            },
        });
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("preloadImage", () => {
    it("onload が発火すると Promise が resolve する", async () => {
        const p = preloadImage("https://example.com/img.jpg");
        lastImg.onload?.();
        await expect(p).resolves.toBeUndefined();
    });

    it("onerror が発火すると Promise が reject する", async () => {
        const p = preloadImage("https://example.com/bad.jpg");
        lastImg.onerror?.();
        await expect(p).rejects.toThrow("Failed to load image");
    });

    it("src が img.src にセットされる", () => {
        preloadImage("https://example.com/x.jpg");
        expect(lastImg.src).toBe("https://example.com/x.jpg");
    });
});

describe("preloadImages", () => {
    it("全画像が成功した場合 Promise が resolve する", async () => {
        const images: MockImg[] = [];
        vi.stubGlobal("Image", function () {
            const img: MockImg = { src: "", onload: null, onerror: null };
            images.push(img);
            return img;
        });

        const p = preloadImages(["a.jpg", "b.jpg", "c.jpg"]);
        // 全て成功させる
        for (const img of images) img.onload?.();
        const results = await p;
        expect(results).toHaveLength(3);
    });

    it("一部の画像が失敗しても他は継続する", async () => {
        const images: MockImg[] = [];
        vi.stubGlobal("Image", function () {
            const img: MockImg = { src: "", onload: null, onerror: null };
            images.push(img);
            return img;
        });

        const p = preloadImages(["ok.jpg", "bad.jpg"]);
        images[0].onload?.();  // 成功
        images[1].onerror?.(); // 失敗
        await expect(p).resolves.toBeDefined(); // 全体は reject しない
    });

    it("空配列を渡すと空の結果を返す", async () => {
        const results = await preloadImages([]);
        expect(results).toHaveLength(0);
    });
});

describe("useImagePreloader", () => {
    it("同じ URL を 2 回 preload しても Image は 1 回しか作られない", () => {
        let count = 0;
        vi.stubGlobal("Image", function () {
            count++;
            return { src: "", onload: null, onerror: null };
        });

        const { result } = renderHook(() => useImagePreloader());
        act(() => {
            result.current.preload("https://example.com/dup.jpg");
            result.current.preload("https://example.com/dup.jpg");
        });
        expect(count).toBe(1);
    });

    it("異なる URL はそれぞれプリロードされる", () => {
        let count = 0;
        vi.stubGlobal("Image", function () {
            count++;
            return { src: "", onload: null, onerror: null };
        });

        const { result } = renderHook(() => useImagePreloader());
        act(() => {
            result.current.preloadMultiple(["a.jpg", "b.jpg", "c.jpg"]);
        });
        expect(count).toBe(3);
    });
});
