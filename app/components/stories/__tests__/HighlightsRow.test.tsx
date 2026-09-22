import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * マイページのハイライトの輪。
 *
 *   - 誰にでも出る。0件は本人以外に何も描かない（空の段を見せない）
 *   - 本人には「新規」と、各輪の鉛筆（作る・直す画面へ）
 *   - 押すと中身を引いて `StoryViewer` を**保存した順のまま**開く
 *     （`groupStories` は投稿順に並べ替えるので、落とすためだけに通す）
 *   - 取得の失敗を「0件」に混ぜない・404 なら輪を外す
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const viewerProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// **本物の loader を通す**（`UserProfileClient.storiesBar.test.tsx` と同じ理由）
vi.mock("next/dynamic", () => ({
    default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
        return function Lazy(props: Record<string, unknown>) {
            const [C, setC] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
            React.useEffect(() => {
                let alive = true;
                void loader().then((m) => { if (alive) setC(() => m.default); });
                return () => { alive = false; };
            }, []);
            return C ? <C {...props} /> : null;
        };
    },
}));
vi.mock("../StoryViewer", () => ({
    default: (props: Record<string, unknown>) => {
        viewerProps.last = props;
        return <div data-testid="viewer"><button onClick={() => (props.onClose as () => void)()}>閉じる</button></div>;
    },
}));

import HighlightsRow from "../HighlightsRow";

const OWNER = "11111111-1111-4111-8111-111111111111";
const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const H2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const summary = [
    { id: H1, title: "北海道", count: 2, cover: { src: "https://cdn/x/1.jpg" } },
    { id: H2, title: "沖縄", count: 1, cover: null },
];
const item = (id: string, createdAt: string) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: OWNER, createdAt, expiresAt: "2026-07-05T10:00:00Z",
    archive: true, archivedAt: "2026-07-05T10:00:00Z", allowReplies: false,
});
// **保存した順は投稿順と逆**（新しい→古い）にしておき、そのまま渡ることを見る
const detail = { id: H1, title: "北海道", items: [item("s2", "2026-07-04T11:00:00Z"), item("s1", "2026-07-04T10:00:00Z")] };

const api = (hs: unknown = summary, det: unknown = detail) => async (url: string) => {
    if (url === `/highlights/${OWNER}`) return { ok: true, status: 200, json: async () => ({ highlights: hs }) };
    if (url === `/highlights/${OWNER}/${H1}`) return { ok: true, status: 200, json: async () => det };
    return { ok: false, status: 404, json: async () => ({ error: "見つかりません" }) };
};

const view = (props: Partial<React.ComponentProps<typeof HighlightsRow>> = {}) => render(
    <HighlightsRow userId={OWNER} displayName="旅人" isOwner={false} isAuthenticated ownUserId={null} locale="ja" {...props} />,
);

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation(api());
    mockShowToast.mockReset();
    viewerProps.last = null;
});

describe("ハイライトの輪", () => {
    // 🔴 中身はストーリーそのもの。一覧（`GET /stories`）が認証必須なので、
    // ここだけインターネットに開かない（一度そうして本番まで出した）
    it("未ログインには出さないし、取りにもいかない", async () => {
        const { container } = view({ isAuthenticated: false });
        await new Promise((r) => setTimeout(r, 20));
        expect(mockUserFetch, "ログインしていないのに取りにいっている").not.toHaveBeenCalled();
        expect(container.querySelector("[data-testid=highlights-row]")).toBeNull();
    });

    it("本人でも、ログインが切れていれば出さない", async () => {
        const { container } = view({ isAuthenticated: false, isOwner: true, ownUserId: OWNER });
        await new Promise((r) => setTimeout(r, 20));
        expect(mockUserFetch).not.toHaveBeenCalled();
        expect(container.querySelector("[data-testid=highlights-row]")).toBeNull();
    });

    it("ログインした訪問者には出る。題と表紙、表紙が無ければアイコン", async () => {
        view();
        const list = await screen.findByRole("list", { name: "ハイライト" });
        const items = within(list).getAllByRole("listitem");
        expect(items).toHaveLength(2);
        expect(within(items[0]).getByRole("button", { name: /北海道/ })).toBeTruthy();
        expect(items[0].querySelector("img")?.getAttribute("src")).toContain("1.jpg");
        expect(items[1].querySelector("img"), "表紙が無いのに画像を出している").toBeNull();
        // 訪問者に「新規」や鉛筆は出ない
        expect(screen.queryByRole("link", { name: "ハイライトを作る" })).toBeNull();
        expect(screen.queryByRole("link", { name: /を編集/ })).toBeNull();
    });

    it("0件なら本人以外には何も描かない", async () => {
        mockUserFetch.mockImplementation(api([]));
        const { container } = view();
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await act(async () => { await Promise.resolve(); });
        expect(container.querySelector("[data-testid=highlights-row]")).toBeNull();
    });

    it("本人には「新規」と、各輪の鉛筆（作る・直す画面へ）", async () => {
        mockUserFetch.mockImplementation(api([summary[0]]));
        view({ isOwner: true, isAuthenticated: true, ownUserId: OWNER });
        const add = await screen.findByRole("link", { name: "ハイライトを作る" });
        expect(add.getAttribute("href")).toBe("/user/highlights");
        const edit = await screen.findByRole("link", { name: "ハイライト「北海道」を編集" });
        expect(edit.getAttribute("href")).toBe(`/user/highlights?id=${H1}`);
    });

    it("本人は0件でも「新規」が出る", async () => {
        mockUserFetch.mockImplementation(api([]));
        view({ isOwner: true, isAuthenticated: true, ownUserId: OWNER });
        expect(await screen.findByRole("link", { name: "ハイライトを作る" })).toBeTruthy();
    });

    it("押すと中身を引いて、保存した順のままビューアで開く", async () => {
        view({ isAuthenticated: true, ownUserId: "someone-else" });
        await userEvent.click(await screen.findByRole("button", { name: /北海道/ }));
        expect(await screen.findByTestId("viewer")).toBeTruthy();
        expect(mockUserFetch).toHaveBeenCalledWith(`/highlights/${OWNER}/${H1}`);
        const groups = viewerProps.last?.groups as Array<{ userId: string; displayName: string; items: Array<{ id: string }> }>;
        expect(groups[0].userId).toBe(OWNER);
        expect(groups[0].displayName).toBe("旅人");
        expect(groups[0].items.map((s) => s.id), "投稿順に並べ替えてしまっている").toEqual(["s2", "s1"]);
        expect(viewerProps.last?.isAuthenticated).toBe(true);
        // 閉じるとビューアが消える
        await userEvent.click(screen.getByText("閉じる"));
        await waitFor(() => expect(screen.queryByTestId("viewer")).toBeNull());
    });

    it("形の壊れた行は落として、残りで開く", async () => {
        mockUserFetch.mockImplementation(api(summary, { ...detail, items: [null, { id: "broken" }, detail.items[1]] }));
        view();
        await userEvent.click(await screen.findByRole("button", { name: /北海道/ }));
        await screen.findByTestId("viewer");
        const groups = viewerProps.last?.groups as Array<{ items: Array<{ id: string }> }>;
        expect(groups[0].items.map((s) => s.id)).toEqual(["s1"]);
    });

    it("中身が空なら開かず、その旨を出す", async () => {
        mockUserFetch.mockImplementation(api(summary, { ...detail, items: [] }));
        view();
        await userEvent.click(await screen.findByRole("button", { name: /北海道/ }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("もうありません"), "error"));
        expect(screen.queryByTestId("viewer")).toBeNull();
    });

    it("消えていた（404）ら輪を外す", async () => {
        view();
        await userEvent.click(await screen.findByRole("button", { name: /沖縄/ }));
        await waitFor(() => expect(screen.queryByRole("button", { name: /沖縄/ })).toBeNull());
        expect(screen.getByRole("button", { name: /北海道/ })).toBeTruthy();
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("開けませんでした"), "error");
    });

    it("取得に失敗したら「0件」ではなく失敗として出し、再試行できる", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        view();
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "再試行" }));
        expect(await screen.findByRole("button", { name: /北海道/ })).toBeTruthy();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });

    it("配列でない応答も失敗（0件に混ぜない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ userId: OWNER }) });
        view();
        expect(await screen.findByText(/読み込めませんでした/)).toBeInTheDocument();
    });
});
