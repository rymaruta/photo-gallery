import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
const mapProps = vi.hoisted(() => ({ last: null as null | { ids: string[] } }));
vi.mock("../../components/PhotoMap", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../components/PhotoMap")>();
    return {
        ...real,
        default: ({ photos }: { photos: readonly Photo[] }) => {
            mapProps.last = { ids: photos.map((p) => p.id) };
            return <div data-testid="photo-map">map:{photos.length}</div>;
        },
    };
});

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

    // 地図を操作できない環境（読み上げ・キーボード）向け。地図と同じ写真へ辿れる
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
        expect(links.map((a) => a.textContent)).toEqual(["場所a", "場所c"]);
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
});
