import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

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

describe("写真ページ: v2 の撮影情報", () => {
    it("畳んだ見出しに「24mm · f/8 · 1/125 s · ISO 100」、下に 機種 · レンズ", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: EXIF } as Photo} />);
        expect((await screen.findByTestId("exif-settings-line")).textContent).toBe("24mm · f/8 · 1/125 s · ISO 100");
        expect(screen.getByTestId("exif-gear-line").textContent).toBe("Canon EOS R6 · RF24-70mm");
    });

    it("開くと機材の行は消える（下の升目が同じ機種・レンズを出すので二度言わない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: EXIF } as Photo} />);
        await screen.findByTestId("exif-gear-line");
        fireEvent.click(screen.getByRole("button", { name: "詳しく見る" }));
        expect(screen.queryByTestId("exif-gear-line")).toBeNull();
        expect(screen.getByTestId("exif-settings-line"), "要約は開いても残る").toBeTruthy();
    });

    it("撮影情報の無い写真には要約を出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, exif: { camera: "X-T5" } } as Photo} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("exif-settings-line")).toBeNull();
        expect(screen.getByTestId("exif-gear-line").textContent).toBe("X-T5");
    });
});

describe("写真ページ: 道しるべ", () => {
    it("写真の上に「撮影地 · この撮影地の写真 ›」（撮影地の集約ページへ・押す的は 44px）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} />);
        await screen.findByText("朝の湖");
        const link = screen.getByRole("link", { name: "銀山温泉 · この撮影地の写真" });
        expect(link.getAttribute("href")).toContain("/location/");
        expect(link.textContent).toContain("この撮影地の写真 ›");
        expect(link.style.minHeight).toBe("44px");
    });
});

describe("写真ページ: この近くで撮られた写真", () => {
    it("近くの写真があれば、見出しと写真へのリンク・地図で見る（正確な座標のとき）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...BASE, coords: { lat: 38.58, lng: 140.53 } } as Photo}
                                initialRelated={related([NEAR])} />);
        const section = await screen.findByTestId("photo-nearby");
        expect(section.textContent).toContain("この近くで撮られた写真");
        expect(section.querySelector("a[data-photo-id='n1']")?.getAttribute("href")).toContain("n1");
        expect(screen.getByRole("link", { name: "地図で見る ›" }).getAttribute("href")).toMatch(/^\/map#/);
    });

    it("近くに1枚も無ければ節ごと出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={BASE} initialRelated={related([])} />);
        await screen.findByText("朝の湖");
        expect(screen.queryByTestId("photo-nearby")).toBeNull();
    });
});
