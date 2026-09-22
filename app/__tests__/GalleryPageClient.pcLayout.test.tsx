import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ja } from "../i18n/labels";

/**
 * **PC は別設計**（owner の指示書 4・11・17:「PCではスマートフォン画面を
 * そのまま横に引き伸ばすのではなく、Webサイトとして最適なレイアウトを
 * 設計してください」）。ホームと「さがす」に入れたのは:
 *
 * | 画面 | < 1024px | ≥ 1024px |
 * |---|---|---|
 * | ホーム | 1列のカード（最終版モック） | 1列のカード ＋ **右に発見の柱** |
 * | さがす | 絞り込み → 発見の節 → 結果 | **左に絞り込みの柱**／右に写真の面 |
 *
 * ⚠️ **jsdom はメディアクエリを解かない**ので、ここで見られるのは
 * 「どういう木を組んだか」まで。実際の幅は Chromium で測ってある
 * （台帳の「PC の設計を入れた」の節に実測表）。だから
 * **クラス名そのものを見る**——`lg:` が落ちればこのテストが落ちる。
 */
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// **`GalleryGrid` は本物を使わない**が、`sizes` と列数は受け取って覚える
// ——この2つは対で変えないといけない（`gridSizes.ts`）
const gridProps = vi.hoisted(() => ({ sizes: "", columns: undefined as string | undefined }));
vi.mock("../components/GalleryGrid", () => ({
    default: (p: { sizes: string; columnsClassName?: string }) => {
        gridProps.sizes = p.sizes;
        gridProps.columns = p.columnsClassName;
        return <div data-testid="grid" />;
    },
}));

const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "landscape", location: "東京", tags: ["旅"], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "landscape", location: "東京", tags: ["旅"], date: "2026-01-02", createdAt: "2026-01-02" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => { mockShowToast.mockReset(); window.history.replaceState({}, "", "/"); });

describe("PC の設計（指示書 4・11・17）", () => {
    describe("ホーム", () => {
        it("🔴 PC では1列のフィードの右に柱が立つ（横に引き伸ばさない）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const aside = container.querySelector("main aside");
            expect(aside, "PC の柱が無い＝1列のまま横に伸びる").not.toBeNull();
            // 柱の中身は「さがす」の発見の節（同じものを二度作らない）
            expect(aside!.querySelector('a[href*="/location/"]'), "柱に発見の節が入っていない").not.toBeNull();
        });

        it("🔴 柱は狭い画面には出さない（スマホはモックのまま）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const aside = container.querySelector("main aside")!;
            expect(aside.className, "狭い画面にも柱が出る").toContain("hidden");
            expect(aside.className, "PC で柱が出ない").toContain("lg:block");
        });

        it("🔴 カードの箱は広げない（`FEED_SIZES_XL` は 36rem で頭打ち）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const shell = container.querySelector("main aside")!.parentElement!;
            expect(shell.className, "PC の2カラムになっていない").toContain("lg:grid");
            // 左は 36rem（576px）で止める。**`1fr` にしない**——伸ばすと
            // カードの `sizes` が嘘になる
            expect(shell.className).toContain("36rem");
        });
    });

    describe("さがす", () => {
        it("🔴 PC では絞り込みが左の柱になり、画面に貼り付く", () => {
            const { container } = render(<GalleryPageClient surface="search" />);
            const bar = container.querySelector("main section")!;      // FilterBar
            const rail = bar.parentElement!;
            expect(rail.className, "絞り込みが貼り付かない＝結果を送ると画面から消える").toContain("lg:sticky");
            expect(rail.parentElement!.className, "PC の2カラムになっていない").toContain("lg:grid");
        });

        it("🔴 グリッドの `sizes` と列数は対で「さがす」用のものを渡す", () => {
            render(<GalleryPageClient surface="search" />);
            // 柱のぶん lg は3列のまま（4列にすると 1024px で1セルがスマホより小さくなる）
            expect(gridProps.columns, "列数を渡していない").toBe("grid-cols-2 sm:grid-cols-3 xl:grid-cols-4");
            expect(gridProps.sizes, "容器が変わったのに `sizes` が据え置き").toContain("14.34375rem");
        });

        it("🔴 PC だけ箱を広げる（トップは広げない）", () => {
            const search = render(<GalleryPageClient surface="search" />);
            expect(search.container.querySelector("main")!.className).toContain("lg:max-w-7xl");
            search.unmount();
            const home = render(<GalleryPageClient surface="home" />);
            expect(home.container.querySelector("main")!.className, "トップまで広げている").not.toContain("max-w-7xl");
        });
    });

    describe("見出し", () => {
        it("🔴 「さがす」の見出しはトップと別の文", () => {
            const home = render(<GalleryPageClient surface="home" />);
            const homeH1 = [...home.container.querySelectorAll("h1")].map((h) => h.textContent);
            home.unmount();
            render(<GalleryPageClient surface="search" />);
            const searchH1 = [...screen.getAllByRole("heading", { level: 1 })].map((h) => h.textContent);
            expect(searchH1[0], "トップと同じ見出しを名乗っている").not.toBe(homeH1[0]);
            expect(searchH1[0]).toBe("写真をさがす");
        });

        it("サイトの一言（`subtitle`）はトップにだけ置く", () => {
            const { container } = render(<GalleryPageClient surface="search" />);
            expect(container.querySelector("#site-subtitle"), "「さがす」にサイトの看板が出ている").toBeNull();
        });
    });
});
