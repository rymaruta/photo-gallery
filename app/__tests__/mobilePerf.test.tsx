// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Photo } from "@/lib/data/photos";

/**
 * **トップのスマホの表示速度（2026-10-28・PageSpeed Insights: 性能 58・LCP 8.8秒）で直したもの。**
 *
 *   1. LCP（並びの先頭の大きい1枚）だけ `fetchPriority="high"` と `<head>` の先読み
 *      ——`<picture>` の中の `<img>` は React が先読みに上げないので、HTML を最後まで
 *      読むまで代表写真の取得が始まらなかった。最初の3枚が全部 high で取り合ってもいた
 *   2. GA4 は `lazyOnload`（`afterInteractive` だと `<head>` に gtag.js の先読みが出る）
 *   3. ホームの撮影スポットの札の下のリンク（写真の表示）を 24px の的にする
 *
 * Web フォントの CSS を描画を止めない形にしたのは `webFontsDeferred.test.tsx`。
 */
const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: `題${id}`, category: "travel", tags: [],
    thumbSrc: `https://cdn/${id}_thumb.webp`, thumbSm: `https://cdn/${id}_thumb_sm.webp`,
    thumbAvif: `https://cdn/${id}_thumb.avif`, thumbSmAvif: `https://cdn/${id}_thumb_sm.avif`,
    displayName: "丸田", location: "パリ, フランス", likes: 0, createdAt: "2026-10-01T00:00:00Z",
    ...over,
} as Photo);

describe("ホームの並び: LCP の1枚だけを先に", () => {
    it("high は先頭の1枚だけ。2・3枚目は eager のまま優先度は既定、4枚目からは lazy", async () => {
        const { default: HomeMosaic } = await import("../components/HomeMosaic");
        const { container } = render(<HomeMosaic photos={["a", "b", "c", "d"].map((i) => photo(i))} locale="ja" />);
        const imgs = Array.from(container.querySelectorAll("picture img"));
        expect(imgs.map((i) => i.getAttribute("loading"))).toEqual(["eager", "eager", "eager", "lazy"]);
        expect(imgs.map((i) => i.getAttribute("fetchpriority"))).toEqual(["high", "auto", "auto", "auto"]);
    });

    it("サーバーで描くと、先頭の1枚の AVIF の srcset が <head> の先読みに出る（同じ sizes・type 付き）", async () => {
        const { default: HomeMosaic } = await import("../components/HomeMosaic");
        const { MOSAIC_HERO_SIZES } = await import("../components/gridSizes");
        const html = renderToString(
            <html><head /><body><HomeMosaic photos={["a", "b", "c"].map((i) => photo(i))} locale="ja" /></body></html>,
        );
        const head = html.slice(0, html.indexOf("</head>"));
        const links = head.match(/<link rel="preload" as="image"[^>]*>/g) ?? [];
        expect(links, "画像の先読みは1本だけ").toHaveLength(1);
        // 先読みの候補は <picture> の AVIF の <source> と**全文一致**（ずれると2回落とす）
        const source = /<source type="image\/avif" srcSet="([^"]+)"/.exec(html)?.[1];
        expect(source, "AVIF の <source> が無い").toBeTruthy();
        expect(/imageSrcSet="([^"]+)"/.exec((links[0] ?? ""))?.[1]).toBe(source);
        expect((links[0] ?? "")).toContain('type="image/avif"');
        expect((links[0] ?? "")).toContain('fetchPriority="high"');
        expect((links[0] ?? "")).toContain(`imageSizes="${MOSAIC_HERO_SIZES}"`);
    });

    it("先に読まない（priorityCount=0）ときは先読みも high も出さない", async () => {
        const { default: HomeMosaic } = await import("../components/HomeMosaic");
        const html = renderToString(
            <html><head /><body><HomeMosaic photos={["a", "b"].map((i) => photo(i))} locale="ja" priorityCount={0} /></body></html>,
        );
        expect(html).not.toMatch(/rel="preload" as="image"/);
        expect(html).not.toMatch(/fetchPriority="high"/);
    });

    it("派生が無い写真は src をそのまま先読みする", async () => {
        const { preloadThumb } = await import("../components/Thumb");
        const Probe = () => { preloadThumb({ fallback: "https://cdn/x.jpg" }); return null; };
        const html = renderToString(<html><head /><body><Probe /></body></html>);
        const link = html.match(/<link rel="preload"[^>]*>/)?.[0] ?? "";
        expect(link).toContain('href="https://cdn/x.jpg"');
        expect(link).toContain('as="image"');
        expect(link).toContain('fetchPriority="high"');
        expect(link).not.toContain("imageSrcSet");
    });
});

describe("GA4 は描画のあと", () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("next/script"); vi.resetModules(); });

    it("gtag.js も初期化も strategy=\"lazyOnload\"（`<head>` に先読みを出さない）", async () => {
        vi.resetModules(); // `siteConfig` は読み込んだ時に環境変数を読む
        vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-TEST");
        vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", "");
        const seen: Array<{ src?: string; id?: string; strategy?: string }> = [];
        vi.doMock("next/script", () => ({
            default: (p: { src?: string; id?: string; strategy?: string }) => { seen.push(p); return null; },
        }));
        const { default: Analytics } = await import("../components/Analytics");
        render(<Analytics />);
        expect(seen.length).toBe(2);
        expect(seen.map((s) => s.strategy)).toEqual(["lazyOnload", "lazyOnload"]);
        expect(seen[0].src).toContain("googletagmanager.com/gtag/js?id=G-TEST");
    });
});

describe("撮影スポットの札の下のリンクは 24px の的", () => {
    it("ライセンスと作者のリンクが、どちらも高さ 24px の箱になっている", async () => {
        const { TopicCreditLine, COMPACT_CREDIT_LINE } = await import("../components/SpotTopicLists");
        const { LocaleProvider } = await import("../i18n/context");
        expect(COMPACT_CREDIT_LINE).toBeGreaterThanOrEqual(24);
        const { container } = render(<LocaleProvider><TopicCreditLine compact credit={{
            author: "作者", license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg",
        }} /></LocaleProvider>);
        const box = container.querySelector<HTMLElement>("[data-testid=topic-credit]")!;
        expect(box.style.lineHeight).toBe(`${COMPACT_CREDIT_LINE}px`);
        expect(box.style.fontSize).toBe("12px");
        const [license, author] = Array.from(box.querySelectorAll("a"));
        // 行の高さを受け継ぐには inline 以外の箱が要る（inline のリンクの的は字の高さ＝14px のまま）
        expect(license.className).toMatch(/\binline-block\b/);
        expect(author.className).toMatch(/\bblock\b/);
        // 作者の行は切る（「…」はリンクの側に掛けないと出ない）
        expect(author.className).toMatch(/\btruncate\b/);
    });
});
