import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **全写真が `1200x800`（3:2）を名乗っていた。**
// 実寸を持たない写真でも `width={1200} height={800}` が固定で付いていたので、
// 縦位置の写真は読み込み後に高さが伸び、下の情報がガタつく
// （Chromium 実測・390x844・画像を500ms遅延: CLS 0.167 →
// 属性なし 0.030 → 実寸 0.000）。
// 同じ「1200x800 の嘘」は OGP 側では既に直してある
// （`app/__tests__/usersMetadata.test.ts`）のに `<img>` に残っていた。

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
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn(async () => ({ ok: true })) }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const base = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/a.jpg",
    userId: "u1",
    title: "写真",
    exif: { camera: "X-T5" },
};

/** 本体の写真（関連写真などは全部モックしてある） */
const mainImage = () => screen.getByAltText(/写真/) as HTMLImageElement;

beforeEach(() => mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] }));

// 実寸があれば `<img>` の属性で比率ぶんの高さが先に確保されるので、
// `min-height: 400px` は要らない。重ねると幅の狭い画面で写真より箱が高くなり
// 上下が黒帯になる（Chromium 実測・390px: 3:2 の写真 362x241 に対し箱 400px
// → 上下 79px ずつ黒）
describe("写真ページの枠の予約", () => {
    const boxes = () => Array.from(document.querySelectorAll<HTMLElement>("div")).filter((d) => d.style.minHeight === "400px");
    it("実寸を持つ写真は 400px の予約を重ねない（黒帯を作らない）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, width: 3000, height: 2000 }} />);
        expect(boxes(), "実寸があるのに 400px の箱が残っている").toHaveLength(0);
    });
    it("実寸を知らない写真は、届くまでの高さを予約する（ガタつきを抑える）", () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        expect(boxes().length).toBeGreaterThan(0);
    });
});

describe("写真ページの画像サイズ", () => {
    it("実寸を持つ写真は、その実寸を出す（縦位置でも枠がずれない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, width: 1000, height: 1500 }} />);
        const img = mainImage();
        expect(img.getAttribute("width")).toBe("1000");
        expect(img.getAttribute("height")).toBe("1500");
    });

    it("実寸を知らない写真は、比率を名乗らない（1200x800 と嘘をつかない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        const img = mainImage();
        expect(img.getAttribute("width"), "実寸を知らないのに 1200x800 を名乗っている").toBeNull();
        expect(img.getAttribute("height")).toBeNull();
    });

    // **「画像を読み込めません」の分岐にもテストが無かった**（レビュー指摘）。
    // 実装は前からあるが、消しても誰も気づかない状態だった
    it("画像が取れないときは理由を出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={base} />);
        const img = mainImage();
        fireEvent.error(img);

        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        expect(screen.queryByAltText(/写真/), "失敗した img を残している").toBeNull();
    });

    it("片方だけしか無い写真も名乗らない（片側だけの属性は比率にならない）", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...base, width: 1000 }} />);
        const img = mainImage();
        expect(img.getAttribute("width")).toBeNull();
        expect(img.getAttribute("height")).toBeNull();
    });
});
