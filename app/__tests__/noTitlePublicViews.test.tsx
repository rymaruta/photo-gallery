import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 公開の画面で、題の無い写真（欄が無い・空白だけ・旧い既定値 `{ ja: "無題", en: "Untitled" }`）に
 * 「無題」を出さない（2026-10-18）。
 *
 * - 見える題は**空なら出さない**（一覧と同じ。owner:「タイトルなくてもいいよ」）
 * - 名前が要る所（共有の文言・読み上げ名・画像の alt）は写真ページと同じ代わりの題
 *   （「<撮影地>の写真」/「写真」・`photoTitleFor`）
 */
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: vi.fn(() => new Promise(() => undefined)),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    authenticatedFetch: vi.fn(),
}));
const share = vi.hoisted(() => ({ shareUrl: vi.fn(async () => "shared" as const), shareToTwitter: vi.fn(), shareToLine: vi.fn(), copyToClipboard: vi.fn(async () => true) }));
vi.mock("../../lib/utils/share", () => share);

const GalleryModal = (await import("../components/GalleryModal")).default;
const RelatedPhotos = (await import("../components/RelatedPhotos")).default;
const MapPhotoList = (await import("../map/MapPhotoList")).default;
const { PhotoCard } = await import("../users/UserProfileClient");

const P = (over: Record<string, unknown>): Photo => ({
    id: "p1", src: "https://cdn.example.com/uploads/u1/p1.jpg", userId: "u1", tags: [], ...over,
} as unknown as Photo);

/** 画像の名前（読み込めた `<img alt>` か、読めなかったときの `role="img"` の名前。`Thumb` はどちらかを出す） */
function imageName(root: Element): string | null {
    const el = root.querySelector('img[alt]:not([alt=""]), [role="img"]');
    return el?.getAttribute("alt") ?? el?.getAttribute("aria-label") ?? null;
}

const NO_TITLES: [string, Record<string, unknown>][] = [
    ["欄が無い", {}],
    ["空白だけ", { title: { ja: "  " } }],
    ["{ ja: 無題, en: Untitled }", { title: { ja: "無題", en: "Untitled" } }],
];
const PLACES: [string, Record<string, unknown>, string][] = [
    ["撮影地あり", { location: "板橋区" }, "板橋区の写真"],
    ["撮影地なし", {}, "写真"],
];

describe("拡大表示（GalleryModal）", () => {
    for (const [name, t] of NO_TITLES) {
        for (const [pname, loc, want] of PLACES) {
            it(`${name}・${pname} → 共有の文言と読み上げ名は「${want}」、見える題は出さない`, async () => {
                const { container } = render(<GalleryModal photos={[P({ ...t, ...loc })]} currentIndex={0}
                    onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />);
                expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(want);
                share.shareUrl.mockClear();
                fireEvent.click(screen.getAllByRole("button", { name: "共有" })[0]);
                await waitFor(() => expect(share.shareUrl).toHaveBeenCalled());
                expect((share.shareUrl.mock.calls[0] as unknown[])[1]).toBe(want);
                expect(container.innerHTML).not.toMatch(/無題|Untitled/);
            });
        }
    }
    it("題があればその題", () => {
        render(<GalleryModal photos={[P({ title: { ja: "朝の湖" }, location: "板橋区" })]} currentIndex={0}
            onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />);
        expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("朝の湖");
    });
});

describe("関連写真の帯（RelatedPhotos）", () => {
    for (const [name, t] of NO_TITLES) {
        it(`${name} → title 属性も見える題も出さず、alt は代わりの題`, () => {
            const { container } = render(<RelatedPhotos title="同じ撮影地" photos={[P({ ...t, location: "板橋区" })]} locale="ja" />);
            const link = container.querySelector('a[data-photo-id="p1"]');
            expect(link?.getAttribute("title") ?? "").toBe("");
            expect(imageName(container)).toBe("板橋区の写真");
            expect(container.innerHTML).not.toMatch(/無題|Untitled/);
        });
    }
});

describe("撮影地マップの一覧（MapPhotoList）", () => {
    for (const [name, t] of NO_TITLES) {
        it(`${name} → 撮影地あり: 撮影地だけ・撮影地なし: 「写真」`, () => {
            const { container, unmount } = render(<MapPhotoList photos={[P({ ...t, location: "板橋区", coords: { lat: 35, lng: 139 } }) as never]} locale="ja" />);
            expect(container.querySelector("a")?.textContent?.trim()).toBe("板橋区");
            expect(container.innerHTML).not.toMatch(/無題|Untitled/);
            unmount();
            const r = render(<MapPhotoList photos={[P({ ...t, coords: { lat: 35, lng: 139 } }) as never]} locale="ja" />);
            expect(r.container.querySelector("a")?.textContent).toContain("写真");
            expect(r.container.innerHTML).not.toMatch(/無題|Untitled/);
        });
    }
});

describe("プロフィールの写真（PhotoCard）", () => {
    for (const [name, t] of NO_TITLES) {
        it(`${name} → 読み上げ名は「写真を開く」、「無題」を出さない`, () => {
            const { container } = render(<PhotoCard photo={P({ ...t, location: "板橋区" })} locale="ja" isOwner={false} />);
            expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("写真を開く");
            expect(container.innerHTML).not.toMatch(/無題|Untitled/);
        });
    }
});
