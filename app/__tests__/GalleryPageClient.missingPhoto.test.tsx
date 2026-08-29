import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **消された写真の共有リンクを踏んだとき、何も言わずにトップが出ていた。**
//
// `/photo/<id>` は静的ページが無ければ 404 →`/?photo=<id>` に振り替わる
// （まだビルドされていない新着写真のための救済）。写真が本当に無い場合も
// 同じ経路を通るが、`openById` が false を返したあと**何もしていなかった**
// ので、`?photo=` だけが静かに外れて普通のギャラリーが出る。踏んだ人には
// 「リンクが壊れている」ではなく「トップに飛ばされた」と見える。
//
// 一方で「一覧に無い＝存在しない」ではない。`openById` が探すのは
// **絞り込んだあと**の一覧なので、フィルターで外れているだけの写真まで
// 「見つかりません」と言ってはいけない。

const mockShowToast = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ current: "" }));
const auth = vi.hoisted(() => ({ current: { isAuthenticated: false, userId: null as string | null, loading: false } }));

vi.mock("../auth/context", () => ({ useAuth: () => auth.current }));
vi.mock("../../lib/hooks/useFollow", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    fetchFollowingSet: async () => new Set<string>(),
}));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
// `?photo=` は本来 SearchParamWatcher が親へ渡す。ここではその値を直接注ぐ。
// 名前を大文字で始めるのは、中でフックを使う（React のコンポーネント）ため
vi.mock("../components/SearchParamWatcher", () => ({
    default: function MockSearchParamWatcher({ onChange }: { onChange: (v: string | null) => void }) {
        React.useEffect(() => { onChange(searchParams.current || null); }, [onChange]);
        return null;
    },
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "food", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    searchParams.current = "";
    auth.current = { isAuthenticated: false, userId: null, loading: false };
    window.history.replaceState({}, "", "/");
});

describe("開けない ?photo= を踏んだとき", () => {
    it("元の一覧にも無ければ、見つからないと伝える", async () => {
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("見つかりませんでした"), "error"));
    });

    // **同じ URL のまま2回言わない。** 効果の deps には絞り込んだ一覧が
    // 入っているので、フィルターを触るたびに再実行される。覚えていないと
    // そのたびに赤いトーストが出る
    it("同じ URL のまま、フィルターを触っても2回は言わない", async () => {
        auth.current = { isAuthenticated: true, userId: "me", loading: false };
        searchParams.current = "deleted-id";
        render(<GalleryPageClient />);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));

        // フィード切替＝絞り込んだ一覧が作り直される（効果が再実行される）
        fireEvent.click(screen.getByRole("button", { name: "フォロー中" }));
        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast, "同じ写真について2回言っている").toHaveBeenCalledTimes(1);
    });

    // **絞り込みで外れているだけなら黙る。** ここで「見つかりません」と
    // 出すと、実際には在る写真について嘘をつくことになる
    it("フィルターで外れているだけなら何も言わない", async () => {
        window.history.replaceState({}, "", "/?category=travel");
        searchParams.current = "p2";   // category=food なので絞り込みから外れる
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast, "在る写真について「見つかりません」と言っている").not.toHaveBeenCalled();
    });

    it("開ける写真では何も言わない（正常系）", async () => {
        searchParams.current = "p1";
        render(<GalleryPageClient />);

        await new Promise((r) => setTimeout(r, 20));
        expect(mockShowToast).not.toHaveBeenCalled();
        expect(screen.queryByText("Gallery")).toBeTruthy();
    });
});
