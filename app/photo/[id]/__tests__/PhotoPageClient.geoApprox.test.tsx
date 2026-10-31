import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// **地名から引いたおおよその座標（`geoApprox`）では「地図で見る」を出さない。**
//
// 撮影地マップのために、地名しか無い写真へ街の中心の座標を補う
// （`scripts/geocode-locations.js`）。その座標で場所チップをリンクにすると、
// Google マップの街の中心に飛び、「ここで撮った」と読まれる。
// 地名（テキスト）はそのまま出るので、場所が分からなくなるわけではない。
//
// 最初の修正は `fallbackHref` にだけ条件を付けていて**効いていなかった**
// ——`getPreferredMapLink` が座標から google リンクを合成するので、
// そちらが常に勝つ。合成の側（`generateMapLinksFromCoords`）で止めた。

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const photo = (extra: Partial<Photo>): Photo => ({
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
    location: "パリ",
    coords: { lat: 48.86, lng: 2.35 },
    ...extra,
} as Photo);

// 2026-10-31 束 1 P2・P4: 本文の上の「撮影日 · 撮影地」の行と、写真の右下の地図の丸を外した。
// Google マップと撮影地マップの行き先は「…」の中へ移した（行き先は消さない）
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "その他" }));

describe("Google マップの行き先（「…」の中）", () => {
    it("正確な座標なら「Google マップで開く」がその座標へ（別のタブ）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo({})} />);
        await screen.findByText("テスト写真");
        openMenu();
        const link = screen.getByRole("menuitem", { name: "Google マップで開く" });
        expect(link).toHaveAttribute("href", expect.stringContaining("48.86,2.35"));
        expect(link).toHaveAttribute("target", "_blank");
    });

    it("おおよその座標（geoApprox）なら出さない（街の中心へのリンクにしない）。地名は消えない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo({ geoApprox: true })} />);
        await screen.findByText("テスト写真");
        openMenu();
        expect(screen.queryByRole("menuitem", { name: "Google マップで開く" }), "街の中心へのリンクを出している").toBeNull();
        expect(screen.getAllByText("パリ").length).toBeGreaterThan(0);
    });
});

// 撮影地マップ（/map）のその位置へ。外部の Google マップとは別の内部リンク
describe("撮影地マップへの導線（「…」の中）", () => {
    it("座標があれば、その位置に寄せた /map へのリンクを出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo({})} />);
        await screen.findByText("テスト写真");
        openMenu();
        expect(screen.getByRole("menuitem", { name: "撮影地マップで見る" })).toHaveAttribute("href", "/map#12/48.86/2.35");
    });

    it("おおよその座標（geoApprox）でも出す——地図の側は断りを付けてピンを立てている", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo({ geoApprox: true })} />);
        await screen.findByText("テスト写真");
        openMenu();
        expect(screen.getByRole("menuitem", { name: "撮影地マップで見る" })).toHaveAttribute("href", "/map#12/48.86/2.35");
    });

    it("座標が無ければ出さない（地図にピンが無い）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo({ coords: undefined })} />);
        await screen.findByText("テスト写真");
        openMenu();
        expect(screen.queryByRole("menuitem", { name: "撮影地マップで見る" })).toBeNull();
    });
});
