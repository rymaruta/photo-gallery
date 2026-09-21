import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **「色でさがす」の配線。** PR #72 の積み残し3件がここで消えていることを、
 * 部品単体ではなく `GalleryPageClient` を描いて見る:
 *
 * 1. 写真の取得（`usePhotos`）は**1回**。以前は `/search` の上に独立して
 *    置いていたので2回飛んでいた
 * 2. 色のグリッドも下のグリッドも**同じ `openById`** で開く。以前は色の側に
 *    渡しておらず、ビルド後の写真を押すとトップへ遷移していた
 * 3. 色の内訳は**絞り込み後の一覧**で数える。以前は全写真で数えていたので、
 *    下が絞り込まれていても上は39枚ぶん出ていた
 *
 * ついでに「さがす」の面にしか出ないこと（ホームは1列カードで、色の
 * グリッドを置く場所が無い）。
 */
const mockShowToast = vi.hoisted(() => vi.fn());
const usePhotosCalls = vi.hoisted(() => ({ n: 0 }));
const grids = vi.hoisted(() => ({ list: [] as { count: number; open?: (id: string) => boolean }[] }));

vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { ...ja, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
// **グリッドは描かず、何を受け取ったかだけ控える。** 色のグリッドと下の
// グリッドの両方がここを通るので、`open` の同一性を突き合わせられる
vi.mock("../components/GalleryGrid", () => ({
    default: (p: { photos: { id: string }[]; onOpenPhoto?: (id: string) => boolean }) => {
        grids.list.push({ count: p.photos.length, open: p.onOpenPhoto });
        return <div data-testid="grid" data-count={p.photos.length} />;
    },
}));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("../components/TimelineCard", () => ({ default: () => <div data-testid="card" /> }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// 青3枚（うち landscape 2枚）・黒2枚（architecture）。全部 2026 年で並びは気にしない
const PHOTOS = [
    { id: "b1", src: "https://cdn/b1.jpg", title: "青1", category: "landscape", tags: [], createdAt: "2026-01-01", dominantColor: "#0000ff" },
    { id: "b2", src: "https://cdn/b2.jpg", title: "青2", category: "landscape", tags: [], createdAt: "2026-01-02", dominantColor: "#0000ee" },
    { id: "b3", src: "https://cdn/b3.jpg", title: "青3", category: "travel", tags: [], createdAt: "2026-01-03", dominantColor: "#1133dd" },
    { id: "k1", src: "https://cdn/k1.jpg", title: "黒1", category: "architecture", tags: [], createdAt: "2026-01-04", dominantColor: "#000000" },
    { id: "k2", src: "https://cdn/k2.jpg", title: "黒2", category: "architecture", tags: [], createdAt: "2026-01-05", dominantColor: "#111111" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => { usePhotosCalls.n += 1; return { photos: PHOTOS, loaded: true, failed: false }; },
}));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    usePhotosCalls.n = 0;
    grids.list = [];
    window.history.replaceState({}, "", "/search");
});

describe("色でさがす の配線（さがす の面）", () => {
    it("出る。ホームには出ない", () => {
        const { unmount } = render(<GalleryPageClient surface="search" />);
        expect(screen.getByRole("heading", { level: 2, name: "色でさがす" })).toBeTruthy();
        unmount();
        render(<GalleryPageClient surface="home" />);
        expect(screen.queryByRole("heading", { level: 2, name: "色でさがす" }), "ホームに色の節が出ている").toBeNull();
    });

    it("写真の取得は1回（部品が自分で取りに行っていない）", () => {
        render(<GalleryPageClient surface="search" />);
        // React は描画を何度か走らせるので「呼び出し回数」ではなく
        // **フックを持つ部品が1つ**であることを見る——2つ動いていた頃は
        // 描画1回あたり2回ずつ呼ばれた。StrictMode は無いので偶数倍にならない
        expect(usePhotosCalls.n, "usePhotos を呼ぶ部品が増えている").toBeLessThanOrEqual(2);
        expect(usePhotosCalls.n).toBeGreaterThan(0);
    });

    it("色のグリッドも下のグリッドも、同じ openById で開く", () => {
        render(<GalleryPageClient surface="search" />);
        // 下のグリッド（5枚）が最後に受け取った open。**控えを消さない**——
        // チップを押しても `GalleryPageClient` は描き直らない（状態は部品の中）
        // ので、下のグリッドはもう一度は描かれない
        const main = [...grids.list].reverse().find((g) => g.count === 5);
        expect(main, "下のグリッドが描かれていない").toBeTruthy();
        const before = grids.list.length;
        fireEvent.click(screen.getByRole("button", { name: /青/ }));
        const color = grids.list.slice(before).find((g) => g.count === 3);
        expect(color, "色を選んだのに青3枚のグリッドが描かれていない").toBeTruthy();
        expect(typeof color!.open, "色のグリッドに onOpenPhoto を渡していない").toBe("function");
        expect(color!.open, "色のグリッドと下のグリッドで開き方が違う").toBe(main!.open);
    });

    it("色の内訳は、絞り込み後の一覧で数える", () => {
        // `?category=landscape` で下の一覧を2枚に絞る → 青は2枚・黒は0枚（チップごと消える）
        window.history.replaceState({}, "", "/search?category=landscape");
        render(<GalleryPageClient surface="search" />);
        expect(screen.getByRole("button", { name: "青 (2)" }), "全写真で数えている（青3）").toBeTruthy();
        expect(screen.queryByRole("button", { name: /黒/ }), "絞り込みで外れた黒が残っている").toBeNull();
    });

    it("絞り込みが無ければ全部で数える（青3・黒2）", () => {
        render(<GalleryPageClient surface="search" />);
        expect(screen.getByRole("button", { name: "青 (3)" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "黒 (2)" })).toBeTruthy();
    });
});
