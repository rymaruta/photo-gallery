import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
/**
 * 読み上げの名前（Testing Library の `getByRole` と同じ計算＝ブラウザの名前の決め方）。
 * 名前の照合に関数を渡すと、計算した名前を受け取れる。空白は1つに畳む
 */
const nameOf = (a: HTMLElement) => {
    let got = "";
    within(a.parentElement!).getByRole("link", { name: (n, el) => { if (el === a) got = n; return el === a; } });
    return got.replace(/\s+/g, " ").trim();
};

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

    // 🔴 **名前は中身から組む**（`aria-label` を付けない）。別の文を `aria-label` に書いていたので、
    // 見えている文字（撮影地・名前・数）と読み上げの名前が食い違い、Lighthouse の
    // label-content-name-mismatch がトップの全タイルで落ちていた（2026-09-30 本番で実測）
    it("読み上げの名前は見えている文字をそのまま含む（写真の説明 → 撮影地 → 撮った人 → 複数枚 → いいね）", () => {
        const { container } = render(<HomeMosaic
            photos={[photo("a", { extraImages: [{ src: "https://cdn/x.jpg" }] } as Partial<Photo>)]} locale="ja" />);
        const a = tiles(container)[0];
        expect(a.hasAttribute("aria-label"), "中身と違う名前を上書きしている").toBe(false);
        const name = nameOf(a);
        // 画面に見えている文字（撮影地・名前と時期・数）が、見えている順のまま名前に入る
        const visible = ["パリ", "丸田 · 2日前", "3"];
        let at = 0;
        for (const v of visible) { const i = name.indexOf(v, at); expect(i, `${v} が名前に無い: ${name}`).toBeGreaterThanOrEqual(0); at = i + v.length; }
        expect(name.startsWith("題a")).toBe(true);        // 先頭は写真の説明（題）
        expect(name).toContain("複数枚の投稿");
        expect(name).toMatch(/、複数枚の投稿、いいね 3件$/);
    });

    it("サーバーが入れた「無題」は読まない・英語の1件は単数", () => {
        const { container } = render(<HomeMosaic photos={[photo("a", { title: "無題", likes: 1 })]} locale="en" />);
        const label = nameOf(tiles(container)[0]);
        expect(label).not.toContain("無題");
        expect(label).toMatch(/, 1 like$/);
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
        const label = nameOf(a);
        for (const part of ["題a", "パリ", "丸田"]) expect(label).toContain(part);
        expect(label).toMatch(/、いいね 3件$/);
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

    it("撮影地が無い写真は文字を重ねないが、誰の写真かは読ませる", () => {
        const { container } = render(<HomeMosaic photos={[photo("a", { location: "" })]} locale="ja" />);
        expect(tiles(container)[0].querySelector("p.font-serif")).toBeNull();
        expect(nameOf(tiles(container)[0])).toContain("丸田");
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
        expect(nameOf(first)).toContain("複数枚の投稿");
        expect(nameOf(second)).not.toContain("複数枚の投稿");
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

    // alt は「題（撮影地）」の形で撮影地を含む。重ねた撮影地も読ませると、同じ地名が続けて二度読まれた
    it("写真の説明が撮影地を含むなら、重ねた撮影地は読ませない（同じ地名を二度読まない）", () => {
        const { container } = render(<HomeMosaic photos={[photo("a"), photo("b", { alt: "夕日の港" } as Partial<Photo>)]} locale="ja" />);
        const [a, b] = tiles(container);
        const nameA = nameOf(a);
        expect(nameA.split("パリ").length - 1, nameA).toBe(1);
        // 説明が撮影地を含まない写真は、重ねた撮影地を読ませる
        expect(nameOf(b)).toContain("パリ");
    });

    // 読み込みに失敗すると `Thumb` は <img> ごと外す。名前を中身から組むので、題が消えないように
    it("画像を読めなかったときも、写真の説明は名前に残る", () => {
        const { container } = render(<HomeMosaic photos={[photo("a")]} locale="ja" />);
        fireEvent.error(container.querySelector("img")!);
        expect(container.querySelector("img[src*='cdn']"), "画像が残っている（前提が崩れた）").toBeNull();
        expect(nameOf(tiles(container)[0]).startsWith("題a")).toBe(true);
    });

    it("いいねの読み上げ文は画面に出さない（sr-only）・見える数字は読ませない", () => {
        const { container } = render(<HomeMosaic photos={[photo("a")]} locale="ja" />);
        const said = Array.from(tiles(container)[0].querySelectorAll("span")).find((s) => s.textContent === "、いいね 3件")!;
        expect(said.className.split(/\s+/)).toContain("sr-only");
        expect(tiles(container)[0].querySelector(".tabular-nums")!.getAttribute("aria-hidden")).toBe("true");
    });
});
