// @vitest-environment jsdom
// ↑ happy-dom では結果が変わる（原因は未調査。2026-09-30 の切り替えで落ちたもの）。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";

// 撮影地マップ（/map）。地図そのもの（Leaflet）は jsdom で描けないので
// 差し替え、**何を地図に渡したか**と、地図の外側の文言・一覧を見る。

const photosState = vi.hoisted(() => ({ current: [] as Photo[], loaded: true, failed: false }));
vi.mock("../../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ loaded: photosState.loaded, failed: photosState.failed, photos: photosState.current }),
}));
vi.mock("../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: {} }),
}));
// 地図に渡った写真の ID を並べるだけの偽物
const mapProps = vi.hoisted(() => ({
    last: null as null | { ids: string[] },
    select: null as null | ((s: unknown) => void),
    searchArea: null as null | ((b: unknown) => void),
    areaActive: false,
    sheetOpen: false,
    spotSlugs: [] as string[],
    /** 地図に渡したスポットの配列そのもの（同じ配列か＝描き直さないかを見る） */
    spotsArray: null as unknown,
    selectSpot: null as null | ((slug: string) => void),
    selectedSpotSlug: null as string | null,
}));
vi.mock("../../components/PhotoMap", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../components/PhotoMap")>();
    return {
        ...real,
        default: ({ photos, onSelect, onSearchArea, areaActive, sheetOpen, spots, onSelectSpot, selectedSpotSlug }: {
            photos: readonly Photo[]; onSelect?: (s: unknown) => void;
            onSearchArea?: (b: unknown) => void; areaActive?: boolean; sheetOpen?: boolean;
            spots?: readonly { slug: string }[]; onSelectSpot?: (slug: string) => void;
            selectedSpotSlug?: string | null;
        }) => {
            mapProps.last = { ids: photos.map((p) => p.id) };
            // ピンを押したことにする口（本物の Leaflet は jsdom で描けない）
            mapProps.select = onSelect ?? null;
            mapProps.searchArea = onSearchArea ?? null;
            mapProps.areaActive = !!areaActive;
            mapProps.sheetOpen = !!sheetOpen;
            mapProps.spotSlugs = (spots ?? []).map((sp) => sp.slug);
            mapProps.spotsArray = spots;
            mapProps.selectSpot = onSelectSpot ?? null;
            mapProps.selectedSpotSlug = selectedSpotSlug ?? null;
            return <div data-testid="photo-map">map:{photos.length}</div>;
        },
    };
});

/**
 * 公式撮影地ガイドの台帳は差し替える。
 *
 * `content/spots.json` はいま空（人が書く棚）。実データに寄りかかると、
 * 台帳に1件入った日に**この判定が別のことを見る**。
 */
const ledger = vi.hoisted(() => ({
    pins: [] as Array<{
        slug: string; name: string; region: string; lat: number; lng: number;
        cover: { src: string; alt: string; credit: string | null } | null;
        stage: "review" | "published";
    }>,
}));
vi.mock("../../../lib/data/spotLink", () => ({ spotPins: () => ledger.pins }));

// `SaveSpotButton`（シートの「行きたい」）が読むもの
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => authState }));
const userFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const MapPage = (await import("../page")).default;

const base = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u1", title: { ja: id }, location: `場所${id}`,
    published: true, createdAt: "2026-01-01T00:00:00.000Z", ...extra,
});

beforeEach(() => {
    photosState.current = [];
    photosState.loaded = true;
    photosState.failed = false;
    mapProps.last = null;
    mapProps.select = null;
    mapProps.searchArea = null;
    mapProps.areaActive = false;
    mapProps.sheetOpen = false;
    mapProps.spotSlugs = [];
    mapProps.selectSpot = null;
    mapProps.selectedSpotSlug = null;
    ledger.pins = [];
    authState.isAuthenticated = true;
    authState.loading = false;
    userFetch.mockReset();
    userFetch.mockResolvedValue({ ok: true, json: async () => ({ slugs: [] }) });
});

describe("/map", () => {
    it("位置情報のある写真が無ければ「まだ」と言い、地図は描かない", () => {
        photosState.current = [base("a"), base("b")];   // 地名はあるが座標が無い
        render(<MapPage />);
        expect(screen.getByText("位置情報のある写真はまだありません。")).toBeInTheDocument();
        expect(screen.queryByTestId("photo-map"), "0枚なのに地図を描いている").toBeNull();
        // 行き止まりにしない
        expect(screen.getByRole("link", { name: "ギャラリーに戻る" })).toHaveAttribute("href", "/");
    });

    // 手元の断面に座標が無いだけで、API の一覧には有ることがある（実測: 4秒の
    // 回線で「0枚・まだありません」が出たあと 18枚に変わった）
    it("一覧がまだ届いていなければ「読み込み中」と言い、「まだありません」とは言わない", () => {
        photosState.loaded = false;
        render(<MapPage />);
        expect(screen.getByText("読み込み中…")).toBeInTheDocument();
        expect(screen.getByText("読み込み中…").getAttribute("aria-busy")).toBe("true");
        expect(screen.queryByText("位置情報のある写真はまだありません。")).toBeNull();
        expect(screen.queryByTestId("photo-map")).toBeNull();
        // 見出しの枚数も「0枚」と言わない（実測: 4秒間「0枚」→「18枚」）
        expect(screen.queryByText(/位置情報のある写真 \d+枚/)).toBeNull();
    });

    it("届いていなくても、手元の断面に座標があれば地図を出す", () => {
        photosState.loaded = false;
        photosState.current = [base("a", { coords: { lat: 35.68, lng: 139.77 } })];
        render(<MapPage />);
        expect(screen.getByTestId("photo-map")).toBeInTheDocument();
        expect(screen.queryByText("読み込み中…")).toBeNull();
        expect(screen.getByText("位置情報のある写真 1枚")).toBeInTheDocument();
    });

    it("取りに行って駄目だったなら、そう言う（「まだ」でも「読み込み中」でもなく）", () => {
        photosState.loaded = false;
        photosState.failed = true;
        render(<MapPage />);
        const msg = screen.getByText(/写真を読み込めませんでした/);
        expect(screen.queryByText("読み込み中…")).toBeNull();
        // 失敗の告知に「更新中」の印を付けない（支援技術が読み上げを抑える）
        expect(msg.getAttribute("aria-busy")).toBe("false");
        expect(screen.queryByText("位置情報のある写真はまだありません。")).toBeNull();
    });

    it("0枚の案内で、編集画面から場所を選べることも伝える", () => {
        render(<MapPage />);
        expect(screen.getByText(/編集画面の「地図に出す位置」で場所を選ぶ/)).toBeInTheDocument();
    });

    it("座標を持つ公開写真だけを地図に渡す（非公開・座標なし・NaN は外す）", () => {
        photosState.current = [
            base("a", { coords: { lat: 35.68, lng: 139.77 } }),
            base("b", { coords: { lat: 48.86, lng: 2.35 }, published: false }),     // 非公開
            base("c"),                                                              // 座標なし
            base("d", { coords: { lat: Number.NaN, lng: 2 } }),                     // 読めない座標
            base("e", { coords: { lat: 51.51, lng: -0.13 }, geoApprox: true }),
        ];
        render(<MapPage />);
        expect(mapProps.last?.ids).toEqual(["a", "e"]);
        expect(screen.getByText("位置情報のある写真 2枚")).toBeInTheDocument();
    });

    it("地名から引いた座標が混じるときだけ、その枚数を注記する", () => {
        photosState.current = [
            base("a", { coords: { lat: 35.68, lng: 139.77 } }),
            base("e", { coords: { lat: 51.51, lng: -0.13 }, geoApprox: true }),
        ];
        render(<MapPage />);
        expect(screen.getByText(/1枚は地名から引いたおおよその位置です。/)).toBeInTheDocument();
    });

    it("全部が正確な座標なら、おおよその注記は出さない", () => {
        photosState.current = [base("a", { coords: { lat: 35.68, lng: 139.77 } })];
        render(<MapPage />);
        expect(screen.getByText(/ピンの位置は約1km の粒度に丸めています。/)).toBeInTheDocument();
        expect(screen.queryByText(/おおよその位置です/), "おおよそが0枚なのに注記が出ている").toBeNull();
    });

    // 地図を操作できない環境（読み上げ・キーボード）向け。地図と同じ写真へ辿れる。
    // **`sr-only` の一覧はこの見える一覧に置き換えた**（2026-09-22）。両方置くと
    // 同じリンクが2組 DOM に並び、片方だけ直す事故が起きる
    it("地図上の写真と同じ集合を、リンクの一覧としても出す", () => {
        photosState.current = [
            base("a", { coords: { lat: 35.68, lng: 139.77 } }),
            base("b", { coords: { lat: 48.86, lng: 2.35 }, published: false }),
            base("c", { coords: { lat: 51.51, lng: -0.13 } }),
        ];
        render(<MapPage />);
        const list = screen.getByRole("list", { name: "地図上の写真" });
        const links = within(list).getAllByRole("link");
        // `ROUTES.PHOTO` はビルド済みの写真だけ `/photo/<id>` にし、それ以外は
        // `/?photo=<id>`（モーダル）へ回す。ここではその規則に従う
        expect(links.map((a) => a.getAttribute("href"))).toEqual([ROUTES.PHOTO("a"), ROUTES.PHOTO("c")]);
        // 行の主役は撮影地（地図の一覧なので、探しているのは場所）
        expect(within(list).getByText("場所a")).toBeInTheDocument();
        expect(within(list).getByText("場所c")).toBeInTheDocument();
    });

    // 絞り込み（①のチップと検索欄）。規則そのものは `lib/utils/mapFilter.ts` の
    // 純関数が見る。ここは**画面が繋がっているか**だけ
    it("チップは、いま地図に在るカテゴリだけを出す（決め打ちで並べない）", () => {
        photosState.current = [
            base("a", { coords: { lat: 35.68, lng: 139.77 }, category: "風景" }),
            base("b", { coords: { lat: 48.86, lng: 2.35 }, category: "建物" }),
            base("c", { coords: { lat: 51.51, lng: -0.13 }, category: "建築" }),
        ];
        render(<MapPage />);
        const chips = within(screen.getByTestId("map-category-chips")).getAllByRole("switch");
        // 「建物」と「建築」は同じ `architecture` に畳まれる（集約ページと同じ物差し）
        expect(chips.map((b) => b.textContent)).toEqual(["すべて", "建築", "風景"]);
        // モックの絵にある「グルメ」「街並み」は実データに無いので出さない
        expect(screen.queryByText("グルメ")).toBeNull();
    });

    it("チップを押すと、そのカテゴリだけが地図に渡る（押し直すと外れる）", () => {
        photosState.current = [
            base("a", { coords: { lat: 35.68, lng: 139.77 }, category: "風景" }),
            base("b", { coords: { lat: 48.86, lng: 2.35 }, category: "建築" }),
        ];
        render(<MapPage />);
        const chip = screen.getByRole("switch", { name: "建築" });
        fireEvent.click(chip);
        expect(mapProps.last?.ids).toEqual(["b"]);
        expect(chip).toHaveAttribute("aria-checked", "true");
        // **絞っているときは分数で出す**（「位置情報のある写真 1枚」だと
        // サイト全体で1枚しか位置情報を持っていないと読める）
        expect(screen.getByTestId("map-count").textContent).toBe("2枚中 1枚を表示");

        fireEvent.click(chip);
        expect(mapProps.last?.ids).toEqual(["a", "b"]);
    });

    /**
     * **撮影地が無い写真では、リンクの文字が id になっていた。**
     *
     * GPS 付きの写真を上げると座標だけ入り、撮影地は空のまま（実データも
     * 30枚中13枚が空）。読み上げは36文字の UUID を読み上げることになる。
     */
    it("撮影地が無ければ題を出す（id を読み上げさせない）", () => {
        photosState.current = [
            base("11111111-2222-3333-4444-555555555555", {
                coords: { lat: 35.68, lng: 139.77 }, location: undefined, title: { ja: "夜明けの港" },
            }),
        ];
        render(<MapPage />);
        const list = screen.getByRole("list", { name: "地図上の写真" });
        const link = within(list).getAllByRole("link")[0];
        expect(link.textContent, "id がそのまま出ている").toBe("夜明けの港");
    });

    /**
     * **空白だけの撮影地は「無い」と同じに扱う。** `||` だけだと真になり、
     * リンクの文字が空＝**名前の無いリンク**になる（読み上げは URL を
     * 読み始めるので、id が出るより悪い）。
     */
    it("撮影地が空白だけなら題を出す（名前の無いリンクを作らない）", () => {
        photosState.current = [
            base("11111111-2222-3333-4444-555555555555", {
                coords: { lat: 35.68, lng: 139.77 }, location: "   ", title: { ja: "夜明けの港" },
            }),
        ];
        render(<MapPage />);
        const list = screen.getByRole("list", { name: "地図上の写真" });
        const link = within(list).getAllByRole("link")[0];
        expect(link.textContent?.trim(), "リンクの文字が空").not.toBe("");
        expect(link.textContent).toBe("夜明けの港");
    });

    it("撮影地も題も無ければ「写真」と出す", () => {
        photosState.current = [
            base("11111111-2222-3333-4444-555555555555", {
                coords: { lat: 35.68, lng: 139.77 }, location: undefined, title: undefined,
            }),
        ];
        render(<MapPage />);
        const list = screen.getByRole("list", { name: "地図上の写真" });
        expect(within(list).getAllByRole("link")[0].textContent).toBe("写真");
    });

    // ④「このエリアを検索」。範囲の判定そのものは `lib/utils/mapFilter.ts` の
    // 純関数が見る。ここは画面が繋がっているか
    describe("このエリアを検索", () => {
        const spread = [
            base("near", { coords: { lat: 35.5, lng: 139.5 } }),
            base("far", { coords: { lat: 10, lng: 10 } }),
        ];

        it("範囲を決めると、その中の写真だけが地図と一覧に残る", () => {
            photosState.current = spread;
            render(<MapPage />);
            act(() => { mapProps.searchArea?.({ south: 35, west: 139, north: 36, east: 140 }); });
            expect(mapProps.last?.ids).toEqual(["near"]);
            expect(screen.getByTestId("map-area-note").textContent).toContain("このエリアの写真 1件");
            expect(screen.getByTestId("map-count").textContent).toBe("2枚中 1枚を表示");
            expect(mapProps.areaActive, "地図側のボタンが解除の文言に変わらない").toBe(true);
        });

        // **押しても一覧へ切り替えない。** 切り替えると地図の列が `display: none` に
        // なり、「範囲の指定を解除」が地図の上に在るので押した直後に届かなくなる
        // （Playwright で実測して直した）
        it("押しても地図のままにする（解除のボタンごと消さない）", () => {
            photosState.current = spread;
            render(<MapPage />);
            act(() => { mapProps.searchArea?.({ south: 35, west: 139, north: 36, east: 140 }); });
            expect(screen.getByTestId("photo-map")).toBeInTheDocument();
        });

        it("断りの×で範囲を外す", () => {
            photosState.current = spread;
            render(<MapPage />);
            act(() => { mapProps.searchArea?.({ south: 35, west: 139, north: 36, east: 140 }); });
            fireEvent.click(screen.getByRole("button", { name: "範囲の指定を解除" }));
            expect(screen.queryByTestId("map-area-note")).toBeNull();
            expect(mapProps.last?.ids).toEqual(["near", "far"]);
        });

        it("`null` が来たら範囲を外す（地図側のボタンから）", () => {
            photosState.current = spread;
            render(<MapPage />);
            act(() => { mapProps.searchArea?.({ south: 35, west: 139, north: 36, east: 140 }); });
            act(() => { mapProps.searchArea?.(null); });
            expect(screen.queryByTestId("map-area-note")).toBeNull();
            expect(mapProps.areaActive).toBe(false);
        });
    });

    // **ピンの中身は地図の外に出した。** 地図の中のポップアップは地図の
    // 高さに縛られ、低い画面では枠の外へ出ていた（実測 390x844 で3枚
    // 465px・地図の上へ 183px はみ出し、うち1枚は表示も操作もできなかった）
    describe("ボトムシート", () => {
        const withCoords = (id: string, extra: Partial<Photo> = {}) =>
            base(id, { coords: { lat: 35.68, lng: 139.77 }, ...extra });

        it("ピンを押すまでは出さない", () => {
            photosState.current = [withCoords("a")];
            render(<MapPage />);
            expect(screen.queryByTestId("map-photo-sheet")).toBeNull();
        });

        it("ピンを押すと、その写真がシートに出る", () => {
            const photos = [withCoords("a"), withCoords("b")];
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos: [photos[1]], index: 0 }); });
            const sheet = screen.getByTestId("map-photo-sheet");
            // **シートの中を見る。** 同じ題は左の一覧にも出ているので、
            // 画面全体から探すと2件見つかる
            expect(within(sheet).getByText("b")).toBeTruthy();
        });

        it("束を押すと「1/3」で送れる", () => {
            const photos = ["a", "b", "c"].map((id) => withCoords(id));
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(screen.getByText("1/3")).toBeTruthy();

            fireEvent.click(screen.getByRole("button", { name: "次の写真" }));
            expect(screen.getByText("2/3")).toBeTruthy();
            expect(within(screen.getByTestId("map-photo-sheet")).getByText("b")).toBeTruthy();
        });

        it("地図の余白を押すと閉じる（`null` が来る）", () => {
            const photos = [withCoords("a")];
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(screen.getByTestId("map-photo-sheet")).toBeTruthy();

            act(() => { mapProps.select?.(null); });
            expect(screen.queryByTestId("map-photo-sheet")).toBeNull();
        });

        // **押した瞬間の写真オブジェクトを抱えない。** 開いている間に一覧が
        // 更新されたとき（手元の断面を API の一覧が置き換える・編集・非公開）、
        // 古い題や、もう地図に無い写真を出し続ける
        it("一覧が更新されたら、シートも新しい中身になる", () => {
            const photos = [withCoords("a", { title: { ja: "古い題" } })];
            photosState.current = photos;
            const { rerender } = render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(within(screen.getByTestId("map-photo-sheet")).getByText("古い題")).toBeTruthy();

            photosState.current = [withCoords("a", { title: { ja: "新しい題" } })];
            rerender(<MapPage />);
            expect(screen.queryByText("古い題")).toBeNull();
            expect(within(screen.getByTestId("map-photo-sheet")).getByText("新しい題")).toBeTruthy();
        });

        it("開いている写真が一覧から消えたら、シートは畳まれる", () => {
            const photos = [withCoords("a"), withCoords("b")];
            photosState.current = photos;
            const { rerender } = render(<MapPage />);
            act(() => { mapProps.select?.({ photos: [photos[0]], index: 0 }); });
            expect(screen.getByTestId("map-photo-sheet")).toBeTruthy();

            photosState.current = [withCoords("b")];   // a が非公開になった
            rerender(<MapPage />);
            expect(screen.queryByTestId("map-photo-sheet")).toBeNull();
        });

        it("束のうち一部が消えたら、残りだけで数え直す", () => {
            const photos = ["a", "b", "c"].map((id) => withCoords(id));
            photosState.current = photos;
            const { rerender } = render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(screen.getByText("1/3")).toBeTruthy();

            photosState.current = [photos[0], photos[2]];
            rerender(<MapPage />);
            expect(screen.getByText("1/2")).toBeTruthy();
        });

        // モックの③「関連写真もすぐ見られ、『この場所の写真を見る』からさらに探索」。
        // **同じ撮影地は文字列の完全一致で見る**（集約ページの緩い一致で寄せると、
        // 地図の上では別のピンの写真が「この場所」として並ぶ）
        it("同じ撮影地の別の写真を帯に出し、残りを「+N」に畳む", () => {
            const here = { coords: { lat: 35.42, lng: 138.88 }, location: "山中湖, 山梨" };
            const photos = ["a", "b", "c", "d", "e"].map((id) => base(id, { ...here }));
            photosState.current = [...photos, base("z", { coords: { lat: 48.86, lng: 2.35 }, location: "パリ" })];
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos: [photos[0]], index: 0 }); });

            const strip = screen.getByTestId("map-sheet-related");
            // 3枚並べて、残り1枚は「+1」（自分を除いた4枚のうち3枚を出す）
            expect(within(strip).getAllByRole("link")).toHaveLength(4);
            expect(within(strip).getByText("+1")).toBeInTheDocument();
            // 別の撮影地の写真は混ぜない
            const hrefs = within(strip).getAllByRole("link").map((a) => a.getAttribute("href"));
            expect(hrefs).not.toContain(ROUTES.PHOTO("z"));
            expect(hrefs, "自分自身を関連に出している").not.toContain(ROUTES.PHOTO("a"));
        });

        it("「この場所の写真を見る」は撮影地の集約ページへ行く", () => {
            const photos = [base("a", { coords: { lat: 35.42, lng: 138.88 }, location: "山中湖, 山梨" })];
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(screen.getByTestId("map-sheet-location-link"))
                .toHaveAttribute("href", "/location/%E5%B1%B1%E4%B8%AD%E6%B9%96%2C-%E5%B1%B1%E6%A2%A8");
        });

        // 撮影地の無い写真（GPS 付きで上げると座標だけ入る）では行き先が作れない
        it("撮影地が無ければ「この場所の写真を見る」を出さない", () => {
            const photos = [base("a", { coords: { lat: 35.42, lng: 138.88 }, location: undefined })];
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(screen.queryByTestId("map-sheet-location-link")).toBeNull();
            expect(screen.queryByTestId("map-sheet-related")).toBeNull();
            // 行き止まりにはしない（「詳細を見る」は残る）
            expect(screen.getByRole("link", { name: "詳細を見る" })).toBeInTheDocument();
        });

        // シートは画面の下 275px を覆う（Chromium で実測）。地図の操作ボタンと
        // 「このエリアを検索」がその下に入ると、95% 不透明な面越しに薄く見えた
        // まま押せない——このリポジトリが何度も踏んでいる形（`2922526f`）
        it("開いている間は、地図に「シートが開いている」と伝える", () => {
            const photos = [base("a", { coords: { lat: 35.42, lng: 138.88 } })];
            photosState.current = photos;
            render(<MapPage />);
            expect(mapProps.sheetOpen).toBe(false);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            expect(mapProps.sheetOpen, "操作のボタンがシートの下に残る").toBe(true);
        });

        it("閉じるボタンで閉じる", () => {
            const photos = [withCoords("a")];
            photosState.current = photos;
            render(<MapPage />);
            act(() => { mapProps.select?.({ photos, index: 0 }); });
            fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
            expect(screen.queryByTestId("map-photo-sheet")).toBeNull();
        });
    });
});

/**
 * 公式撮影地ガイドのピンを押したとき。
 *
 * owner のコアの鎖（さがす → 撮影地ガイド → **マップ** → 行きたい場所 →
 * 旅行プラン → 写真SNS）で、地図から次の2つへ繋ぐのがこのシートの役目。
 */
describe("公式撮影地ガイドのピン", () => {
    const PIN = { slug: "takaya-jinja", name: "高屋神社", region: "香川県 観音寺市", lat: 34.1, lng: 133.6, cover: null, stage: "published" as const };
    const COVER = { src: "/spots/takaya.jpg", alt: "高屋神社の鳥居", credit: "丸田 竜平" };
    const P = (id: string): Photo => ({
        id, src: `https://cdn/${id}.jpg`, userId: "u1", title: { ja: `写真${id}` },
        location: "山中湖", coords: { lat: 35.42, lng: 138.88 }, published: true,
        createdAt: "2026-01-01T00:00:00.000Z",
    } as Photo);

    /// **写真が1枚も無いと地図ごと出ない**（既存の判断）ので、1枚置く
    const show = () => { photosState.current = [P("a")]; ledger.pins = [PIN]; render(<MapPage />); };

    /**
     * **公式スポットの一覧は、行そのものがガイドへのリンク。**
     *
     * `MapPhotoList` が同じ理由でそうしている——「押すと選ぶだけ、にすると
     * 読み上げの人が辿り着けない」。地図を操作できない人にとって、ここが
     * ガイドへの**唯一の経路**になる。
     */
    describe("公式スポットの一覧", () => {
        it("行がガイドへのリンクになっている", () => {
            show();
            const list = screen.getByTestId("map-spot-list");
            const link = within(list).getByRole("link", { name: /高屋神社/ });
            expect(link.getAttribute("href")).toBe("/spots/takaya-jinja");
        });

        it("地域も出す（どこの場所か分かるように）", () => {
            show();
            expect(within(screen.getByTestId("map-spot-list")).getByText(/香川県 観音寺市/)).toBeTruthy();
        });

        /// **タブで分けない。** 公式スポットと写真が同時に見られるのが、
        /// 1つの地図にした理由
        it("写真の一覧と同時に出る（タブで排他にしない）", () => {
            show();
            expect(screen.getByTestId("map-spot-list")).toBeTruthy();
            expect(screen.getByTestId("map-list")).toBeTruthy();
        });

        /// 台帳が空なら節ごと出さない（空の見出しを置かない）
        it("スポットが0件なら節ごと出さない", () => {
            photosState.current = [P("a")];
            ledger.pins = [];
            render(<MapPage />);
            expect(screen.queryByTestId("map-spot-list")).toBeNull();
            expect(screen.queryByText("公式撮影スポット")).toBeNull();
        });

        /// 数えていないものを出さない（owner の指示 2026-09-22）
        it("「人気」「評価」「枚数」を出さない", () => {
            show();
            expect(screen.getByTestId("map-spot-list").textContent).not.toMatch(/人気|評価|枚|件/);
        });
    });

    /**
     * 代表写真。**権利の判断はサーバー側で済ませてある**ので、画面は
     * 在れば出す・無ければ枠ごと出さないだけ。
     */
    describe("シートの代表写真", () => {
        it("無ければ枠ごと出さない（空の灰色を置かない）", async () => {
            show();
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            expect(within(screen.getByTestId("map-spot-sheet")).queryByRole("img")).toBeNull();
        });

        it("在れば出し、クレジットも添える", async () => {
            photosState.current = [P("a")];
            ledger.pins = [{ ...PIN, cover: COVER }];
            render(<MapPage />);
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            const sheet = screen.getByTestId("map-spot-sheet");
            const img = within(sheet).getByRole("img");
            expect(img.getAttribute("src")).toBe("/spots/takaya.jpg");
            expect(img.getAttribute("alt"), "台帳の alt をそのまま使う").toBe("高屋神社の鳥居");
            expect(within(sheet).getByTestId("map-spot-credit").textContent).toBe("丸田 竜平");
        });

        /**
         * クレジットが要らない回（owner 本人の写真）は**要素ごと出さない**。
         *
         * ⚠️ 最初は「文字が無いこと」で見ていたが、**空の黒いチップが写真の
         * 上に出る**変異を素通りさせた（背景と余白を持つので見える）。
         * 要素そのものの有無で見る。
         */
        it("クレジットが `null` なら、空の帯も出さない", async () => {
            photosState.current = [P("a")];
            ledger.pins = [{ ...PIN, cover: { ...COVER, credit: null } }];
            render(<MapPage />);
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            expect(within(screen.getByTestId("map-spot-sheet")).queryByTestId("map-spot-credit")).toBeNull();
        });
    });

    /**
     * **スポットも写真と同じ絞り込みで絞る**（2026-09-30 のレビュー: 「銀山温泉」で探しても
     * 絞られるのは写真だけ・スポットの一覧とピンは全件のまま）。件数は写真と別に数える
     */
    describe("絞り込みとスポット", () => {
        const GINZAN = { slug: "ginzan-onsen", name: "銀山温泉", region: "山形県 尾花沢市", lat: 38.58, lng: 140.53, cover: null, stage: "published" as const };
        /** 検索欄は 250ms 待ってから絞る（`MapControls` の debounce） */
        const typeQuery = async (value: string) => {
            fireEvent.change(screen.getByTestId("map-search-input"), { target: { value } });
            await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
        };
        const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...PIN, slug: `s${i}`, name: `スポット${i}` }));

        it("語で絞ると、スポットの一覧とピンも絞られる（地域でも当たる）", async () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            await typeQuery("銀山温泉");
            expect(mapProps.spotSlugs).toEqual(["ginzan-onsen"]);
            expect(within(screen.getByTestId("map-spot-list")).queryByText("高屋神社")).toBeNull();
            await typeQuery("香川");
            expect(mapProps.spotSlugs).toEqual(["takaya-jinja"]);
        });

        it("写真の件数とスポットの件数を別の行で数える", async () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            await typeQuery("銀山温泉");
            expect(screen.getByTestId("map-spot-count").textContent).toBe("撮影スポット 2か所中 1か所を表示");
            expect(screen.getByTestId("map-count").textContent).toContain("1枚中 0枚を表示");
        });

        it("当たるスポットが無ければ、節は残して理由を言う", async () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN];
            render(<MapPage />);
            await typeQuery("銀山温泉");
            expect(mapProps.spotSlugs).toEqual([]);
            expect(screen.getByTestId("map-spot-empty").textContent).toContain("検索語や範囲に当たる撮影スポットはありません");
        });

        it("写真のカテゴリで絞っている間は、スポットを出さず、そう言う", () => {
            photosState.current = [{ ...P("a"), category: "風景" } as Photo];
            ledger.pins = [PIN];
            render(<MapPage />);
            fireEvent.click(screen.getByRole("switch", { name: "風景" }));
            expect(mapProps.spotSlugs).toEqual([]);
            expect(screen.getByTestId("map-spot-empty").textContent).toContain("カテゴリは写真の分類");
        });

        it("「このエリアを検索」でスポットも範囲の中だけになる", () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            act(() => { mapProps.searchArea?.({ south: 38, west: 140, north: 39, east: 141 }); });
            expect(mapProps.spotSlugs).toEqual(["ginzan-onsen"]);
            expect(screen.getByTestId("map-area-note").textContent).toContain("撮影スポット 1か所");
        });

        it("位置情報のある写真が0枚でも、スポットがあれば地図を出す", () => {
            photosState.current = [];
            ledger.pins = [PIN];
            render(<MapPage />);
            expect(screen.getByTestId("photo-map")).toBeTruthy();
            expect(mapProps.spotSlugs).toEqual(["takaya-jinja"]);
            expect(screen.queryByText("位置情報のある写真はまだありません。")).toBeNull();
        });

        it("写真がまだ届いていない間は「0枚」と言わない", () => {
            photosState.current = [];
            photosState.loaded = false;
            ledger.pins = [PIN];
            render(<MapPage />);
            expect(screen.getByTestId("map-count").textContent).toContain("写真を読み込み中");
            expect(screen.getByTestId("map-count").textContent).not.toContain("0枚");
            photosState.loaded = true;
        });

        /// スマホで長い一覧が地図より前に来ない（「リスト」を押したときだけ）
        it("スマホでは、地図の表示中はスポットの一覧を隠し、「リスト」で出す", () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN];
            render(<MapPage />);
            const wrap = screen.getByTestId("map-spot-list").closest("section")!.parentElement!;
            expect(wrap.className).toContain("hidden");
            expect(wrap.className).toContain("lg:block");
            fireEvent.click(screen.getByTestId("map-view-list"));
            expect(screen.getByTestId("map-spot-list").closest("section")!.parentElement!.className).not.toContain("hidden");
        });

        // cfc451eb のレビュー 3: 地図の語も読み・英語名・別名に当てる（「さがす」と同じ索引）
        it("読み・英語名でも、スポットのピンが絞られる（名前の索引を共有）", async () => {
            const { resetSpotSearchIndex } = await import("../../../lib/hooks/useSpotSearchIndex");
            resetSpotSearchIndex();
            const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [
                { s: "ginzan-onsen", n: "銀山温泉", e: "Ginzan Onsen", r: "ぎんざんおんせん", g: "山形県 尾花沢市" },
                { s: "takaya-jinja", n: "高屋神社", r: "たかやじんじゃ", g: "香川県 観音寺市" },
            ] }));
            vi.stubGlobal("fetch", fetchMock);
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            await typeQuery("ぎんざん");
            await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
            expect(mapProps.spotSlugs).toEqual(["ginzan-onsen"]);
            await typeQuery("Ginzan");
            expect(mapProps.spotSlugs).toEqual(["ginzan-onsen"]);
        });

        // cfc451eb のレビュー 2: 選んだ場所を見失わせない
        it("選んでいるスポットは、絞り込みで外れてもピンを残す（シートだけ残さない）・一覧と件数には足さない", async () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            await typeQuery("銀山温泉");
            expect([...mapProps.spotSlugs].sort()).toEqual(["ginzan-onsen", "takaya-jinja"]);
            expect(screen.getByTestId("map-spot-sheet")).toBeTruthy();
            expect(within(screen.getByTestId("map-spot-list")).queryByText("高屋神社")).toBeNull();
            expect(screen.getByTestId("map-spot-count").textContent).toBe("撮影スポット 2か所中 1か所を表示");
        });

        it("カテゴリで絞っている間は、選んだピンだけ残し、一覧は理由を言う", async () => {
            photosState.current = [{ ...P("a"), category: "風景" } as Photo];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            fireEvent.click(screen.getByRole("switch", { name: "風景" }));
            expect(mapProps.spotSlugs).toEqual(["takaya-jinja"]);
            expect(screen.getByTestId("map-spot-empty").textContent).toContain("カテゴリは写真の分類");
        });

        // 1b658978 のレビュー 2: 選ぶたびに地図へ新しい配列を渡すと、全部のピンが描き直される
        it("表示中のスポットを選んでも、地図に渡す配列は変わらない（描き直さない）", async () => {
            photosState.current = [P("a")];
            ledger.pins = [PIN, GINZAN];
            render(<MapPage />);
            const before = mapProps.spotsArray;
            await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
            expect(mapProps.spotsArray).toBe(before);
        });

        // 1b658978 のレビュー: 索引を待つ間は「無い」と言わない・失敗したら待ち続けない
        it("名前の索引を待つ間は「探しています」、取れなければ「当たらない」と言う", async () => {
            const { resetSpotSearchIndex } = await import("../../../lib/hooks/useSpotSearchIndex");
            resetSpotSearchIndex();
            let release: (v: unknown) => void = () => {};
            vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { release = r; })));
            photosState.current = [P("a")];
            ledger.pins = [PIN];
            render(<MapPage />);
            await typeQuery("ぎんざん");
            expect(screen.getByTestId("map-spot-empty").textContent).toContain("探しています");
            await act(async () => { release({ ok: false, json: async () => null }); await new Promise((r) => setTimeout(r, 20)); });
            expect(screen.getByTestId("map-spot-empty").textContent).toContain("当たる撮影スポットはありません");
        });

        afterEach(() => { vi.unstubAllGlobals(); photosState.loaded = true; });

        it("写真がまだ届いていない間は、写真の一覧も「該当なし」と言わない", () => {
            photosState.current = [];
            photosState.loaded = false;
            ledger.pins = [PIN];
            render(<MapPage />);
            expect(screen.getByTestId("map-list-empty").textContent).toContain("写真を読み込み中");
            photosState.loaded = true;
        });

        it("一覧は30件ずつ（全件を一度に並べない）", () => {
            photosState.current = [P("a")];
            ledger.pins = many(95);
            render(<MapPage />);
            expect(within(screen.getByTestId("map-spot-list")).getAllByRole("link")).toHaveLength(30);
            fireEvent.click(screen.getByTestId("map-spot-more"));
            expect(within(screen.getByTestId("map-spot-list")).getAllByRole("link")).toHaveLength(60);
            fireEvent.click(screen.getByTestId("map-spot-more"));
            expect(within(screen.getByTestId("map-spot-list")).getAllByRole("link")).toHaveLength(90);
            fireEvent.click(screen.getByTestId("map-spot-more"));
            expect(within(screen.getByTestId("map-spot-list")).getAllByRole("link")).toHaveLength(95);
            expect(screen.queryByTestId("map-spot-more")).toBeNull();
        });
    });

    it("台帳のスポットを地図へ渡す", () => {
        show();
        expect(mapProps.spotSlugs).toEqual(["takaya-jinja"]);
    });

    it("押すとシートが出て、名前と地域を出す", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        const sheet = screen.getByTestId("map-spot-sheet");
        expect(within(sheet).getByText("高屋神社")).toBeTruthy();
        expect(within(sheet).getByText("香川県 観音寺市")).toBeTruthy();
        expect(within(sheet).getByText("公式撮影スポット")).toBeTruthy();
    });

    /// 🔴 **「公式」と名乗るのは人が確かめた行だけ。** 運営未確認の下書きは
    /// シートでも一覧でも「下書き」と名乗る（2026-09-24 の台帳は 1,417件が
    /// 未確認のまま「公式」を名乗っていた）
    it("下書きのピンは「公式」と名乗らない", async () => {
        photosState.current = [P("a")];
        ledger.pins = [{ ...PIN, stage: "review" }];
        render(<MapPage />);
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        const sheet = screen.getByTestId("map-spot-sheet");
        expect(within(sheet).getByText("撮影スポット（下書き）")).toBeTruthy();
        expect(within(sheet).queryByText("公式撮影スポット")).toBeNull();
        expect(screen.queryByText("公式撮影スポット")).toBeNull();
        expect(screen.getByText("撮影地ガイド（下書き）", { exact: false })).toBeTruthy();
    });

    /// 🔴 **地図 → ガイド**（コアの鎖の次の輪）
    it("撮影ガイドへの導線が `/spots/<slug>` を指す", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        expect(screen.getByTestId("map-spot-guide-link").getAttribute("href")).toBe("/spots/takaya-jinja");
    });

    /// 🔴 **地図 → 行きたい場所**（同上）。鍵の形は `savedSpotKey` が持つ
    it("「行きたい」で保存すると、頭の付いた鍵を送る", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        const btn = await screen.findByRole("button", { name: "行きたい" });
        userFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ slugs: ["SPOT-takaya-jinja"] }) });
        await act(async () => { fireEvent.click(btn); });
        expect(userFetch).toHaveBeenLastCalledWith(
            "/user/spots",
            expect.objectContaining({ body: JSON.stringify({ slug: "SPOT-takaya-jinja" }) }),
        );
    });

    /// **シートは1枚だけ。** 同じ場所に出るので、重なると下が読めない
    it("写真のピンを押すと、スポットのシートは閉じる", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        expect(screen.queryByTestId("map-spot-sheet")).toBeTruthy();
        await act(async () => { mapProps.select?.({ photos: [P("a")], index: 0 }); });
        expect(screen.queryByTestId("map-spot-sheet")).toBeNull();
        expect(screen.queryByTestId("map-photo-sheet")).toBeTruthy();
    });

    it("スポットのピンを押すと、写真のシートは閉じる", async () => {
        show();
        await act(async () => { mapProps.select?.({ photos: [P("a")], index: 0 }); });
        expect(screen.queryByTestId("map-photo-sheet")).toBeTruthy();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        expect(screen.queryByTestId("map-photo-sheet")).toBeNull();
    });

    /// 開いているスポットを地図へ伝える（そのピンを目立たせるため）
    it("開いているスポットを地図へ伝える", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        expect(mapProps.selectedSpotSlug).toBe("takaya-jinja");
    });

    it("閉じるとシートが消える", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("takaya-jinja"); });
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "閉じる" })); });
        expect(screen.queryByTestId("map-spot-sheet")).toBeNull();
    });

    /**
     * **台帳から下りたスポットはシートを畳む。** 押した瞬間の object を
     * 抱えず、スラッグから引き直しているので自然にそうなる（写真と同じ判断）。
     */
    it("台帳に無いスラッグではシートを出さない", async () => {
        show();
        await act(async () => { mapProps.selectSpot?.("kieta"); });
        expect(screen.queryByTestId("map-spot-sheet")).toBeNull();
    });
});
