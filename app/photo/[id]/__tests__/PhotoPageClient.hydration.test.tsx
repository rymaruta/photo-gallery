import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";

// **写真ページはハイドレーションまで写真を隠さない。**
// この画面は検索の着地点。以前は `opacity-0`（ぼかしが無ければ黒い回転まで）を
// 静的HTMLに焼いていたので、JS が届いて React が付くまで写真が見えなかった
// （`Thumb` と同じ型。Chromium 実測・Fast 3G + CPU 4倍で一覧は 1.6秒 → 5.9秒）。
// LCP をそのぶん遅らせていた。

const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: (...args: unknown[]) => mockPublicFetch(...args),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const base = { id: "p1", src: "https://cdn.example.com/uploads/u1/a.jpg", userId: "u1", title: "写真", exif: { camera: "X-T5" } };
const mainImage = () => screen.getByAltText(/写真/) as HTMLImageElement;
const setReady = (ready: boolean) => {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => ready });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (ready ? 1000 : 0) });
};
const restore = () => {
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
};

beforeEach(() => mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] }));

describe("写真ページ: ハイドレーション前は隠さない", () => {
    it("静的HTMLでは本体の写真を透明にせず、黒い回転も出さない", () => {
        const html = renderToString(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        const img = /<img[^>]*alt="写真"[^>]*>/.exec(html)?.[0] ?? "";
        expect(img, "本体の <img> が見つからない").not.toBe("");
        expect(img, "JS が届くまで写真が透明のまま").not.toContain("opacity-0");
        expect(html, "届いている写真を黒い回転で覆う").not.toContain("animate-spin");
    });

    it("React が付いた時点でまだ届いていなければ隠して回転を出し、届いたら出す", () => {
        setReady(false);
        try {
            const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            const img = mainImage();
            expect(img.className).toContain("opacity-0");
            expect(container.querySelector(".animate-spin"), "待っているのに回転が無い").not.toBeNull();
            fireEvent.load(img);
            expect(img.className).toContain("opacity-100");
            expect(container.querySelector(".animate-spin")).toBeNull();
        } finally { restore(); }
    });

    it("既に届いていれば（キャッシュ済みの再訪）隠さない", () => {
        setReady(true);
        try {
            const { container } = render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            expect(mainImage().className).toContain("opacity-100");
            expect(container.querySelector(".animate-spin")).toBeNull();
        } finally { restore(); }
    });

    it("読み込みに失敗したら、隠したままにせず失敗を出す", () => {
        setReady(false);
        try {
            render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
            fireEvent.error(mainImage());
            expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        } finally { restore(); }
    });
});
