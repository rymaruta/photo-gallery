import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * トップの「自分 / フォロー中 / すべて」。
 *
 * owner:「この画面は、タブで切り替えて、自分の写真かフォロー中の人の写真みれる
 * ようにしたい」「デフォルトは自分のみがいい」。
 *
 * - ログイン中だけ出る。**既定は「自分」**（URL にタブか `?photo=` があれば倒さない）
 * - 「自分」は自分の写真だけのグリッド／「フォロー中」は `TimelineFeed`（絞り込みは
 *   出さない）／「すべて」は未ログインと同じ一覧
 * - 未ログインはタブ無し・みんなの写真。`?scope=mine` で来ても絞らない
 */
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null, loading: false } }));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/FilterBar", () => ({ default: () => <div data-testid="filter-bar" /> }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
// `?photo=` は本来 SearchParamWatcher が URL から親へ渡す。ここでは URL を短い間隔で
// 読んで渡す（値を直接注ぐ形だと、グリッドから開いた写真の `?photo=` を「消えた」と
// 誤って伝えて閉じてしまう）
vi.mock("../components/SearchParamWatcher", () => ({
    default: function MockWatcher({ onChange }: { onChange: (v: string | null) => void }) {
        const read = () => new URLSearchParams(window.location.search).get("photo");
        const [v, setV] = React.useState(read);
        React.useEffect(() => { const t = setInterval(() => setV(read()), 5); return () => clearInterval(t); }, []);
        React.useEffect(() => { onChange(v); }, [v, onChange]);
        return null;
    },
}));
vi.mock("../components/TimelineFeed", () => ({ default: () => <div data-testid="timeline-feed" /> }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const gridProps = vi.hoisted(() => ({ ids: null as string[] | null, open: null as ((id: string) => boolean) | null }));
vi.mock("../components/GalleryGrid", () => ({
    default: (p: { photos: Array<{ id: string }>; onOpenPhoto?: (id: string) => boolean }) => {
        gridProps.ids = p.photos.map((x) => x.id); gridProps.open = p.onOpenPhoto ?? null; return <div data-testid="grid" />;
    },
}));

const PHOTOS = [
    { id: "mine-1", userId: "me", src: "https://cdn/a.jpg", title: "自分1", category: "travel", tags: [], date: "2026-01-03", createdAt: "2026-01-03" },
    { id: "theirs", userId: "u1", src: "https://cdn/b.jpg", title: "他人", category: "travel", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
    { id: "mine-2", userId: "me", src: "https://cdn/c.jpg", title: "自分2", category: "food", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
];
const photosState = vi.hoisted(() => ({ photos: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: photosState.photos, loaded: true, failed: false }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

const tab = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => tab(name).getAttribute("aria-pressed") === "true";

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    photosState.photos = PHOTOS;
    gridProps.ids = null;
    window.history.replaceState({}, "", "/");
});

describe("トップの 自分 / フォロー中 / すべて", () => {
    it("ログイン中の既定は「自分」で、自分の写真だけが並ぶ", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        expect(gridProps.ids).toEqual(["mine-1", "mine-2"]);
        expect(new URLSearchParams(window.location.search).get("scope")).toBe("mine");
    });

    it("「すべて」を押すとみんなの写真。押した後に既定へ戻されない", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        fireEvent.click(tab("すべて"));
        await waitFor(() => expect(gridProps.ids).toEqual(["mine-1", "theirs", "mine-2"]));
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("すべて"), "「すべて」を押したのに「自分」へ戻している").toBe(true);
        expect(new URLSearchParams(window.location.search).get("scope")).toBeNull();
    });

    it("「フォロー中」は絞り込みとグリッドの代わりにタイムラインを出す", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        fireEvent.click(tab("フォロー中"));
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
        expect(screen.queryByTestId("filter-bar"), "フォロー中で効かない絞り込みを出している").toBeNull();
        expect(screen.queryByTestId("grid")).toBeNull();
        expect(new URLSearchParams(window.location.search).get("scope")).toBe("following");
    });

    it("URL がタブを指定していれば、既定の「自分」で上書きしない", async () => {
        window.history.replaceState({}, "", "/?scope=following");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("フォロー中")).toBe(true);
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
    });

    // 共有リンク・通知は写真を名指ししている。「自分」に無い写真なら絞りを外す
    // 往復（トースト付き）になるので、最初から「すべて」で開く
    it("?photo= で来た人は「自分」へ倒さない", async () => {
        window.history.replaceState({}, "", "/?photo=theirs");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("すべて")).toBe(true);
    });

    it("認証の判定中は倒さず、確定してから「自分」にする", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        const { rerender } = render(<GalleryPageClient />);
        expect(screen.queryByRole("button", { name: "自分" })).toBeNull();
        expect(gridProps.ids).toEqual(["mine-1", "theirs", "mine-2"]);
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        rerender(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        expect(gridProps.ids).toEqual(["mine-1", "mine-2"]);
    });

    // 🔴 レビューが指摘: ハイドレーション直後に写真を開き、そのあと認証が確定すると
    // 「自分」へ倒れて**開いている写真の下で一覧が入れ替わる**（`setFilters` は
    // `currentIndex` を触らない）。開いている写真があるときは倒さない
    it("写真を開いている最中に認証が確定しても、「自分」へ倒さない", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        const { rerender } = render(<GalleryPageClient />);
        act(() => { expect(gridProps.open!("theirs")).toBe(true); });
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        rerender(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("すべて"), "開いている写真の下で一覧を入れ替えている").toBe(true);
        expect(gridProps.ids).toEqual(["mine-1", "theirs", "mine-2"]);
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
    });

    // フォロー中の面はグリッドではないので、名指しの写真は「すべて」へ外してから開く
    // （フィードの上にモーダルを重ねない）
    it("「フォロー中」で ?photo= が届いたら、「すべて」へ外して開く", async () => {
        window.history.replaceState({}, "", "/?scope=following");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
        window.history.pushState({}, "", "/?scope=following&photo=theirs");   // 通知からの遷移
        await waitFor(() => expect(pressed("すべて")).toBe(true));
        expect(screen.queryByTestId("timeline-feed")).toBeNull();
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
    });

    it("未ログインはタブ無しで、?scope=mine で来ても絞らない", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        window.history.replaceState({}, "", "/?scope=mine");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.queryByRole("button", { name: "自分" })).toBeNull();
        expect(gridProps.ids).toEqual(["mine-1", "theirs", "mine-2"]);
        expect(new URLSearchParams(window.location.search).get("scope"), "未ログインに mine が残っている").toBeNull();
    });

    it("「自分」で写真が0枚なら、投稿への導線を出す（「条件に一致しない」とは言わない）", async () => {
        photosState.photos = [PHOTOS[1]];   // 他人の1枚だけ
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        expect(screen.getByText("まだ写真を投稿していません。")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "最初の写真を投稿" }).getAttribute("href")).toBe("/user/upload");
        expect(screen.queryByText(/条件に一致する写真がありません/)).toBeNull();
    });

    it("おすすめは「すべて」のときだけ", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }];
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("自分")).toBe(true));
        expect(screen.queryByRole("heading", { name: "おすすめ" })).toBeNull();
        fireEvent.click(tab("すべて"));
        await waitFor(() => expect(screen.getByRole("heading", { name: "おすすめ" })).toBeInTheDocument());
    });
});
