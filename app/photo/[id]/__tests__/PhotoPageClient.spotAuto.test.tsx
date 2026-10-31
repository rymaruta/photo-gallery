import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import type { SpotLink } from "@/lib/data/spotLink";

/**
 * 写真の詳細の**自動の結び**（2026-10-31 判断・journey.photo-ios#425）。
 *
 * - 撮った本人にだけ「『◯◯』の写真としてまとめました」と「違う場所なので外す」
 * - 外すと `PUT /photos/{id}` に `spotAuto: "off"`、元に戻すと `spotAuto: null`
 * - 外したら撮影スポットの札（この写真の撮影スポット）も引っ込める
 * - ほかの人には知らせを出さない（札は出る）・本人が選んだ `spotId` があれば知らせを出さない
 */
const auth = vi.hoisted(() => ({ userId: "bob" as string | null }));
const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: !!auth.userId, userId: auth.userId, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    publicFetch: () => new Promise(() => undefined),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const FOX_PHOTO = {
    id: "p1", src: "https://cdn.example.com/uploads/bob/b.webp", title: "夢の中", userId: "bob",
    location: "蔵王キツネ村, 白石市, 宮城県",
} as unknown as Photo;
const FOX_LINK = { slug: "miyagi-zao-fox", name: "蔵王キツネ村", region: "宮城県 白石市" } as unknown as SpotLink;

/** `spotAuto` を送った呼び出しだけ（本人の画面はほかにも userFetch を呼ぶ） */
const spotAutoCalls = () => mockUserFetch.mock.calls
    .filter(([, init]) => typeof (init as { body?: unknown } | undefined)?.body === "string" && (init as { body: string }).body.includes("spotAuto"))
    .map(([url, init]) => ({ url: url as string, method: (init as { method: string }).method, body: JSON.parse((init as { body: string }).body) }));

beforeEach(() => {
    auth.userId = "bob";
    mockUserFetch.mockReset();
    mockUserFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

describe("写真の詳細: 自動の結び", () => {
    it("本人には知らせと「違う場所なので外す」。押すと spotAuto: off を送り、札を引っ込める", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={FOX_PHOTO} spotLink={FOX_LINK} spotAuto={{ name: "蔵王キツネ村", off: false }} />);
        const notice = await screen.findByTestId("spot-auto-notice");
        expect(notice.textContent).toContain("あなたにだけ表示");
        expect(notice.textContent).toContain("「蔵王キツネ村」の写真としてまとめました");
        expect(screen.getByRole("heading", { name: "この写真の撮影スポット" })).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "違う場所なので外す" }));
        await waitFor(() => expect(spotAutoCalls()).toHaveLength(1));
        expect(spotAutoCalls()[0]).toEqual({ url: "/photos/p1", method: "PUT", body: { spotAuto: "off" } });
        await waitFor(() => expect(screen.queryByRole("heading", { name: "この写真の撮影スポット" })).toBeNull());
        expect(screen.getByTestId("spot-auto-notice").textContent).toContain("自動のまとめを外しています");

        fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
        await waitFor(() => expect(spotAutoCalls()).toHaveLength(2));
        expect(spotAutoCalls()[1].body).toEqual({ spotAuto: null });
    });

    it("保存に失敗したら、外した見た目にしない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "x" }) });
        render(<PhotoPageClient photoId="p1" initialPhoto={FOX_PHOTO} spotLink={FOX_LINK} spotAuto={{ name: "蔵王キツネ村", off: false }} />);
        fireEvent.click(await screen.findByRole("button", { name: "違う場所なので外す" }));
        await waitFor(() => expect(spotAutoCalls()).toHaveLength(1));
        expect(screen.getByRole("heading", { name: "この写真の撮影スポット" })).toBeTruthy();
        expect(screen.getByTestId("spot-auto-notice").textContent).toContain("まとめました");
    });

    it("外してある写真は「元に戻す」を出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...FOX_PHOTO, spotAuto: "off" } as Photo} spotLink={null} spotAuto={{ name: "蔵王キツネ村", off: true }} />);
        const notice = await screen.findByTestId("spot-auto-notice");
        expect(notice.textContent).toContain("自動のまとめを外しています");
        expect(screen.getByRole("button", { name: "元に戻す" })).toBeTruthy();
    });

    it("ほかの人には知らせを出さない（札は出る）", async () => {
        auth.userId = "alice";
        render(<PhotoPageClient photoId="p1" initialPhoto={FOX_PHOTO} spotLink={FOX_LINK} spotAuto={{ name: "蔵王キツネ村", off: false }} />);
        expect(await screen.findByRole("heading", { name: "この写真の撮影スポット" })).toBeTruthy();
        expect(screen.queryByTestId("spot-auto-notice")).toBeNull();
    });

    it("本人が選んだ spotId がある写真には知らせを出さない", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={{ ...FOX_PHOTO, spotId: "sp_aaaaaaaaaaaa" } as Photo} spotLink={FOX_LINK} spotAuto={{ name: "蔵王キツネ村", off: false }} />);
        expect(await screen.findByRole("heading", { name: "この写真の撮影スポット" })).toBeTruthy();
        expect(screen.queryByTestId("spot-auto-notice")).toBeNull();
    });
});
