import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ja } from "../i18n/labels";
import { MOSAIC_HERO_SIZES } from "../components/gridSizes";

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

// **機材も入れておく。** 入れないと柱の「機材からさがす」の節が
// 丸ごと出ず（データが無い節は描かない）、その節の見出しのリンクも
// 一緒に消える＝見張りが空回りする
const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "landscape", location: "東京", tags: ["旅"], date: "2026-01-01", createdAt: "2026-01-01", exif: { camera: "SONY ILCE-7M3" } },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "landscape", location: "東京", tags: ["旅"], date: "2026-01-02", createdAt: "2026-01-02", exif: { camera: "SONY ILCE-7M3" } },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    window.history.replaceState({}, "", "/");
    // **毎回まっさらにする。** 残したままだと、`GalleryGrid` が丸ごと
    // 描かれなくなっても前のテストが置いた値で下の検査が通る
    gridProps.sizes = "";
    gridProps.columns = undefined;
});

describe("PC の設計（指示書 4・11・17）", () => {
    describe("ホーム", () => {
        it("🔴 PC では1列のフィードの右に柱が立つ（横に引き伸ばさない）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const aside = container.querySelector("main aside");
            expect(aside, "PC の柱が無い＝1列のまま横に伸びる").not.toBeNull();
            // 柱の中身は発見の節（`DiscoverRail`）。**行き先では探さない**
            // ——行き先は別のテストが見ている項目で、ここで `href` を当てにすると
            // 2つの性質が1つのテストに混ざる。
            //
            // ⚠️ 目印は 2026-09-23 に更新した（節の名前が「写真の多い撮影地」→
            // 「撮影地からさがす」に変わったため）。**更新後もこの判定が効くこと**
            // ——柱を空にすると落ちる——を変異で確かめてある。
            expect(aside!.textContent, "柱に発見の節が入っていない").toContain("撮影地からさがす");
            expect(aside!.textContent, "カテゴリの節が入っていない").toContain("カテゴリからさがす");
            expect(aside!.querySelectorAll("a").length, "柱にリンクが無い").toBeGreaterThan(0);
        });

        it("🔴 柱は狭い画面には出さない（スマホはモックのまま）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const aside = container.querySelector("main aside")!;
            expect(aside.className, "狭い画面にも柱が出る").toContain("hidden");
            expect(aside.className, "PC で柱が出ない").toContain("lg:block");
        });

        it("🔴 柱の高さは画面に収める（貼り付いたまま画面より高いと、下の節に届く手段が無い）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const aside = container.querySelector("main aside")!;
            expect(aside.className, "画面より高くなっても切り上げない").toContain("lg:max-h-");
            expect(aside.className, "はみ出したぶんを送れない").toContain("lg:overflow-y-auto");
        });

        it("🔴 フィードは 40rem で止める（`1fr` にしない・`MOSAIC_HERO_SIZES` と対）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const shell = container.querySelector("main aside")!.parentElement!;
            expect(shell.className, "PC の2カラムになっていない").toContain("lg:grid");
            // **`1fr` にしない**——伸ばすと並びの `sizes` が嘘になる。
            // 640px は `Thumb` の派生（512w）から引いた線で、
            // `SPOT_HERO_SIZES` が 640px に止めているのと同じ理由
            expect(shell.className, "フィードの上限が 40rem ではない").toContain("40rem");
            expect(MOSAIC_HERO_SIZES, "`sizes` を対で動かしていない").toContain("40rem");
        });

        it("🔴 柱を押したら「さがす」の検索結果へ行く（集約ページではない）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            // **節の項目だけを見る。** 見出しの「すべて見る ›」は索引ページ
            // （`/category` `/location` `/camera`）へ向ける——**トップから
            // 集約ページへ渡す唯一の1本**で、これが無いと `/search` が
            // `robots.txt` で `Disallow` なぶん、トップはリンクを1本も渡さない
            // （2026-09-22 に実ビルドで 0本 と数えた）。
            // 見出しの行き先は下の「索引ページへ行ける」で別に縛る
            const all = [...container.querySelectorAll("main aside a")].map((a) => a.getAttribute("href") ?? "");
            // **タグの節は例外**: 検索に載るタグページ（`/tag/<slug>`）へ直接張る
            // （集約ページへの内部リンクそのものが目的・`DiscoverRail` の注記）
            const links = all.filter((h) => !/^\/(category|location|camera)$/.test(h) && !/^\/tag\/[^/]+$/.test(h));
            expect(links.length, "柱にリンクが無い").toBeGreaterThan(0);
            for (const href of links) {
                expect(href, `集約ページのままになっている: ${href}`).toMatch(/^\/search\?/);
            }
            // カテゴリは専用の絞り込み、撮影地は `?q=`（`useGallery` が読む形）
            expect(links.some((h) => h.startsWith("/search?category=")), "カテゴリの絞り込みに載っていない").toBe(true);
            expect(links.some((h) => h.startsWith("/search?q=")), "撮影地・機材が検索語に載っていない").toBe(true);
        });

        /**
         * 🔴 **トップから集約ページへ渡る1本。**
         *
         * 実ビルド（151 HTML・2026-09-22）で数えると、トップ →
         * `/category/*` `/location/*` `/camera/*` は **0本**だった。
         * 柱の項目は owner の指示で `/search?…` を向いていて、その
         * `/search` は `robots.txt` で `Disallow`＝行き止まり。
         * `/tag/*` だけは写真カードのチップで49本あった。
         *
         * **索引ページは実在する**（`app/category/page.tsx` ほか）ので、
         * 「すべて見る」は枠だけではない——`#125` で落とした死にコードと
         * 同じ形に戻っていないことを、ここで縛る。
         */
        it("🔴 節の見出しから索引ページへ行ける（トップ→集約ページの唯一の1本）", () => {
            const { container } = render(<GalleryPageClient surface="home" />);
            const hrefs = [...container.querySelectorAll("main aside a")].map((a) => a.getAttribute("href") ?? "");
            for (const want of ["/category", "/location", "/camera"]) {
                expect(hrefs, `${want} への「すべて見る」が無い`).toContain(want);
            }
            // 文言まで見る（枠だけ置いて押せない形に戻っていないこと）
            expect(container.querySelector("main aside")?.textContent ?? "").toContain("すべて見る");
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
            // 柱のぶん PC でも3列のまま（4列にすると 1024px で1セルがスマホより小さくなる）
            expect(gridProps.columns, "列数を渡していない").toBe("grid-cols-2 sm:grid-cols-3");
            expect(gridProps.sizes, "容器が変わったのに `sizes` が据え置き").toContain("16.58333rem");
        });

        it("🔴 PC だけ箱を広げる（ヘッダーとずらしすぎない）", () => {
            // 6xl＝写真ページ・集約ページと同じ箱。7xl にするとヘッダー
            //（`max-w-5xl`）と片側128px ずれる
            for (const surface of ["search", "home"] as const) {
                const r = render(<GalleryPageClient surface={surface} />);
                const cls = r.container.querySelector("main")!.className;
                expect(cls, `${surface}: 狭い画面の箱が変わっている`).toContain("max-w-5xl");
                expect(cls, `${surface}: PC で広げていない`).toContain("lg:max-w-6xl");
                expect(cls, `${surface}: ヘッダーより広げすぎ`).not.toContain("max-w-7xl");
                r.unmount();
            }
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
