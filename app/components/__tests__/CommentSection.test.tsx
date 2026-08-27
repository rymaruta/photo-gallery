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
        // 本物を使う（サーバー由来の 404 だけを「もう無い」と読む判定そのもの）
        isGoneResponse: actual.isGoneResponse,
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

// 失敗表示中に投稿すると、投稿は成功しているのに一覧が「読み込めません
// でした」のままで自分のコメントが見えなかった（6641bed レビューの指摘）
describe("CommentSection: 失敗表示中の投稿", () => {
    it("投稿が成功したら一覧表示へ戻り、自分のコメントが見える", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({
            comment: { id: "c9", uid: "me", name: "自分", text: "投稿できた", t: "2026-08-23T00:00:00Z" },
        }) });
        render(<CommentSection photoId="p1" locale="ja" />);
        expect(await screen.findByText(/コメントを読み込めませんでした/)).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("コメントを追加…"), { target: { value: "投稿できた" } });
        fireEvent.click(screen.getByRole("button", { name: "送信" }));

        expect(await screen.findByText("投稿できた")).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });
});

// コメント削除の失敗が無言だった（楽観削除→黙って戻る）。投稿は理由を
// 出すのに削除だけ無言、という非対称でもあった（SW-b3）
describe("CommentSection: 削除の失敗", () => {
    it("失敗したらトーストで伝える（黙って戻さない）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({
            items: [{ id: "c1", uid: "me", name: "自分", text: "消したい", t: "2026-08-23T00:00:00Z" }],
            count: 1,
        }) });
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        render(<CommentSection photoId="p1" locale="ja" photoOwnerId="me" />);
        expect(await screen.findByText("消したい")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "コメントを削除" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("削除できませんでした"), "error"));
        // ロールバックされて残っている
        expect(screen.getByText("消したい")).toBeInTheDocument();
    });
});

// 別のタブ（や写真オーナー）が先に消していると、サーバーは 404 を返す。
// これを失敗と読んで巻き戻していたので、**消えたはずのコメントが一覧に
// 戻り**、「削除できませんでした」と出て、何度押しても同じことが起きた。
// 消えているなら目的は達成しているので、成功として扱う（CT-5）。
describe("CommentSection: 別タブで先に消されていた（404）", () => {
    it("消えたものは一覧に戻さず、取り直して収束する", async () => {
        // 1回目の一覧は残っている → 削除は 404（別タブが先に消した）
        // → 取り直すと本当に無い、という現実の順序を再現する
        mockUserPublicFetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                items: [{ id: "c1", uid: "me", name: "自分", text: "消したい", t: "2026-08-23T00:00:00Z" }],
                count: 1,
            }) })
            .mockResolvedValue({ ok: true, json: async () => ({ items: [], count: 0 }) });
        const gone = { error: "コメントが見つかりません" };
        mockUserFetch.mockResolvedValue({
            ok: false, status: 404,
            clone: () => ({ json: async () => gone }),
            json: async () => gone,
        });

        render(<CommentSection photoId="p1" locale="ja" photoOwnerId="me" />);
        expect(await screen.findByText("消したい")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "コメントを削除" }));
        await waitFor(() => expect(screen.queryByText("消したい")).toBeNull());
        // **落ち着いてから見る。** 楽観削除で一瞬消えた窓を waitFor が拾うので、
        // ここで確かめないと巻き戻す実装でも通ってしまう（レビューが実測）
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByText("消したい")).toBeNull();
        expect(mockShowToast).not.toHaveBeenCalledWith(
            expect.stringContaining("削除できませんでした"), "error");
    });
});

// ベースURLの設定ミスで API Gateway が返す 404（{"message":"Not Found"}）まで
// 成功にすると、消せていないのに「削除しました」になる。うちの API は理由を
// 必ず {error: "…"} で返すので、それだけを「もう無い」と読む。
describe("CommentSection: 設定ミスの 404 は成功にしない", () => {
    it("API Gateway 形式の 404 は失敗として扱う", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({
            items: [{ id: "c1", uid: "me", name: "自分", text: "消したい", t: "2026-08-23T00:00:00Z" }],
            count: 1,
        }) });
        mockUserFetch.mockResolvedValue({
            ok: false, status: 404,
            clone: () => ({ json: async () => ({ message: "Not Found" }) }),
            json: async () => ({ message: "Not Found" }),
        });

        render(<CommentSection photoId="p1" locale="ja" photoOwnerId="me" />);
        expect(await screen.findByText("消したい")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "コメントを削除" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("削除できませんでした"), "error"));
        expect(screen.getByText("消したい")).toBeInTheDocument();   // 巻き戻る
    });
});


// 退会した人のプロフィールはもう無い（墓石になり、公開APIは空を返す）。
// リンクを出すと「開いても何も無いページ」へ誘うことになる。
describe("退会した人のコメント", () => {
    it("名前は出すが、プロフィールへのリンクは出さない", async () => {
        mockUserPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                items: [
                    { id: "c1", uid: "gone", name: "退会したユーザー", text: "こんにちは", t: "2026-01-01T00:00:00Z", deleted: true },
                    { id: "c2", uid: "alive", name: "居る人", text: "やあ", t: "2026-01-02T00:00:00Z" },
                ],
                count: 2,
            }),
        });
        render(<CommentSection photoId="p1" photoOwnerId="owner" locale="ja" />);

        expect(await screen.findByText("退会したユーザー")).toBeInTheDocument();
        // 退会した人の名前はリンクになっていない
        expect(screen.getByText("退会したユーザー").closest("a")).toBeNull();
        // 生きている人は今までどおりリンク
        expect(screen.getByText("居る人").closest("a")).not.toBeNull();
    });
});
