import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { MAP_MAX_ZOOM } from "@/lib/utils/mapView";

// 地図そのもの（描画・タイル）は jsdom では出せないので Leaflet を差し替え、
// **こちらが Leaflet に何を渡しているか**を見る。
// ここに置いたのは、実ブラウザでしか見えない壊れを踏んだため:
//   コンテナがスタッキングコンテキストを作らず、Leaflet の z-index 400 が
//   ページ全体の土俵に出て `z-50` のヘッダー・メニューを覆っていた。
// CSS と実測が要る話だが、**こちら側の指定が消えたら気づける**ようにする。
//
// **ポップアップはもう作らない**（写真の中身は `app/map/MapPhotoSheet.tsx` が
// 描く）。以前ここに「ポップアップの画像に高さが無く、Leaflet が収まっていると
// 誤って測る」という項目があったが、その作りごと無くなったので落とした
// ——`bindPopup` を呼ばないことは「押されたピンを親へ渡す」の1件が見張っている。

type FakeMarker = {
    kind: string; latlng: unknown; opts: Record<string, unknown>;
    /**
     * `bindPopup` が呼ばれたら入る。**`null` のままであること**を見張る
     * ためだけに在る（ポップアップはもう作らない）。`popupOpts` /
     * `getPopup` / `update` も持っていたが、**誰も見ていない偽物**
     * だったので落とした
     */
    popup: HTMLElement | null;
    clickHandler?: () => void;
    keypressHandler?: (e: { originalEvent?: { key: string } }) => void;
    on: (ev: string, fn: (e?: unknown) => void) => void; addTo: () => FakeMarker;
    bindPopup: (el: HTMLElement) => FakeMarker;
};
const state = vi.hoisted(() => ({
    markers: [] as FakeMarker[], zoom: 4, center: [36, 138] as [number, number],
    zoomControl: null as unknown, mapOpts: null as Record<string, unknown> | null,
    fitOpts: null as Record<string, unknown> | null, fitCalls: 0,
    setViewArgs: [] as Array<{ center: [number, number]; zoom: number }>,
    bounds: { south: 35, west: 139, north: 36, east: 140 },
    fireMap: (() => {}) as (ev: string) => void,
}));
const fireMap = (ev: string) => state.fireMap(ev);

vi.mock("leaflet", () => {
    const handlers: Record<string, Array<() => void>> = {};
    const map = {
        getZoom: () => state.zoom,
        getCenter: () => ({ lat: state.center[0], lng: state.center[1] }),
        // 操作のボタン（容器の外の `<button>`）から呼ぶぶん
        zoomIn: vi.fn(() => { state.zoom += 1; }),
        zoomOut: vi.fn(() => { state.zoom -= 1; }),
        getBounds: () => ({
            getSouth: () => state.bounds.south, getWest: () => state.bounds.west,
            getNorth: () => state.bounds.north, getEast: () => state.bounds.east,
        }),
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
        const m: FakeMarker = {
            kind, latlng, opts, popup: null,
            on: (ev: string, fn: (e?: unknown) => void) => {
                if (ev === "click") m.clickHandler = fn as () => void;
                if (ev === "keypress") m.keypressHandler = fn as FakeMarker["keypressHandler"];
            },
            addTo: () => m,
            bindPopup: (el) => { m.popup = el; return m; },
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
    state.bounds = { south: 35, west: 139, north: 36, east: 140 };
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
        // **境界そのものを置く。** `19` と書いてあったが `MAP_MAX_ZOOM` は
        // **18**——分岐は `map.getZoom() < MAP_MAX_ZOOM` なので、19 では
        // `<` を `<=` に変えても偽のままで**境界を一度も通っていなかった**。
        // 定数を import して、値が動いてもここが追う
        state.zoom = MAP_MAX_ZOOM;
        await draw([photo("a", { coords: at }), photo("b", { coords: at }), photo("c", { coords: at })], onSelect);

        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(cluster, "束のピンが無い").toBeTruthy();
        cluster!.clickHandler?.();
        const sel = onSelect.mock.calls[0][0] as { photos: MapPhoto[]; index: number };
        expect(sel.photos.map((p) => p.id)).toEqual(["a", "b", "c"]);
        expect(sel.index).toBe(0);
    });

    /**
     * **これ以上寄れないなら、割れる束でもシートに渡す。**
     *
     * 分岐は3つの AND（`inner` が在る・**中身の座標が割れている**・
     * `map.getZoom() < MAP_MAX_ZOOM`）。上の「これ以上割れない束」は
     * 3枚とも同じ座標なので**2つ目で偽**になり、ズームの項を一度も
     * 通っていなかった——`state.zoom = 19` と書いてあったのはそのせいで
     * 見過ごされていた（`MAP_MAX_ZOOM` は **18** で、19 は実在しない値）。
     *
     * ここは**座標を割れる形にしたうえで、ズームを上限に置く**。これで
     * `<` を `<=` に変えると落ちる＝境界を実際に通る。
     * 座標は zoom 18 でも同じ升に入る差（約11m）を選んである
     * （`clusterPoints` の升は zoom 18 で約33m 四方）。
     */
    it("上限まで寄っていたら、割れる束でもシートに渡す（寄り直さない）", async () => {
        const onSelect = vi.fn();
        state.zoom = MAP_MAX_ZOOM;
        await draw([
            photo("a", { coords: { lat: 35.42, lng: 138.88 } }),
            photo("b", { coords: { lat: 35.4201, lng: 138.88 } }),
        ], onSelect);

        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(cluster, "束のピンが無い（座標が割れすぎて束にならなかった）").toBeTruthy();
        const before = state.fitCalls;
        cluster!.clickHandler?.();
        expect(state.fitCalls, "上限なのに寄り直している").toBe(before);
        expect(onSelect, "シートに渡していない").toHaveBeenCalledTimes(1);
        const sel = onSelect.mock.calls[0][0] as { photos: MapPhoto[]; index: number };
        expect(sel.photos.map((p) => p.id)).toEqual(["a", "b"]);
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
    // `bubblingMouseEvents: false` のレイヤーだけで、**`Marker` は既定 false**・
    // `Path`（circleMarker）は既定 true。渡し忘れると、単独のピンを押した
    // 直後に地図の click（＝閉じる）が走って何も出ない。
    //
    // **2026-09-22 に単独のピンは `Marker`（写真入りの `divIcon`）になった**
    // ので、既定のまま伝わらない。`circleMarker` に戻すなら
    // `bubblingMouseEvents: false` を明示すること
    it("単独のピンは Marker で描く（click が地図へ伝わらない側）", async () => {
        await draw([photo("a")]);
        expect(state.markers[0].kind).toBe("marker");
        expect(state.markers[0].opts.bubblingMouseEvents, "Path に戻すなら false を明示する").toBeUndefined();
    });

    // モックの②「写真ピン」。地図の上で「どこに何が在るか」が絵で分かる形
    it("単独のピンには写真のサムネを入れる（幅と高さを px で書く）", async () => {
        await draw([photo("a", { thumbSm: "https://cdn.example.com/uploads/a_sm.webp" })]);
        const icon = state.markers[0].opts.icon as { html: HTMLElement; iconSize: number[]; iconAnchor: number[] };
        const img = icon.html.querySelector("img");
        expect(img, "サムネが入っていない").toBeTruthy();
        expect(img!.getAttribute("src")).toContain("a_sm.webp");
        // **px を書かないと Leaflet の `width: auto` が効く**（読み込み前は幅0、
        // 読み込み後は元画像の 256px になってピンが化ける）
        expect(img!.getAttribute("width")).toBe("40");
        expect(img!.getAttribute("height")).toBe("40");
        // 尖りの先が座標（下端を合わせる）
        expect(icon.iconAnchor).toEqual([icon.iconSize[0] / 2, icon.iconSize[1]]);
    });

    // **文字列の HTML を組まない。** 写真の URL を通した差し込みの口になる
    it("ピンの中身は DOM で渡す（HTML の文字列を組まない）", async () => {
        await draw([photo("a")]);
        const icon = state.markers[0].opts.icon as { html: unknown };
        expect(typeof icon.html, "文字列で組んでいる").not.toBe("string");
    });

    it("サムネが無い写真でも描ける（丸だけ残す）", async () => {
        await draw([photo("a", { src: "" } as Partial<Photo>)]);
        const icon = state.markers[0].opts.icon as { html: HTMLElement };
        expect(icon.html.querySelector("img")).toBeNull();
        expect(icon.html.querySelector(".photo-map-pin__tail")).toBeTruthy();
    });

    // 束のピンは `keyboard: true` で Tab で来られるが、Leaflet は Enter を
    // click に**変換しない**（以前は `bindPopup` が `keypress` を拾っていた）
    it("束のピンは Enter でも押せる", async () => {
        const at = { lat: 35.42, lng: 138.88 };
        const onSelect = vi.fn();
        state.zoom = MAP_MAX_ZOOM;
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
        state.zoom = MAP_MAX_ZOOM;
        await draw([photo("a", { coords: at }), photo("<img onerror=x>", { coords: at })]);
        const cluster = state.markers.find((m) => m.kind === "marker");
        expect(JSON.stringify(cluster!.opts)).not.toContain("onerror");
    });
});

// **操作のボタンは Leaflet のコントロールにしない**（2026-09-22・最終版モック）。
// `L.control.zoom` は白い26px四方の `<a href="#">` で、色も大きさもこのサイトと
// 合わず、読み上げには「リンク」と伝わる。地図の容器の**外**に素の `<button>` を
// 置けば、Leaflet のドラッグ・ホイールにも触られない
describe("操作のボタン", () => {
    it("Leaflet のズームコントロールは作らない", async () => {
        await draw([photo("a")]);
        expect(state.zoomControl, "Leaflet 側のコントロールが復活している").toBeNull();
        expect(state.mapOpts?.zoomControl).toBe(false);
    });

    it("＋ と − で地図を寄せ引きする", async () => {
        await draw([photo("a")]);
        const before = state.zoom;
        fireEvent.click(screen.getByRole("button", { name: "拡大" }));
        expect(state.zoom).toBe(before + 1);
        fireEvent.click(screen.getByRole("button", { name: "縮小" }));
        expect(state.zoom).toBe(before);
    });

    // **`z-[1001]` は Leaflet のコントロール層（1000）より前**。そのぶん、
    // 外枠が `isolate` でスタッキングコンテキストを作っていないと、
    // この値がページの土俵に出て固定ヘッダー（z-50）を覆う（`2922526f` と同じ形）
    it("ボタンは地図の枠の中に閉じ込める（外枠が isolate）", async () => {
        await draw([photo("a")]);
        const frame = document.querySelector(".photo-map-frame") as HTMLElement;
        expect(frame, "外枠が無い").toBeTruthy();
        expect(frame.className).toContain("isolate");
        expect(frame.querySelector('[data-testid="map-locate"]'), "ボタンが枠の外にある").toBeTruthy();
    });

    // 「このエリアを検索」。範囲は素の数で親へ渡す（Leaflet の型を外に出さない）
    it("「このエリアを検索」で今の表示範囲を親へ渡す", async () => {
        const onSearchArea = vi.fn();
        render(<PhotoMap photos={[photo("a")]} locale="ja" onSearchArea={onSearchArea} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        fireEvent.click(screen.getByTestId("map-search-area"));
        expect(onSearchArea).toHaveBeenCalledWith({ south: 35, west: 139, north: 36, east: 140 });
    });

    it("範囲が効いているときは、押すと解除になる", async () => {
        const onSearchArea = vi.fn();
        render(<PhotoMap photos={[photo("a")]} locale="ja" onSearchArea={onSearchArea} areaActive />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        const btn = screen.getByTestId("map-search-area");
        expect(btn.textContent).toContain("範囲の指定を解除");
        fireEvent.click(btn);
        expect(onSearchArea).toHaveBeenCalledWith(null);
    });

    it("親が受け取らないなら「このエリアを検索」は出さない", async () => {
        await draw([photo("a")]);
        expect(screen.queryByTestId("map-search-area")).toBeNull();
    });
});

/**
 * **現在地は送らない・保存しない**（owner の指示 2026-09-22）。
 *
 * 地図は動かすたびに中心を `sessionStorage` に控えている。現在地へ寄せた
 * あと控え続けると、**端末のだいたいの位置が残る**（小数4桁＝約11m）。
 * 写真の座標は約1km に丸めて出しているのに、閲覧者自身の位置だけそれより
 * 細かく残るのは筋が通らないので、使った瞬間に消して以後書かない。
 */
describe("現在地", () => {
    const stubGeolocation = (impl: Partial<Geolocation>) => {
        Object.defineProperty(navigator, "geolocation", {
            configurable: true, writable: true, value: impl as Geolocation,
        });
    };

    it("押すと、その位置へ寄る", async () => {
        stubGeolocation({
            getCurrentPosition: (ok) => ok({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition),
        });
        await draw([photo("a")]);
        state.setViewArgs.length = 0;
        fireEvent.click(screen.getByTestId("map-locate"));
        expect(state.setViewArgs).toEqual([{ center: [48.86, 2.35], zoom: 12 }]);
    });

    it("押した時点で控えを消し、以後は見ている場所を控えない", async () => {
        stubGeolocation({
            getCurrentPosition: (ok) => ok({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition),
        });
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 1, lng: 2, zoom: 5, hash: "" }));
        await draw([photo("a")]);
        fireEvent.click(screen.getByTestId("map-locate"));
        expect(sessionStorage.getItem("photo-map:view"), "現在地が控えに残っている").toBeNull();

        // そのあと地図を動かしても書かない
        state.center = [48.86, 2.35]; state.zoom = 12;
        fireEvent.click(screen.getByRole("button", { name: "拡大" }));
        fireMap("moveend");
        expect(sessionStorage.getItem("photo-map:view"), "現在地の近くを控えている").toBeNull();
    });

    it("断られたら、その旨を出す（読み上げにも届ける）", async () => {
        stubGeolocation({
            getCurrentPosition: (_ok, err) => err?.({ code: 1 } as GeolocationPositionError),
        });
        await draw([photo("a")]);
        fireEvent.click(screen.getByTestId("map-locate"));
        const msg = await screen.findByRole("status");
        expect(msg.textContent).toContain("現在地を取得できませんでした");
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


/**
 * 公式撮影地ガイドのピン（`/spots/<slug>`）。
 *
 * ここで固定したいのは3つ:
 *
 *  1. **写真の束に混ぜない**——混ぜると束の数字が「N枚」と名乗ったまま
 *     写真でないものを数える
 *  2. **形を分ける**——写真入りの丸と同じ見た目にすると「ここに写真がある」
 *     と読める（現在地の点を丸にしてあるのと同じ判断）
 *  3. **押すと親へスラッグが渡る**（中身は画面側のシートが描く）
 */
describe("公式撮影地ガイドのピン", () => {
    const SPOT = { slug: "takaya-jinja", name: "高屋神社", region: "香川県 観音寺市", lat: 34.1, lng: 133.6 };

    const drawWithSpot = async (photos: MapPhoto[], onSelectSpot?: (slug: string) => void) => {
        render(<PhotoMap photos={photos} locale="ja" spots={[SPOT]} onSelectSpot={onSelectSpot} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    };

    const spotMarker = () => state.markers.find((m) => String(m.opts.title ?? "").includes("高屋神社"));

    it("写真が1枚も無くてもピンが立つ（投稿0枚でも成立するのが台帳の肝）", async () => {
        await drawWithSpot([]);
        expect(spotMarker()).toBeTruthy();
    });

    /// 🔴 **束の数字は写真の枚数のまま。** 同じ升にスポットが在っても増えない
    it("写真の束には混ざらない", async () => {
        await drawWithSpot([photo("a"), photo("b")]);
        const cluster = state.markers.find((m) => String(m.opts.title ?? "").includes("枚"));
        expect(cluster?.opts.title, "束の数字がスポットを数えている").toBe("2枚");
    });

    /// 🔴 **形を分ける。** 写真のピン（`photo-map-pin`）と同じクラスにしない
    it("写真のピンとは別の形で描く", async () => {
        await drawWithSpot([]);
        // 偽物の `divIcon` は渡された options をそのまま返す（上のモック）
        const icon = spotMarker()?.opts.icon as { html?: HTMLElement; className?: string } | undefined;
        expect(icon?.className).toBe("spot-map-pin-icon");
        expect(icon?.html?.className).toContain("spot-map-pin");
        expect(icon?.html?.className, "写真のピンと同じ見た目にしない").not.toContain("photo-map-pin");
    });

    /// 名前は読み上げにも届く（ピンの中身は印だけ＝文字を持たない）
    it("名前と「公式」を読み上げに渡す", async () => {
        await drawWithSpot([]);
        expect(spotMarker()?.opts.title).toBe("高屋神社（公式撮影スポット）");
        expect(spotMarker()?.opts.alt).toBe("高屋神社（公式撮影スポット）");
        const html = (spotMarker()?.opts.icon as { html?: HTMLElement }).html;
        expect(html?.textContent, "ピンの中に文字を入れない").toBe("");
    });

    it("押すとスラッグが親へ渡る", async () => {
        const onSelectSpot = vi.fn();
        await drawWithSpot([], onSelectSpot);
        spotMarker()?.clickHandler?.();
        expect(onSelectSpot).toHaveBeenCalledWith("takaya-jinja");
    });

    it("Enter でも押せる", async () => {
        const onSelectSpot = vi.fn();
        await drawWithSpot([], onSelectSpot);
        spotMarker()?.keypressHandler?.({ originalEvent: { key: "Enter" } });
        expect(onSelectSpot).toHaveBeenCalledWith("takaya-jinja");
    });

    /// **写真の束の下に隠れない。** 同じ升に束が在ると押せなくなる
    it("写真のピンより手前に置く", async () => {
        await drawWithSpot([photo("a"), photo("b")]);
        expect(Number(spotMarker()?.opts.zIndexOffset ?? 0)).toBeGreaterThan(0);
    });

    it("`onSelectSpot` を渡さなくても落ちない", async () => {
        await drawWithSpot([]);
        expect(() => spotMarker()?.clickHandler?.()).not.toThrow();
    });

    /// 渡さなければ1本も立たない（既定の空配列が毎回作られないことも兼ねる）
    it("スポットを渡さなければ立たない", async () => {
        await draw([photo("a")]);
        expect(state.markers.some((m) => String(m.opts.title ?? "").includes("公式"))).toBe(false);
    });
});
