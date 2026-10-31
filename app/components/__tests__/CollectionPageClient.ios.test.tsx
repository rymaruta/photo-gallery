// @vitest-environment jsdom
// ↑ `<picture>` の `<source>` の sizes を読むので、`gridSizes.test.tsx` と同じく jsdom で描く
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { Photo } from "../../../lib/data/photos";
import { sortForCollection } from "../../../lib/utils/photoOrder";
import { slimForGrid } from "../../../lib/utils/related";
import { EDITORIAL_HERO_SIZES, EDITORIAL_PAIR_SIZES } from "../gridSizes";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const CollectionPageClient = (await import("../CollectionPageClient")).default;

/**
 * **集約の頁（タグ・カテゴリ・機材）を iOS の `CollectionPhotosScreen`（板 12）にそろえた形**（2026-10-31 束 2）。
 * どれも直しを戻すと落ちる: 眉・明朝 32 の題・枚数の行・並べ替えのチップ（既定は人気）・
 * 大きく1枚 → 2枚 → 2枚の並び（隙間 10・角 18）・先頭の1枚の撮影地と @撮った人・押せるチップの相互リンク。
 */
const P = (o: Partial<Photo>): Photo => ({
    src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x-512.webp", thumbSm: "https://cdn/x-256.webp", ...o,
} as Photo);

const photos: Photo[] = [
    P({ id: "a", title: "朝の湖", location: "山中湖, 山梨", likes: 1, createdAt: "2026-05-01T00:00:00Z", date: "2020-01-01", displayName: "丸田", category: "landscape" }),
    P({ id: "b", title: "夕方の街", location: "パリ", likes: 9, createdAt: "2026-01-01T00:00:00Z", displayName: "旅人A" }),
    P({ id: "c", title: "雪", likes: 4, createdAt: "2026-03-01T00:00:00Z", date: "2024-12-24" }),
    P({ id: "d", title: "森", likes: 0, createdAt: "2026-06-01T00:00:00Z" }),
    P({ id: "e", title: "海", likes: 4, createdAt: "2026-04-01T00:00:00Z" }),
    P({ id: "f", title: "橋", likes: 2, createdAt: "2026-02-01T00:00:00Z" }),
];

const ids = () => [...document.querySelectorAll("[data-layout=editorial] a[data-photo-id]")].map((a) => a.getAttribute("data-photo-id"));

describe("集約の頁の見出し（iOS の板 12）", () => {
    it("眉（真鍮）→ 明朝 32 の題 → 13 の枚数の行", () => {
        render(<CollectionPageClient photos={photos} heading="#森 の写真" description="説明" breadcrumb="タグ: 森" type="tag" />);
        const head = screen.getByTestId("collection-heading");
        const eyebrow = head.querySelector("p.eyebrow")!;
        expect(eyebrow.textContent).toBe("TAG");
        expect(eyebrow.className).toContain("text-accent");
        expect(eyebrow.getAttribute("aria-hidden")).toBe("true");
        const h1 = within(head).getByRole("heading", { level: 1 });
        expect(h1.className).toContain("font-serif");
        expect(h1.style.fontSize).toBe("32px");
        const count = screen.getByTestId("collection-count");
        expect(count.textContent).toBe("6枚");
        expect(count.style.fontSize).toBe("13px");
        // 説明文（検索に載せる文）は残す
        expect(screen.getByText("説明")).toBeTruthy();
    });

    it("種類ごとの眉（PLACE・CATEGORY・CAMERA）", () => {
        const { rerender } = render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" type="camera" />);
        expect(screen.getByTestId("collection-heading").querySelector("p.eyebrow")!.textContent).toBe("CAMERA");
        rerender(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" type="category" />);
        expect(screen.getByTestId("collection-heading").querySelector("p.eyebrow")!.textContent).toBe("CATEGORY");
    });
});

describe("並べ替え（人気・新着・撮影日。既定は人気）", () => {
    it("最初は人気の順（同点は投稿の新しい順）で、チップを押すと並びが変わる", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        const group = screen.getByTestId("collection-sort");
        const chips = within(group).getAllByRole("button");
        expect(chips.map((c) => c.textContent)).toEqual(["人気", "新着", "撮影日"]);
        expect(chips[0].getAttribute("aria-pressed")).toBe("true");
        // b(9) → e(4, 4/1) → c(4, 3/1) → f(2) → a(1) → d(0)
        expect(ids()).toEqual(["b", "e", "c", "f", "a", "d"]);
        fireEvent.click(chips[1]);
        expect(ids()).toEqual(["d", "a", "e", "c", "f", "b"]);
        fireEvent.click(chips[2]);
        // 撮った日のある写真が先（新しい日から）、無い写真は投稿の新しい順で後ろ
        expect(ids()).toEqual(["c", "a", "d", "e", "f", "b"]);
    });

    it("写真が1枚ならチップを出さない", () => {
        render(<CollectionPageClient photos={[photos[0]]} heading="h" description="d" breadcrumb="b" />);
        expect(screen.queryByTestId("collection-sort")).toBeNull();
    });

    it("一覧に渡す項目に、並べ替えと先頭の1枚の字の材料がある（`slimForGrid`）", () => {
        const slim = slimForGrid(photos[0]) as Photo;
        expect(slim.likes).toBe(1);
        expect(slim.createdAt).toBe("2026-05-01T00:00:00Z");
        expect(slim.date).toBe("2020-01-01");
        expect(slim.displayName).toBe("丸田");
        expect(sortForCollection([slim, slimForGrid(photos[1])], "popular").map((p) => p.id)).toEqual(["b", "a"]);
    });
});

describe("写真の並び（iOS の `PhotoGrid`: 大きく1枚 → 2枚 → 2枚）", () => {
    it("大きい1枚は2列ぶん・2枚の段は正方形。隙間 10・角 18", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        const grid = document.querySelector("[data-layout=editorial]") as HTMLElement;
        expect(grid.style.gap).toBe("10px");
        expect(grid.className).toContain("md:grid-cols-4");
        const tiles = [...grid.querySelectorAll("[data-tile]")].map((t) => t.getAttribute("data-tile"));
        expect(tiles).toEqual(["hero", "pair", "pair", "pair", "pair", "hero"]);
        const first = grid.querySelector("[data-tile=hero]")!;
        expect(first.className).toContain("col-span-2");
        expect(first.className).toContain("md:row-span-2");
        const link = first.querySelector("a")!;
        expect(link.className).toContain("aspect-[16/10]");
        expect(link.style.borderRadius).toBe("18px");
        expect(grid.querySelector("[data-tile=pair] a")!.className).toContain("aspect-square");
    });

    it("大きい1枚と2枚の段で sizes を分ける", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        const grid = document.querySelector("[data-layout=editorial]") as HTMLElement;
        const sizesOf = (sel: string) => grid.querySelector(`${sel} img`)?.getAttribute("sizes")
            ?? grid.querySelector(`${sel} source`)?.getAttribute("sizes");
        expect(sizesOf("[data-tile=hero]")).toBe(EDITORIAL_HERO_SIZES);
        expect(sizesOf("[data-tile=pair]")).toBe(EDITORIAL_PAIR_SIZES);
    });

    it("先頭の1枚に撮影地（明朝）・@撮った人・いいねを重ねる（iOS の `LeadCaption`）", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        const lead = screen.getAllByTestId("lead-caption");
        expect(lead).toHaveLength(1);
        // 人気の先頭は b（パリ・旅人A・9）
        expect(lead[0].textContent).toContain("パリ");
        expect(lead[0].textContent).toContain("@旅人A");
        expect(lead[0].textContent).toContain("9");
        expect(lead[0].querySelector("p.font-serif")!.textContent).toBe("パリ");
    });

    it("2枚目以降は分類の眉と題（写真の上なので白）", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        fireEvent.click(within(screen.getByTestId("collection-sort")).getByText("新着"));
        // 新着の2枚目が a（分類 landscape → 風景）
        const tile = document.querySelector('[data-layout=editorial] a[data-photo-id="a"]')!;
        expect(tile.querySelector("p.eyebrow")!.textContent).toBe("風景");
        expect(tile.querySelector("p.eyebrow")!.className).toContain("text-white/75");
        expect(tile.textContent).toContain("朝の湖");
    });
});

describe("相互リンクは押せるチップ", () => {
    it("チップの型（`chipStyles`）で、行き先と件数を出す", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" type="tag"
            related={[{ label: "海", count: 3, path: "/tag/umi" }]} />);
        const link = within(screen.getByTestId("collection-related")).getByRole("link");
        expect(link.getAttribute("href")).toBe("/tag/umi");
        expect(link.textContent).toBe("#海3");
        expect(link.className).toContain("bg-chip");
        expect(link.style.minHeight).toBe("34px");
        expect(screen.getByRole("heading", { level: 2, name: "関連タグ" }).className).toContain("font-serif");
    });
});

describe("大きい1枚の高さ（束 2 の確かめ）", () => {
    /**
     * PC（768px 以上）で `aspect-auto h-full` にしていた頃は、隣に2枚の段が無い並び（1枚・2枚・最後に大きい1枚が残る）で
     * 高さがほぼ 0 になった。**どの並びでも、大きい1枚は自分で正方形の高さを持つ**（2×2＋隙間で正方形）
     */
    it.each([1, 2, 4, 6])("写真 %i 枚: 大きい1枚はスマホ 16:10・PC 正方形で、高さを隣に任せない", (n) => {
        render(<CollectionPageClient photos={photos.slice(0, n)} heading="h" description="d" breadcrumb="b" />);
        const heroes = document.querySelectorAll("[data-layout=editorial] [data-tile=hero] a");
        expect(heroes.length).toBeGreaterThan(0);
        for (const a of heroes) {
            expect(a.className).toContain("aspect-[16/10]");
            expect(a.className).toContain("md:aspect-square");
            expect(a.className).not.toContain("md:aspect-auto");
            expect(a.className).not.toContain("md:h-full");
        }
    });

    it("先に読むのは3枚（大きい1枚＋最初の2枚の段・ホームと同じ）", () => {
        render(<CollectionPageClient photos={photos} heading="h" description="d" breadcrumb="b" />);
        const imgs = [...document.querySelectorAll("[data-layout=editorial] a[data-photo-id]")]
            .map((a) => a.querySelector("picture img, img:not([aria-hidden])")!.getAttribute("loading"));
        expect(imgs.slice(0, 3)).toEqual(["eager", "eager", "eager"]);
        expect(imgs.slice(3).every((l) => l === "lazy")).toBe(true);
    });
});
