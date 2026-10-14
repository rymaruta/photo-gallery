import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

/**
 * 写真ページの「この写真を見て撮影」（`InspiredByLine`）。
 *
 * **元の写真は公開の一覧（`GET /photos`）に居るときだけ出す。** 取得前はビルド時に
 * 解いたもの（`initialInspired`）を出し、取得したら一覧で解き直す——そのあいだに
 * 非公開・削除になった元の写真は消える（読むときにも確かめる）。
 */
const mockPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
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
const { inspiredSourceFor, toInspiredLink } = await import("@/lib/utils/inspired");

const SOURCE = {
    id: "src-1", src: "https://cdn.example.com/uploads/alice/a.webp", thumbSm: "https://cdn.example.com/uploads/alice/a-256.webp",
    title: { ja: "朝の湖", en: "Morning lake" }, userId: "alice", displayName: "アリス", published: true,
} as unknown as Photo;
const MINE = {
    id: "p1", src: "https://cdn.example.com/uploads/bob/b.webp", title: "ぼくの湖", userId: "bob", inspiredBy: "src-1",
} as unknown as Photo;

const okList = (rows: Photo[]) => ({ ok: true, status: 200, json: async () => rows });
/** 取得をいつまでも返さない（ビルド時のデータのまま描いている状態を見る） */
const pending = () => new Promise(() => undefined);

beforeEach(() => {
    mockPublicFetch.mockReset();
});

describe("写真ページ: この写真を見て撮影", () => {
    it("取得前は、ビルド時に解いた元の写真を出す（小さい画像・題・作者・元の写真へのリンク）", async () => {
        mockPublicFetch.mockImplementation(pending);
        render(<PhotoPageClient photoId="p1" initialPhoto={MINE} initialInspired={toInspiredLink(SOURCE)} />);
        const line = await screen.findByTestId("inspired-by");
        expect(line.textContent).toContain("この写真を見て撮影");
        expect(line.textContent).toContain("朝の湖");
        expect(line.textContent).toContain("アリス さんの写真");
        expect(line.querySelector("a")?.getAttribute("href")).toMatch(/src-1/);
        expect(line.querySelector("img")?.getAttribute("src")).toContain("a-256.webp");
    });

    it("取得した公開の一覧に元の写真が居れば出し続ける", async () => {
        mockPublicFetch.mockResolvedValue(okList([MINE, SOURCE]));
        render(<PhotoPageClient photoId="p1" initialPhoto={MINE} initialInspired={toInspiredLink(SOURCE)} />);
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        expect(await screen.findByTestId("inspired-by")).toBeTruthy();
    });

    it("取得した一覧に居なければ（非公開・削除）消す", async () => {
        mockPublicFetch.mockResolvedValue(okList([MINE]));
        render(<PhotoPageClient photoId="p1" initialPhoto={MINE} initialInspired={toInspiredLink(SOURCE)} />);
        await waitFor(() => expect(screen.queryByTestId("inspired-by")).toBeNull());
    });

    it("付いていない写真には出さない", async () => {
        mockPublicFetch.mockResolvedValue(okList([{ ...MINE, inspiredBy: undefined } as Photo, SOURCE]));
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...MINE, inspiredBy: undefined } as Photo} />);
        await screen.findByText("ぼくの湖");
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        expect(screen.queryByTestId("inspired-by")).toBeNull();
    });

    it("編集で外したあとの一覧なら（inspiredBy が無い）、ビルド時のものを出さない", async () => {
        mockPublicFetch.mockResolvedValue(okList([{ ...MINE, inspiredBy: undefined } as Photo, SOURCE]));
        render(<PhotoPageClient photoId="p1" initialPhoto={MINE} initialInspired={toInspiredLink(SOURCE)} />);
        await waitFor(() => expect(screen.queryByTestId("inspired-by")).toBeNull());
    });
});

describe("inspiredSourceFor: 公開の一覧から元の写真を探す", () => {
    const all = [MINE, SOURCE];

    it("居れば返す", () => {
        expect(inspiredSourceFor(MINE, all)?.id).toBe("src-1");
    });

    it.each([
        ["非公開", { published: false }],
        ["ストーリー", { story: true }],
        ["公開範囲を絞った", { audience: "followers" }],
        ["src が無い", { src: "" }],
    ])("%s の行は返さない（一覧が古い行を含んでいても隠す側に倒す）", (_label, patch) => {
        expect(inspiredSourceFor(MINE, [MINE, { ...SOURCE, ...patch } as Photo])).toBeNull();
    });

    it("居なければ（削除）返さない・自分自身は指さない・付いていなければ null", () => {
        expect(inspiredSourceFor(MINE, [MINE])).toBeNull();
        expect(inspiredSourceFor({ ...MINE, inspiredBy: "p1" } as Photo, all)).toBeNull();
        expect(inspiredSourceFor({ ...MINE, inspiredBy: undefined } as Photo, all)).toBeNull();
        expect(inspiredSourceFor(null, all)).toBeNull();
    });

    it("要約は 256px → 512px → 原寸の順で小さい画像を選ぶ", () => {
        expect(toInspiredLink(SOURCE).thumb).toContain("a-256.webp");
        expect(toInspiredLink({ ...SOURCE, thumbSm: undefined, thumbSrc: "t512" } as Photo).thumb).toBe("t512");
        expect(toInspiredLink({ ...SOURCE, thumbSm: undefined } as Photo).thumb).toBe(SOURCE.src);
    });
});
