import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ストーリーのアーカイブの画面（`/user/archive`）。
 *
 * 中身はサーバー（`GET /stories/archive`）が返す行そのもので、見せ方は
 * `StoryViewer` をそのまま使う。ここで見るのは画面の責務だけ:
 *   - 未ログインはログインへ（戻り先付き）
 *   - 新しい順に並べ、押した1枚から開く（ビューアは古い→新しいに送る）
 *   - 取得の失敗を「0件」に混ぜない（下書きの一覧と同じ判断）
 *   - 削除は 404 を成功として扱い、一覧から外す
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, loading: false, userId: "me" as string | null } }));
/** ビューアに渡った props（開き方を見るだけなので、中身は描かない） */
const viewerProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    isGoneResponse: async (r: { status: number }) => r.status === 404 || r.status === 410,
    readApiError: async (_r: unknown, f: string) => f,
}));
vi.mock("../../../components/stories/StoryViewer", () => ({
    default: (props: Record<string, unknown>) => {
        viewerProps.last = props;
        const onDelete = props.onDelete as ((id: string) => Promise<boolean>) | undefined;
        const items = (props.groups as Array<{ items: Array<{ id: string }> }>)[0].items;
        const idx = props.initialItemIndex as number;
        return (
            <div data-testid="viewer">
                <span data-testid="opened">{items[idx]?.id}</span>
                <button onClick={() => void onDelete?.(items[idx].id)}>この1枚を削除</button>
                <button onClick={() => (props.onClose as () => void)()}>閉じる</button>
            </div>
        );
    },
}));

const Page = (await import("../page")).default;

const story = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: "me", mediaType: "image",
    createdAt, expiresAt: "2026-07-05T10:00:00.000Z", archivedAt: "2026-07-05T10:00:00.000Z", archive: true, ...extra,
});
/** サーバーは新しい順で返す */
const THREE = [story("s3", "2026-07-04T12:00:00Z"), story("s2", "2026-07-04T11:00:00Z"), story("s1", "2026-07-04T10:00:00Z")];

const api = (archive: unknown = THREE) => async (url: string, init?: { method?: string }) => {
    if (url === "/stories/archive") return { ok: true, status: 200, json: async () => archive };
    if (url.startsWith("/stories/") && init?.method === "DELETE") return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
};

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(api());
    mockReplace.mockReset();
    mockShowToast.mockReset();
    authState.current = { isAuthenticated: true, loading: false, userId: "me" };
    viewerProps.last = null;
});

describe("アーカイブの画面", () => {
    it("未ログインはログインへ（戻り先付き）", async () => {
        authState.current = { isAuthenticated: false, loading: false, userId: null };
        render(<Page />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        const to = String(mockReplace.mock.calls[0][0]);
        expect(to).toContain("/login");
        expect(to, "戻り先が付いていない").toContain(encodeURIComponent("/user/archive"));
        expect(mockUserFetch, "未ログインなのに取りにいっている").not.toHaveBeenCalled();
    });

    it("新しい順に並ぶ", async () => {
        render(<Page />);
        const tiles = await screen.findAllByRole("listitem");
        expect(tiles).toHaveLength(3);
        const srcs = tiles.map((t) => t.querySelector("img")?.getAttribute("src") ?? "");
        expect(srcs.map((s) => s.match(/(s\d)\.jpg/)?.[1])).toEqual(["s3", "s2", "s1"]);
    });

    it("押した1枚から開く（ビューアは古い→新しいの束を受け取る）", async () => {
        render(<Page />);
        const tiles = await screen.findAllByRole("listitem");
        await userEvent.click(tiles[1]);   // グリッドの2番目 = s2
        expect(await screen.findByTestId("opened")).toHaveTextContent("s2");
        const groups = viewerProps.last?.groups as Array<{ userId: string; items: Array<{ id: string }> }>;
        expect(groups[0].userId).toBe("me");
        expect(groups[0].items.map((i) => i.id), "ビューアに渡す束が古い順でない").toEqual(["s1", "s2", "s3"]);
        expect(viewerProps.last?.ownUserId, "自分のストーリーとして開いていない（削除が出ない）").toBe("me");
    });

    it("取得に失敗したら「0件」ではなく失敗として出す", async () => {
        mockUserFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        render(<Page />);
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByText(/まだありません/)).toBeNull();
    });

    it("配列でない応答も失敗（0件に混ぜない）", async () => {
        mockUserFetch.mockImplementation(api({ items: [] }));
        render(<Page />);
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
    });

    it("本当に0件なら「まだありません」", async () => {
        mockUserFetch.mockImplementation(api([]));
        render(<Page />);
        expect(await screen.findByText(/まだありません/)).toBeInTheDocument();
    });

    it("読めない行は落として、残りは出す", async () => {
        mockUserFetch.mockImplementation(api([THREE[0], null, { id: "broken" }]));
        render(<Page />);
        expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    });

    it("削除すると一覧から外れる（404 も成功）", async () => {
        mockUserFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
            if (url === "/stories/archive") return { ok: true, status: 200, json: async () => THREE };
            if (init?.method === "DELETE") return { ok: false, status: 404, json: async () => ({ error: "gone" }) };
            return { ok: true, status: 200, json: async () => ({}) };
        });
        render(<Page />);
        const tiles = await screen.findAllByRole("listitem");
        await userEvent.click(tiles[0]);   // s3
        await userEvent.click(await screen.findByText("この1枚を削除"));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/stories/s3", expect.objectContaining({ method: "DELETE" })));
        await userEvent.click(screen.getByText("閉じる"));
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("削除"), "success");
    });
});
