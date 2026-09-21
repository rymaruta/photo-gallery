import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ハイライトを作る・直す画面（`/user/highlights`）。モックの作成画面＝
 * 題・表紙・チェック付きのグリッド。
 *
 *   - 未ログインはログインへ（戻り先付き）
 *   - グリッドはアーカイブ（新しい順）。フォロワーのみの投稿は押せず、理由が付く
 *   - 選ぶと印が付き、最初の1枚が表紙。表紙は選んだ中から替えられる
 *   - 保存は**投稿順（古い→新しい）**で送る（押した順ではない）
 *   - `?id=` は既存を読んで PUT。消すのもここ（404 は成功）
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, loading: false, userId: "11111111-1111-4111-8111-111111111111" as string | null } }));
const query = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? query.id : null) }),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    isGoneResponse: async (r: { status: number }) => r.status === 404,
    readApiError: async (r: { json: () => Promise<{ error?: string }> }, f: string) => (await r.json()).error ?? f,
}));

const Page = (await import("../page")).default;

const ME = "11111111-1111-4111-8111-111111111111";
const HID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const story = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `story-0000000${n}-0000-4000-8000-000000000000`, src: `https://cdn/x/s${n}.jpg`, userId: ME, mediaType: "image",
    createdAt: `2026-07-0${n}T10:00:00Z`, expiresAt: `2026-07-0${n + 1}T10:00:00Z`, archivedAt: `2026-07-0${n + 1}T10:00:00Z`, archive: true, ...extra,
});
const S1 = story(1), S2 = story(2), S3 = story(3, { visibility: "followers" });
/** サーバーは新しい順 */
const ARCHIVE = [S3, S2, S1];

const api = (archive: unknown = ARCHIVE) => async (url: string, init?: { method?: string }) => {
    if (url === "/stories/archive") return { ok: true, status: 200, json: async () => archive };
    if (url === "/highlights" && init?.method === "POST") return { ok: true, status: 200, json: async () => ({ highlight: { id: HID } }) };
    if (url.startsWith("/highlights/") && init?.method === "PUT") return { ok: true, status: 200, json: async () => ({ highlight: { id: HID } }) };
    if (url.startsWith("/highlights/") && init?.method === "DELETE") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({}) };
};
/** グリッド（3列の ul）のタイル */
const gridTiles = async () => {
    const lists = await screen.findAllByRole("list");
    const grid = lists.find((l) => l.classList.contains("grid"))!;
    return within(grid).getAllByRole("listitem");
};
const tileButton = (li: HTMLElement) => within(li).getByRole("button");
const sent = (method: string) => mockUserFetch.mock.calls
    .filter((c) => (c[1] as { method?: string })?.method === method)
    .map((c) => ({ url: c[0] as string, body: JSON.parse((c[1] as { body?: string }).body ?? "null") }));

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(api());
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "見つかりません" }) });
    mockReplace.mockReset();
    mockPush.mockReset();
    mockShowToast.mockReset();
    authState.current = { isAuthenticated: true, loading: false, userId: ME };
    query.id = null;
});

describe("ハイライトの作成画面", () => {
    it("未ログインはログインへ（戻り先付き）", async () => {
        authState.current = { isAuthenticated: false, loading: false, userId: null };
        render(<Page />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain(encodeURIComponent("/user/highlights"));
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("アーカイブを新しい順に並べ、フォロワーのみの投稿は押せず理由が付く", async () => {
        render(<Page />);
        const lis = await gridTiles();
        expect(lis).toHaveLength(3);
        expect(lis.map((t) => t.querySelector("img")?.getAttribute("src")?.match(/s(\d)/)?.[1])).toEqual(["3", "2", "1"]);
        const locked = tileButton(lis[0]);
        expect(locked, "フォロワーのみの投稿が押せる").toBeDisabled();
        expect(locked.getAttribute("aria-label")).toMatch(/フォロワーのみ/);
        expect(screen.getByText(/鍵のついた投稿/)).toBeInTheDocument();
        // 押せるタイルは「選ぶ」もの
        expect(tileButton(lis[1]).getAttribute("aria-pressed")).toBe("false");
    });

    it("選ぶと印が付き、最初の1枚が表紙。保存は投稿順で、表紙つき", async () => {
        render(<Page />);
        const lis = await gridTiles();
        // 新しい方（s2）を先に、古い方（s1）を後に押す
        await userEvent.click(tileButton(lis[1]));
        await userEvent.click(tileButton(lis[2]));
        expect(tileButton(lis[1]).getAttribute("aria-pressed")).toBe("true");
        expect(within(lis[1]).getByText("表紙")).toBeInTheDocument();
        expect(screen.getByText("2/100")).toBeInTheDocument();

        // 表紙を s1 に替える
        const covers = within(screen.getByRole("list", { name: "表紙を選ぶ" })).getAllByRole("button");
        expect(covers).toHaveLength(2);
        await userEvent.click(covers[0]);   // 投稿順なので先頭が s1
        expect(within(lis[2]).getByText("表紙")).toBeInTheDocument();
        expect(within(lis[1]).queryByText("表紙")).toBeNull();

        await userEvent.type(screen.getByLabelText("名前"), "北海道");
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(sent("POST")).toHaveLength(1));
        expect(sent("POST")[0].url).toBe("/highlights");
        expect(sent("POST")[0].body, "押した順のまま送っている").toEqual({ title: "北海道", storyIds: [S1.id, S2.id], coverStoryId: S1.id });
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("作りました"), "success");
        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining(ME));
    });

    it("名前が空・選択が空なら保存できない", async () => {
        render(<Page />);
        const lis = await gridTiles();
        expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
        await userEvent.click(tileButton(lis[1]));
        expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
        await userEvent.type(screen.getByLabelText("名前"), "x");
        expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
        // 外すと表紙も消え、保存できなくなる
        await userEvent.click(tileButton(lis[1]));
        expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
        expect(screen.queryByRole("list", { name: "表紙を選ぶ" })).toBeNull();
    });

    it("サーバーが断った理由をそのまま出す", async () => {
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (url === "/stories/archive") return { ok: true, status: 200, json: async () => ARCHIVE };
            if (init?.method === "POST") return { ok: false, status: 400, json: async () => ({ error: "「フォロワーのみ」で投稿したストーリーはハイライトに入れられません" }) };
            return { ok: true, status: 200, json: async () => ({}) };
        });
        render(<Page />);
        const lis = await gridTiles();
        await userEvent.click(tileButton(lis[1]));
        await userEvent.type(screen.getByLabelText("名前"), "x");
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("フォロワーのみ"), "error"));
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    });

    it("取得に失敗したら「0件」ではなく失敗として出す", async () => {
        mockUserFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        render(<Page />);
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByText(/まだありません/)).toBeNull();
    });

    it("本当に0件なら案内を出す", async () => {
        mockUserFetch.mockImplementation(api([]));
        render(<Page />);
        expect(await screen.findByText(/まだありません/)).toBeInTheDocument();
    });
});

describe("ハイライトの編集（?id=）", () => {
    beforeEach(() => {
        query.id = HID;
        mockUserPublicFetch.mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ id: HID, title: "旧", coverStoryId: S2.id, items: [S1, S2] }),
        });
    });

    it("今の題・選択・表紙を読み、PUT で置き換える", async () => {
        render(<Page />);
        expect(await screen.findByRole("heading", { name: "ハイライトを編集" })).toBeInTheDocument();
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalledWith(`/highlights/${ME}/${HID}`));
        const lis = await gridTiles();
        await waitFor(() => expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("旧"));
        expect(tileButton(lis[1]).getAttribute("aria-pressed")).toBe("true");
        expect(tileButton(lis[2]).getAttribute("aria-pressed")).toBe("true");
        expect(within(lis[1]).getByText("表紙")).toBeInTheDocument();
        // s1 を外して保存
        await userEvent.click(tileButton(lis[2]));
        await userEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(sent("PUT")).toHaveLength(1));
        expect(sent("PUT")[0].url).toBe(`/highlights/${HID}`);
        expect(sent("PUT")[0].body).toEqual({ title: "旧", storyIds: [S2.id], coverStoryId: S2.id });
        expect(sent("POST")).toHaveLength(0);
    });

    it("無ければマイページへ戻す", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "見つかりません" }) });
        render(<Page />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining(ME)));
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("見つかりません"), "error");
    });

    it("削除は確認してから。404 も成功。ストーリーは消えない", async () => {
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (url === "/stories/archive") return { ok: true, status: 200, json: async () => ARCHIVE };
            if (init?.method === "DELETE") return { ok: false, status: 404, json: async () => ({ error: "無い" }) };
            return { ok: true, status: 200, json: async () => ({}) };
        });
        render(<Page />);
        await gridTiles();
        await userEvent.click(screen.getByRole("button", { name: "このハイライトを削除" }));
        expect(sent("DELETE"), "確認せずに消している").toHaveLength(0);
        await userEvent.click(screen.getByRole("button", { name: "削除する" }));
        await waitFor(() => expect(sent("DELETE")).toHaveLength(1));
        expect(sent("DELETE")[0].url).toBe(`/highlights/${HID}`);
        expect(mockUserFetch.mock.calls.some((c) => String(c[0]).startsWith("/stories/") && (c[1] as { method?: string })?.method === "DELETE"),
            "ストーリーまで消している").toBe(false);
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("削除しました"), "success");
        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining(ME));
    });

    it("新規のときは削除の入口が無い", async () => {
        query.id = null;
        render(<Page />);
        await gridTiles();
        expect(screen.queryByRole("button", { name: "このハイライトを削除" })).toBeNull();
    });
});
