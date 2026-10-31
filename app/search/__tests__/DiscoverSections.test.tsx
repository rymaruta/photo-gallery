import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

vi.mock("../../components/Thumb", () => ({ default: ({ photo }: { photo: Photo }) => <span data-thumb={photo.id} /> }));

/**
 * 🔴 **`<Link>` に印を付けてから数える。**
 *
 * 以前ここは `a.hasAttribute("data-prefetch")` が false であることで
 * 「素の `<a>` か」を見ていたが、**Next の `<Link>` はその属性を出さない**
 * （DOM に出るのは素の `<a href>`）ので、**`<a>` でも `<Link>` でも常に true**
 * ——柱を `<Link>` に戻す変異を当てても**13件とも緑**だった（実測）。
 *
 * だから本物の `<Link>` を、**見分けの付く印を持つ `<a>`** に置き換える。
 * こうすると「柱に印が無い」と「面の中には印が在る」を両方見られる
 * ——**後者が無いと、mock が効かなくなった日にまた何も検証しなくなる**
 * （`vi.mock` は黙る。台帳の「🔴 `vi.mock` は黙る」の節）。
 */
vi.mock("next/link", () => ({
    default: ({ href, children, prefetch, ...rest }: {
        href: string; children: React.ReactNode; prefetch?: boolean;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        // `prefetch` は DOM の属性ではない（そのまま撒くと React が警告を出す）
        void prefetch;
        return <a data-next-link="1" href={typeof href === "string" ? href : ""} {...rest}>{children}</a>;
    },
}));

import DiscoverSections from "../DiscoverSections";

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: id, ...extra,
} as unknown as Photo);

const render1 = (photos: Photo[], map: Record<string, string> = {}) =>
    render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={map} />);

vi.mock("../../components/GalleryGrid", () => ({
    default: ({ photos, searchTiles }: { photos: Photo[]; searchTiles?: boolean }) =>
        <div data-testid="open-grid" data-tiles={String(!!searchTiles)}>{photos.map((p) => p.id).join(",")}</div>,
}));

// 2026-10-31 束 1 S4・S5・S7・S8: iOS の発見の面（撮影地 → おすすめ → 色 → 機材）
describe("さがす: 発見の節", () => {
    it("撮影地の札は 156×116・角 14・名前は写真の上（明朝 18）・枚数を出さない（S5）", () => {
        const { container } = render1([
            photo("a", { location: "香川県 観音寺市 高屋神社" }), photo("b", { location: "香川県 観音寺市 高屋神社" }),
        ]);
        const card = container.querySelector('a[href*="/location/"]') as HTMLElement;
        expect(card.style.width).toBe("156px");
        expect(card.style.height).toBe("116px");
        expect(card.className).toContain("rounded-xl");
        const name = card.querySelector(".font-serif") as HTMLElement;
        expect(name.textContent).toBe("高屋神社");
        expect(name.style.fontSize).toBe("18px");
        expect(card.textContent, "枚数を外した").not.toMatch(/枚/);
    });

    it("🔴 国の名前だけの撮影地は札にしない（「フランス」の札を出さない・iOS の `spotName`）", () => {
        const { container } = render1([photo("a", { location: "フランス" }), photo("b", { location: "パリ" })]);
        const names = [...container.querySelectorAll('a[href*="/location/"]')].map((a) => a.textContent);
        expect(names).toEqual(["パリ"]);
    });

    it("🔴 同じ名前の撮影地は1枚の札にまとめる（「パリ」と「パリ, フランス」を2枚の「パリ」にしない）", () => {
        const { container } = render1([
            photo("a", { location: "パリ" }), photo("b", { location: "パリ" }), photo("c", { location: "パリ, フランス" }),
        ]);
        const names = [...container.querySelectorAll('a[href*="/location/"]')].map((a) => a.textContent);
        expect(names).toEqual(["パリ"]);
    });

    it("🔴 撮影地は枚数順。「人気」とは呼ばない（数えているのは枚数だけ）。見出しの右は「地図で見る」", () => {
        const { container } = render1([
            photo("a", { location: "東京" }), photo("b", { location: "東京" }), photo("c", { location: "パリ" }),
        ]);
        const links = [...container.querySelectorAll('a[href*="/location/"]')].map((a) => a.textContent);
        expect(links[0], "枚数順になっていない").toContain("東京");
        expect(container.textContent, "数えていない「人気」を名乗っている").not.toMatch(/人気|おすすめ撮影スポット/);
        expect(screen.getByRole("link", { name: "地図で見る" }).getAttribute("href")).toBe("/map");
    });

    it("おすすめ（S4）: owner が選んだ写真をカテゴリごとに 120×160 の帯で・「すべて見る」はカテゴリの頁へ", () => {
        render1([
            photo("a", { category: "landscape", featured: true }), photo("b", { category: "landscape", featured: true }),
            photo("c", { category: "nature" }),
        ], { landscape: "風景" });
        const picks = screen.getByTestId("discover-picks");
        const tiles = [...picks.querySelectorAll("a")];
        expect(tiles.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining([expect.stringContaining("a"), expect.stringContaining("b")]));
        expect((tiles[0] as HTMLElement).style.width).toBe("120px");
        expect((tiles[0] as HTMLElement).style.height).toBe("160px");
        expect(screen.getByRole("heading", { name: "おすすめ" })).toBeTruthy();
        expect(document.body.textContent).toContain("PICKS · 風景");
    });

    it("色から探す（S8）: 写真の丸 62＋題材の名前。押すとその色の写真が開き、押し直すと閉じる", () => {
        render1([
            photo("a", { dominantColor: "#3a7bd5", category: "landscape" }),
            photo("b", { dominantColor: "#ff8c00", category: "landscape" }),
            photo("c", { dominantColor: "#ff8c00", category: "food" }),
        ]);
        const colors = screen.getByTestId("discover-colors");
        const btns = [...colors.querySelectorAll("button")];
        expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual(["青（空・海）・1枚", "オレンジ（夕日）・1枚"]);
        expect((btns[0].querySelector("span") as HTMLElement).style.width).toBe("62px");
        expect(colors.className, "5 等分の位置に左から").toContain("grid-cols-5");
        fireEvent.click(btns[1]);
        expect(btns[1].getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByTestId("open-grid").textContent, "料理の写真は夕日に入れない").toBe("b");
        fireEvent.click(btns[1]);
        expect(screen.queryByTestId("open-grid")).toBeNull();
    });

    it("機材から探す（S7）: 札 3 枚（広角・標準・望遠と範囲）。押すとその焦点距離の写真。機種の索引へも行ける", () => {
        render1([
            photo("a", { exif: { camera: "SONY ILCE-7M3", focalLength: "24mm" } }),
            photo("b", { exif: { camera: "SONY ILCE-7M3", focalLength: "50mm" } }),
            photo("c", { exif: { camera: "Canon EOS R6", focalLength: "200mm" } }),
        ]);
        const gear = screen.getByTestId("discover-gear");
        const btns = [...gear.querySelectorAll("button")];
        expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual(["広角で撮る 〜35mm", "標準で撮る 36〜70mm", "望遠で撮る 71mm〜"]);
        expect(btns[0].className).toContain("min-h-[88px]");
        fireEvent.click(btns[2]);
        expect(screen.getByTestId("open-grid").textContent).toBe("c");
        expect(screen.getByRole("link", { name: /機種で見る/ }).getAttribute("href")).toBe("/camera");
    });

    it("🔴 データが無い節は丸ごと出さない（空の枠を置かない）", () => {
        const { container } = render1([photo("a", { category: "landscape" })]);
        expect(container.querySelector('a[href*="/location/"]'), "撮影地が無いのに節が出ている").toBeNull();
        expect(screen.queryByTestId("discover-gear"), "機材が無いのに節が出ている").toBeNull();
        expect(screen.queryByText(/写真の多い撮影地/)).toBeNull();
    });

    it("🔴 何も無ければ部品ごと描かない", () => {
        const { container } = render1([photo("a")]);
        expect(container.innerHTML).toBe("");
    });

    it("代表写真は、その撮影地に入る写真から選ぶ（別の綴りで保存された写真にも当たる）", () => {
        const { container } = render1([photo("p1", { location: "パリ" }), photo("p2", { location: "パリ, フランス" })]);
        const card = container.querySelector('a[href*="/location/"]')!;
        expect(card.querySelector("[data-thumb]")?.getAttribute("data-thumb")).toBe("p1");
    });

    it("撮影地・おすすめのリンクは先読みしない（本物の `<Link>` を通る）", () => {
        const { container } = render1([photo("a", { location: "東京" }), photo("b", { location: "東京" })]);
        const links = [...container.querySelectorAll("a")];
        expect(links.length).toBeGreaterThan(0);
        for (const a of links) expect(a.getAttribute("data-next-link"), "素の <a> になっている").toBe("1");
    });
});

// アプリ v2 の節の見出し（iOS の `JPSectionHeading`）: 眉＋消える線 → 明朝 22 の題 → 灰の「すべて見る」
describe("さがす: 節の見出しはアプリ v2 の形", () => {
    it("眉（読み上げに出さない）・明朝の題・灰の「すべて見る」", () => {
        const { container } = render1([photo("a", { location: "香川県 観音寺市 高屋神社" })]);
        const heads = [...container.querySelectorAll('[data-testid="discover-section-head"]')];
        expect(heads.length).toBeGreaterThan(0);
        for (const h of heads) {
            const eb = h.querySelector("p.eyebrow")!;
            expect(eb, "眉が無い").toBeTruthy();
            expect(eb.className).toContain("eyebrow-line");
            expect(eb.getAttribute("aria-hidden")).toBe("true");
            const h2 = h.querySelector("h2")!;
            expect(h2.className).toContain("font-serif");
            expect((h2 as HTMLElement).style.fontSize).toBe("22px");
            const more = h.querySelector("a")!;
            expect(more.className, "行き先は合図ではない（真鍮にしない）").not.toContain("text-accent");
            expect(more.className).toContain("min-h-[44px]");
        }
    });
});
