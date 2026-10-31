import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import type { SpotLink } from "@/lib/data/spotLink";

/**
 * 写真の詳細の v2 の形（板 `PhotoDetail.dc.html`）: 撮影情報の要約と機材の行・
 * 写真の上の道しるべ・末尾の「この近くで撮られた写真 ／ 地図で見る」。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: false, userId: null as string | null, loading: false }));
vi.mock("../../../auth/context", () => ({ useAuth: () => auth }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: vi.fn(() => new Promise(() => undefined)),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const BASE = {
    id: "p1", src: "https://cdn.example.com/uploads/alice/a.webp", title: "朝の湖", userId: "alice",
    displayName: "アリス", location: "銀山温泉",
} as unknown as Photo;

beforeEach(() => {
    auth.isAuthenticated = false;
    auth.userId = null;
});

const EXIF = { camera: "Canon EOS R6", lens: "RF24-70mm", aperture: "f/8", exposure: "1/125s", iso: 100, focalLength: "24mm" };
const NEAR = { id: "n1", src: "https://cdn.example.com/uploads/bob/n.webp", title: "近くの橋" } as unknown as Photo;
const related = (nearby: Photo[]) => ({ author: [], location: [], prev: null, next: null, nearby });

// 2026-10-31 束 1 P8: iOS の `ExifRow`。札で囲まない1行（要約つき）、開くと 4 つの升とカメラ・レンズの行
describe("写真ページ: 撮影情報（iOS の形）", () => {
    it("閉じた行に「24mm · f/8 · 1/125 s · ISO 100」。札（角 16 の地）で囲まない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: EXIF } as Photo} />);
        expect((await screen.findByTestId("exif-settings-line")).textContent).toBe("24mm · f/8 · 1/125 s · ISO 100");
        const row = screen.getByTestId("photo-exif");
        expect(row.className).not.toMatch(/rounded-2xl|bg-surface/);
        expect(screen.getByRole("button", { name: /^撮影情報/ }).style.minHeight).toBe("44px");
    });

    it("開くと 4 つの升（焦点距離・絞り・シャッター・ISO）と、カメラ・レンズの行（升と同じ項目は行に出さない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: EXIF } as Photo} />);
        const btn = await screen.findByRole("button", { name: /^撮影情報/ });
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(btn);
        expect(btn.getAttribute("aria-expanded")).toBe("true");
        const cells = screen.getByTestId("photo-exif-cells");
        expect([...cells.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["焦点距離", "絞り", "シャッター", "ISO"]);
        expect([...cells.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["24mm", "f/8", "1/125 s", "100"]);
        const detail = document.getElementById("photo-exif-detail")!;
        expect(detail.textContent).toContain("Canon EOS R6");
        expect(detail.textContent).toContain("RF24-70mm");
        expect(detail.textContent).not.toContain("シャッター速度");
    });

    it("撮影設定の無い写真は要約も升も出さず、機種の行だけ", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: { camera: "X-T5" } } as Photo} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("exif-settings-line")).toBeNull();
        expect(screen.queryByTestId("photo-exif-cells")).toBeNull();
        expect(document.getElementById("photo-exif-detail")!.textContent).toContain("X-T5");
    });
});

// 2026-10-31 束 1 P2: iOS の `placeRow`（「📍 撮影地 · 撮影地の詳細」・写真の上の白い字・下線・当たり 44）
describe("写真ページ: 道しるべ", () => {
    it("写真の裾に「撮影地 · 撮影地の詳細」（撮影地の頁へ・押す的は 44px・黒い札で囲まない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const link = screen.getByRole("link", { name: "銀山温泉 · 撮影地の詳細" });
        expect(link.getAttribute("href")).toContain("/location/");
        expect(link.textContent).toContain("撮影地の詳細");
        expect(link.style.minHeight).toBe("44px");
        expect(link.innerHTML).not.toMatch(/bg-black/);
    });

    it("台帳の撮影スポットを指す写真は「撮影スポット · 名前 ›」の行も出す（撮影スポットの頁へ）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE}
                                spotLink={{ slug: "ginzan-onsen", name: "銀山温泉", region: "山形県 尾花沢市" } as unknown as SpotLink} />);
        await screen.findByText("朝の湖");
        const row = screen.getByTestId("photo-spot-guide");
        expect(row.getAttribute("href")).toBe("/spots/ginzan-onsen");
        expect(row.textContent).toContain("撮影スポット · 銀山温泉");
        // 2行の当たり（44 ずつ）を負の余白で重ねない（束 1 の確かめの直し）
        for (const a of [row, screen.getByTestId("photo-place-link")]) expect(a.className).not.toMatch(/-my-/);
    });
});

describe("写真ページ: この近くで撮られた写真", () => {
    it("近くの写真があれば、見出しと写真へのリンク・地図で見る（正確な座標のとき）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, coords: { lat: 38.58, lng: 140.53 } } as Photo}
                                initialRelated={related([NEAR])} />);
        const section = await screen.findByTestId("photo-nearby");
        expect(section.textContent).toContain("この近くで撮られた写真");
        expect(section.querySelector("a[data-photo-id='n1']")?.getAttribute("href")).toContain("n1");
        expect(screen.getByRole("link", { name: "地図で見る" }).getAttribute("href")).toMatch(/^\/map#/);
    });

    it("近くに1枚も無ければ節ごと出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} initialRelated={related([])} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-nearby")).toBeNull();
    });
});
