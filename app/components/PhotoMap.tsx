"use client";

import React, { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Photo } from "../../lib/data/photos";
import { clusterPoints, boundsOf, type GeoPoint } from "../../lib/utils/mapClusters";
import { MAP_MIN_ZOOM, MAP_MAX_ZOOM, chooseInitialView, readSavedView, saveView } from "../../lib/utils/mapView";

/** 位置情報を持つ写真だけ（`coords` が有限の数であること） */
export type MapPhoto = Photo & { coords: { lat: number; lng: number } };
export function photosWithCoords(photos: readonly Photo[]): MapPhoto[] {
    return photos.filter((p): p is MapPhoto =>
        !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng));
}

/** ピンを押したときに親へ渡すもの。`null` は「閉じる」 */
export type MapSelection = { photos: MapPhoto[]; index: number };

type Point = GeoPoint & { photo: MapPhoto };

/** ピンの半径（px）。束の升はこの直径より少し大きく取る */
const PIN_PX = 9;
const CELL_PX = 56;

/**
 * ピンを押した直後に地図の `click` も鳴るまでの猶予（ms）。
 *
 * Leaflet はレイヤーの DOM イベントを**地図にも伝える**
 * （`Layer._fireDOMEvent` が targets にレイヤーと地図を並べて撃つ）ので、
 * ピンを押すと「選ぶ」の直後に「閉じる」が走る。`stopPropagation` は
 * ベクターと `divIcon` で効き方が違うので、時刻で弾く。
 */
const PIN_CLICK_GRACE_MS = 200;

/**
 * 撮影地の地図。**Leaflet は effect の中で読む**——`window` に依存するので、
 * トップレベルで import すると静的書き出し（`next build` の事前描画）で落ちる。
 * CSS は window に依存しないので普通に import する。
 *
 * ピンは `circleMarker`（ベクター）と `divIcon`（束の数字）だけで描き、
 * Leaflet 既定のマーカー画像は使わない——バンドラ経由だと画像のパスが
 * 壊れる既知の罠で、そもそもこのサイトの見た目に合わない。
 *
 * 束ね方は `lib/utils/mapClusters.ts`（純関数）。ズームが変わるたびに
 * 束ね直す（ズームだけで束が決まる格子なので、移動では変えない）。
 *
 * **写真の中身は地図の中に描かない。** 以前は Leaflet のポップアップに
 * サムネと題を組んでいたが、
 *
 *   - 高さが地図の中に収まらず、低い画面では枠の外へ出ていた
 *     （実測 390x844 で3枚 465px・地図の上へ 183px はみ出し）
 *   - 画像が遅れて入ると測り直しが要り、その測り直しが横送りの位置と
 *     フォーカスを巻き戻していた（送る操作そのものが送れなくなる）
 *   - 束の枚数だけ中身を作るので、枚数に比例して重くなる
 *
 * 今は**押されたことだけ**を `onSelect` で親へ渡し、中身は画面下の
 * シート（`app/map/MapPhotoSheet.tsx`）が描く。地図の高さに縛られない。
 */
export default function PhotoMap({ photos, locale, onSelect }: {
    photos: readonly MapPhoto[];
    locale: "ja" | "en";
    /** ピンが押された（`null` は地図の余白が押された＝閉じる） */
    onSelect?: (selection: MapSelection | null) => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const layerRef = useRef<LayerGroup | null>(null);
    // 最新の写真を effect の外から読む（ズームのたびに束ね直すため）
    const photosRef = useRef(photos);
    photosRef.current = photos;
    // **ref に持つ。** 依存に入れると、親が関数を作り直すたびに地図ごと
    // 建て直すことになる（見ていた場所もズームも消える）
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let cancelled = false;

        void (async () => {
            const L = await import("leaflet");
            if (cancelled || !containerRef.current) return;

            // **「動きを減らす」設定を尊重する。** Leaflet は既定でズームも移動も
            // 慣性も動かす（実測: ズーム 321ms・ホイール 344ms・指を離してから
            // 464ms 滑る）。Leaflet 自身は `prefers-reduced-motion` を見ない
            // （1.9.4 のソースに参照 0 件）ので、こちらで渡す。
            // `fitBounds` だけ止めても、ズームボタン・ホイール・慣性が残る
            const reduceMotion = typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            // ズームは**左下**。左上だと、少しスクロールした帯で固定ヘッダーの
            // 下に入り、半透明のヘッダー越しに「＋」が見えているのに押せない
            // （押すとヘッダーのロゴが反応してトップへ飛ぶ）——実測で確認
            // `minZoom`: 引ききると世界1周が地図の高さより短くなり、上下に
            // 下地の黒が出る（実測 390x844: ズーム0 で上 211px・1 で 39px）。
            // 2 なら 1024px で、スマホの 70vh（≒590px）にも収まる
            const map = L.map(el, {
                zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: MAP_MIN_ZOOM,
                zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion,
                markerZoomAnimation: !reduceMotion, inertia: !reduceMotion,
            });
            L.control.zoom({ position: "bottomleft" }).addTo(map);
            mapRef.current = map;
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: MAP_MAX_ZOOM,
                // OpenStreetMap の利用規約: 帯を出す
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(map);
            const layer = L.layerGroup().addTo(map);
            layerRef.current = layer;

            /** 最後にピンを押した時刻。地図の `click` が続けて鳴るのを弾く */
            let lastPinClick = 0;
            const select = (sel: MapSelection) => {
                lastPinClick = Date.now();
                onSelectRef.current?.(sel);
            };
            // 地図の余白を押したら閉じる。**ピンの直後は閉じない**
            // （Leaflet はレイヤーのイベントを地図にも伝えるため）
            map.on("click", () => {
                if (Date.now() - lastPinClick < PIN_CLICK_GRACE_MS) return;
                onSelectRef.current?.(null);
            });

            const draw = () => {
                layer.clearLayers();
                const points: Point[] = photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng, photo: p }));
                for (const c of clusterPoints(points, map.getZoom(), CELL_PX)) {
                    if (c.items.length === 1) {
                        const { photo } = c.items[0];
                        const marker = L.circleMarker([c.lat, c.lng], {
                            radius: PIN_PX, color: "#ffffff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 0.9,
                        });
                        marker.on("click", () => select({ photos: [photo], index: 0 }));
                        marker.addTo(layer);
                    } else {
                        const icon = L.divIcon({
                            html: `<span>${c.items.length}</span>`,   // 数字だけ（利用者の入力は入らない）
                            className: "photo-map-cluster",
                            iconSize: [34, 34],
                        });
                        const marker = L.marker([c.lat, c.lng], {
                            icon,
                            title: locale === "en" ? `${c.items.length} photos` : `${c.items.length}枚`,
                            keyboard: true,
                        });
                        // **押したら、その束が収まる範囲まで一気に寄る。**
                        // 「2段ずつ寄る」だと、4km 離れた2枚を割るのに5回押す
                        // ことになった（実ブラウザで実測）。
                        // 同じ升（約1km に丸めた同じ座標）の写真は**どこまで寄っても
                        // 割れない**ので、寄れないときは束ごとシートに渡す
                        // （シートが「1/5」で送れるようにする）
                        const inner = boundsOf(c.items);
                        const splittable = !!inner && (inner.north !== inner.south || inner.east !== inner.west) && map.getZoom() < MAP_MAX_ZOOM;
                        if (splittable) {
                            // **`animate: true` は渡さない。** Leaflet の
                            // `options.animate !== true && !this.getSize().contains(offset)`
                            // （`leaflet-src.js:4787`）は「1画面より遠い行き先は
                            // 動かさない」という安全弁で、`true` を渡すと**外れる**。
                            // 設定を入れていない人にまで「画面端の束を押すと約1秒
                            // かけて滑る」が起きる（実測）。止めたいときだけ false
                            marker.on("click", () => {
                                map.fitBounds([[inner.south, inner.west], [inner.north, inner.east]], { padding: [48, 48], maxZoom: MAP_MAX_ZOOM, animate: reduceMotion ? false : undefined });
                            });
                        } else {
                            // これ以上は割れない束。**枚数ぶんまとめてシートに渡し、
                            // 「1/5」で送ってもらう。** 地図の中に横並びのカードを
                            // 作っていた頃は、画像が遅れて入るたびに測り直しが走り、
                            // その測り直しが横送りの位置を先頭へ巻き戻していた
                            // （実測: 10枚の束で5回送って5回とも先頭へ戻された）
                            marker.on("click", () => select({ photos: c.items.map((it) => it.photo), index: 0 }));
                        }
                        marker.addTo(layer);
                    }
                }
            };

            // **最初に見せる場所。** 写真ページから飛んできた（URL のハッシュ）か、
            // このタブで前に見ていた場所（控え）があればそこ。無ければ全部の
            // ピンが収まる範囲。決め方は `chooseInitialView` を参照——
            // 「写真を開いて戻るたびに全体へ戻される」を止めるのが目的
            const initial = chooseInitialView(window.location.hash, readSavedView());
            const b = boundsOf(photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng })));
            if (initial) {
                map.setView([initial.lat, initial.lng], initial.zoom);
            } else if (b) {
                map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [32, 32], maxZoom: 12 });
            } else {
                map.setView([36, 138], 4);   // 写真が無ければ日本全体
            }
            draw();
            map.on("zoomend", draw);
            // 動かすたびに控える。URL は触らない（mapView.ts の冒頭を参照）。
            // **最初の場所は控えに入らない**——上の `setView`/`fitBounds` は
            // `moveend` を同期で出し終えている（Leaflet 1.9.4 を実行して確認:
            // 後付けの listener には 0 回）。それで困らない: 動かしていなければ
            // 控えの有無に関わらずハッシュ／全体表示に戻るので着地は同じ
            map.on("moveend", () => {
                const c = map.getCenter();
                saveView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }, window.location.hash);
            });
        })();

        return () => {
            cancelled = true;
            layerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // 写真が増えたら描き直す（`photosRef` を読むのは draw。ここは初期化だけ）
    }, [locale]);

    // 写真の配列が変わったら、地図を作り直さずにピンだけ描き直す
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        map.fire("zoomend");
    }, [photos]);

    return (
        <div
            ref={containerRef}
            role="region"
            aria-label={locale === "en" ? "Map of shooting locations" : "撮影地マップ"}
            // **`isolate`（isolation: isolate）を外さない。** Leaflet はペインに
            // z-index 400〜1000 を振る。ここでスタッキングコンテキストを作らないと
            // その値がページ全体の土俵に出て、`z-50` のヘッダーとメニューを追い越す
            // ——実測（Chromium・390x844・300px スクロール）: ヘッダー帯の画素が
            // 地図のタイル色になり、ロゴもハンバーガーも見えないまま押せる状態だった。
            // 下地の色は globals.css（`.photo-map-shell`）。ここに `bg-white/5` と
            // 書いても Leaflet の `.leaflet-container { background: #ddd }` と
            // 同じ強さで、読み込み順で負けて効かない（実測 rgb(221,221,221)）
            className="photo-map-shell isolate w-full h-[70vh] min-h-[320px] rounded-2xl overflow-hidden ring-1 ring-white/10"
            data-testid="photo-map"
        />
    );
}
