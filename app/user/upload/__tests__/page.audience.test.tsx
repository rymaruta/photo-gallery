import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ROUTES } from "../../../../lib/routes";

// **公開範囲**（iOS の新規投稿と同じ三択）。サーバーは前から `audience` を受けていた
// （`api-user/src/upload.ts`・`sanitizeAudience`）。絞った写真はウェブサイトに載らない。
// 保存の中身を見る仕組みは page.album.test.tsx と同じ。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false, userId: "me" }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// `userFetch` はこちらでトークンを引く（`getCurrentSession` だけ差し替えても
// 入口を支配できない）。page.quota.test.tsx と同じ形
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

/** `/upload/save` に送った本文 */
function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "";
    mockPush.mockReset();
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

async function uploadOne(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const publish = await screen.findByRole("button", { name: /投稿する/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

describe("アップロード画面: 公開範囲（iOS の新規投稿と同じ三択）", () => {

    /** 既定は全体に公開で、**送らない**（サーバーも属性を書かない形で持つ） */
    it("既定は全体に公開で、audience を載せない", async () => {
        const { container, getByRole } = render(<UploadPage />);
        expect(getByRole("radio", { name: /全体に公開/ })).toBeChecked();
        await uploadOne(container);
        expect("audience" in savedBody()!, "全体に公開なのに audience を送っている").toBe(false);
    });

    it("「フォロワーのみ」を選ぶと audience: followers を載せる", async () => {
        const { container, getByRole } = render(<UploadPage />);
        await userEvent.click(getByRole("radio", { name: /フォロワーのみ/ }));
        await uploadOne(container);
        expect(savedBody()!.audience).toBe("followers");
    });

    it("「親しい友達」を選ぶと audience: closeFriends を載せ、選ぶ場所へ案内する", async () => {
        const { container, getByRole, getByText } = render(<UploadPage />);
        await userEvent.click(getByRole("radio", { name: /親しい友達/ }));
        expect(getByText(/設定の「親しい友達」/)).toHaveAttribute("href", "/user/settings");
        await uploadOne(container);
        expect(savedBody()!.audience).toBe("closeFriends");
    });

    /** 絞るとウェブサイトに載らない（検索から見つからない）。選ぶ前に分かるように */
    it("絞った選択肢は「ウェブサイトには載りません」と言う", () => {
        const { getAllByText } = render(<UploadPage />);
        expect(getAllByText(/ウェブサイトには載りません/)).toHaveLength(2);
    });

    /**
     * **絞った写真はトップに出ない。** 「上げたのに無い＝失敗した」と読まれないよう、
     * そう伝えて、自分の写真が並ぶプロフィールへ送る（持ち主には全件見える）
     */
    it("絞って公開したら、ウェブサイトに載らないと伝え、プロフィールへ移る", async () => {
        const { container, getByRole } = render(<UploadPage />);
        await userEvent.click(getByRole("radio", { name: /フォロワーのみ/ }));
        await uploadOne(container);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("ウェブサイトには載りません"), "info"));
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith(ROUTES.USER_PROFILE("me")), { timeout: 3000 });
    });

    it("全体に公開なら、今までどおりトップへ移り、載らないとは言わない", async () => {
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"), { timeout: 3000 });
        expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("ウェブサイトには載りません"))).toBe(false);
    });
});
