import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * `TimelineFeed` — フォローしている人の写真が投稿順に流れる面（マイページの「フォロー中」タブ）。
 *
 * 見ているのは**状態の出し分け**（まだ／未ログイン／失敗／0人／0枚／並ぶ）と、
 * 共有のフォロー一覧が変わったら取り直すこと。中身の決め方は
 * `lib/utils/__tests__/timeline.test.ts`。
 */
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me", loading: false } }));
vi.mock("../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const photosState = vi.hoisted(() => ({ current: { photos: [] as unknown[], loading: false, loaded: true, failed: false } }));
vi.mock("../../../lib/hooks/usePhotos", () => ({ usePhotos: () => photosState.current }));

const follow = vi.hoisted(() => ({
    fetch: vi.fn<() => Promise<Set<string>>>(),
    listeners: new Set<() => void>(),
}));
vi.mock("../../../lib/hooks/useFollow", () => ({
    fetchFollowingSet: () => follow.fetch(),
    subscribeFollowingSet: (fn: () => void) => { follow.listeners.add(fn); return () => follow.listeners.delete(fn); },
}));
// **フォローの操作は境界としてモックする。** このファイルが見ているのは
// 面の状態の出し分け（まだ／未ログイン／失敗／0人／0枚／並ぶ）で、
// フォローの押し心地は `FollowButton` 側の試験の担当。
// 本物を通すと `useFollow`（上でモックした一覧の取得とは別の口）まで
// 引きずられ、**この面の試験がフォローの通信を模す羽目になる**
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/hooks/useMySaves", () => ({ useMySaves: () => ({ photoIds: [], pending: false, failed: false, retry: vi.fn() }) }));
vi.mock("../../../lib/hooks/usePhotoSave", () => ({ usePhotoSave: () => ({ saved: false, pending: false, toggle: vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../UserAvatar", () => ({ default: () => <span /> }));
vi.mock("../FollowButton", () => ({
    FollowAction: () => null,
    default: () => null,
}));

const TimelineFeed = (await import("../TimelineFeed")).default;
const Feed = () => <TimelineFeed locale="ja" />;

const PHOTOS = [
    { id: "a-new", src: "https://cdn/a-new.jpg", userId: "A", displayName: "Aさん", title: "新しい方", createdAt: "2026-09-10T10:00:00", date: "2019-01-01" },
    { id: "a-old", src: "https://cdn/a-old.jpg", userId: "A", displayName: "Aさん", title: "古い方", createdAt: "2026-09-01T10:00:00", date: "2026-09-09", location: "パリ" },
    { id: "b1", src: "https://cdn/b1.jpg", userId: "B", displayName: "Bさん", title: "Bの写真", createdAt: "2026-09-05T10:00:00" },
    { id: "me1", src: "https://cdn/me1.jpg", userId: "me", displayName: "自分", title: "自分の写真", createdAt: "2026-09-12T10:00:00" },
];

const cardIds = () => Array.from(document.querySelectorAll("[data-photo-id]")).map((el) => el.getAttribute("data-photo-id"));

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    photosState.current = { photos: PHOTOS, loading: false, loaded: true, failed: false };
    follow.fetch.mockReset();
    follow.listeners.clear();
});

describe("TimelineFeed", () => {
    it("フォローしている人の写真だけが、投稿の新しい順に並ぶ（自分のは混ざらない）", async () => {
        follow.fetch.mockResolvedValue(new Set(["A"]));
        render(<Feed />);
        await waitFor(() => expect(cardIds()).toEqual(["a-new", "a-old"]));
        // 誰が上げたかがカードに出る（一覧のグリッドには無かったもの）
        expect(screen.getAllByText("Aさん").length).toBe(2);
        expect(screen.queryByText("自分の写真"), "自分の写真が混ざっている").toBeNull();
        expect(screen.queryByText("Bの写真"), "フォローしていない人の写真が混ざっている").toBeNull();
        expect(screen.getByText("パリ")).toBeInTheDocument();
        // 写真ページへ（先読みはしない）
        const link = document.querySelector('[data-photo-id="a-new"]') as HTMLAnchorElement;
        expect(link.getAttribute("href")).toMatch(/a-new/);
    });

    // 🔴 レビューが発見: `createdAt` は UTC の瞬間なのに、書かれた数字をそのまま出す
    // `formatStoredDateTime` に通していた（JST では9時間前・深夜は前日）。
    // 相対表記なら閲覧者のゾーンで正しい。**撮影日ではなく上げた日**で数える
    it("上げた日を相対で出す（撮影日ではない・ゾーンに依らない）", async () => {
        vi.useFakeTimers({ now: new Date("2026-09-13T10:00:00Z"), toFake: ["Date"] });
        try {
            follow.fetch.mockResolvedValue(new Set(["A"]));
            render(<Feed />);
            await waitFor(() => expect(cardIds()).toEqual(["a-new", "a-old"]));
            const times = Array.from(document.querySelectorAll("time")).map((t) => [t.getAttribute("dateTime"), t.textContent]);
            // a-new: 上げたのは 09-10（撮影は 2019）→ 3日前。a-old: 上げたのは 09-01（撮影 09-09）→ 12日前
            expect(times).toEqual([
                ["2026-09-10T10:00:00", "3日前"],
                ["2026-09-01T10:00:00", "12日前"],
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("未ログインは送り返さず、ログインへの導線を出す", () => {
        authState.current = { isAuthenticated: false, userId: "", loading: false };
        follow.fetch.mockResolvedValue(new Set(["A"]));
        render(<Feed />);
        const login = screen.getByRole("link", { name: "ログイン" });
        expect(login.getAttribute("href")).toMatch(/^\/login\?next=/);
        expect(follow.fetch, "未ログインなのに一覧を取りに行っている").not.toHaveBeenCalled();
        expect(cardIds()).toEqual([]);
    });

    it("判定中は「読み込み中」だけ（0人とも未ログインとも言わない）", () => {
        authState.current = { isAuthenticated: false, userId: "", loading: true };
        render(<Feed />);
        expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
        expect(screen.queryByRole("link", { name: "ログイン" })).toBeNull();
        expect(follow.fetch).not.toHaveBeenCalled();
    });

    it("誰もフォローしていなければ、ユーザーを探す導線", async () => {
        follow.fetch.mockResolvedValue(new Set());
        render(<Feed />);
        expect(await screen.findByText("まだ誰もフォローしていません。")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "ユーザーを探す" }).getAttribute("href")).toBe("/users/search");
    });

    // **0人の答えは確定しているので、写真を待たない**（待つと0人の人にだけ
    // 無意味な「読み込み中…」が出る。トップから移した守り）
    it("フォローが0人なら、写真の一覧を待たずに案内を出す", async () => {
        photosState.current = { photos: [], loading: true, loaded: false, failed: false };
        follow.fetch.mockResolvedValue(new Set());
        render(<Feed />);
        expect(await screen.findByText("まだ誰もフォローしていません。")).toBeInTheDocument();
        expect(screen.queryByRole("status")).toBeNull();
    });

    // **取得中に「0人」と言わない**（トップのフォロー中フィードが踏んだ穴）
    it("一覧が届くまでは「読み込み中」で、「0人」の画面は出さない", () => {
        follow.fetch.mockReturnValue(new Promise(() => {}));
        render(<Feed />);
        expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
        expect(screen.queryByText("まだ誰もフォローしていません。")).toBeNull();
    });

    it("一覧の取得に失敗したら、そう言って取り直せる", async () => {
        follow.fetch.mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(new Set(["A"]));
        render(<Feed />);
        expect(await screen.findByText("フォロー中の一覧を読み込めませんでした。")).toBeInTheDocument();
        expect(cardIds()).toEqual([]);
        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        await waitFor(() => expect(cardIds()).toEqual(["a-new", "a-old"]));
        expect(follow.fetch).toHaveBeenCalledTimes(2);
    });

    it("フォロー先が1枚も上げていなければ、そう言う（一覧が届いた回だけ）", async () => {
        follow.fetch.mockResolvedValue(new Set(["C"]));
        render(<Feed />);
        expect(await screen.findByText("フォロー中の人は、まだ写真を投稿していません。")).toBeInTheDocument();
    });

    it("写真の一覧がまだなら「まだ投稿していません」と言い切らない", async () => {
        photosState.current = { photos: [], loading: true, loaded: false, failed: false };
        follow.fetch.mockResolvedValue(new Set(["A"]));
        render(<Feed />);
        await waitFor(() => expect(follow.fetch).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("読み込み中"));
        expect(screen.queryByText(/まだ写真を投稿していません/)).toBeNull();
    });

    it("写真の一覧が落ちた回は、投稿が無いとは言わない", async () => {
        photosState.current = { photos: [], loading: false, loaded: false, failed: true };
        follow.fetch.mockResolvedValue(new Set(["A"]));
        render(<Feed />);
        expect(await screen.findByText("写真の一覧を読み込めませんでした。")).toBeInTheDocument();
    });

    // フォロー解除・ブロックはこの画面の外（プロフィール・ストーリー）で起きる。
    // 共有の一覧が変わったら取り直さないと、外した相手の写真が出続ける
    it("共有のフォロー一覧が変わったら取り直す", async () => {
        follow.fetch.mockResolvedValueOnce(new Set(["A", "B"])).mockResolvedValueOnce(new Set(["B"]));
        render(<Feed />);
        await waitFor(() => expect(cardIds()).toEqual(["a-new", "b1", "a-old"]));
        act(() => { follow.listeners.forEach((fn) => fn()); });
        await waitFor(() => expect(cardIds()).toEqual(["b1"]));
    });

    // 取り直している間、前の集合でも空集合でも描かない（「0人」が一瞬復活しない。
    // トップから移した守り）
    it("取り直しの途中で「0人」が復活しない", async () => {
        follow.fetch.mockResolvedValueOnce(new Set(["A"])).mockReturnValueOnce(new Promise(() => {}));
        render(<Feed />);
        await waitFor(() => expect(cardIds()).toEqual(["a-new", "a-old"]));
        act(() => { follow.listeners.forEach((fn) => fn()); });
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("読み込み中"));
        expect(screen.queryByText("まだ誰もフォローしていません。"), "取り直し中に0人と言っている").toBeNull();
        expect(cardIds()).toEqual([]);
    });
});
