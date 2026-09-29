import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/**
 * トップの「おすすめ / フォロー中 / 新着」（owner の新デザイン）。
 *
 * **「自分」タブは無くなった**——自分の写真はマイページの「投稿」タブが持つ。
 *
 * - **タブは未ログインにも出る**（「おすすめ」は誰が見ても同じ）。
 *   戻すのは「フォロー中」だけ（本人の id が無いと意味を持たない）
 * - **おすすめ＝運営が選んだ写真を先に、残りはいいねの多い順**（iOS の `HomeFeed`・
 *   空にならない）。選ばれた写真が1枚も無ければ、**既定にはしない**（新着のまま）
 * - 「フォロー中」は `TimelineFeed`／「新着」は1列のカード
 * - **絞り込みとグリッドはトップから消えた**（「さがす」の持ち場）
 */
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null, loading: false } }));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
// **`showToast` は固定する。** 描画のたびに新しい関数を返すと、`?photo=` の effect
// （依存に `showToast` が入る）が毎回走り直し、写真を開いた直後の再描画で
// `photoParam` がまだ届いていない隙に「URL から消えた」と誤読して閉じる。
// 本物は `useCallback` で安定している（管理画面のテストで一度踏んだ型）
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/FilterBar", () => ({ default: () => <div data-testid="filter-bar" /> }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
// `?photo=` は本来 SearchParamWatcher が URL から親へ渡す（Next の `useSearchParams` は
// `history.replaceState` / `pushState` に同期して更新される）。ここでは URL の書き込みを
// 包んで**その場で**知らせる。**間隔で読む形（5ms の polling）にしてはいけない**——
// CI の負荷で認証の再描画が polling より先に来ると `photoParam` がまだ `null` で、
// 「URL から `?photo=` が消えた」と誤読して開いた写真を閉じる（run 403 で落ちた）。
// 値を直接注ぐ形も駄目（グリッドから開いた写真の `?photo=` を「消えた」と伝える）
const URL_EVENT = "test:urlchange";
for (const m of ["pushState", "replaceState"] as const) {
    const orig = window.history[m].bind(window.history);
    window.history[m] = ((...a: Parameters<History["pushState"]>) => { orig(...a); window.dispatchEvent(new Event(URL_EVENT)); }) as History["pushState"];
}
vi.mock("../components/SearchParamWatcher", () => ({
    default: function MockWatcher({ onChange }: { onChange: (v: string | null) => void }) {
        const read = () => new URLSearchParams(window.location.search).get("photo");
        const [v, setV] = React.useState(read);
        React.useEffect(() => {
            const sync = () => setV(read());
            window.addEventListener(URL_EVENT, sync); window.addEventListener("popstate", sync);
            return () => { window.removeEventListener(URL_EVENT, sync); window.removeEventListener("popstate", sync); };
        }, []);
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
// トップの新着は写真の並び（`HomeMosaic`）。**並びの部品そのものは境界としてモックする**
// （見せ方は `HomeMosaic.test.tsx` の担当。ここで見たいのは「どの写真が
// どの順で並ぶか」）
vi.mock("../components/HomeMosaic", () => ({
    default: (p: { photos: { id: string }[] }) => <>{p.photos.map((ph) => <div key={ph.id} data-card={ph.id} />)}</>,
}));

const PHOTOS = [
    { id: "mine-1", userId: "me", src: "https://cdn/a.jpg", title: "自分1", category: "travel", tags: [], date: "2026-01-03", createdAt: "2026-01-03" },
    { id: "theirs", userId: "u1", src: "https://cdn/b.jpg", title: "他人", category: "travel", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
    { id: "mine-2", userId: "me", src: "https://cdn/c.jpg", title: "自分2", category: "food", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
];
const photosState = vi.hoisted(() => ({ photos: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: photosState.photos, loaded: true, failed: false }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

/**
 * 🔴 **`role="tab"` ＋ `aria-selected`**（2026-09-22 に `aria-pressed` から直した）。
 * 3つとも押し直しても外れない＝必ずどれか1つが選ばれているので、
 * 「押されています／押されていません」は嘘になる。マイページのタブを
 * 同じ理由で直したのと同じ形（PM の指示: 排他の切り替えは `role="tab"`、
 * 入り切りは `role="switch"`。3つ目の表現を作らない）。
 */
const tab = (name: string) => screen.getByRole("tab", { name });
const pressed = (name: string) => tab(name).getAttribute("aria-selected") === "true";
/** トップのカードに並んでいる写真（グリッドではない） */
const cardIds = () => Array.from(document.querySelectorAll("[data-card]")).map((el) => el.getAttribute("data-card"));

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    photosState.photos = PHOTOS;
    gridProps.ids = null;
    window.history.replaceState({}, "", "/");
});

describe("トップの おすすめ / フォロー中 / 新着", () => {
    it("おすすめが1枚も無ければ、既定は「新着」（空のタブを最初に見せない）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("新着")).toBe(true));
        expect(cardIds()).toEqual(["mine-1", "theirs", "mine-2"]);
        expect(new URLSearchParams(window.location.search).get("scope")).toBeNull();
    });

    it("おすすめが在れば、ログイン中の既定は「おすすめ」", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("おすすめ")).toBe(true));
        expect(screen.getByRole("heading", { name: "おすすめ" })).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).get("scope")).toBe("featured");
    });

    it("押したタブに留まる（既定へ戻されない）", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("おすすめ")).toBe(true));
        fireEvent.click(tab("新着"));
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("新着"), "押したのに既定へ戻している").toBe(true);
    });

    it("「フォロー中」はタイムラインを出す（グリッドも絞り込みも出さない）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("新着")).toBe(true));
        fireEvent.click(tab("フォロー中"));
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
        expect(screen.queryByTestId("filter-bar"), "トップに絞り込みを出している").toBeNull();
        expect(screen.queryByTestId("grid")).toBeNull();
        expect(new URLSearchParams(window.location.search).get("scope")).toBe("following");
    });

    // 🔴 **トップに絞り込みとグリッドは出さない**（「さがす」の持ち場）
    it("トップは写真の並び（HomeMosaic）。絞り込みもグリッドも出さない", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(cardIds().length).toBeGreaterThan(0));
        expect(screen.queryByTestId("filter-bar")).toBeNull();
        expect(screen.queryByTestId("grid")).toBeNull();
    });

    it("「さがす」面では絞り込みとグリッドを出す（カードは出さない）", async () => {
        render(<GalleryPageClient surface="search" />);
        await waitFor(() => expect(screen.getByTestId("grid")).toBeInTheDocument());
        expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
        expect(cardIds()).toEqual([]);
        expect(screen.queryByRole("button", { name: "おすすめ" }), "さがすにタブを出している").toBeNull();
    });

    it("URL がタブを指定していれば、既定で上書きしない", async () => {
        window.history.replaceState({}, "", "/?scope=following");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("フォロー中")).toBe(true);
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
    });

    // 共有リンク・通知は写真を名指ししている。タブを倒すと、その1枚が
    // そのタブに無い場合に絞りを外す往復（トースト付き）になる
    it("?photo= で来た人はタブを倒さない", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        window.history.replaceState({}, "", "/?photo=theirs");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(pressed("新着")).toBe(true);
    });

    it("認証の判定中は倒さず、確定してから既定にする", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        const { rerender } = render(<GalleryPageClient />);
        expect(pressed("新着"), "判定中に倒している").toBe(true);
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        rerender(<GalleryPageClient />);
        await waitFor(() => expect(pressed("おすすめ")).toBe(true));
    });

    // 🔴 レビューが指摘した形（`mine` の頃）。開いている写真があるときは倒さない
    // ——倒すと**開いている写真の下で一覧が入れ替わる**（`setFilters` は
    // `currentIndex` を触らない）
    it("写真を開いている最中に認証が確定しても、タブを倒さない", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        authState.current = { isAuthenticated: false, userId: null, loading: true };
        const { rerender } = render(<GalleryPageClient surface="search" />);
        act(() => { expect(gridProps.open!("theirs")).toBe(true); });
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
        authState.current = { isAuthenticated: true, userId: "me", loading: false };
        rerender(<GalleryPageClient surface="search" />);
        await new Promise((r) => setTimeout(r, 30));
        expect(new URLSearchParams(window.location.search).get("scope"),
            "開いている写真の下で一覧を入れ替えている").toBeNull();
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
    });

    // フォロー中の面はグリッドではないので、名指しの写真は「新着」へ外してから開く
    // （フィードの上にモーダルを重ねない）
    it("「フォロー中」で ?photo= が届いたら、「新着」へ外して開く", async () => {
        window.history.replaceState({}, "", "/?scope=following");
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.getByTestId("timeline-feed")).toBeInTheDocument();
        window.history.pushState({}, "", "/?scope=following&photo=theirs");   // 通知からの遷移
        await waitFor(() => expect(pressed("新着")).toBe(true));
        expect(screen.queryByTestId("timeline-feed")).toBeNull();
        expect(new URLSearchParams(window.location.search).get("photo")).toBe("theirs");
    });

    // **「おすすめ」は未ログインでも見られる**（運営が選んだ写真で、誰が見ても同じ）。
    // 戻すのは「フォロー中」だけ——ここを全部戻していたので、未ログインの人は
    // 押しても弾かれていた
    it("未ログインでも「おすすめ」は見られる。「フォロー中」だけ戻す", async () => {
        photosState.photos = [{ ...PHOTOS[1], featured: true }, PHOTOS[0]];
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 30));
        fireEvent.click(tab("おすすめ"));
        await waitFor(() => expect(pressed("おすすめ")).toBe(true));
        expect(screen.getByRole("heading", { name: "おすすめ" })).toBeInTheDocument();
    });

    it("未ログインが ?scope=following で来ても、そこには留めない", async () => {
        authState.current = { isAuthenticated: false, userId: null, loading: false };
        window.history.replaceState({}, "", "/?scope=following");
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("新着")).toBe(true));
        expect(new URLSearchParams(window.location.search).get("scope"),
            "未ログインに following が残っている").toBeNull();
    });

    it("知らないタブの値は無視する", async () => {
        window.history.replaceState({}, "", "/?scope=mine");
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("新着")).toBe(true));
    });

    it("おすすめが1枚も選ばれていなくても空にしない（全部の写真を「おすすめ」の並びで出す・iOS と同じ）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(pressed("新着")).toBe(true));
        fireEvent.click(tab("おすすめ"));
        await waitFor(() => expect(pressed("おすすめ")).toBe(true));
        expect(screen.queryByText("まだおすすめは選ばれていません。")).toBeNull();
        // いいねが全部 0 なら投稿の新しい順（この固定データは撮影日＝投稿日なので新着と同じ）
        expect(cardIds()).toEqual(["mine-1", "theirs", "mine-2"]);
    });
});

/**
 * 🔴 **タブの作法（WAI-ARIA の tabs）。**
 *
 * 直す前は `role="group"` ＋ `aria-pressed` のボタン3つだった。
 * `aria-pressed` は「押して入り切りする」という意味だが、この3つは
 * **押し直しても外れない**——必ずどれか1つが選ばれている。読み上げは
 * 「押されていません」と言うのに外す手段が無い、という嘘になる。
 *
 * PM の線（2026-09-22）:「入り切りは `role="switch"`、排他の切り替えは
 * `role="tab"`。**3つ目の表現を作らない**」。マイページのタブを同じ理由で
 * 直してあるので、そちらに揃える。
 */
describe("ホームのタブの作法", () => {
    it("tablist の中の tab で、選んでいる1つだけ aria-selected", () => {
        render(<GalleryPageClient />);
        const list = screen.getByRole("tablist");
        expect(list, "tablist が無い").toBeInTheDocument();
        const tabs = screen.getAllByRole("tab");
        expect(tabs).toHaveLength(3);
        expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true"), "選択中が1つではない").toHaveLength(1);
        // 入り切りの意味を持つ `aria-pressed` は残っていない
        for (const t of tabs) expect(t.hasAttribute("aria-pressed"), "aria-pressed が残っている").toBe(false);
    });

    it("roving tabindex（Tab の止まり先は選んでいるタブだけ）", () => {
        render(<GalleryPageClient />);
        const tabs = screen.getAllByRole("tab");
        for (const t of tabs) {
            const selected = t.getAttribute("aria-selected") === "true";
            expect(t.getAttribute("tabindex"), `${t.textContent}: roving tabindex になっていない`)
                .toBe(selected ? "0" : "-1");
        }
    });

    it("aria-controls の行き先が実在する（tabpanel）", () => {
        render(<GalleryPageClient />);
        const id = screen.getAllByRole("tab")[0].getAttribute("aria-controls");
        expect(id, "aria-controls が無い").toBeTruthy();
        const panel = document.getElementById(id!);
        expect(panel, `aria-controls の行き先（#${id}）が無い`).not.toBeNull();
        expect(panel!.getAttribute("role"), "tabpanel になっていない").toBe("tabpanel");
        // 面は選んでいるタブに名前を借りる
        const labelled = panel!.getAttribute("aria-labelledby");
        expect(document.getElementById(labelled ?? ""), "面の名前の出どころが無い").not.toBeNull();
    });

    it("矢印キーで隣のタブへ動き、端で折り返す", () => {
        render(<GalleryPageClient />);
        // 未ログインの既定は「新着」（一覧の最後）
        const start = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!;
        fireEvent.keyDown(start, { key: "ArrowRight" });
        // 端なので先頭（おすすめ）へ折り返す
        expect(pressed("おすすめ"), "右端から先頭へ折り返さない").toBe(true);
        fireEvent.keyDown(screen.getByRole("tab", { name: "おすすめ" }), { key: "ArrowLeft" });
        expect(pressed("新着"), "左端から末尾へ折り返さない").toBe(true);
        fireEvent.keyDown(screen.getByRole("tab", { name: "新着" }), { key: "Home" });
        expect(pressed("おすすめ"), "Home で先頭へ行かない").toBe(true);
    });
});
