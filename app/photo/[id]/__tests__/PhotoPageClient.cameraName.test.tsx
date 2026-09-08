import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **画面で EXIF を抽出する経路だけ、Make と Model を素のまま連結していた。**
// Model がメーカー名を含む機種（Hasselblad "X2D 100C" は Model が
// "Hasselblad X2D 100C"）で「Hasselblad Hasselblad X2D 100C」になる。
// アップロード側は前から `formatCameraName` で畳んでいた（対の乖離）

const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockParse = vi.hoisted(() => vi.fn());

vi.mock("exifr", () => ({ default: { parse: (...a: unknown[]) => mockParse(...a) } }));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
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
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

// exif を持たない写真（＝画面で抽出する経路に入る）
const base = { id: "p1", src: "https://cdn.example.com/uploads/u1/a.jpg", userId: "u1", title: "写真" };

beforeEach(() => {
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockParse.mockReset();
});

describe("写真ページ: 画面で抽出したカメラ名", () => {
    it("Model がメーカー名を含んでいても二重にしない", async () => {
        mockParse.mockResolvedValue({ Make: "Hasselblad", Model: "Hasselblad X2D 100C" });
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        // 抽出は本体の画像が読み込まれてから
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("Hasselblad X2D 100C");
        expect(screen.queryByText(/Hasselblad Hasselblad/)).toBeNull();
    });

    it("Make と Model が別物なら並べる（正常系）", async () => {
        mockParse.mockResolvedValue({ Make: "Canon", Model: "EOS R5" });
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        fireEvent.load(screen.getByAltText(/写真/));
        await screen.findByText("Canon EOS R5");
    });
});
