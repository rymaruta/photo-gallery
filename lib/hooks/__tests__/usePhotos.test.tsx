import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// **`loaded` は「API の一覧で置き換わったか」。**
//
// 初期値は `app/data/photos.json`（ビルド時のスナップショット）なので、
// 「配列が空でない」は「一覧が届いた」の代わりにならない。それで代用して
// いたせいで、ビルド後にアップロードされた写真の共有リンクに対して
// 「その写真は見つかりませんでした」と嘘をつき、しかもその判定を覚えて
// **あとから届いても開かなく**なっていた（GalleryPageClient）。
//
// **失敗したときは true にしない**のが要点。取れなかっただけで「無い」とは
// 言えないので、判断できないままにしておく（黙る側に倒す）。

const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({ publicFetch: mockPublicFetch }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/app/data/photos.json", () => ({
    default: [{ id: "base-1", src: "a.jpg", title: "静的", category: "x", tags: [], date: "2026-01-01" }],
}));

const { usePhotos } = await import("../usePhotos");

const API_PHOTOS = [
    { id: "api-1", src: "b.jpg", title: "新着", category: "x", tags: [], date: "2026-02-01" },
];

beforeEach(() => { mockPublicFetch.mockReset(); });

describe("usePhotos の loaded", () => {
    it("最初は false（静的なスナップショットしか無い）", () => {
        mockPublicFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        const { result } = renderHook(() => usePhotos());
        expect(result.current.loaded).toBe(false);
        expect(result.current.photos).toHaveLength(1);   // 静的の分は出る
    });

    it("API の一覧で置き換わったら true", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => API_PHOTOS });
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.photos[0].id).toBe("api-1");
    });

    // **ここが要点。** 取れなかっただけで「無い」とは言えない
    it("取得に失敗したら false のまま（無いとは言わない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded, "失敗したのに「届いた」と言っている").toBe(false);
        expect(result.current.photos).toHaveLength(1);
    });

    it("通信が落ちても false のまま", async () => {
        mockPublicFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded).toBe(false);
    });

    // **ここは以前「false のまま」を正解として固定していた。それが誤り。**
    //
    // 空配列は失敗ではない——**聞けて、答えが「公開写真は0件」だった**。
    // false のままにすると、公開写真が1枚も無い環境（新しい環境・全部
    // 非公開にした・全部消した）で `loaded` が永久に立たず、
    // `GalleryPageClient` の門
    //   `if (!photosLoaded) { setPendingPhoto(photoParam); return; }`
    // を越えられない。共有リンク `/?photo=<id>` を踏んでも**モーダルも
    // 出ず、無いとも言われず、`?photo=` が URL に残ったまま**になる。
    // 押し直しても同じ（`notFoundRef` にも到達しない）。
    //
    // **もう一方の性質は残す。** 「空で静的データを潰さない」は変えていない
    // ——変えるのは「届いたことを記録するか」だけ。
    it("空配列でも届いたことにする（が、静的データは潰さない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [] });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded, "答えが返っているのに「まだ」と言っている").toBe(true);
        expect(result.current.photos, "空で静的データを潰している").toHaveLength(1);
    });

    // 配列ですらない応答（HTML のエラーページなど）は「答え」ではない
    it("配列でなければ届いたことにしない", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ error: "boom" }) });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded).toBe(false);
        expect(result.current.photos).toHaveLength(1);
    });
});

// **100件中1件が壊れているだけで、ページ全体が落ちていた。**
//
// `Array.isArray(data)` までしか見ずに状態へ入れていたので、`null` が
// 1件混じると描画中に `TypeError`（`useGallery` の `p.category` ほか）になり、
// `ErrorBoundary` のカードがヘッダーごと画面を覆う。
// 読めない行だけ落として、残りは出す。
describe("読めない行が混じった応答", () => {
    it("壊れた行を落として、残りは出す", async () => {
        mockPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => [API_PHOTOS[0], null, "文字列", { src: "id なし" }],
        });
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.photos.map((p) => p.id), "壊れた行が状態に入っている")
            .toEqual(["api-1"]);
    });

    it("全部読めないなら静的のスナップショットを残す", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [null, null] });
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.photos.map((p) => p.id), "静的のぶんまで消えている")
            .toEqual(["base-1"]);
    });

    // **配列ですらないときは「届いた」と言わない**（取れなかったのと同じ）
    it("配列でなければ loaded を立てない", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded).toBe(false);
    });
});

// **`failed`（取りに行って駄目だった）を `loaded` と分けて持つ。**
// `loaded` は「届いたか」しか言わないので、失敗と「まだ来ていない」を
// 区別できない。待っている側（共有リンク・通知から開いた `?photo=`）は
// 「届く前に無いと言わない」ために `loaded` を門にしているので、
// **失敗すると永久に黙って待つ**（実測: 応答を保持すると 3秒・10秒・30秒の
// いずれでもモーダルもトーストも出ず、`?photo=` が URL に残ったまま）。
describe("usePhotos の failed", () => {
    it("届いたら failed は立たない", async () => {
        mockPublicFetch.mockResolvedValue(new Response(JSON.stringify(API_PHOTOS), { status: 200 }));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.failed).toBe(false);
    });

    it("サーバーが 5xx を返したら failed", async () => {
        mockPublicFetch.mockResolvedValue(new Response("boom", { status: 503 }));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.loaded, "失敗を「届いた」にしない").toBe(false);
    });

    it("時間切れ（TimeoutError）も failed", async () => {
        mockPublicFetch.mockRejectedValue(new DOMException("応答がありません", "TimeoutError"));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.failed).toBe(true));
    });

    // **画面を離れたときの中断は失敗ではない。** 一緒にすると、別ページへ
    // 移っただけで「読み込めませんでした」と言い出す
    it("自分で畳んだ中断（AbortError）は failed にしない", async () => {
        mockPublicFetch.mockRejectedValue(new DOMException("やめた", "AbortError"));
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 30));
        expect(result.current.failed).toBe(false);
    });

    // **200 なのに配列でない**（壊れた応答・別のAPIに当たっている）。
    // ここに出口が無いと `loaded` も `failed` も立たず、待っている側
    // （`?photo=` の待ち id）が永久に黙って待つ
    it("200 でも配列でなければ failed（黙って待たせない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.loaded, "配列でないのに届いたことにしている").toBe(false);
    });

    // **取り直しの契機。** 一度失敗すると `failed` が立ちっぱなしで、
    // この画面には再試行が無かった（`?photo=` を開こうとした人は、タブを
    // 開き直すまで写真モーダルが死ぬ）。画面に部品を増やさない形で、
    // 戻ってきたとき・回線が戻ったときに取り直す（`useFollow` と同じ手）
    it("戻ってきたら取り直す（失敗したときだけ）", async () => {
        mockPublicFetch.mockResolvedValueOnce(new Response("boom", { status: 503 }));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.failed).toBe(true));

        mockPublicFetch.mockResolvedValue(new Response(JSON.stringify(API_PHOTOS), { status: 200 }));
        document.dispatchEvent(new Event("visibilitychange"));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.failed).toBe(false);
        expect(result.current.photos.map((p) => p.id)).toEqual(["api-1"]);
    });

    it("回線が戻ったときも取り直す", async () => {
        mockPublicFetch.mockResolvedValueOnce(new Response("boom", { status: 503 }));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.failed).toBe(true));

        mockPublicFetch.mockResolvedValue(new Response(JSON.stringify(API_PHOTOS), { status: 200 }));
        window.dispatchEvent(new Event("online"));
        await waitFor(() => expect(result.current.loaded).toBe(true));
    });

    // **成功したあとは取り直さない。** 戻ってくるたびに投げると、
    // 常駐しているこの画面が延々と取りにいく
    it("届いているときは、戻ってきても取り直さない", async () => {
        mockPublicFetch.mockResolvedValue(new Response(JSON.stringify(API_PHOTOS), { status: 200 }));
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        const calls = mockPublicFetch.mock.calls.length;
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("online"));
        await new Promise((r) => setTimeout(r, 30));
        expect(mockPublicFetch.mock.calls.length, "成功しているのに取り直している").toBe(calls);
    });
});
