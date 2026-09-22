import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 拡大表示（モーダル）の保存ボタン。**いいねとは別の口**を叩くこと、
// 未ログインでは案内を出すこと、写真を送ったらしおりが持ち越されないこと。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));

vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ ...authState }) }));
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { resetFavoritesCache } from "../../../../lib/hooks/useFavorites";
import GalleryModal from "../index";
import type { Photo } from "@/lib/data/photos";

const photo = (id: string): Photo => ({
    id, src: `https://cdn.example.com/uploads/u1/${id}.jpg`,
    title: { ja: "写真", en: "Photo" }, tags: [], likes: 3,
});

/** 既定: いいねも保存も「まだ付いていない」 */
function defaultRoutes(path: string) {
    if (path.startsWith("/user/likes/")) return { ok: true, json: async () => ({ liked: false }) };
    if (path.startsWith("/user/saves/")) return { ok: true, json: async () => ({ saved: false }) };
    if (path.endsWith("/save")) return { ok: true, json: async () => ({ saved: true }) };
    return { ok: true, json: async () => ({ likes: 4 }) };
}

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    authState.isAuthenticated = true;
    authState.loading = false;
    mockShowToast.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset().mockImplementation((p: string) => Promise.resolve(defaultRoutes(p)));
});
afterEach(() => { localStorage.clear(); });

function setup(index = 0) {
    return render(
        <GalleryModal
            photos={[photo("p1"), photo("p2")]}
            currentIndex={index}
            onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()}
            locale="ja"
        />,
    );
}

describe("拡大表示の保存ボタン", () => {
    it("いいねとは別のボタンとして出る", async () => {
        setup();
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "いいね" })).toBeTruthy();
    });

    it("押すと `/photos/<id>/save` へ POST し、しおりが付く", async () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/save", { method: "POST" });
        // **いいねは飛ばない**（別の棚）
        expect(mockUserFetch).not.toHaveBeenCalledWith("/photos/p1/like", expect.anything());
    });

    it("保存済みから押すと DELETE", async () => {
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.startsWith("/user/saves/") ? { ok: true, json: async () => ({ saved: true }) }
                : p.endsWith("/save") ? { ok: true, json: async () => ({ saved: false }) }
                    : defaultRoutes(p)));
        setup();
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "保存を取り消す" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
        expect(mockUserFetch).toHaveBeenLastCalledWith("/photos/p1/save", { method: "DELETE" });
    });

    // **未ログインは「失敗」ではない。** 「保存できませんでした。もう一度
    // お試しください」と言われても、押し直して直る話ではない
    it("未ログインならログインを促し、サーバーへは何も送らない", async () => {
        authState.isAuthenticated = false;
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast.mock.calls[0][0]).toContain("ログイン");
        expect(mockUserFetch).not.toHaveBeenCalledWith("/photos/p1/save", expect.anything());
        // しおりは付かない（付くと「保存した」と見えるのに、どこにも残らない）
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    });

    it("失敗したらトーストで伝え、しおりは戻る", async () => {
        const body = { error: "保存に失敗しました" };
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.endsWith("/save") && !p.startsWith("/user/")
                ? { ok: false, status: 500, json: async () => body, clone: () => ({ json: async () => body }) }
                : defaultRoutes(p)));
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    });

    /**
     * モーダルは**同じフックのまま**次の写真へ進む（コンポーネントを作り直さない）。
     * 持ち越すと、1枚目のしおりが2枚目にも付いて見え、押すと解除が飛ぶ。
     *
     * ⚠️ **2枚目の取得を着地させてはいけない。** 以前は p1 が `saved: true`・
     * p2 が `saved: false` を返す形だったので、**捨てる処理を消しても
     * 2枚目の応答が `false` を運んできて緑**になっていた——「持ち越さない」を
     * 何も検証していなかった。だから p2 の GET は**着地させないまま握る**。
     * これで「保存」に戻る道が、捨てる処理しか無くなる。
     */
    it("写真を送ったら、しおりは持ち越さない", async () => {
        let landSecond!: (v: unknown) => void;
        mockUserFetch.mockImplementation((p: string) => {
            if (p === "/user/saves/p1") return Promise.resolve({ ok: true, json: async () => ({ saved: true }) });
            // p2 は**返さない**（飛行中のまま）
            if (p === "/user/saves/p2") return new Promise((r) => { landSecond = r; });
            return Promise.resolve(defaultRoutes(p));
        });
        const { rerender } = setup(0);
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());

        rerender(
            <GalleryModal
                photos={[photo("p1"), photo("p2")]}
                currentIndex={1}
                onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()}
                locale="ja"
            />,
        );
        // **2枚目の答えが来る前に**「保存」に戻っていること
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
        expect(screen.queryByRole("button", { name: "保存を取り消す" }),
            "1枚目のしおりを持ち越している").toBeNull();

        // 後始末（開いたままの約束を残さない）。着地しても壊れないことまで見る
        landSecond({ ok: true, json: async () => ({ saved: false }) });
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
    });

    // 読み上げ名が「保存を取り消す」（＝これから起きること）なので、
    // `aria-pressed` を足すと「保存を取り消す、押されています」と読まれて
    // 意味が逆に取れる。隣のいいねも同じ形
    it("操作を名前にしているので aria-pressed は付けない", async () => {
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.startsWith("/user/saves/") ? { ok: true, json: async () => ({ saved: true }) } : defaultRoutes(p)));
        setup();
        const save = await screen.findByRole("button", { name: "保存を取り消す" });
        expect(save.getAttribute("aria-pressed")).toBeNull();
        expect(screen.getByRole("button", { name: "いいね" }).getAttribute("aria-pressed")).toBeNull();
    });

    // 共有リンクを開いた直後はログイン状態の確認中で、押しても
    // `toggle` が入口で抜ける——アイコンも変わらずトーストも出ないので、
    // **壊れているようにしか見えない**
    it("ログイン状態の確認中は aria-busy で伝え、押しても何も飛ばない", () => {
        authState.loading = true;
        setup();
        const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
        expect(save.getAttribute("aria-busy")).toBe("true");
        // **`disabled` にはしない。** 往復中に disabled にすると、Enter で
        // 押した人のフォーカスが body に落ちて戻らない（隣のいいねと同じく
        // `busyRef` だけで連打を弾く）
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(mockUserFetch).not.toHaveBeenCalledWith("/photos/p1/save", expect.anything());
    });

    it("ログイン状態が確定したら aria-busy が下りる", async () => {
        setup();
        const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
        await waitFor(() => expect(save.getAttribute("aria-busy")).toBe("false"));
    });

    it("いいねのボタンと重ならない位置に置く（44px の当たりが並ぶ）", () => {
        setup();
        const save = screen.getByRole("button", { name: "保存" });
        const like = screen.getByRole("button", { name: "いいね" });
        // **px で書く。** 640px 未満で root が 14px に落ちるので rem は縮み、
        // 隣のボタンと重なる
        expect(save.className).toContain("right-[120px]");
        expect(like.className).toContain("right-[64px]");
    });
});

/**
 * 🔴 **呼ぶ側が一覧を持っているなら、送るたびに聞きに行かない。**
 *
 * ホームは `useMySaves` で保存済みの id を**一覧ぶん1回**で持っているのに、
 * ビューアには渡していなかった。実測（ログイン済みでホームからビューアを開き、
 * 3回 送った）:
 *
 *     GET /photos/<id>/like ・ GET /user/likes/<id> ・ GET /user/saves/<id>
 *     …が **送るたびに3本ずつ**
 *
 * `/user/saves/<id>` は一覧で分かっているぶんなので、丸ごと要らない。
 * カードで直したのと同じ形（`TimelineCard` / `usePhotoSave` の
 * `known` / `knownPending`）に揃える。
 *
 * ⚠️ いいねの2本は残る——ホームは**いいねの一覧を引いていない**
 * （`useMyServerLikes` を読むのは `/favorites` だけ）。そこへ新しく
 * 一括取得を足すのは別の判断なので、ここでは広げない。
 */
describe("一覧から分かっている保存（savedIds）", () => {
    const withIds = (ids: string[] | null, pending = false) => render(
        <GalleryModal
            photos={[photo("p1"), photo("p2")]}
            currentIndex={0}
            onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()}
            locale="ja"
            savedIds={ids ? new Set(ids) : null}
            savesPending={pending}
        />,
    );
    const saveGets = () => mockUserFetch.mock.calls.filter((c) => String(c[0]).startsWith("/user/saves/"));

    it("🔴 一覧に在れば、写真ごとに聞きに行かない（しおりは付く）", async () => {
        withIds(["p1"]);
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());
        expect(saveGets(), "一覧で分かっているのに GET を撃った").toEqual([]);
    });

    it("一覧に無ければ、未保存として出す（やはり聞きに行かない）", async () => {
        withIds(["p9"]);
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
        expect(saveGets()).toEqual([]);
    });

    it("一覧が飛行中なら待つ（撃たない）", async () => {
        withIds(null, true);
        await screen.findByRole("button", { name: "保存" });
        expect(saveGets(), "一覧の到着を待たずに撃った").toEqual([]);
    });

    // **渡さなければ今までどおり**（撮影スポット詳細は一覧を持っていない）
    it("渡さなければ、今までどおり聞きに行く", async () => {
        setup();
        await waitFor(() => expect(saveGets().length).toBeGreaterThan(0));
    });
});
