import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";

/**
 * 撮影スポット詳細の画面。
 *
 * ここで固定したいのは4つ:
 *
 *  1. **クチコミの欄を置かない**（投稿する口も裁く仕組みも無い）
 *  2. **タブは3つとも DOM に在る**——`/location/*` は検索に載っている
 *     ページなので、切り替えで本文が HTML から消えてはいけない
 *  3. **無い情報を作らない**——撮影時期が無ければ「—」。推測で埋めない
 *  4. **`geoApprox` を正確な GPS と区別する**
 */
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
// グリッドの中身はここの関心ではない（`GalleryGrid.test.tsx` が見る）
vi.mock("../GalleryGrid", () => ({
    default: ({ photos }: { photos: Array<{ id: string }> }) => (
        <div data-testid="grid">{photos.map((p) => <span key={p.id}>{p.id}</span>)}</div>
    ),
}));

import SpotPageClient from "../SpotPageClient";

/**
 * **`ToastProvider` の中で描く。** 保存ボタンが `useToast` を使うため。
 * 本番では `app/layout.tsx` が全ページを包んでいる（そこを外すと
 * どの画面でも同じ例外になるので、ここで包むのは筋が通っている）。
 */
const render = (ui: React.ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

const base = {
    slug: "パリ",
    name: "パリ",
    heading: "パリの写真",
    description: "パリで撮影した旅の写真3枚を掲載。",
    breadcrumb: "撮影地: パリ",
    photos: [{ id: "p1" }, { id: "p2" }] as never,
    nearbyPhotos: [] as never,
    facts: { photoCount: 2, photographerCount: 1, period: null, cameras: [], tags: [] },
    coords: null,
    broader: [],
    narrower: [],
    nearby: [],
    related: [],
};

beforeEach(() => { vi.clearAllMocks(); });

describe("撮影スポット詳細", () => {
    it("見出しにスポット名が出る", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("パリの写真");
    });

    // **クチコミは作らない。** 投稿する口も、荒れたものを裁く仕組みも
    // 持っていないのに枠だけ置くと、0件のまま残るか誰も見ない投稿欄になる
    it("タブは 概要／写真／地図 の3つだけ（クチコミを置かない）", () => {
        render(<SpotPageClient {...base} />);
        const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
        expect(tabs).toEqual(["概要", "写真", "地図"]);
        expect(screen.queryByText(/クチコミ|レビュー|口コミ/)).toBeNull();
    });

    /**
     * **3つとも DOM に在る。** 切り替えで差し替えると、静的HTMLには
     * その時のタブの中身しか出ない（検索に載っているページ）。
     */
    it("選んでいないタブの中身も DOM に残る（hidden で隠すだけ）", () => {
        render(<SpotPageClient {...base} />);
        for (const key of ["overview", "photos", "map"]) {
            expect(document.getElementById(`spot-panel-${key}`), `spot-panel-${key} が無い`).not.toBeNull();
        }
        // 既定は「写真」——今まで見えていたものを保つ
        expect(document.getElementById("spot-panel-photos")!.hidden).toBe(false);
        expect(document.getElementById("spot-panel-overview")!.hidden).toBe(true);
    });

    it("タブを押すと切り替わる", () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(screen.getByRole("tab", { name: "概要" }));
        expect(document.getElementById("spot-panel-overview")!.hidden).toBe(false);
        expect(document.getElementById("spot-panel-photos")!.hidden).toBe(true);
    });

    /**
     * **`role="tablist"` を名乗るなら、矢印キーで動けること。**
     *
     * 名乗るだけだと、読み上げは「タブ 1/3」と案内するのに矢印が効かない
     * ——案内された通りに操作できない方が、ただのボタンの並びより悪い。
     */
    it("矢印キーで移れて、移った先にフォーカスが行く（端は折り返す）", () => {
        render(<SpotPageClient {...base} />);
        const list = screen.getByRole("tablist");
        // 既定は「写真」（真ん中）
        fireEvent.keyDown(list, { key: "ArrowRight" });
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "地図" }));
        expect(document.getElementById("spot-panel-map")!.hidden).toBe(false);
        // 端で折り返す
        fireEvent.keyDown(list, { key: "ArrowRight" });
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "概要" }));
        fireEvent.keyDown(list, { key: "ArrowLeft" });
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "地図" }));
        fireEvent.keyDown(list, { key: "Home" });
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "概要" }));
        fireEvent.keyDown(list, { key: "End" });
        expect(document.activeElement).toBe(screen.getByRole("tab", { name: "地図" }));
    });

    /**
     * **関係ないキーは飲まない。**
     *
     * roving tabindex なので、tablist の中で Tab の停止点は選ばれている
     * 1つだけ。ここで `Tab` を飲むと、**キーボードだけで操作する人が
     * タブの並びから出られない**。
     *
     * `e.preventDefault()` を「移る先が決まったときだけ」撃つ、という条件を
     * 見張るテストが**どこにも無かった**——`preventDefault()` を判定の
     * 前に移すという、ごく起こりやすい書き換えで25件が全部緑になる。
     * `fireEvent.keyDown` は `preventDefault()` が呼ばれると `false` を返す。
     */
    it("関係ないキーは飲まない（矢印だけ飲む）", () => {
        render(<SpotPageClient {...base} />);
        const list = screen.getByRole("tablist");
        for (const key of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown", "Escape"]) {
            expect(fireEvent.keyDown(list, { key }), `${key} を飲んでいる`).toBe(true);
        }
        // 矢印・Home/End は飲む（矢印での横スクロールを起こさない）
        for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            expect(fireEvent.keyDown(list, { key }), `${key} を飲んでいない`).toBe(false);
        }
    });

    // roving tabindex: Tab で止まるのは選ばれている1つだけ
    it("Tab で止まるのは選ばれているタブだけ", () => {
        render(<SpotPageClient {...base} />);
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    });

    // **無い情報を作らない。** 0 や推測で埋めず「—」と書く
    it("撮影時期が無ければ「—」（勝手に埋めない）", () => {
        render(<SpotPageClient {...base} />);
        const overview = document.getElementById("spot-panel-overview")!;
        const term = within(overview).getByText("撮影時期");
        expect(term.parentElement!.textContent).toContain("—");
    });

    it("撮影時期があれば範囲で出す", () => {
        render(<SpotPageClient {...base} facts={{ ...base.facts, period: { from: "2023-05-01", to: "2024-10-12" } }} />);
        const overview = document.getElementById("spot-panel-overview")!;
        expect(within(overview).getByText("撮影時期").parentElement!.textContent).toMatch(/2023.*〜.*2024/);
    });

    /**
     * **カメラのチップの飛び先は、スラッグでなければならない。**
     *
     * `collectionPath` は正規化しない（デコードして1回エンコードするだけ）。
     * 生の機種名を渡していたので `/camera/SONY%20ILCE-7M3` を出していたが、
     * 実体は `out/camera/sony-ilce-7m3.html`——`dynamicParams = false` の
     * 静的書き出しなので、**カメラのチップが出る全ページでハード404**
     * （実ビルドの `out/location/パリ.html` で確認した）。
     */
    it("カメラのチップは、生の機種名ではなくスラッグへ飛ぶ", () => {
        render(<SpotPageClient {...base} facts={{ ...base.facts, cameras: [{ name: "SONY ILCE-7M3", count: 2 }] }} />);
        // チップは概要タブの中。既定は「写真」なので開いてから見る
        fireEvent.click(screen.getByRole("tab", { name: "概要" }));
        const link = screen.getByRole("link", { name: /SONY ILCE-7M3/ });
        expect(link.getAttribute("href")).toBe("/camera/sony-ilce-7m3");
        expect(link.getAttribute("href")).not.toContain("%20");
    });

    it("所在地は、渡された広い撮影地だけを出す（国名を当てに行かない）", () => {
        // **`rerender` は使わない**——`ToastProvider` の包みが外れる
        const { unmount } = render(<SpotPageClient {...base} />);
        expect(screen.queryByText("フランス")).toBeNull();
        unmount();
        render(<SpotPageClient {...base} broader={[{ label: "フランス", count: 4, path: "/location/%E3%83%95" }]} />);
        expect(screen.getByRole("link", { name: "フランス" })).toBeTruthy();
    });

    /**
     * **所在地を `/` 区切りの住所のようには描かない。**
     *
     * 一度そう描いていたが、この並びは**広い順であることを保証できない**
     * ——`photoIsInLocation` は字の包含なので `"パリ"` と `"フランス"` は
     * 互いに含まず、どちらが広いかをこのデータは知らない。住所の形に
     * 描くと、知らない順序を主張することになる（実在する
     * `/location/パリ,-フランス` で「パリ / フランス」と**狭い→広い**に
     * 描かれていた）。
     */
    it("所在地を住所の形（/ 区切り）に描かない", () => {
        render(<SpotPageClient {...base} broader={[
            { label: "パリ", count: 3, path: "/location/p" },
            { label: "フランス", count: 4, path: "/location/f" },
        ]} />);
        const region = screen.getByRole("link", { name: "パリ" }).parentElement!;
        // リンクとリンクの間に区切り記号を置かない
        expect(region.textContent).not.toContain("/");
        // 代わりに、この並びが何なのかを読み上げに伝える
        expect(region.textContent).toContain("この場所を含む撮影地");
    });
});

describe("地図タブ", () => {
    it("座標が無ければ「位置がまだ無い」と言い切る（空の地図を出さない）", () => {
        render(<SpotPageClient {...base} />);
        const map = document.getElementById("spot-panel-map")!;
        expect(map.textContent).toContain("地図に出せる位置がまだありません");
    });

    // **`geoApprox` を正確な GPS と区別する**（`sanitizeCoords` の丸めの断りも出す）
    it("推定の位置なら、そう断る", () => {
        render(<SpotPageClient {...base} coords={{ lat: 48.86, lng: 2.34, approx: true }} />);
        const map = document.getElementById("spot-panel-map")!;
        expect(map.textContent).toContain("約1km");
        expect(map.textContent).toContain("地名から引いたおおよその位置");
    });

    it("正確な位置なら「地名から引いた」とは書かない", () => {
        render(<SpotPageClient {...base} coords={{ lat: 48.86, lng: 2.34, approx: false }} />);
        const map = document.getElementById("spot-panel-map")!;
        expect(map.textContent).toContain("約1km");
        expect(map.textContent).not.toContain("地名から引いた");
    });
});

describe("周辺のスポット", () => {
    const nearby = [
        { label: "ヴェルサイユ", count: 2, path: "/location/v", km: 17.3, approx: true },
        { label: "山中湖", count: 2, path: "/location/y", km: 0.8, approx: false },
    ];

    it("渡された順（距離順）でそのまま並べる", () => {
        render(<SpotPageClient {...base} nearby={nearby} />);
        const list = screen.getByRole("heading", { name: "周辺のスポット" }).parentElement!;
        const labels = within(list).getAllByRole("link").map((a) => a.textContent);
        expect(labels[0]).toContain("ヴェルサイユ");
        expect(labels[1]).toContain("山中湖");
    });

    // **距離の粒度を偽らない。** 元が約1kmに丸めてあるので小数第1位まで。
    // 推定に基づくぶんには「約」を付ける
    it("推定に基づく距離には「約」を付ける", () => {
        render(<SpotPageClient {...base} nearby={nearby} />);
        const list = screen.getByRole("heading", { name: "周辺のスポット" }).parentElement!;
        const links = within(list).getAllByRole("link");
        expect(links[0].textContent).toContain("約17km");
        expect(links[1].textContent).toContain("0.8km");
        expect(links[1].textContent).not.toContain("約");
    });

    it("0件なら節ごと出ない", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.queryByRole("heading", { name: "周辺のスポット" })).toBeNull();
    });
});
