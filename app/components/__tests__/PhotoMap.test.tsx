import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// 地図そのもの（描画・タイル）は jsdom では出せないので Leaflet を差し替え、
// **こちらが Leaflet に何を渡しているか**を見る。
// ここに置いたのは、実ブラウザでしか見えない壊れを2件踏んだため:
//   (1) コンテナがスタッキングコンテキストを作らず、Leaflet の z-index 400 が
//       ページ全体の土俵に出て `z-50` のヘッダー・メニューを覆っていた
//   (2) ポップアップの画像に高さが無く、Leaflet が「収まっている」と誤って測って
//       スクロールにしないまま、あとから画像が入って地図の外まで伸びていた
// どちらも CSS と実測が要る話だが、**こちら側の指定が消えたら気づける**ようにする。

type FakeMarker = {
    kind: string; latlng: unknown; opts: Record<string, unknown>;
    popup: HTMLElement | null; popupOpts: Record<string, unknown> | null;
    on: (ev: string, fn: () => void) => void; addTo: () => FakeMarker;
    bindPopup: (el: HTMLElement, o: Record<string, unknown>) => FakeMarker;
};
const state = vi.hoisted(() => ({ markers: [] as FakeMarker[], zoom: 4 }));

vi.mock("leaflet", () => {
    const handlers: Record<string, Array<() => void>> = {};
    const map = {
        getZoom: () => state.zoom,
        fitBounds: vi.fn(), setView: vi.fn(), remove: vi.fn(),
        on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
        fire: (ev: string) => (handlers[ev] ?? []).forEach((f) => f()),
    };
    const group = { addTo: () => group, clearLayers: () => { state.markers.length = 0; } };
    const make = (kind: string) => (latlng: unknown, opts: Record<string, unknown> = {}) => {
        const m: FakeMarker = {
            kind, latlng, opts, popup: null, popupOpts: null,
            on: () => {}, addTo: () => m,
            bindPopup: (el, o) => { m.popup = el; m.popupOpts = o; return m; },
        };
        state.markers.push(m);
        return m;
    };
    return {
        map: () => map,
        tileLayer: () => ({ addTo: () => ({}) }),
        layerGroup: () => group,
        circleMarker: make("circle"),
        marker: make("marker"),
        divIcon: (o: unknown) => o,
    };
});

const PhotoMap = (await import("../PhotoMap")).default;

type MapPhoto = Photo & { coords: { lat: number; lng: number } };
const photo = (id: string, extra: Partial<Photo> = {}): MapPhoto => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u1", title: { ja: `写真${id}` },
    location: "山中湖", coords: { lat: 35.42, lng: 138.88 }, published: true,
    createdAt: "2026-01-01T00:00:00.000Z", ...extra,
} as MapPhoto);

const draw = async (photos: MapPhoto[]) => {
    render(<PhotoMap photos={photos} locale="ja" />);
    await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
};

beforeEach(() => { state.markers.length = 0; state.zoom = 4; });

describe("地図の枠", () => {
    it("スタッキングコンテキストを作る（Leaflet の z-index をページに出さない）", async () => {
        await draw([photo("a")]);
        // `isolate` = isolation: isolate。これが無いと Leaflet のペイン（400）と
        // コントロール（1000）が `z-50` のヘッダー・メニューを追い越す
        // ——実測（Chromium 390x844・300pxスクロール）: ヘッダー帯の画素が
        // タイル色になり、見えないハンバーガーが押せる状態だった
        expect(screen.getByTestId("photo-map").className).toContain("isolate");
    });

    it("下地の色は専用クラスに寄せる（Tailwind の bg-* は Leaflet に負ける）", async () => {
        await draw([photo("a")]);
        const cls = screen.getByTestId("photo-map").className;
        expect(cls).toContain("photo-map-shell");
        // `bg-white/5` は `.leaflet-container { background: #ddd }` と同じ強さで、
        // 読み込み順で負けて一度も効いていなかった（実測 rgb(221,221,221)）
        expect(cls, "効かない指定を戻している").not.toContain("bg-white/5");
    });
});

describe("ポップアップ", () => {
    it("サムネに幅と高さを入れる（Leaflet が開いた瞬間に測れるように）", async () => {
        await draw([photo("a", { width: 4000, height: 3000 })]);
        const img = state.markers[0].popup!.querySelector("img")!;
        expect(img.getAttribute("width")).toBe("160");
        // 実寸が分かればその比（160 * 3000/4000 = 120）
        expect(img.getAttribute("height")).toBe("120");
    });

    it("実寸を持たない写真は 3:2 で見積もる（高さ無しにしない）", async () => {
        await draw([photo("a")]);
        const img = state.markers[0].popup!.querySelector("img")!;
        expect(img.getAttribute("height"), "高さが無いと Leaflet は高さ0で測る").toBe("107");
    });

    it("極端な比でも収まる範囲に丸める", async () => {
        await draw([photo("a", { width: 100, height: 9000 })]);
        expect(state.markers[0].popup!.querySelector("img")!.getAttribute("height")).toBe("240");
    });

    it("同じ升の束は、写真ごとのカードを並べて全部に辿れるようにする", async () => {
        await draw([photo("a"), photo("b"), photo("c")]);
        const cluster = state.markers.find((m) => m.kind === "marker")!;
        expect(cluster, "同じ座標なのに束になっていない").toBeTruthy();
        const links = [...cluster.popup!.querySelectorAll("a")];
        expect(links.map((a) => a.getAttribute("href"))).toHaveLength(3);
        // はみ出したぶんはスクロールで届く（高さの上限を渡している）
        expect(cluster.popupOpts?.maxHeight).toBe(320);
    });

    it("タイトルは文字として入れる（利用者の入力を HTML として解釈しない）", async () => {
        await draw([photo("a", { title: { ja: "<b>注入</b>" } })]);
        const link = state.markers[0].popup!.querySelector("a")!;
        expect(link.textContent).toBe("<b>注入</b>");
        expect(link.querySelector("b"), "利用者の入力が要素になっている").toBeNull();
    });

    it("地名から引いた座標は「おおよそ」と断る", async () => {
        await draw([photo("a", { geoApprox: true })]);
        expect(state.markers[0].popup!.textContent).toContain("山中湖（おおよそ）");
    });
});
