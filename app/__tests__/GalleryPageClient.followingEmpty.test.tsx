import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **取得中と「0人」を同じ画面にしていた。**
//
// `followingIds` の初期値は空の Set なので、取得が終わる前のフォロー中
// フィードは必ず0件になる。そのまま「フォローした人の写真がここに
// 集まります。」を出すと、何人もフォローしている人にも、回線が遅い間ずっと
// 「誰もフォローしていない人」の画面を見せることになる。
//
// もうひとつ、**0件の理由を取り違えていた**。検索語やカテゴリで0件に
// なった回にも同じ文言を出していたので、抜けるには「みんなの写真を見る」
// →まだ0件→「フィルターをリセット」と2手かかっていた。

const mockUserFetch = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, userId: "me" as string | null, loading: false },
}));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// フォローしている u1 の写真が1枚ある状態
//
// **一覧の取得の状態も差し替えられるようにしておく。** ここを
// `loaded: true` 固定で書いていたので、「写真がまだ来ていない／取れなかった
// ときに『まだ投稿していません』と言わない」という守りを**この8件が
// 一度も通っていなかった**（守りを消しても全部緑だった）。
const photosState = vi.hoisted(() => ({
    current: { loaded: true, failed: false },
}));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({
        loaded: photosState.current.loaded,
        failed: photosState.current.failed,
        photos: [{
            id: "p1", userId: "u1", src: "https://cdn/p1.jpg",
            title: { ja: "友達の写真", en: "Friend" }, category: "street", tags: [],
            date: "2026-01-01", createdAt: "2026-01-01", published: true,
        }],
    }),
}));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

const EMPTY = /フォローした人の写真がここに集まります/;

beforeEach(async () => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    photosState.current = { loaded: true, failed: false };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset();
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("フォロー中フィードの空表示", () => {
    it("取得が終わるまで「0人」の画面を出さない", async () => {
        let settle: ((v: unknown) => void) | null = null;
        mockUserFetch.mockImplementation(() => new Promise((res) => { settle = res; }));

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(screen.queryByText(EMPTY), "取得中なのに「0人」の画面を出している").toBeNull();

        settle!({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        // 届いたら写真が出る（＝空表示にはならない）
        await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    });

    // **「まだ分からない」を未ログインと混ぜない。** セッションの復元は
    // 非同期で、その間 `isAuthenticated` は false。上流で確定させてしまうと、
    // `/?feed=following` を再読込・戻るで開いた人に「0人」の画面が出る。
    it("認証の判定中は「0人」の画面を出さない", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        window.history.replaceState({}, "", "/?feed=following");

        const { rerender } = render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        expect(screen.queryByText(EMPTY), "認証の判定中に「0人」を出している").toBeNull();
        expect(screen.queryByText(/結果: 0 件/), "本文を伏せながら0件と言っている").toBeNull();

        // 判定が終わってログイン済みと分かる
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        rerender(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    });

    // **「まだ誰もフォローしていない」と「フォロー先がまだ投稿していない」を
    // 分ける。** すぐ上のコメントが「0件の理由がフォローが0人のときだけ
    // この文言にする」と宣言しているのに、条件に人数が入っていなかった
    // ——1人フォローした直後（相手がまだ投稿していない）に、**誰も
    // フォローしていない人と同じ画面**が出てフォローが効いていないように見える
    it("フォローが1人以上なら、「まだ投稿していません」と言う", async () => {
        // その1人はまだ写真を投稿していない（一覧の写真は u1 のもの）
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u2"] }) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(/フォロー中の人は、まだ写真を投稿していません/)).toBeInTheDocument();
        expect(screen.queryByText(EMPTY), "誰もフォローしていない人と同じ画面を出している").toBeNull();
    });

    // **写真の一覧が来ていないうちは「まだ投稿していません」と言わない。**
    // 相手が投稿していても、こちらの手元に写真が無ければ0件になる。
    // 分からない間は断定しない側（「ここに集まります」）へ倒す。
    it("写真の取得に失敗したときは「まだ投稿していません」と断定しない", async () => {
        photosState.current = { loaded: true, failed: true };
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u2"] }) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
        expect(
            screen.queryByText(/フォロー中の人は、まだ写真を投稿していません/),
            "写真が取れていないのに「投稿していません」と断定している",
        ).toBeNull();
    });

    // 写真がまだ届いていないのは「0人」でも「投稿していません」でもない
    // ——**読み込み中**。フォロー中の一覧を待つときと同じ扱いにする
    it("写真の一覧がまだ届いていない間は「読み込み中…」", async () => {
        photosState.current = { loaded: false, failed: false };
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u2"] }) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText("読み込み中…")).toBeInTheDocument();
        expect(
            screen.queryByText(/フォロー中の人は、まだ写真を投稿していません/),
            "一覧がまだ来ていないのに「投稿していません」と断定している",
        ).toBeNull();
        expect(
            screen.queryByText(EMPTY),
            "まだ来ていないのに「誰もフォローしていない人」と同じ画面を出している",
        ).toBeNull();
    });

    // **落ちた回は「読み込み中…」に落とさない。** `usePhotos` は失敗しても
    // `loaded` を立てないので、`!photosLoaded` だけで判定すると
    // **永久に「読み込み中…」**になる
    it("写真の取得に失敗したら、読み込み中のまま固まらない", async () => {
        photosState.current = { loaded: false, failed: true };
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u2"] }) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
        expect(screen.queryByText("読み込み中…"), "落ちたのに読み込み中のまま").toBeNull();
    });

    it("フォローが0人なら、今までどおりの案内", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    });

    // 未ログインは「取得しない」＝確定。ここで確定させ忘れると、本文は
    // null のまま・タブも出ないので、**抜け出せない真っ白**になる
    it("未ログインで ?feed=following を開いたら、案内を出す", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        window.history.replaceState({}, "", "/?feed=following");

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "みんなの写真を見る" })).toBeInTheDocument();
    });

    // 「もう一度読み込む」の再取得中も、確定するまでは出さない
    it("再取得の途中で「0人」が復活しない", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));
        await screen.findByText(/フォロー中の一覧を読み込めませんでした/);

        let settle: ((v: unknown) => void) | null = null;
        mockUserFetch.mockImplementation(() => new Promise((res) => { settle = res; }));
        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));

        await waitFor(() => expect(settle).not.toBeNull());
        expect(screen.queryByText(EMPTY), "再取得の途中で「0人」に戻っている").toBeNull();

        settle!({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    });

    it("本当に0人なら、今までどおり案内を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    });

    it("検索語で0件になったときは「条件に一致する写真がありません」を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        window.history.replaceState({}, "", "/?feed=following&q=zzzznomatch");

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);

        // リセットで feed ごと戻せる方の分岐に落ちる
        expect(await screen.findByText(/条件に一致する写真がありません/)).toBeInTheDocument();
        expect(screen.queryByText(EMPTY), "0件の理由を取り違えている").toBeNull();
    });
});
