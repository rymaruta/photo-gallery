import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";

// 撮影地マップ（/map）。地図そのもの（Leaflet）は jsdom で描けないので
// 差し替え、**何を地図に渡したか**と、地図の外側の文言・一覧を見る。

const photosState = vi.hoisted(() => ({ current: [] as Photo[] }));
vi.mock("../../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ loaded: true, photos: photosState.current }),
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
    mapProps.last = null;
});

describe("/map", () => {
    it("位置情報のある写真が無ければ「まだ」と言い、地図は描かない", () => {
        photosState.current = [base("a"), base("b")];   // 地名はあるが座標が無い
        render(<MapPage />);
        expect(screen.getByText("位置情報のある写真はまだありません。")).toBeInTheDocument();
        expect(screen.queryByTestId("photo-map"), "0枚なのに地図を描いている").toBeNull();
        // 行き止まりにしない
        expect(screen.getByRole("link", { name: "ギャラリーへ戻る" })).toHaveAttribute("href", "/");
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
});
