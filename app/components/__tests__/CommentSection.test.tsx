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
        // **一覧を読む口は、ログイン中は認証つき（`GET /user/comments/{id}`）**（S-1）。
        // この画面はログイン中で、ここで見たいのは表示なので、読む口2つを
        // 同じ作り物（`mockUserPublicFetch`）に向ける。どちらの口を呼ぶかは
        // `useComments.test.tsx` が見る。投稿・削除は今までどおり `mockUserFetch`
        userFetch: (...a: unknown[]) => String(a[0]).startsWith("/user/comments/")
            ? mockUserPublicFetch(...a)
            : mockUserFetch(...a),
        userPublicFetch: mockUserPublicFetch,
        publicFetch: vi.fn(),
        authenticatedFetch: vi.fn(),
        readApiError: actual.readApiError,
        // 本物を使う（サーバー由来の 404 だけを「もう無い」と読む判定そのもの）
        isGoneResponse: actual.isGoneResponse,
        isMissingRouteResponse: actual.isMissingRouteResponse,
        // `useComments` がセッション切れを見分けるのに読む。**列挙式のモックは
        // 足りない export を「アクセスした瞬間に落ちる」形で教えてくれる**
        // ——ここが抜けていて、2通目のコメントでだけ落ちていた
        AUTH_REQUIRED_MESSAGE: actual.AUTH_REQUIRED_MESSAGE,
        NETWORK_UNREACHABLE_MESSAGE: actual.NETWORK_UNREACHABLE_MESSAGE,
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
import { AUTH_REQUIRED_MESSAGE } from "../../../lib/utils/api";

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

// **Ctrl/Cmd+Enter に IME のガードは付けない**（一度付けて、外した）。
//
// 変換確定に使われるのは Enter 単体で、修飾キー付きは IME が消費しない。
// それでも `isComposing` は「そのとき変換が生きているか」だけを見るので、
// 変換の要らない語（「ありがとう」）を打ち終えた直後も true のまま
// ——ガードを付けると**送信が黙って死ぬ**（Chromium で実測: 変換中の
// Ctrl+Enter は `ctrl=true isComposing=true` で届く）。
// `onChange` は変換中も発火するので `text` は画面と一致しており、
// 押した時点で見えている文字を送るのが正しい。
describe("CommentSection: 変換中の送信", () => {
    async function typeAndKey(text: string, key: Record<string, unknown>) {
        render(<CommentSection photoId="p1" locale="ja" />);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        const box = screen.getByPlaceholderText("コメントを追加…");
        fireEvent.change(box, { target: { value: text } });
        fireEvent.keyDown(box, { key: "Enter", ctrlKey: true, ...key });
    }

    // **変換中でも送る。** 画面に出ている文字がそのまま飛ぶ
    it("変換中の Ctrl+Enter でも、見えている文字を送る", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
        await typeAndKey("ありがとう", { keyCode: 13, isComposing: true });
        await waitFor(() => expect(mockUserFetch, "送信が黙って死んでいる").toHaveBeenCalled());
        const body = JSON.parse((mockUserFetch.mock.calls[0][1] as { body: string }).body);
        expect(body.text).toBe("ありがとう");
    });

    it("確定後の Ctrl+Enter も今までどおり投稿する", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
        await typeAndKey("今日", { keyCode: 13, isComposing: false });
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        const body = JSON.parse((mockUserFetch.mock.calls[0][1] as { body: string }).body);
        expect(body.text).toBe("今日");
    });

    // 修飾キーの無い Enter は今までどおり改行（送信しない）
    it("Enter だけでは送信しない", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "c1" }) });
        await typeAndKey("今日", { keyCode: 13, isComposing: false, ctrlKey: false });
        expect(mockUserFetch).not.toHaveBeenCalled();
    });
});

// **200 だが本文の形がおかしいとき、矛盾した画面になっていた。**
//
// 行のふるいを足したとき `?? []` にしたので、`items` が配列でなくても
// `count` はサーバー値がそのまま入る——見出し「コメント 3」＋本文
// 「まだコメントがありません。最初のひとことを。」が同時に出る。
// `loadError` の分岐は既にあるのに通っていなかった。
describe("CommentSection: 応答の形がおかしいとき", () => {
    it.each([
        ["items が配列でない", { items: { a: 1 }, count: 3 }],
        ["items が無い", { count: 3 }],
    ])("%s なら『まだコメントがありません』と混ぜない", async (_name, body) => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => body });
        render(<CommentSection photoId="p1" locale="ja" />);
        expect(await screen.findByText(/読み込めませんでした|失敗/),
            "0件と同じ見た目になっている").toBeInTheDocument();
        expect(screen.queryByText(/まだコメントがありません/)).toBeNull();
    });

    // 正常系: 本当に0件なら今までどおり
    it("本当に0件なら『まだコメントがありません』", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [], count: 0 }) });
        render(<CommentSection photoId="p1" locale="ja" />);
        expect(await screen.findByText(/まだコメントがありません/)).toBeInTheDocument();
    });
});

// **セッションが切れて送れなかったときの案内。**
// 押す前に未ログインと分かった場合の案内（`auth-required`）が既にあるのに、
// 送ってから分かった場合はそこを通らず、日本語固定の定数が赤いトーストで
// 出ていた。同じことなので同じ口へ。
describe("CommentSection: セッションが切れていたとき", () => {
    it("赤い失敗ではなく、ログインの案内を出す", async () => {
        mockUserFetch.mockRejectedValue(new Error(AUTH_REQUIRED_MESSAGE));
        await typeAndSend("いいね");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast).toHaveBeenLastCalledWith("コメントするにはログインしてください", "info");
    });

    it("打った文字は消さない（送り直せる）", async () => {
        mockUserFetch.mockRejectedValue(new Error(AUTH_REQUIRED_MESSAGE));
        await typeAndSend("いいね");
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect((screen.getByPlaceholderText("コメントを追加…") as HTMLTextAreaElement).value).toBe("いいね");
    });
});
