import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// オーナー向けの編集導線（UX-1 で追加）。**他人や未ログインに出してはいけない**
// ——押しても /user/edit 側で弾かれるが、出ている時点で誤解を招く。
// 既存の PhotoPageClient のテストは fetchFail / mvError の2本だけで、
// この分岐に触れていなかった。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: false, userId: null as string | null, loading: false },
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));
// readApiError は本物を使う（この配線こそが直した対象）。fetch だけ差し替える
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
// 写真ページの脇役は描かない（それぞれ自分のテストを持っている）
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
const mockLikeToggle = vi.hoisted(() => vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true })));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: mockLikeToggle }),
}));
vi.mock("../../../../lib/utils/music", () => ({
    searchSongs: (...a: unknown[]) => mockSearchSongs(...a),
    parseMusicEmbed: () => null,
}));
const mockSearchSongs = vi.hoisted(() => vi.fn());

const PhotoPageClient = (await import("../PhotoPageClient")).default;

// **曲を持たせる。** この節は `(photoSong || photoYtUrl || isOwnPhoto)` で
// 囲まれているので、曲が無いとオーナー以外では**節ごと描かれず**、
// 導線の `isOwnPhoto &&` を壊しても他人には出ない＝変異が素通りする
// （実際に素通りした）。曲があれば節は全員に描かれるので、
// 導線を隠しているのが内側の判定だけになる。
const photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
    exif: { Model: "X-T5" },
    song: { title: "曲", previewUrl: "https://audio.example/a.m4a" },
} as unknown as Photo;

const LINK = /この写真を編集・削除/;

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
    authState.current = { isAuthenticated: false, userId: null, loading: false };
});

describe("オーナー向けの編集導線", () => {
    it("未ログインには出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        expect(screen.queryByText(LINK)).toBeNull();
    });

    it("別人には出さない", async () => {
        authState.current = { isAuthenticated: true, userId: "someone-else", loading: false };
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        await screen.findByText("テスト写真");
        expect(screen.queryByText(LINK)).toBeNull();
    });

    it("本人には出す（編集画面へのリンク）", async () => {
        authState.current = { isAuthenticated: true, userId: "owner-1", loading: false };
        render(<PhotoPageClient photoId="p1" initialPhoto={photo} />);
        const link = await screen.findByText(LINK);
        expect(link.closest("a")?.getAttribute("href")).toContain("/user/edit?id=p1");
    });
});
