import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// localStorage モック
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
    value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    configurable: true,
});

// api モジュールをモック。
// いいね数の読み取りは userPublicFetch（ユーザーAPI）を使う。
// publicFetch は管理APIを向いており、いいね/コメント/フォローの経路は存在しない。
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`isGoneResponse`）が undefined になり、呼んだ瞬間に投げる——それを
// hook の catch が飲むので、**緑のまま間違ったことを測るテスト**になる。
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import { usePhotoLikes } from "../usePhotoLikes";
import { resetFavoritesCache } from "../useFavorites";

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    // お気に入りはモジュール内にキャッシュされる。localStorage を消すだけでは
    // 前のテストの状態が残り、次のテストの初期値が「いいね済み」になる。
    resetFavoritesCache();
    mockPublicFetch.mockReset();
    mockUserFetch.mockReset();
    // デフォルト: 初回のカウント取得は失敗扱い（初期値を維持）
    mockPublicFetch.mockResolvedValue({ ok: false });
});

afterEach(() => vi.clearAllMocks());

describe("usePhotoLikes", () => {
    describe("/user/likes/{id} の count（S-1）", () => {
        const myLike = (body: unknown) => mockUserFetch.mockImplementation((path: string) =>
            Promise.resolve(path.startsWith("/user/likes/")
                ? { ok: true, json: async () => body }
                : { ok: false }));

        // 限定写真は未認証の数の口が 404（既定の `{ ok: false }`）。数はこちらから来る
        it("count があれば数に使う", async () => {
            myLike({ liked: true, count: 7 });
            const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
            await waitFor(() => expect(result.current.count).toBe(7));
            expect(result.current.liked).toBe(true);
        });

        it("count が無いときは 0 と読まず今の値を保つ", async () => {
            myLike({ liked: false });
            const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
            await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
            await act(async () => { await Promise.resolve(); });
            expect(result.current.count).toBe(3);
        });

        it("押したあとに着いた count では巻き戻さない", async () => {
            let resolve: (v: unknown) => void = () => {};
            mockUserFetch.mockImplementation((path: string) => path.startsWith("/user/likes/")
                ? new Promise((r) => { resolve = r; })
                : Promise.resolve({ ok: true, json: async () => ({ liked: true, likes: 4 }) }));
            const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
            await act(async () => { await result.current.toggle(); });
            expect(result.current.count).toBe(4);
            await act(async () => { resolve({ ok: true, json: async () => ({ liked: false, count: 3 }) }); });
            expect(result.current.count).toBe(4);
        });
    });

    it("初期状態は未いいね・初期カウント", () => {
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        expect(result.current.liked).toBe(false);
        expect(result.current.count).toBe(10);
    });

    it("マウント時にサーバーの最新カウントを反映する", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 42 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        await waitFor(() => expect(result.current.count).toBe(42));
    });

    it("ログイン時: いいねで楽観+1 → サーバー確定値を反映", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 6 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(true);
        expect(result.current.count).toBe(6);
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "POST" });
    });

    it("いいね済みから解除で DELETE を呼ぶ", async () => {
        store["photo-gallery-favorites"] = JSON.stringify(["p1"]); // 既にお気に入り
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 4 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));
        expect(result.current.liked).toBe(true);

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(false);
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "DELETE" });
    });

    it("未ログイン時はローカルのみ変更し、公開の件数は動かさない", async () => {
        // 動かしていた頃は、42いいねの写真でハートを押すと「43」に見え、
        // もう一度押すと「42」に戻った——サーバーには何も送っていないので、
        // 公開の数字を勝手に上下させているだけだった。
        const { result } = renderHook(() => usePhotoLikes("p1", 5, false));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.liked).toBe(true);   // お気に入りには入る
        expect(result.current.count).toBe(5);      // 公開の件数は動かさない
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    // 未ログインで押した状態のままログインすると、次の一押しが DELETE に
    // なって「取り消し」扱いになっていた——投稿者にいいねも通知も届かない。
    // 別の端末では逆に、いいね済みの写真が未いいねに見えた。
    // サーバーの真値（/user/likes/<id>）を初期値にする。
    describe("サーバー側のいいね状態", () => {
        it("端末のお気に入りより、サーバーの答えを優先する", async () => {
            // 端末には「いいね済み」が残っているが、サーバーには無い
            store["photo-gallery-favorites"] = JSON.stringify(["p1"]);
            resetFavoritesCache();
            mockUserFetch.mockImplementation((path: string) =>
                Promise.resolve(path.startsWith("/user/likes/")
                    ? { ok: true, json: async () => ({ liked: false }) }
                    : { ok: true, json: async () => ({ likes: 1 }) }));

            const { result } = renderHook(() => usePhotoLikes("p1", 0, true));
            await waitFor(() => expect(result.current.liked).toBe(false));

            // だから最初の一押しは POST（取り消しではない）
            await act(async () => { await result.current.toggle(); });
            expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "POST" });
        });

        it("未ログインならサーバーには聞かない", async () => {
            // ログイン時は必ず1回聞く、を先に確かめてから「未ログインでは聞かない」を見る。
            // 「呼ばれていないこと」だけを waitFor で見ると、実装を消しても通る。
            mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ liked: false }) });
            const authed = renderHook(() => usePhotoLikes("p1", 0, true));
            await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith(
                "/user/likes/p1", expect.anything()));
            authed.unmount();

            mockUserFetch.mockClear();
            renderHook(() => usePhotoLikes("p2", 0, false));
            await new Promise((r) => setTimeout(r, 20));
            expect(mockUserFetch).not.toHaveBeenCalled();
        });

        it("写真が変わったら状態を持ち越さない", async () => {
            // モーダルは同じフックのまま次の写真へ進む。持ち越すと、
            // 1枚目に付けたいいねが2枚目にも付いて見え、押すと DELETE が飛ぶ
            // （＝2枚目にはいいねが付かない）。
            mockUserFetch.mockImplementation((path: string) =>
                Promise.resolve(path.startsWith("/user/likes/")
                    ? { ok: true, json: async () => ({ liked: false }) }
                    : { ok: true, json: async () => ({ likes: 1 }) }));
            const { result, rerender } = renderHook(
                ({ id }) => usePhotoLikes(id, 0, true), { initialProps: { id: "p1" } });

            await act(async () => { await result.current.toggle(); });
            expect(result.current.liked).toBe(true);

            rerender({ id: "p2" });
            await waitFor(() => expect(result.current.liked).toBe(false));

            mockUserFetch.mockClear();
            await act(async () => { await result.current.toggle(); });
            expect(mockUserFetch).toHaveBeenCalledWith("/photos/p2/like", { method: "POST" });
        });

        it("応答が返る前に別の写真へ送っても、そちらのハートと件数を壊さない", async () => {
            // モーダルは同じフックのまま次の写真へ進む。await の後に
            // 「まだ同じ写真か」を見ずに書いていた頃は、Aで押した結果が
            // Bのハートと件数に反映されていた（Bがいいね済みでも空になり、
            // 次の一押しが POST になって二重に付く）。
            let failA: ((v: unknown) => void) | undefined;
            mockUserFetch.mockImplementation((path: string) => {
                if (path.startsWith("/user/likes/")) {
                    return Promise.resolve({ ok: true, json: async () => ({ liked: false }) });
                }
                if (path === "/photos/A/like") return new Promise((r) => { failA = r; });
                return Promise.resolve({ ok: true, json: async () => ({ likes: 3 }) });
            });

            const { result, rerender } = renderHook(
                ({ id, likes }) => usePhotoLikes(id, likes, true),
                { initialProps: { id: "A", likes: 10 } });

            // A のいいねを開始（応答はまだ返さない）
            let pending: Promise<{ ok: boolean; message?: string }> | undefined;
            act(() => { pending = result.current.toggle(); });

            // 応答を待たずに B へ送る
            rerender({ id: "B", likes: 3 });
            await waitFor(() => expect(result.current.count).toBe(3));

            // ここで A の要求が失敗して返る
            await act(async () => {
                failA?.({ ok: false });
                await pending;
            });

            // B の表示は壊れていない
            expect(result.current.count).toBe(3);
            expect(result.current.liked).toBe(false);
        });

        it("写真を送ると件数も引き継がない", async () => {
            mockUserFetch.mockImplementation(() =>
                Promise.resolve({ ok: false }));   // 件数の取得は失敗させる
            mockPublicFetch.mockResolvedValue({ ok: false });

            const { result, rerender } = renderHook(
                ({ id, likes }) => usePhotoLikes(id, likes, true),
                { initialProps: { id: "A", likes: 42 } });
            await waitFor(() => expect(result.current.count).toBe(42));

            rerender({ id: "B", likes: 3 });
            // 42 のまま出し続けない
            await waitFor(() => expect(result.current.count).toBe(3));
        });

        it("答えが遅れて届いても、先に押したハートを上書きしない", async () => {
            let resolveLiked: ((v: unknown) => void) | undefined;
            mockUserFetch.mockImplementation((path: string) => {
                if (path.startsWith("/user/likes/")) {
                    return new Promise((r) => { resolveLiked = r; });
                }
                return Promise.resolve({ ok: true, json: async () => ({ likes: 1 }) });
            });
            const { result } = renderHook(() => usePhotoLikes("p1", 0, true));
            await act(async () => { await result.current.toggle(); });
            expect(result.current.liked).toBe(true);

            // 遅れて「いいねしていません」が届く
            await act(async () => {
                resolveLiked?.({ ok: true, json: async () => ({ liked: false }) });
                await Promise.resolve();
            });
            expect(result.current.liked).toBe(true);
        });
    });

    it("サーバー失敗時は楽観更新を巻き戻す", async () => {
        mockUserFetch.mockResolvedValue({ ok: false });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(false); // 巻き戻し
        expect(result.current.count).toBe(5);
    });
});

// いいねの失敗が log.warn だけで、押した人には「ハートが黙って戻る」
// としか見えなかった（フォローは文言を出すのに非対称）。呼び出し元が
// 伝えられるよう、toggle は成否を返す（SW-b4）
describe("usePhotoLikes: toggle は成否を返す", () => {
    it("失敗したら false（呼び出し元がトーストを出せる）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        let ok: boolean | undefined;
        await act(async () => { ok = (await result.current.toggle()).ok; });
        expect(ok).toBe(false);
    });

    it("成功したら true", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11, liked: true }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        let ok: boolean | undefined;
        await act(async () => { ok = (await result.current.toggle()).ok; });
        expect(ok).toBe(true);
    });
});

// **押したあとに、押す前の数字が遅れて届いて巻き戻していた。**
//
// マウント時の件数取得は「押す前の数」を運ぶ。同じ番人（`touchedRef`）を
// `serverLiked` にだけ入れて、数字に入れ忘れていたので、回線が遅いと
// **ハートは付いたまま数字だけ元に戻る**（サーバーの真値は増えている）。
describe("遅れて届いた初回の件数", () => {
    it("押したあとの確定値を巻き戻さない", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : { ok: true, json: async () => ({ likes: 43 }) }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.count).toBe(43);

        // 押す前に投げた取得が、いま着地する
        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 42 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "押す前の数字で巻き戻している").toBe(43);
        expect(result.current.liked).toBe(true);
    });

    // **未ログインで押しただけでも番人が立っていた。**
    // 未ログインはサーバーに何も送らないのに、マウント時の件数取得
    // （唯一の是正経路。cron ビルドが止まっている間、`photos.json` の
    // 数字は古くなる）が永久に殺され、古い数字が出たまま固定されていた。
    it("未ログインで押しても、届いた最新の件数は反映する", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, false));
        await act(async () => { await result.current.toggle(); });

        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 57 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "未ログインなのに件数の更新を止めている").toBe(57);
    });

    // 巻き戻した＝「押す前」の姿に戻ったので、遅れて届く真値は弾かない
    it("保存に失敗して巻き戻したあとも、届いた件数は反映する", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : { ok: false, status: 500, json: async () => ({}) }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.count).toBe(42);   // 巻き戻し済み

        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 57 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "巻き戻したあとも真値を弾いている").toBe(57);
    });

    it("押していなければ、届いた数字をそのまま出す（正常系）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 42 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        await waitFor(() => expect(result.current.count).toBe(42));
    });
});

// **非公開になった写真のいいねは、解除だけ通る。**
//
// サーバー（`api-user/src/likes.ts` の DELETE）はマーカーを消してカウンタも
// 減らしたうえで、非公開・削除済みなら数字を返さずに 404 を返す（減算に
// 公開判定を足すと「本人が永久に取り消せない」ため意図してそうしてある）。
// クライアントが一律「失敗」と読んで巻き戻すと、**サーバーは解除済みなのに
// 画面はいいね済み**のまま、押し直しても同じ 404 で永久に直らない。
describe("もう見えない写真のいいね", () => {
    const gone = { ok: false, status: 404, json: async () => ({ error: "写真が見つかりません" }), clone() { return this; } };

    it("解除は成功として扱う（巻き戻さない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11 }) });
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: true }) }
                : gone));

        const { result } = renderHook(() => usePhotoLikes("p1", 11, true));
        await waitFor(() => expect(result.current.liked).toBe(true));

        let ok = false;
        await act(async () => { ok = (await result.current.toggle()).ok; });

        expect(ok, "解除できているのに失敗として伝えている").toBe(true);
        expect(result.current.liked, "サーバーは解除済みなのに、いいね済みへ戻している").toBe(false);
        expect(result.current.count).toBe(10);
    });

    // **「もう見えない」けれど「あなたのいいねは残っている」。**
    // マーカーが既にある写真が非公開に戻された場合、サーバーは数字を出さずに
    // 404 を返すが `liked: true` を添える。これを「付かなかった」と読んで
    // 未いいねに戻すと、押し直しても同じ 404 で**永久に外せない**
    // （解除の DELETE は通るのに、画面がその導線を出さない）。
    it("マーカーが残っている 404 では、いいね済みとして見せる", async () => {
        const goneButLiked = {
            ok: false, status: 404,
            json: async () => ({ error: "写真が見つかりません", liked: true }),
            clone() { return this; },
        };
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11 }) });
        // **本番の形にする。** マーカーが残っているなら `getMyLike` は
        // `true` を返す（`api-user/src/likes.ts`）。`false` を返すモックは
        // 本番に存在しない組み合わせで、着地順しだいで結果が変わる
        let settleMyLike: ((v: unknown) => void) | null = null;
        mockUserFetch.mockImplementation((url: string) =>
            url.startsWith("/user/likes/")
                ? new Promise((res) => { settleMyLike = res; })   // 押したあとに着地させる
                : Promise.resolve(goneButLiked));

        const { result } = renderHook(() => usePhotoLikes("p1", 11, true));
        await waitFor(() => expect(result.current.count).toBe(11));

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked, "サーバーには残っているのに未いいねに戻している").toBe(true);
        // マーカーは前からあるので、数字は増えていない
        expect(result.current.count).toBe(11);
        // **端末のお気に入りにも入っている。** ここで `toggleFavorite` を
        // もう一度呼ぶと、追加して即削除になる（押したのに /favorites から
        // 消える。ハートの表示もカードと割れる）
        expect(JSON.parse(store["photo-gallery-favorites"] ?? "[]"),
            "お気に入りが二重トグルで消えている").toContain("p1");

        // 遅れて `/user/likes/` が着地しても、確定した表示を壊さない
        await act(async () => {
            settleMyLike!({ ok: true, json: async () => ({ liked: true }) });
            await Promise.resolve();
        });
        expect(result.current.liked).toBe(true);
        expect(result.current.count).toBe(11);
    });

    // 付ける側は逆。非公開ならマーカーごと戻されて何も起きていないので、
    // 巻き戻すのが正しい
    it("付ける側は今までどおり巻き戻して失敗を伝える", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11 }) });
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : gone));

        const { result } = renderHook(() => usePhotoLikes("p1", 11, true));
        await waitFor(() => expect(result.current.count).toBe(11));

        let ok = true;
        await act(async () => { ok = (await result.current.toggle()).ok; });

        expect(ok).toBe(false);
        expect(result.current.liked).toBe(false);
        expect(result.current.count).toBe(11);
    });
});

// **押し直しても直らない失敗を「もう一度お試しください」で済ませない。**
// 戻り値が boolean だったので理由を運べず、セッションが切れていても
// 通信できなくても同じ案内になっていた（`useFollow` / `useComments` は
// 前から見分けている）。
describe("usePhotoLikes: 断られた理由を運ぶ", () => {
    it.each([
        ["セッション切れ", "AUTH_REQUIRED_MESSAGE"],
        ["通信できない", "NETWORK_UNREACHABLE_MESSAGE"],
    ])("%s はその文言を返す", async (_label, key) => {
        const api = await import("../../utils/api");
        const msg = (api as unknown as Record<string, string>)[key];
        mockUserFetch.mockRejectedValue(new Error(msg));
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok).toBe(false);
        expect(r?.message, "理由を捨てている").toBe(msg);
    });

    it("理由の分からない失敗は文言を運ばない（画面が既定文を出す）", async () => {
        mockUserFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok).toBe(false);
        expect(r?.message, "英語の技術文字列を運んでいる").toBeUndefined();
    });

    // **いちばん多いのは例外ではなく 401。** トークンをローカルで取れない
    // 回だけが例外で、期限切れのトークンで投げた回は 401 の応答として返る。
    // `readApiError` はそれを「セッションの有効期限が切れています…」に
    // 置き換える——`useFollow` / `useComments` は前からこれを通している
    it("401 は「セッションの有効期限が切れています」を運ぶ", async () => {
        const { SESSION_EXPIRED_MESSAGE } = await import("../../utils/api");
        mockUserFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Unauthorized" }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.message, "サーバーが言っている理由を捨てている").toBe(SESSION_EXPIRED_MESSAGE);
    });

    it("サーバーが日本語の理由を返したら、それを運ぶ", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "この写真にはいいねできません" }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.message).toBe("この写真にはいいねできません");
    });

    it("理由の無い失敗は運ばない（画面が既定文を出す）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new SyntaxError("<"); } });
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok).toBe(false);
        expect(r?.message, "空文字を運ぶと空のトーストが出る").toBeUndefined();
    });

    // **押していない3経路は「失敗」ではない。** まとめて書き換えたので、
    // 1つ反転しても誰も気づかない状態だった。とくに未ログインが反転すると、
    // 訪問者がハートを押すたびに赤いトーストが出る
    it("未ログインで押しても失敗にしない（サーバーへ送っていない）", async () => {
        const { result } = renderHook(() => usePhotoLikes("p1", 3, false));
        let r: { ok: boolean } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok, "未ログインを失敗として伝えている").toBe(true);
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン状態が確定する前に押しても失敗にしない", async () => {
        const { result } = renderHook(() => usePhotoLikes("p1", 3, false, true));
        let r: { ok: boolean } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok).toBe(true);
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("押している最中の二度押しも失敗にしない", async () => {
        let release: (() => void) | null = null;
        mockUserFetch.mockImplementation(() => new Promise((res) => {
            release = () => res({ ok: true, json: async () => ({ liked: true, likes: 4 }) });
        }));
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let second: { ok: boolean } | undefined;
        await act(async () => {
            const first = result.current.toggle();
            second = await result.current.toggle();   // まだ返っていない間に押す
            release?.();
            await first;
        });
        expect(second?.ok, "二度押しを失敗として伝えている").toBe(true);
    });

    it("成功したら文言は無い", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ liked: true, likes: 4 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 3, true));
        let r: { ok: boolean; message?: string } | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toEqual({ ok: true, message: undefined });
    });
});
