import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **カバーを自分の投稿から選ぶ**（#304・板 50 CoverPick・2026-10-18）と、設定したあとのお礼（`POST /user/trunk/reward`）。

const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSafe = vi.hoisted(() => vi.fn<(f: File, maxPx?: number) => Promise<File>>(async (f) => f));
const mockBytes = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: (...a: unknown[]) => mockSafe(...(a as [File, number])),
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));
vi.mock("../../../../lib/utils/imageBytes", () => ({ fetchImageBytes: (...a: unknown[]) => mockBytes(...a) }));

const ProfilePage = (await import("../page")).default;

const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };
const PHOTOS = [
    { id: "p1", src: "https://cdn.test/uploads/p1.webp", likes: 2, createdAt: "2026-10-10T00:00:00Z" },
    { id: "p2", src: "https://cdn.test/uploads/p2.webp", likes: 9, createdAt: "2026-10-01T00:00:00Z" },
    { id: "p3", src: "https://cdn.test/uploads/p3.webp", likes: 50, createdAt: "2026-10-12T00:00:00Z", audience: "followers" },
];
let photos: unknown = PHOTOS;
let reward = { granted: true, added: 3, coins: 3, rewarded: true };
const mockFetch = vi.fn();

beforeEach(() => {
    photos = PHOTOS;
    reward = { granted: true, added: 3, coins: 3, rewarded: true };
    mockShowToast.mockReset();
    mockSafe.mockReset().mockImplementation(async (f: File) => f);
    mockBytes.mockReset().mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
    mockUserFetch.mockReset().mockImplementation(async (url: string) => {
        if (url === "/profile/avatar/presigned-url") {
            return { ok: true, json: async () => ({ presignedUrl: "https://s3.test/put", contentType: "image/webp" }) };
        }
        if (url === "/user/photos") return { ok: true, json: async () => photos };
        if (url === "/user/trunk/reward") return { ok: true, json: async () => reward };
        return { ok: true, json: async () => STORED };
    });
    mockFetch.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const presignBodies = () => mockUserFetch.mock.calls
    .filter((c) => c[0] === "/profile/avatar/presigned-url")
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);
const rewardBodies = () => mockUserFetch.mock.calls
    .filter((c) => c[0] === "/user/trunk/reward")
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

describe("カバーを自分の投稿から選ぶ", () => {
    it("全体に公開している投稿だけを、いいねの多い順に並べる（絞った写真は出さない）", async () => {
        render(<ProfilePage />);
        const sec = await screen.findByTestId("cover-pick");
        const btns = within(sec).getAllByRole("button", { name: /カバーにする$/ });
        expect(btns).toHaveLength(2);
        expect(btns[0].querySelector("img")?.getAttribute("src")).toContain("p2");
        await userEvent.click(within(sec).getByRole("radio", { name: "最近" }));
        expect(within(sec).getAllByRole("button", { name: /カバーにする$/ })[0].querySelector("img")?.getAttribute("src")).toContain("p1");
    });

    it("押すと、その写真の中身を取り直して type: \"cover\" で上げ、お礼を頼み、足せたら知らせる", async () => {
        render(<ProfilePage />);
        const sec = await screen.findByTestId("cover-pick");
        await userEvent.click(within(sec).getAllByRole("button", { name: /カバーにする$/ })[0]);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("カバー写真を更新しました", "success"));
        expect(mockBytes).toHaveBeenCalledWith("https://cdn.test/uploads/p2.webp");
        expect(presignBodies()).toEqual([{ fileType: "image/webp", type: "cover" }]);
        // 縮める・位置情報を落とすのは端末から選ぶときと同じ
        expect(mockSafe.mock.calls[0][1]).toBe(1280);
        await waitFor(() => expect(rewardBodies()).toEqual([{ kind: "cover" }]));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("カバーを設定したお礼に、トランクの硬貨を 3 枚", "success"));
    });

    it("お礼が 0 枚（もらい済み）なら知らせない", async () => {
        reward = { granted: false, added: 0, coins: 10, rewarded: true };
        render(<ProfilePage />);
        const sec = await screen.findByTestId("cover-pick");
        await userEvent.click(within(sec).getAllByRole("button", { name: /カバーにする$/ })[0]);
        await waitFor(() => expect(rewardBodies()).toHaveLength(1));
        await new Promise((r) => setTimeout(r, 0));
        expect(mockShowToast.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining("硬貨"));
    });

    it("アイコンを端末から上げたときも kind: avatar でお礼を頼む", async () => {
        const { container } = render(<ProfilePage />);
        await screen.findByDisplayValue("こんにちは");
        const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
        await userEvent.upload(inputs[1], new File(["x"], "me.jpg", { type: "image/jpeg" }));
        await waitFor(() => expect(rewardBodies()).toEqual([{ kind: "avatar" }]));
    });

    it("投稿が無ければ投稿へ誘う", async () => {
        photos = [];
        render(<ProfilePage />);
        const sec = await screen.findByTestId("cover-pick");
        expect(within(sec).getByRole("link", { name: "写真を投稿する" }).getAttribute("href")).toBe("/user/upload");
    });

    it("写真の一覧が読めなければ節ごと出さない（画面は出す）", async () => {
        photos = { error: "x" };
        render(<ProfilePage />);
        await screen.findByDisplayValue("こんにちは");
        expect(screen.queryByTestId("cover-pick")).toBeNull();
    });
});
