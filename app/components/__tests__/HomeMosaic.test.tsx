import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Photo } from "@/lib/data/photos";
import HomeMosaic from "../HomeMosaic";
import { ROUTES } from "@/lib/routes";
import { MOSAIC_HERO_SIZES, MOSAIC_PAIR_SIZES } from "../gridSizes";

/**
 * ホームの写真の並び（iOS の `HomeMosaic`・板 01c）。
 * 並べ方の規則そのものは `lib/utils/__tests__/editorialLayout.test.ts` が見る。
 * ここは「画面にどう出るか」。
 */
const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: `題${id}`, category: "travel", tags: [],
    displayName: "丸田", location: "パリ, フランス", likes: 3, createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    ...over,
} as Photo);

const tiles = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>("a[data-photo-id]"));

describe("HomeMosaic", () => {
    it("大きく1枚（16:9）→ 2枚（1:1）→ 2枚 の順に並ぶ（1枚ずつの項目・大きい1枚は2列ぶん）", () => {
        const { container } = render(<HomeMosaic photos={["a", "b", "c", "d", "e", "f"].map((i) => photo(i))} locale="ja" />);
        const list = container.querySelector("ol")!;
        expect(list.className).toContain("grid-cols-2");
        expect(list.style.gap).toBe("4px");
        const items = Array.from(list.children);
        expect(items).toHaveLength(6);                     // 写真1枚ごと（段ごとではない）
        expect(items.map((li) => li.className.includes("col-span-2"))).toEqual([true, false, false, false, false, true]);
        const ratio = tiles(container).map((a) => a.style.aspectRatio);
        expect(ratio).toEqual(["16 / 9", "1 / 1", "1 / 1", "1 / 1", "1 / 1", "16 / 9"]);
    });

    it("一覧が1枚ずれても、ほかの写真を作り直さない（段ごとの key だと全部作り直していた）", () => {
        const all = ["a", "b", "c", "d", "e", "f"].map((i) => photo(i));
        const { container, rerender } = render(<HomeMosaic photos={all} locale="ja" />);
        const before = new Map(tiles(container).map((t) => [t.dataset.photoId, t]));
        rerender(<HomeMosaic photos={all.slice(1)} locale="ja" />);
        for (const t of tiles(container)) expect(t, t.dataset.photoId).toBe(before.get(t.dataset.photoId));
    });

    it("同じ写真が2回入っても、2枚の段に穴を空けない（大きい1枚は何番目かで決める）", () => {
        const a = photo("a"), b = photo("b"), c = photo("c");
        const { container } = render(<HomeMosaic photos={[a, a, b, c]} locale="ja" />);
        const spans = Array.from(container.querySelector("ol")!.children).map((li) => li.className.includes("col-span-2"));
        // editorialRows: [a] 大 → (a,b) 2枚 → [c] 大
        expect(spans).toEqual([true, false, false, true]);
    });

    it("最初に読むのは3枚（大きい1枚＋最初の2枚の段）。同じ段の右だけ遅れない", () => {
        render(<HomeMosaic photos={["a", "b", "c", "d"].map((i) => photo(i))} locale="ja" />);
        const imgs = screen.getAllByRole("img");
        expect(imgs.map((i) => i.getAttribute("loading"))).toEqual(["eager", "eager", "eager", "lazy"]);
    });

    it("重ねた文字・印・いいねの丸は読み上げから外す（リンクの名前が全部を読む）", () => {
        const { container } = render(<HomeMosaic
            photos={[photo("a", { extraImages: [{ src: "https://cdn/x.jpg" }] } as Partial<Photo>)]} locale="ja" />);
        const a = tiles(container)[0];
        const shown = Array.from(a.children).filter((el) => el.tagName !== "PICTURE" && !el.querySelector("img") && el.tagName !== "IMG");
        expect(shown.length).toBeGreaterThanOrEqual(3);
        for (const el of shown) expect(el.getAttribute("aria-hidden"), el.outerHTML.slice(0, 60)).toBe("true");
    });

    it("サーバーが入れた「無題」は読まない・英語の1件は単数", () => {
        const { container } = render(<HomeMosaic photos={[photo("a", { title: "無題", likes: 1 })]} locale="en" />);
        const label = tiles(container)[0].getAttribute("aria-label")!;
        expect(label).not.toContain("無題");
        expect(label).toContain("1 like");
        expect(label).not.toContain("1 likes");
    });

    it("持ち主が選んだ見せたい位置（focalPoint）で切る", () => {
        render(<HomeMosaic photos={[photo("a", { focalPoint: { x: 0.2, y: 0.8 } } as Partial<Photo>)]} locale="ja" />);
        expect((screen.getByRole("img") as HTMLImageElement).style.objectPosition).toBe("20% 80%");
    });

    it("スマホでは画面の端から端まで（本文の余白を打ち消す）・角丸なし", () => {
        const { container } = render(<HomeMosaic photos={[photo("a")]} locale="ja" />);
        const list = container.querySelector("ol")!;
        expect(list.className.split(/\s+/)).toEqual(expect.arrayContaining(["-mx-4", "sm:mx-0"]));
        expect(tiles(container)[0].className).not.toMatch(/rounded/);
    });

    it("各1枚は写真ページへのリンク。題・撮影地・撮った人・いいねの数を読み上げる", () => {
        const { container } = render(<HomeMosaic photos={[photo("a")]} locale="ja" />);
        const a = tiles(container)[0];
        expect(a.getAttribute("href")).toBe(ROUTES.PHOTO("a"));
        const label = a.getAttribute("aria-label")!;
        for (const part of ["題a", "パリ", "丸田", "いいね 3件"]) expect(label).toContain(part);
    });

    it("写真の上に撮影地（最初の区切りまで）と「名前 · ◯日前」を重ねる。2枚の段は名前だけ", () => {
        const { container } = render(<HomeMosaic photos={["a", "b", "c"].map((i) => photo(i))} locale="ja" />);
        const [hero, pair] = tiles(container);
        expect(hero.textContent).toContain("パリ");
        expect(hero.textContent).not.toContain("フランス");
        expect(hero.textContent).toContain("丸田 · 2日前");
        expect(pair.textContent).toContain("丸田");
        expect(pair.textContent).not.toContain("日前");
    });

    it("撮影地が無い写真は文字を重ねない", () => {
        const { container } = render(<HomeMosaic photos={[photo("a", { location: "" })]} locale="ja" />);
        expect(tiles(container)[0].querySelector("p.font-serif")).toBeNull();
    });

    it("「◯日前」は静的HTMLに焼かない（ビルドの翌日以降に水和が食い違う）", () => {
        const html = renderToString(<HomeMosaic photos={[photo("a")]} locale="ja" />);
        expect(html).not.toContain("日前");
    });

    it("右下にいいねの数、複数枚の投稿には右上の印", () => {
        const { container } = render(<HomeMosaic
            photos={[photo("a", { likes: 12, extraImages: [{ src: "https://cdn/x.jpg" }] } as Partial<Photo>), photo("b")]}
            locale="ja" />);
        const [first, second] = tiles(container);
        expect(first.querySelector(".tabular-nums")?.textContent).toBe("12");
        expect(first.querySelectorAll("svg").length).toBe(2);   // ハート＋複数枚の印
        expect(second.querySelectorAll("svg").length).toBe(1);  // ハートだけ
        expect(first.getAttribute("aria-label")).toContain("複数枚の投稿");
    });

    it("画像の大きさの申告は段の種類で分ける", () => {
        // 縮小版（派生）が無い写真には `Thumb` が申告を付けないので、派生を持たせる
        const withDerivs = (i: string) => photo(i, { thumbSm: `https://cdn/${i}-256.webp`, thumbSrc: `https://cdn/${i}-512.webp` } as Partial<Photo>);
        render(<HomeMosaic photos={["a", "b", "c"].map(withDerivs)} locale="ja" />);
        const imgs = screen.getAllByRole("img");
        const sizes = imgs.map((i) => i.getAttribute("sizes") ?? i.closest("picture")?.querySelector("source")?.getAttribute("sizes"));
        expect(sizes[0]).toBe(MOSAIC_HERO_SIZES);
        expect(sizes[1]).toBe(MOSAIC_PAIR_SIZES);
    });
});
