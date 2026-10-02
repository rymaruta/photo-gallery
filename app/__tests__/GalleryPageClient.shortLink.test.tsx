import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **短縮リンク `/?p=<先頭8文字>` を踏んだとき**（2026-10-02・Threads に載せる文の最後のリンク）。
// 一覧と照らして `/?photo=<id>` に置き換え、あとは `?photo=` の経路に任せる。
// 下の注記は元にしたテスト（missingPhoto）のもの。
//
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
const searchParams = vi.hoisted(() => ({ current: "", short: "" }));
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
// 絞り込みを「触る」ためのボタンだけ持つ。値を変えなくても `setFilters` は
// 新しいオブジェクトを作るので、URL の同期がもう一度走る。
//
// **これを押す回は `surface="search"` で描く。** 絞り込みの欄は「さがす」の
// 持ち場になった（トップは1列のカード）。見ている性質は面に依らない
// ——`?photo=` の効果は両方の面で同じものが走る
vi.mock("../components/FilterBar", () => ({
    default: ({ onChange }: { onChange: (v: Record<string, never>) => void }) => (
        <button type="button" onClick={() => onChange({})}>絞り込みを触る</button>
    ),
}));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
// `?photo=` は本来 SearchParamWatcher が親へ渡す。ここではその値を直接注ぐ。
// **本物と同じく「値が変わったら知らせる」形にする**（`[value, onChange]`）。
// deps を `[onChange]` だけにしていたとき、`onChange` が安定な参照なので
// 再描画しても知らせが飛ばず、「戻る」を模せなかった。
// 名前を大文字で始めるのは、中でフックを使う（React のコンポーネント）ため
vi.mock("../components/SearchParamWatcher", () => ({
    default: function MockSearchParamWatcher({ name, onChange }: { name: string; onChange: (v: string | null) => void }) {
        // **名前で分ける**（`?photo=` と `?p=` は別の項目）
        const value = (name === "p" ? searchParams.short : searchParams.current) || null;
        React.useEffect(() => { onChange(value); }, [value, onChange]);
        return null;
    },
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "food", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
    { id: "a0e0e987-4686-437a-a5fd-b6eaa2debd84", src: "https://cdn/c.jpg", title: "う", category: "travel", tags: [], date: "2026-01-03", createdAt: "2026-01-03" },
];
/** API の一覧が届く前かどうか。届く前は静的JSON（＝ここでは PHOTOS）だけ */
const photosState = vi.hoisted(() => ({ extra: [] as Array<Record<string, unknown>>, loaded: true, failed: false }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ photos: [...PHOTOS, ...photosState.extra], loaded: photosState.loaded, failed: photosState.failed }),
}));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    searchParams.current = "";
    searchParams.short = "";
    auth.current = { isAuthenticated: false, userId: null, loading: false };
    photosState.extra = [];
    photosState.loaded = true;
    photosState.failed = false;
    window.history.replaceState({}, "", "/");
});

const photoInUrl = () => new URLSearchParams(window.location.search).get("photo");

describe("短縮リンク /?p=<先頭8文字>", () => {
    it("一覧に1枚当たれば、その写真の ?photo= に置き換える", async () => {
        searchParams.short = "a0e0e987";
        render(<GalleryPageClient />);
        await waitFor(() => expect(photoInUrl()).toBe("a0e0e987-4686-437a-a5fd-b6eaa2debd84"));
        expect(new URLSearchParams(window.location.search).get("p")).toBeNull();
    });

    it("ビルド後の新着写真は、API の一覧が届いてから当てる（先に「無い」と決めない）", async () => {
        photosState.loaded = false;
        searchParams.short = "bbbbbbbb";
        const { rerender } = render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));
        expect(photoInUrl(), "届く前に置き換えている").toBeNull();

        photosState.extra = [{ id: "bbbbbbbb-1111-4222-8333-444444444444", src: "https://cdn/n.jpg", title: "新",
                               category: "travel", tags: [], date: "2026-10-02", createdAt: "2026-10-02" }];
        photosState.loaded = true;
        rerender(<GalleryPageClient />);
        await waitFor(() => expect(photoInUrl()).toBe("bbbbbbbb-1111-4222-8333-444444444444"));
    });

    it("届いても当たらなければ、8文字のまま ?photo= に渡す（黙ってトップを出さない）", async () => {
        searchParams.short = "deadbeef";
        render(<GalleryPageClient />);
        await waitFor(() => expect(photoInUrl()).toBe("deadbeef"));
    });

    it("一覧が取れなかったら8文字を書き込まず、一度だけ知らせて取り直しを待つ", async () => {
        photosState.loaded = false;
        photosState.failed = true;
        searchParams.short = "bbbbbbbb";
        const { rerender } = render(<GalleryPageClient />);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("読み込めませんでした"), "error"));
        expect(photoInUrl(), "一致しえない8文字を ?photo= に固めている").toBeNull();

        // 回線が戻って一覧が届いたら開く（`?p=` が URL から消えていても覚えている）
        searchParams.short = "";
        photosState.extra = [{ id: "bbbbbbbb-1111-4222-8333-444444444444", src: "https://cdn/n.jpg", title: "新",
                               category: "travel", tags: [], date: "2026-10-02", createdAt: "2026-10-02" }];
        photosState.failed = false;
        photosState.loaded = true;
        rerender(<GalleryPageClient />);
        await waitFor(() => expect(photoInUrl()).toBe("bbbbbbbb-1111-4222-8333-444444444444"));
        expect(mockShowToast).toHaveBeenCalledTimes(1);
    });

    // ほかのクエリ（`utm_*` など）は、トップが開いた時点で絞り込みから URL を書き戻すので
    // もともと残らない（`useGallery`）。ここではパスを `/` に決め打ちしないことだけを見る
    it("いまのパスは残し、p だけを photo に替える", async () => {
        window.history.replaceState({}, "", "/search?utm_source=threads&p=a0e0e987");
        searchParams.short = "a0e0e987";
        render(<GalleryPageClient />);
        await waitFor(() => expect(photoInUrl()).toBe("a0e0e987-4686-437a-a5fd-b6eaa2debd84"));
        expect(window.location.pathname).toBe("/search");
        expect(new URLSearchParams(window.location.search).get("p")).toBeNull();
    });

    it("短縮の形でない ?p= には触らない", async () => {
        searchParams.short = "p1";
        render(<GalleryPageClient />);
        await new Promise((r) => setTimeout(r, 20));
        expect(photoInUrl()).toBeNull();
    });
});
