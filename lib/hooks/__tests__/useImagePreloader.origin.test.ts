import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * **先読みするURLは、画面に出すURLと同じでなければ意味がない。**
 *
 * 画面に描く側（`Thumb` / `ModalImage`）を `publicImageUrl` で
 * サイトのドメインに揃えたとき、**先読みだけ生のまま**にしていた。
 * 別々のURLなのでブラウザのキャッシュは当たらず、**同じ写真を2回落とす**
 * ——先読みは節約のための仕組みなのに、逆に倍払う形になっていた
 * （拡大表示は前後2枚も先読みし、お気に入りは最大10枚）。
 *
 * ここは**綴りではなく、実際に `Image` に入った値**で見る。
 */
const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";
const SITE = "https://journey-photo.com";

/** `new Image()` を差し替えて、入った src を記録する */
function captureImages(): string[] {
    const seen: string[] = [];
    class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(v: string) { seen.push(v); }
        get src() { return seen[seen.length - 1] ?? ""; }
    }
    vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
    return seen;
}

const load = async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", CDN);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    return import("../useImagePreloader");
};

beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("画像の先読み", () => {
    it("配信の既定ドメインで保存された写真も、サイトのドメインで先読みする", async () => {
        const seen = captureImages();
        const { preloadImage } = await load();
        void preloadImage(`${CDN}/uploads/a.jpg`);
        expect(seen, "画面に出すURLと違うものを先読みしている").toEqual([`${SITE}/uploads/a.jpg`]);
    });

    it("複数枚でも全部揃える", async () => {
        const seen = captureImages();
        const { preloadImages } = await load();
        void preloadImages([`${CDN}/uploads/a.jpg`, `${SITE}/uploads/b.jpg`]);
        expect(seen).toEqual([`${SITE}/uploads/a.jpg`, `${SITE}/uploads/b.jpg`]);
    });

    // 知らないホストは触らない（曲のアートワークなど、別のところから来る画像）
    it("知らないホストは触らない", async () => {
        const seen = captureImages();
        const { preloadImage } = await load();
        void preloadImage("https://example.org/x.jpg");
        expect(seen).toEqual(["https://example.org/x.jpg"]);
    });

    // **札も揃えたあとの値で持つ。** 生の値で覚えると、
    // 同じ写真を「別のURL」として二重に先読みする
    it("同じ写真は、URLの書き方が違っても一度しか先読みしない", async () => {
        const seen = captureImages();
        const { useImagePreloader } = await load();
        const { renderHook } = await import("@testing-library/react");
        const { result } = renderHook(() => useImagePreloader());
        result.current.preload(`${CDN}/uploads/a.jpg`);
        result.current.preload(`${SITE}/uploads/a.jpg`);
        expect(seen, "同じ写真を2回先読みしている").toEqual([`${SITE}/uploads/a.jpg`]);
    });
});
