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
// 共有の中身は `share.test.ts` が見る。ここで見たいのは**何を渡したか**
const shareMocks = vi.hoisted(() => ({
    shareUrl: vi.fn(async () => "shared" as const),
    copyToClipboard: vi.fn(async () => true),
    shareToTwitter: vi.fn(),
    shareToLine: vi.fn(),
}));
vi.mock("../../../lib/utils/share", () => shareMocks);
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, loading: false }) }));
/**
 * グリッドの中身はここの関心ではない（`GalleryGrid.test.tsx` が見る）。
 *
 * ただし**受け取った props は出す**——このページが
 * 「その場で開く」を頼んでいるか、頼まれた側が何を返すかは、ここの関心。
 */
vi.mock("../GalleryGrid", () => ({
    default: ({ photos, onOpenPhoto, openInPlace, priorityCount }: {
        photos: Array<{ id: string }>;
        onOpenPhoto?: (id: string) => boolean;
        openInPlace?: boolean;
        priorityCount?: number;
    }) => (
        <div data-testid="grid" data-open-in-place={String(!!openInPlace)} data-priority={String(priorityCount)}>
            {photos.map((p) => (
                <button key={p.id} type="button" onClick={() => { lastOpenResult.value = onOpenPhoto?.(p.id); }}>
                    {p.id}
                </button>
            ))}
            <button type="button" onClick={() => { lastOpenResult.value = onOpenPhoto?.("居ない写真"); }}>
                居ない写真を開く
            </button>
        </div>
    ),
}));
// **ビューアは使い回し**（`GalleryModal`）。あちらの中身は
// `GalleryModal` 自身のテストが見るので、ここでは「開いたか・どれを・
// 送れるか」だけを出す
vi.mock("../GalleryModal", () => ({
    default: ({ photos, currentIndex, onClose, onNext, onPrev }: {
        photos: Array<{ id: string }>; currentIndex: number;
        onClose: () => void; onNext: () => void; onPrev: () => void;
    }) => (
        <div data-testid="modal" data-current={photos[currentIndex]?.id}>
            <button type="button" onClick={onPrev}>前へ</button>
            <button type="button" onClick={onNext}>次へ</button>
            <button type="button" onClick={onClose}>閉じる</button>
        </div>
    ),
}));
/** `onOpenPhoto` の戻り値を試験から覗くための箱 */
const lastOpenResult = vi.hoisted(() => ({ value: undefined as boolean | undefined }));

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
    canonicalUrl: "https://journey-photo.com/location/パリ",
    // **既定は「書かれていない」。** 台帳（`content/spot-master.json`）は
    // owner が書くまで空なので、こちらが本番でいちばん多い姿
    reading: null,
    summary: null,
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
    it("クチコミも評価も置かない", () => {
        const { container } = render(<SpotPageClient {...base} />);
        expect(screen.queryByText(/クチコミ|レビュー|口コミ/)).toBeNull();
        expect(container.textContent).not.toMatch(/[★☆]|評価/);
        // 投稿する口（入力欄）も無い
        expect(container.querySelector("textarea")).toBeNull();
    });

    /**
     * 🔴 **節は隠さない**（2026-09-22・タブを畳んだ）。
     *
     * 元はタブ3つ（概要／写真／地図）で、選ばれていない中身を `hidden` で
     * 隠していた。その形が守っていたのは「**検索に載っているページなので、
     * 本文が HTML から消えてはいけない**」という一点。
     *
     * 節に畳んだので、隠す仕組みごと無くなった。**戻さないための見張り**が
     * これ——`hidden` の節が1つでも現れたら落ちる。
     */
    it("`hidden` で隠している節が1つも無い", () => {
        const { container } = render(<SpotPageClient {...base} />);
        expect(container.querySelectorAll("[hidden]").length).toBe(0);
    });

    /**
     * **3つぶんの中身が、1回の描画で全部在る。**
     *
     * 「タブを押さないと出ない」が無いこと＝静的HTMLに全部載ること。
     * 中身そのもの（統計・写真・地図の案内）で見る——`hidden` の有無だけ
     * だと、中身を条件で出し分ける形に変えたときに素通りする。
     */
    it("概要・写真・地図の中身が、切り替えなしで全部出る", () => {
        const { container } = render(<SpotPageClient {...base} coords={{ lat: 48.86, lng: 2.34, approx: true }} />);
        expect(container.textContent).toContain(base.description);          // 概要
        expect(container.textContent).toContain("撮影時期");                 // 統計
        expect(screen.getByTestId("grid")).toBeTruthy();                     // 写真
        expect(screen.getByRole("link", { name: "撮影地マップを開く" })).toBeTruthy(); // 地図
    });

    // **タブという仕掛けごと持たない。** 残っていると「隠す入れ物」が
    // いつの間にか戻る足場になる
    it("タブの仕掛けを持たない", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.queryAllByRole("tab").length).toBe(0);
        expect(screen.queryByRole("tablist")).toBeNull();
    });

    // **無い情報を作らない。** 0 や推測で埋めず「—」と書く
    it("撮影時期が無ければ「—」（勝手に埋めない）", () => {
        render(<SpotPageClient {...base} />);
        const term = screen.getByText("撮影時期");
        expect(term.parentElement!.textContent).toContain("—");
    });

    it("撮影時期があれば範囲で出す", () => {
        render(<SpotPageClient {...base} facts={{ ...base.facts, period: { from: "2023-05-01", to: "2024-10-12" } }} />);
        expect(screen.getByText("撮影時期").parentElement!.textContent).toMatch(/2023.*〜.*2024/);
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
        // 節を縦に並べたので、チップは最初から見えている（切り替え不要）
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
        expect(screen.getByText(/地図に出せる位置がまだありません/)).toBeTruthy();
    });

    // **`geoApprox` を正確な GPS と区別する**（`sanitizeCoords` の丸めの断りも出す）
    it("推定の位置なら、そう断る", () => {
        const { container } = render(<SpotPageClient {...base} coords={{ lat: 48.86, lng: 2.34, approx: true }} />);
        expect(container.textContent).toContain("約1km");
        expect(container.textContent).toContain("地名から引いたおおよその位置");
    });

    it("正確な位置なら「地名から引いた」とは書かない", () => {
        const { container } = render(<SpotPageClient {...base} coords={{ lat: 48.86, lng: 2.34, approx: false }} />);
        expect(container.textContent).toContain("約1km");
        expect(container.textContent).not.toContain("地名から引いた");
    });
});

describe("周辺のスポット", () => {
    const nearby = [
        { label: "ヴェルサイユ", count: 2, path: "/location/v", km: 17.3, approx: true, cover: null },
        { label: "山中湖", count: 2, path: "/location/y", km: 0.8, approx: false, cover: null },
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

/**
 * ── ヘッダーと代表画像（モック①②・2026-09-22）─────────────
 *
 * ここで固定したいのは「**動かない枠を置かない**」こと。モックの
 * 「1/10」は*送れる*ことが前提の数字で、送れないのに出すと
 * owner の「デザインだけ完成して操作できない画面は作らない」に反する。
 */
describe("撮影スポット詳細: ヘッダーと代表画像", () => {
    it("戻るは `/` へのリンク（`router.back()` を使わない＝サイトの外へ出さない）", () => {
        render(<SpotPageClient {...base} />);
        const back = screen.getByRole("link", { name: "ギャラリーに戻る" });
        expect(back.getAttribute("href")).toBe("/");
    });

    it("共有は canonical を渡す（`window.location` から組み立てない）", async () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(screen.getByRole("button", { name: "共有" }));
        await screen.findByRole("link", { name: "ギャラリーに戻る" });
        expect(shareMocks.shareUrl).toHaveBeenCalledWith(
            "https://journey-photo.com/location/パリ", "パリの写真", base.description,
        );
    });

    // **場所には「相手」が居ない。** 通報・ブロック・非表示は人や投稿への
    // 操作なので、押しても何も起きない項目を並べない
    it("⋯ に出るのは共有の3つだけ（通報・ブロックは出さない）", () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
        expect(items).toEqual(["リンクをコピー", "Xで共有", "LINEで共有"]);
        expect(items.some((t) => (t ?? "").includes("通報"))).toBe(false);
    });

    it("代表画像は1枚目で、押すとその写真へ行ける", () => {
        render(<SpotPageClient {...base} />);
        const link = screen.getByRole("link", { name: "この写真を開く" });
        expect(link.getAttribute("href")).toContain("p1");
    });

    // **「1/N」は実際に動く数字。** 送れないのに出すと、数字が状態ではなく
    // 飾りになる（モック②は「枚数と現在の表示位置」と書いている）
    it("次の写真を押すと 1/2 → 2/2 になり、行き先も入れ替わる", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.getByText("1/2")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
        expect(screen.getByText("2/2")).toBeTruthy();
        expect(screen.getByRole("link", { name: "この写真を開く" }).getAttribute("href")).toContain("p2");
    });

    it("端では折り返す（前の写真で最後の1枚へ）", () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(screen.getByRole("button", { name: "前の写真" }));
        expect(screen.getByText("2/2")).toBeTruthy();
    });

    it("1枚しか無ければ「1/1」も前/次も出さない", () => {
        render(<SpotPageClient {...base} photos={[{ id: "only" }] as never} />);
        expect(screen.getByRole("link", { name: "この写真を開く" })).toBeTruthy();
        expect(screen.queryByText("1/1")).toBeNull();
        expect(screen.queryByRole("button", { name: "次の写真" })).toBeNull();
    });

    it("写真が無ければ代表画像の枠ごと出さない", () => {
        render(<SpotPageClient {...base} photos={[] as never} />);
        expect(screen.queryByRole("link", { name: "この写真を開く" })).toBeNull();
    });
});

/**
 * ── その場で拡大（モック⑧・2026-09-22）──────────────────
 *
 * **2つ目のビューアを作らない**（`GalleryModal` を使い回す）。
 * ここで見たいのは「頼み方」と「開けなかったときに黙らないこと」。
 */
describe("撮影スポット詳細: その場で拡大", () => {
    it("グリッドに「その場で開く」を頼んでいる", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.getByTestId("grid").getAttribute("data-open-in-place")).toBe("true");
    });

    it("最初はビューアを描かない", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.queryByTestId("modal")).toBeNull();
    });

    // **ビューアは後ろへ回してある**（`next/dynamic`）ので、押してすぐには
    // 描かれない。`findBy*` で待つ——同期で見ると、読み込みの速さに
    // 結果が左右されるテストになる
    it("押した写真でビューアが開き、閉じると消える", async () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(within(screen.getByTestId("grid")).getByRole("button", { name: "p2" }));
        expect((await screen.findByTestId("modal")).getAttribute("data-current")).toBe("p2");
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(screen.queryByTestId("modal")).toBeNull();
    });

    it("ビューアの送りは端で折り返す", async () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(within(screen.getByTestId("grid")).getByRole("button", { name: "p1" }));
        await screen.findByTestId("modal");
        fireEvent.click(screen.getByRole("button", { name: "前へ" }));
        expect(screen.getByTestId("modal").getAttribute("data-current")).toBe("p2");
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));
        expect(screen.getByTestId("modal").getAttribute("data-current")).toBe("p1");
    });

    // 🔴 **開けないのに遷移を止めると、タップが無反応になる。**
    // 写真ページへ行く方が、何も起きないよりずっと良い
    /**
     * 🔴 **端末の「戻る」でビューアが閉じる**（ページごと離脱しない）。
     *
     * `/location/*` は検索の着地点。積まないまま開くと、戻るで
     * **サイトの外**（前に見ていた別のサイト）へ出る。
     * 履歴の作法そのものは `useViewerHistory.test.ts` が見る。ここで見るのは
     * **この画面がそれを使っているか**。
     */
    it("戻るでビューアが閉じる（ページごと離脱しない）", async () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(within(screen.getByTestId("grid")).getByRole("button", { name: "p1" }));
        expect(await screen.findByTestId("modal")).toBeTruthy();
        fireEvent(window, new PopStateEvent("popstate"));
        expect(screen.queryByTestId("modal"), "戻るで閉じていない＝ページごと離脱する").toBeNull();
    });

    it("知らない写真なら false を返す（遷移を止めさせない）", () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(screen.getByRole("button", { name: "居ない写真を開く" }));
        expect(lastOpenResult.value).toBe(false);
        expect(screen.queryByTestId("modal")).toBeNull();
    });

    it("見つかった写真では true を返す（その場で開く）", () => {
        render(<SpotPageClient {...base} />);
        fireEvent.click(within(screen.getByTestId("grid")).getByRole("button", { name: "p1" }));
        expect(lastOpenResult.value).toBe(true);
    });
});

/**
 * ── 地図に寄せる・周辺のスポットのカード（モック⑥⑨・2026-09-22）───
 *
 * ⚠️ **コミット済みの `app/data/photos.json` は座標を1件も持たない**
 * （30枚とも）。だから本番で見える姿は**手元のビルドでは出ない**
 * ——ここが唯一「出る側」を固定している場所になる。
 */
describe("撮影スポット詳細: 地図と周辺のスポット", () => {
    const coords = { lat: 35.4234, lng: 138.8765, approx: true };

    // **地図タブは `hidden` で隠れている**（3つとも DOM に残す設計なので、
    // 読み上げの木からは外れる）。既存の地図タブのテストと同じく id で取る
    it("「地図で見る」はこの場所に寄せて開く（#ズーム/緯度/経度）", () => {
        render(<SpotPageClient {...base} coords={coords} />);
        const link = screen.getByRole("link", { name: "撮影地マップを開く" });
        // ズームは PHOTO_LINK_ZOOM（12）。座標は小数4桁（約11m）まで
        expect(link.getAttribute("href")).toBe("/map#12/35.4234/138.8765");
    });

    // **座標が無ければ寄せようがない。** 出すのは素の /map で、
    // 「位置がまだありません」と言い切る側の文面が出る
    it("座標が無ければハッシュを付けない", () => {
        render(<SpotPageClient {...base} coords={null} />);
        const link = screen.getByRole("link", { name: "撮影地マップを開く" });
        expect(link.getAttribute("href")).toBe("/map");
    });

    it("周辺のスポットのカードに、そのスポットの1枚が出る", () => {
        const nearby = [{
            label: "山中湖", count: 2, path: "/location/y", km: 0.8, approx: false,
            cover: { id: "n1", src: "https://x/uploads/n1.jpg", title: "湖", location: "山中湖" },
        }] as never;
        render(<SpotPageClient {...base} nearby={nearby} />);
        const list = screen.getByRole("heading", { name: "周辺のスポット" }).parentElement!;
        expect(within(list).getAllByRole("img").length).toBe(1);
    });

    // **代わりの絵を置かない。** 「写真がある場所」のカードで、持って
    // いない絵を見せることになる
    it("絵を持たないスポットのカードには、絵の枠ごと出さない", () => {
        const nearby = [{ label: "山中湖", count: 2, path: "/location/y", km: 0.8, approx: false, cover: null }] as never;
        render(<SpotPageClient {...base} nearby={nearby} />);
        const list = screen.getByRole("heading", { name: "周辺のスポット" }).parentElement!;
        expect(within(list).queryAllByRole("img").length).toBe(0);
        // 名前・距離・枚数は出る（カードそのものは消さない）
        expect(list.textContent).toContain("山中湖");
        expect(list.textContent).toContain("0.8km");
        expect(list.textContent).toContain("2枚");
    });

    // **評価と♡は出さない**（評価の仕組みが無く、「行きたい」は本人しか
    // 読めない＝公開の集計が無い）。モック⑨には在るが、実データが無い
    it("カードに評価も「行きたい」も出さない", () => {
        const nearby = [{ label: "山中湖", count: 2, path: "/location/y", km: 0.8, approx: false, cover: null }] as never;
        render(<SpotPageClient {...base} nearby={nearby} />);
        const list = screen.getByRole("heading", { name: "周辺のスポット" }).parentElement!;
        expect(list.textContent).not.toMatch(/★|☆|4\.\d|評価/);
        expect(within(list).queryByRole("button")).toBeNull();
    });
});

/**
 * ── ふりがなと概要（モック③⑤・`content/spot-master.json`）─────
 *
 * **owner が書くまで空。** だからいちばん多い姿は「両方 null」で、
 * そのとき**枠ごと出ない**ことがこの節の主眼。
 */
describe("撮影スポット詳細: ふりがなと概要", () => {
    // **「空の行を描く」も出さないうちに入る。** 中身で見ると、
    // `{reading !== undefined && …}` のような変異が**空の `<p>` を描いても
    // 素通りする**（実測でそうなった）。印で見れば、描いた時点で落ちる
    it("書かれていなければ、ふりがなの行を出さない", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.queryByTestId("spot-reading")).toBeNull();
    });

    it("書かれていれば、見出しの下にふりがなが出る", () => {
        render(<SpotPageClient {...base} reading="たかやじんじゃ" />);
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1.nextElementSibling).toBe(screen.getByTestId("spot-reading"));
        expect(screen.getByTestId("spot-reading").textContent).toBe("たかやじんじゃ");
    });

    it("概要は、書かれていれば本文に出る", () => {
        render(<SpotPageClient {...base} summary="雲海に浮かぶ鳥居。" />);
        expect(screen.getByTestId("spot-summary").textContent).toBe("雲海に浮かぶ鳥居。");
    });

    // **「空の段落を描く」も出したうちに入る。** 中身で見ると、
    // `{summary !== undefined && …}` の変異が素通りする（実測）
    it("概要が無ければ、その枠ごと出さない（定型文で埋めない）", () => {
        const { container } = render(<SpotPageClient {...base} />);
        expect(screen.queryByTestId("spot-summary")).toBeNull();
        // 既にある説明文（`collectionCopy`）は出る
        expect(container.textContent).toContain(base.description);
    });

    // 🔴 **台帳の値を見出しや説明文に混ぜない。** 混ぜると `<title>` と
    // `<meta name=description>` が 14ページぶん動く（URL は変わらなくても
    // 検索結果の見え方が変わる＝「SEO を壊さない」と言えなくなる）
    it("ふりがなも概要も、見出しと説明文には混ざらない", () => {
        render(<SpotPageClient {...base} reading="たかやじんじゃ" summary="雲海に浮かぶ鳥居。" />);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(base.heading);
        const { container } = render(<SpotPageClient {...base} reading="X" summary="Y" />);
        const paras = [...container.querySelectorAll("p")].map((p) => p.textContent);
        // 説明文の段落は**そのまま**（読みや概要を足した文になっていない）
        expect(paras).toContain(base.description);
    });
});

/**
 * ── ヒーローと格子の関係（レビューの指摘3・4）─────────────
 */
describe("撮影スポット詳細: ヒーローと格子", () => {
    // **格子は折り返しのずっと下**（実測 y=1064 / 画面 844・390px）。
    // 既定の8枚 `priority` は、画面に出ていない写真で LCP と帯域を奪い合う
    it("格子に「先読みしない」を頼んでいる", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.getByTestId("grid").getAttribute("data-priority")).toBe("0");
    });

    // **同じ画面で同じ写真の振る舞いを2通りにしない。**
    // ヒーローも格子と同じく「その場で拡大」
    it("代表画像を押すと、遷移せずその場で開く", async () => {
        render(<SpotPageClient {...base} />);
        const hero = screen.getByRole("link", { name: "この写真を開く" });
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        fireEvent(hero, ev);
        expect(ev.defaultPrevented, "遷移を止めていない＝その場で開いていない").toBe(true);
        expect((await screen.findByTestId("modal")).getAttribute("data-current")).toBe("p1");
    });

    // 🔴 **`href` は残す。** 消すと検索に載っているこのページから
    // 写真の個別ページへの内部リンクが1本減る
    it("代表画像の `href` は写真ページのまま", () => {
        render(<SpotPageClient {...base} />);
        expect(screen.getByRole("link", { name: "この写真を開く" }).getAttribute("href")).toContain("p1");
    });
});
