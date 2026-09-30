// @vitest-environment jsdom
// ↑ 画像の属性（loading・srcset・sizes・alt）を happy-dom が jsdom と同じに扱わない。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **1ページ1オリジン**——画面に描く画像URLを、サイトのドメインに揃える。
 *
 * 保存されている値は CloudFront の既定ドメインで書かれる（api-user の
 * `canonicalUploadUrl` が `CLOUDFRONT_URL` を土台にし、deploy はそこに
 * 既定ドメインを渡す）。`og:image`・画像サイトマップ・JSON-LD は前から
 * `publicImageUrl` を通していたが、**画面に描く `<img>` は生のまま**だった。
 *
 * ここは**綴りではなく描画で見る**——実際に出た `src` / `srcset` を全部拾い、
 * CDN のホストが1つも残っていないことを見る（同じ部品の中に入口が
 * 増えても、増えた側が生のままなら落ちる）。
 */
const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";
const SITE = "https://journey-photo.com";

const withEnv = async <T,>(load: () => Promise<T>): Promise<T> => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CLOUDFRONT_URL", CDN);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    return load();
};

/** 描かれた木から、画像を指すURLを全部集める（`srcset` は1本ずつに割る） */
function imageUrls(root: HTMLElement): string[] {
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll("img, source, video"))) {
        const src = el.getAttribute("src");
        if (src) out.push(src);
        const set = el.getAttribute("srcset");
        if (set) out.push(...set.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean));
    }
    return out;
}

const cdnLeftIn = (root: HTMLElement) => imageUrls(root).filter((u) => u.includes("cloudfront.net"));

beforeEach(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("一覧のサムネ（Thumb）", () => {
    const photo = {
        src: `${CDN}/uploads/a.jpg`,
        thumbSrc: `${CDN}/uploads/a_512.webp`,
        thumbSm: `${CDN}/uploads/a_256.webp`,
        thumbAvif: `${CDN}/uploads/a_512.avif`,
        thumbSmAvif: `${CDN}/uploads/a_256.avif`,
    };

    it("本体も srcset も、サイトのドメインで出す", async () => {
        const Thumb = (await withEnv(async () => (await import("../Thumb")).default));
        const { container } = render(<Thumb photo={photo as never} alt="湖" />);
        expect(cdnLeftIn(container), "CDN の既定ドメインのまま描いている").toEqual([]);
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(`${SITE}/uploads/a_512.webp`);
        const avif = container.querySelector('source[type="image/avif"]')?.getAttribute("srcset");
        expect(avif).toBe(`${SITE}/uploads/a_256.avif 256w, ${SITE}/uploads/a_512.avif 512w`);
        const webp = container.querySelector('source[type="image/webp"]')?.getAttribute("srcset");
        expect(webp).toBe(`${SITE}/uploads/a_256.webp 256w, ${SITE}/uploads/a_512.webp 512w`);
    });

    // **ぼかしは data: URI**。揃える対象ではない（触ると画像が消える）
    it("ぼかしの data: URI は触らない", async () => {
        const Thumb = (await withEnv(async () => (await import("../Thumb")).default));
        const blur = "data:image/webp;base64,AAAA";
        const { container } = render(<Thumb photo={{ ...photo, blurDataURL: blur } as never} alt="湖" />);
        expect(container.querySelector('img[src^="data:"]')?.getAttribute("src")).toBe(blur);
    });

    // 知らないホスト（別のところから来る画像）は触らない
    it("知らないホストのサムネは触らない", async () => {
        const Thumb = (await withEnv(async () => (await import("../Thumb")).default));
        const { container } = render(<Thumb photo={{ src: "https://example.org/x.jpg" } as never} alt="湖" />);
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe("https://example.org/x.jpg");
    });
});

describe("拡大表示（ModalImage）", () => {
    it("AVIF の source も本体も、サイトのドメインで出す", async () => {
        const ModalImage = (await withEnv(async () => (await import("../GalleryModal/ModalImage")).default));
        const { container } = render(
            <ModalImage src={`${CDN}/uploads/b.webp`} srcAvif={`${CDN}/uploads/b.avif`} alt="湖" />,
        );
        expect(cdnLeftIn(container), "CDN の既定ドメインのまま描いている").toEqual([]);
        expect(container.querySelector('source[type="image/avif"]')?.getAttribute("srcset")).toBe(`${SITE}/uploads/b.avif`);
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(`${SITE}/uploads/b.webp`);
    });
});

/**
 * 🔴 **描かない要求も、同じオリジンに揃える。**
 *
 * 写真ページは、データ側に EXIF が無い写真だけ**画像そのものを取りに行って**
 * 撮影情報を読む（`exifr`）。その入口だけ生の `src` を渡していたので、
 * 同じ1枚に対して2つのホストへ要求が飛んでいた——
 * `<img>` は `journey-photo.com`、EXIF は CloudFront の既定ドメイン。
 * 別オリジンなので CORS が要り、返らなければ**撮影情報の欄が黙って出ない**
 * （例外は握るので画面に何も出ない＝気づけない）。
 *
 * ⚠️ **この経路は描画に出ないので、上の「描かれたURL」では見えない。**
 * だから綴りで見る。**自己点検つき**——読む場所が消えたら、空回りで緑に
 * ならずに落ちる。
 */
describe("写真ページの EXIF 抽出（描かないが飛ぶ要求）", () => {
    const readLoadExif = (): string => {
        const src = readFileSync(
            join(__dirname, "..", "..", "photo", "[id]", "PhotoPageClient.tsx"), "utf8");
        const m = /const loadExif = async \(\) => \{([\s\S]*?)\n        \};/.exec(src);
        return m?.[1] ?? "";
    };

    it("見る場所が実在する（空回りしていない）", () => {
        const body = readLoadExif();
        expect(body, "loadExif が見つからない（名前が変わった？）").not.toBe("");
        expect(body, "exifr を呼んでいない").toContain("exifr.parse(");
        expect(body, "画像を取りに行く控えの経路が無い").toContain("fetch(");
    });

    it("取りに行く先を publicImageUrl で揃えている", () => {
        const body = readLoadExif();
        expect(body, "生の src のまま取りに行っている").toContain("publicImageUrl(src)");
        // `exifr.parse(src` / `fetch(src` が1つも残っていないこと
        const raw = [...body.matchAll(/\b(?:exifr\.parse|fetch)\(\s*src\b/g)].map((x) => x[0]);
        expect(raw, "生の src を渡している呼び出しが残っている").toEqual([]);
    });
});
