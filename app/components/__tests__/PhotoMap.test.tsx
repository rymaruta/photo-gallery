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
    update: ReturnType<typeof vi.fn>;
    clickHandler?: () => void;
    keypressHandler?: (e: { originalEvent?: { key: string } }) => void;
    on: (ev: string, fn: (e?: unknown) => void) => void; addTo: () => FakeMarker;
    bindPopup: (el: HTMLElement, o: Record<string, unknown>) => FakeMarker;
    getPopup: () => { update: ReturnType<typeof vi.fn> };
};
const state = vi.hoisted(() => ({
    markers: [] as FakeMarker[], zoom: 4, center: [36, 138] as [number, number],
    zoomControl: null as unknown, mapOpts: null as Record<string, unknown> | null,
    fitOpts: null as Record<string, unknown> | null, fitCalls: 0,
    setViewArgs: [] as Array<{ center: [number, number]; zoom: number }>,
    fireMap: (() => {}) as (ev: string) => void,
}));
const fireMap = (ev: string) => state.fireMap(ev);

vi.mock("leaflet", () => {
    const handlers: Record<string, Array<() => void>> = {};
    const map = {
        getZoom: () => state.zoom,
        getCenter: () => ({ lat: state.center[0], lng: state.center[1] }),
        fitBounds: vi.fn((_b: unknown, o: Record<string, unknown>) => { state.fitOpts = o; state.fitCalls++; (handlers.moveend ?? []).forEach((f) => f()); }),
        setView: vi.fn((center: [number, number], zoom: number) => {
            state.setViewArgs.push({ center, zoom }); state.center = center; state.zoom = zoom;
            (handlers.moveend ?? []).forEach((f) => f());   // 本物も setView の直後に moveend を出す
        }),
        // アンマウントで listener を捨てる（溜めるとテストをまたいで前の
        // コンポーネントの moveend が走る）
        remove: vi.fn(() => { for (const k of Object.keys(handlers)) delete handlers[k]; }),
        on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
        fire: (ev: string) => (handlers[ev] ?? []).forEach((f) => f()),
    };
    state.fireMap = map.fire;
    const group = { addTo: () => group, clearLayers: () => { state.markers.length = 0; } };
    const make = (kind: string) => (latlng: unknown, opts: Record<string, unknown> = {}) => {
        const update = vi.fn();
        const m: FakeMarker = {
            kind, latlng, opts, popup: null, popupOpts: null, update,
            on: (ev: string, fn: (e?: unknown) => void) => {
                if (ev === "click") m.clickHandler = fn as () => void;
                if (ev === "keypress") m.keypressHandler = fn as FakeMarker["keypressHandler"];
            },
            addTo: () => m,
            bindPopup: (el, o) => { m.popup = el; m.popupOpts = o; return m; },
            getPopup: () => ({ update }),
        };
        state.markers.push(m);
        return m;
    };
    return {
        map: (_el: unknown, opts: Record<string, unknown>) => { state.mapOpts = opts; return map; },
        tileLayer: () => ({ addTo: () => ({}) }),
        layerGroup: () => group,
        circleMarker: make("circle"),
        marker: make("marker"),
        divIcon: (o: unknown) => o,
        control: { zoom: (o: unknown) => { state.zoomControl = o; return { addTo: () => ({}) }; } },
    };
});

const PhotoMap = (await import("../PhotoMap")).default;

type MapPhoto = Photo & { coords: { lat: number; lng: number } };
const photo = (id: string, extra: Partial<Photo> = {}): MapPhoto => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u1", title: { ja: `写真${id}` },
    location: "山中湖", coords: { lat: 35.42, lng: 138.88 }, published: true,
    createdAt: "2026-01-01T00:00:00.000Z", ...extra,
} as MapPhoto);

const draw = async (photos: MapPhoto[], onSelect?: (s: unknown) => void) => {
    render(<PhotoMap photos={photos} locale="ja" onSelect={onSelect} />);
    await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
};

/** 「動きを減らす」設定を模す（jsdom には matchMedia が無い） */
function setReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true, writable: true,
        value: (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
    });
}

beforeEach(() => {
    state.markers.length = 0; state.zoom = 4; state.center = [36, 138]; state.zoomControl = null;
    state.mapOpts = null; state.fitOpts = null; state.fitCalls = 0; state.setViewArgs.length = 0;
    setReducedMotion(false);
    window.location.hash = "";
    sessionStorage.clear();
});

// 最初に見せる場所と、動かしたあとの控え。決め方は lib/utils/mapView.ts
describe("見る場所", () => {
    it("引ききれる限界を 2 にする（世界1周が地図の高さより短いと上下に下地が出る）", async () => {
        await draw([photo("a")]);
        // 実測 390x844: ズーム0 で上に 211px・1 で 39px の黒帯
        expect(state.mapOpts?.minZoom).toBe(2);
    });

    it("何も無ければ、全部のピンが収まる範囲に合わせる", async () => {
        await draw([photo("a")]);
        expect(state.fitCalls).toBe(1);
        expect(state.setViewArgs).toEqual([]);
    });

    it("URL の #z/lat/lng があればそこを見せる（写真ページからの導線）", async () => {
        window.location.hash = "#12/48.86/2.35";
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [48.86, 2.35], zoom: 12 }]);
        expect(state.fitCalls, "ハッシュの位置に寄せたあと全体へ戻している").toBe(0);
    });

    it("このタブで前に見ていた場所があれば、そこから始める（戻るたびに全体へ戻さない）", async () => {
        // 実測: ズーム 6 まで寄って写真を開き、戻ると 1 に戻っていた
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 35.42, lng: 138.88, zoom: 6, hash: "" }));
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [35.42, 138.88], zoom: 6 }]);
        expect(state.fitCalls).toBe(0);
    });

    it("ハッシュが控えを取ったときと同じなら、控え（そのあと動かした場所）を優先する", async () => {
        window.location.hash = "#12/48.86/2.35";
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 48.9, lng: 2.4, zoom: 9, hash: "#12/48.86/2.35" }));
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [48.9, 2.4], zoom: 9 }]);
    });

    it("動かすたびに、見ている場所を控える", async () => {
        window.location.hash = "#12/48.86/2.35";
        await draw([photo("a")]);
        state.center = [41.38, 2.18]; state.zoom = 7;
        // 本物の Leaflet は移動が終わると moveend を出す
        fireMap("moveend");
        const saved = JSON.parse(sessionStorage.getItem("photo-map:view")!);
        expect(saved).toEqual({ lat: 41.38, lng: 2.18, zoom: 7, hash: "#12/48.86/2.35" });
    });
});

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

// **写真の中身は地図の中に描かない。** 押されたことだけを `onSelect` で
// 親へ渡し、中身は画面下のシート（`app/map/MapPhotoSheet.tsx`）が描く。
//
// 地図の中（Leaflet のポップアップ）に組んでいた頃は2つ壊れていた:
//   - 高さが地図に収まらず、低い画面では枠の外へ出ていた（実測 390x844 で
//     3枚 465px・地図の上へ 183px はみ出し、うち1枚は表示も操作もできなかった）
//   - 画像が遅れて入るたびに測り直しが走り、その測り直しが横送りの位置を
//     先頭へ巻き戻していた（実測: 10枚の束で5回送って5回とも先頭へ戻された）
describe("押されたピンを親へ渡す", () => {
    it("ポップアップはもう作らない（地図の高さに縛られないため）", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 10, lng: 10 } })]);
        for (const m of state.markers) expect(m.popup).toBeNull();
    });

    it("単独のピンを押すと、その1枚が渡る", async () => {
        const onSelect = vi.fn();
        await draw([photo("a")], onSelect);
        state.markers[0].clickHandler?.();
        expect(onSelect).toHaveBeenCalledTimes(1);
        const sel = onSelect.mock.calls[0][0] as { photos: MapPhoto[]; index: number };
        expect(sel.photos.map((p) => p.id)).toEqual(["a"]);
        expect(sel.index).toBe(0);
    });

    // 同じ升（約1km に丸めた同じ座標）の写真は**どこまで寄っても割れない**。
    // 束ごと渡して、シートが「1/5」で送れるようにする
    it("これ以上割れない束は、枚数ぶんまとめて渡る", async () => {
        const at = { lat: 35.42, lng: 138.88 };
        const onSelect = vi.fn();
        state.zoom = 19;   // MAP_MAX_ZOOM。これ以上は寄れない
        await draw([photo("a", { coords: at }), photo("b", { coords: at }), photo("c", { coords: at })], onSelect);

        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(cluster, "束のピンが無い").toBeTruthy();
        cluster!.clickHandler?.();
        const sel = onSelect.mock.calls[0][0] as { photos: MapPhoto[]; index: number };
        expect(sel.photos.map((p) => p.id)).toEqual(["a", "b", "c"]);
        expect(sel.index).toBe(0);
    });

    // **まだ割れる束は寄るだけ。** シートに渡すと、寄れば個別に見られる
    // ものまで「1/5」に畳んでしまう
    it("まだ割れる束は寄るだけで、シートには渡さない", async () => {
        const onSelect = vi.fn();
        state.zoom = 4;
        await draw([
            photo("a", { coords: { lat: 35.40, lng: 138.80 } }),
            photo("b", { coords: { lat: 35.44, lng: 138.96 } }),
        ], onSelect);

        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(cluster, "束のピンが無い").toBeTruthy();
        // 最初の「全部のピンが収まる範囲へ」のぶんを差し引く
        const before = state.fitCalls;
        cluster!.clickHandler?.();
        expect(state.fitCalls).toBe(before + 1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("地図の余白を押すと `null`（＝閉じる）が渡る", async () => {
        const onSelect = vi.fn();
        await draw([photo("a")], onSelect);
        fireMap("click");
        expect(onSelect).toHaveBeenCalledWith(null);
    });

    // Leaflet はレイヤーの DOM イベントを**地図にも伝える**（`Layer._fireDOMEvent`
    // が targets にレイヤーと地図を並べて撃つ）。止めるのは
    // `bubblingMouseEvents: false` のレイヤーだけで、`Marker` は既定 false・
    // `Path`（circleMarker）は既定 **true**。渡し忘れると、単独のピンを押した
    // 直後に地図の click（＝閉じる）が走って何も出ない
    it("単独のピンは click を地図へ伝えない（bubblingMouseEvents: false）", async () => {
        await draw([photo("a")]);
        expect(state.markers[0].kind).toBe("circle");
        expect(state.markers[0].opts.bubblingMouseEvents).toBe(false);
    });

    // 束のピンは `keyboard: true` で Tab で来られるが、Leaflet は Enter を
    // click に**変換しない**（以前は `bindPopup` が `keypress` を拾っていた）
    it("束のピンは Enter でも押せる", async () => {
        const at = { lat: 35.42, lng: 138.88 };
        const onSelect = vi.fn();
        state.zoom = 19;
        await draw([photo("a", { coords: at }), photo("b", { coords: at })], onSelect);
        const cluster = state.markers.find((m) => m.kind === "marker")!;
        cluster.keypressHandler?.({ originalEvent: { key: "a" } });
        expect(onSelect).not.toHaveBeenCalled();
        cluster.keypressHandler?.({ originalEvent: { key: "Enter" } });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("`onSelect` を渡さなくても落ちない", async () => {
        await draw([photo("a")]);
        expect(() => { state.markers[0].clickHandler?.(); fireMap("click"); }).not.toThrow();
    });

    // 束の数字は利用者の入力ではない（題を入れていた頃は DOM を組んでいた）
    it("束のピンに入れるのは枚数の数字だけ", async () => {
        const at = { lat: 35.42, lng: 138.88 };
        state.zoom = 19;
        await draw([photo("a", { coords: at }), photo("<img onerror=x>", { coords: at })]);
        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(JSON.stringify(cluster!.opts)).not.toContain("onerror");
    });
});

describe("ズームの位置", () => {
    // 左上に置くと、少しスクロールした帯で固定ヘッダーの下に入り、
    // 半透明のヘッダー越しに「＋」が見えているのに押せない
    // （押すとヘッダーのロゴが反応してトップへ飛ぶ）——実測で確認
    it("左下に置く（固定ヘッダーの下に入らない）", async () => {
        await draw([photo("a")]);
        expect(state.zoomControl).toMatchObject({ position: "bottomleft" });
    });
});

// Leaflet は既定でズームも移動も慣性も動かし、自分では
// `prefers-reduced-motion` を見ない（1.9.4 のソースに参照0件）。
// 実測: ズーム 321ms・ホイール 344ms・指を離してから 464ms 滑る
describe("動きを減らす設定", () => {
    it("既定では今までどおり動かす", async () => {
        await draw([photo("a")]);
        expect(state.mapOpts).toMatchObject({ zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: true, inertia: true });
    });

    it("設定が入っていたら、ズーム・淡色・慣性を止める", async () => {
        setReducedMotion(true);
        await draw([photo("a")]);
        expect(state.mapOpts).toMatchObject({ zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
    });

    // 束を押したときの寄せも同じ（`fitBounds` だけ止めても、ズームボタン・
    // ホイール・慣性が残る＝上の4つと両方が要る）
    it("束を押したときの寄せも止める", async () => {
        setReducedMotion(true);
        await draw([photo("a"), photo("b", { coords: { lat: 35.6, lng: 139.9 } })]);
        state.markers.find((m) => m.kind === "marker")?.clickHandler?.();
        expect(state.fitOpts).toMatchObject({ animate: false });
    });

    // **設定が無いときに `animate: true` を渡してはいけない。** Leaflet の
    // `options.animate !== true && !getSize().contains(offset)`（leaflet-src.js:4787）は
    // 「1画面より遠い行き先は動かさない」安全弁で、`true` はそれを外す。
    // 設定を入れていない人にまで「画面端の束を押すと約1秒かけて滑る」が起きる
    it("設定が無いときは寄せ方を Leaflet に任せる（true を渡さない）", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 35.6, lng: 139.9 } })]);
        state.markers.find((m) => m.kind === "marker")?.clickHandler?.();
        expect(state.fitOpts?.animate, "true を渡すと Leaflet の安全弁が外れる").toBeUndefined();
    });
});

// 地図のポップアップのサムネは `document.createElement("img")` で組む＝
// JSX の入口を数えるテスト（`app/__tests__/imageOriginSites.test.ts`）から
// 見えない場所。ここで描画として見る。
