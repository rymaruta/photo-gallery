import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Bounds, LatLng, MapEngine, MarkerSpec } from "./engine";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from "../utils/mapView";

/**
 * 控えの地図（Leaflet＋OpenStreetMap）。**Apple のマップが使えないときだけ**出す
 * （鍵が無い・Apple の配信に届かない・鍵が断られた。`lib/map/engine.ts`）。
 *
 * **Leaflet は呼ぶときに読む**——`window` に依存するので、トップレベルで
 * import すると静的書き出し（`next build` の事前描画）で落ちる。
 * CSS（`leaflet/dist/leaflet.css`）は `PhotoMap` が読む。
 */
export async function createLeafletEngine(
    el: HTMLElement, opts: { reduceMotion: boolean; isCancelled?: () => boolean },
): Promise<MapEngine | null> {
    const L = await import("leaflet");
    // **読み終えた時点で、もう要らなくなっていたら地図を作らない。** 作ってから
    // 捨てると、入れ替わりの次の回（StrictMode の作り直し・言語の切り替え）が
    // 同じ箱に `L.map` を呼び、"Map container is already initialized" で落ちる
    // ——前の地図はまだ消える前なので、次の地図は作られず真っ白になる
    if (opts.isCancelled?.()) return null;
    const { reduceMotion } = opts;
    // **「動きを減らす」設定を尊重する。** Leaflet は既定でズームも移動も
    // 慣性も動かす（実測: ズーム 321ms・ホイール 344ms・指を離してから
    // 464ms 滑る）。Leaflet 自身は `prefers-reduced-motion` を見ない
    // （1.9.4 のソースに参照 0 件）ので、こちらで渡す。
    // `minZoom`: 引ききると世界1周が地図の高さより短くなり、上下に
    // 下地の黒が出る（実測 390x844: ズーム0 で上 211px・1 で 39px）。
    // **`zoomControl: false`**——ズームは容器の外の `<button>`（`PhotoMap`）
    const map: LeafletMap = L.map(el, {
        zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: MAP_MIN_ZOOM,
        zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion,
        markerZoomAnimation: !reduceMotion, inertia: !reduceMotion,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: MAP_MAX_ZOOM,
        // OpenStreetMap の利用規約: 帯を出す
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const layer: LayerGroup = L.layerGroup().addTo(map);

    return {
        kind: "leaflet",
        getZoom: () => map.getZoom(),
        getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
        getBounds: (): Bounds => {
            const b = map.getBounds();
            return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
        },
        setView: (c: LatLng, zoom: number) => { map.setView([c.lat, c.lng], zoom); },
        // **`animate: true` は渡さない。** Leaflet の
        // `options.animate !== true && !this.getSize().contains(offset)`
        // （`leaflet-src.js:4787`）は「1画面より遠い行き先は動かさない」という
        // 安全弁で、`true` を渡すと**外れる**。止めたいときだけ false
        fitBounds: (b, o) => {
            map.fitBounds([[b.south, b.west], [b.north, b.east]], {
                padding: [o.padding, o.padding], maxZoom: o.maxZoom, animate: o.animate,
            });
        },
        zoomIn: () => { map.zoomIn(); },
        zoomOut: () => { map.zoomOut(); },
        // **ピンの click はここへ来ない。** Leaflet はレイヤーの DOM イベントを
        // 地図にも伝えるが、`bubblingMouseEvents: false` のレイヤーだけは
        // 止める（`leaflet-src.js:4567`）。`Marker` は既定で false
        onBackgroundClick: (fn) => { map.on("click", fn); },
        onZoomEnd: (fn) => { map.on("zoomend", fn); },
        onMoveEnd: (fn) => { map.on("moveend", fn); },
        // 本物は `setView` / `fitBounds` の `movestart` を**同期で**出し終えている
        // ので、初期表示のあとに登録すれば人の操作（とこちらの寄せ）だけが届く
        onceUserMove: (fn) => { map.once("movestart zoomstart", fn); },
        clearMarkers: () => { layer.clearLayers(); },
        addMarker: (s: MarkerSpec) => {
            const marker = L.marker([s.lat, s.lng], {
                icon: L.divIcon({
                    html: s.el,
                    // `className` を渡すと既定の `leaflet-div-icon`（白背景・灰色の枠）は付かない
                    className: s.className ?? "",
                    iconSize: s.size,
                    iconAnchor: s.anchor,
                }),
                title: s.title,
                alt: s.title,
                keyboard: true,
                ...(s.zIndexOffset !== undefined ? { zIndexOffset: s.zIndexOffset } : {}),
            });
            if (s.onActivate) {
                const fn = s.onActivate;
                marker.on("click", fn);
                // Enter でも押せるようにする（ピンは `keyboard: true` で Tab で
                // 来られるが、Leaflet は Enter を click に**変換しない**）
                marker.on("keypress", (e) => {
                    if ((e as { originalEvent?: KeyboardEvent }).originalEvent?.key === "Enter") fn();
                });
            }
            marker.addTo(layer);
        },
        // 現在地の点。色は現在地だけの `--color-location` ＋黒 2px の縁
        // （デザインシステム「黒塗りの真鍮」・iOS と同じ）
        addHereDot: (p) => {
            L.circleMarker([p.lat, p.lng], {
                radius: 7, color: "#000000", weight: 2, fillColor: "#9cc3e6", fillOpacity: 1,
                interactive: false,
            }).addTo(layer);
        },
        invalidateSize: () => { map.invalidateSize({ debounceMoveend: true }); },
        remove: () => { map.remove(); },
    };
}
