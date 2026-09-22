import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

vi.mock("../../components/Thumb", () => ({ default: ({ photo }: { photo: Photo }) => <span data-thumb={photo.id} /> }));

import DiscoverSections from "../DiscoverSections";

const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, title: id, ...extra,
} as unknown as Photo);

const render1 = (photos: Photo[], map: Record<string, string> = {}) =>
    render(<DiscoverSections photos={photos} locale="ja" categoryDisplayMap={map} />);

describe("さがす: 発見の節", () => {
    it("カテゴリ・撮影地・機材の節を、集約ページへのリンクで出す", () => {
        render1([
            photo("a", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
            photo("b", { category: "landscape", location: "パリ", exif: { camera: "SONY ILCE-7M3" } }),
            photo("c", { category: "nature", location: "東京", exif: { camera: "Canon EOS R6" } }),
        ], { landscape: "風景", nature: "自然" });
        expect(screen.getByRole("link", { name: /風景/ }).getAttribute("href")).toContain("/category/");
        expect(screen.getByRole("link", { name: /パリ/ }).getAttribute("href")).toContain("/location/");
        expect(screen.getByRole("link", { name: /SONY ILCE-7M3/ }).getAttribute("href")).toContain("/camera/");
    });

    it("🔴 撮影地は枚数順で、数を添える。「人気」とは呼ばない（数えているのは枚数だけ）", () => {
        const { container } = render1([
            photo("a", { location: "東京" }), photo("b", { location: "東京" }), photo("c", { location: "パリ" }),
        ]);
        const links = [...container.querySelectorAll('a[href*="/location/"]')].map((a) => a.textContent);
        expect(links[0], "枚数順になっていない").toContain("東京");
        expect(links[0]).toContain("2枚");
        expect(container.textContent, "数えていない「人気」を名乗っている").not.toMatch(/人気|おすすめ撮影スポット/);
    });

    it("🔴 データが無い節は丸ごと出さない（空の枠を置かない）", () => {
        const { container } = render1([photo("a", { category: "landscape" })]);
        expect(container.querySelector('a[href*="/location/"]'), "撮影地が無いのに節が出ている").toBeNull();
        expect(container.querySelector('a[href*="/camera/"]'), "機材が無いのに節が出ている").toBeNull();
        expect(screen.queryByText(/写真の多い撮影地/)).toBeNull();
    });

    it("🔴 何も無ければ部品ごと描かない", () => {
        const { container } = render1([photo("a")]);
        expect(container.innerHTML).toBe("");
    });

    it("🔴 機材は「広角・標準・望遠」にしない（35mm換算が無いので嘘になる）", () => {
        const { container } = render1([photo("a", { exif: { camera: "SONY ILCE-7M3", focalLength: "28mm" } })]);
        expect(container.textContent).not.toMatch(/広角|標準|望遠|Wide|Telephoto/);
    });

    it("二重のメーカー名は畳んで出す", () => {
        render1([photo("a", { exif: { camera: "Hasselblad Hasselblad X2D II 100C" } })]);
        expect(screen.getByRole("link", { name: /Hasselblad X2D II 100C/ })).toBeTruthy();
        expect(screen.queryByText(/Hasselblad Hasselblad/)).toBeNull();
    });

    it("代表写真は、その集約に入る写真から選ぶ（別名で保存された写真にも当たる）", () => {
        const { container } = render1([
            photo("en", { category: "architecture" }),
            photo("ja", { category: "建築" }),
        ]);
        // どちらも `/category/architecture` に寄る＝節は1つ、絵は先頭の写真
        const links = [...container.querySelectorAll('a[href*="/category/"]')];
        expect(links).toHaveLength(1);
        expect(container.querySelector("[data-thumb]")?.getAttribute("data-thumb")).toBe("en");
    });

    it("集約ページへのリンクは先読みしない（画面に入るたび行き先を落とし直さない）", () => {
        const { container } = render1([photo("a", { location: "東京" }), photo("b", { location: "東京" })]);
        for (const a of container.querySelectorAll("a")) {
            expect(a.getAttribute("href"), "先読みしている").toBeTruthy();
        }
    });
});
