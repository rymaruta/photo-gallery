import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// コメント欄の「断られた理由」の出し方。
//
// フック側だけを見るテストでは足りなかった。理由をフックの state に
// 入れて画面側が `lastError` を読む作りにしていたところ、画面側の
// submit は**その描画時点の値**を掴んでいるので、1回目の 429 では
// null のまま「投稿に失敗しました」が出て、2回目にようやく
// 1回目の文言が出ていた。フックの state は正しく更新されていたので、
// フックのテストは全部通っていた。だから画面ごと確かめる。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/utils/api")>("../../../lib/utils/api");
    return {
        userFetch: mockUserFetch,
        userPublicFetch: mockUserPublicFetch,
        publicFetch: vi.fn(),
        authenticatedFetch: vi.fn(),
        readApiError: actual.readApiError,
    };
});

vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }),
}));

vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("../UserAvatar", () => ({ default: () => <div /> }));

import CommentSection from "../CommentSection";

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ items: [], count: 0 }) });
    mockShowToast.mockReset();
});

async function typeAndSend(text: string) {
    render(<CommentSection photoId="p1" locale="ja" />);
    await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("コメントを追加…"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
}

describe("CommentSection: 断られた理由の表示", () => {
    it("1回目の失敗でサーバーの文言が出る", async () => {
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429,
            json: async () => ({ error: "同じ写真へのコメントは10件までです" }),
        });

        await typeAndSend("11件目");

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast).toHaveBeenCalledWith("同じ写真へのコメントは10件までです", "error");
    });

    it("2回目に1回目の文言を出さない（別の理由には別の文言）", async () => {
        mockUserFetch.mockResolvedValue({
            ok: false, status: 429,
            json: async () => ({ error: "同じ写真へのコメントは10件までです" }),
        });
        await typeAndSend("11件目");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));

        mockUserFetch.mockRejectedValue(new Error("offline"));
        fireEvent.click(screen.getByRole("button", { name: "送信" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(2));
        expect(mockShowToast).toHaveBeenLastCalledWith("通信に失敗しました", "error");
    });

    it("通ったらトーストは出さず、入力欄を空にする", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ comment: { id: "c1", uid: "me", name: "私", text: "いいね", t: "2026-08-20T00:00:00Z" } }),
        });

        await typeAndSend("いいね");

        await waitFor(() => expect(screen.getByText("いいね")).toBeInTheDocument());
        expect(mockShowToast).not.toHaveBeenCalled();
        expect((screen.getByPlaceholderText("コメントを追加…") as HTMLTextAreaElement).value).toBe("");
    });
});

// 取得の失敗が「まだコメントがありません」と同じ見た目だった（SW-b2）。
// 付いているコメントが消えたように見える。失敗は失敗と伝えて再試行を出す。
describe("CommentSection: 一覧の取得失敗", () => {
    it("失敗は0件表示と混ぜず、再読み込みで立て直す", async () => {
        mockUserPublicFetch
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                items: [{ id: "c1", uid: "u1", name: "旅人", text: "きれい", t: "2026-08-01T00:00:00Z" }],
                count: 1,
            }) });
        render(<CommentSection photoId="p1" locale="ja" />);

        expect(await screen.findByText(/コメントを読み込めませんでした/)).toBeInTheDocument();
        expect(screen.queryByText(/まだコメントがありません/)).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
        expect(await screen.findByText("きれい")).toBeInTheDocument();
    });
});
