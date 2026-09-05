"use client";

import React, { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Photo } from "../../lib/data/photos";
import { ROUTES } from "../../lib/routes";
import { clusterPoints, boundsOf, type GeoPoint } from "../../lib/utils/mapClusters";

/** 位置情報を持つ写真だけ（`coords` が有限の数であること） */
export type MapPhoto = Photo & { coords: { lat: number; lng: number } };
export function photosWithCoords(photos: readonly Photo[]): MapPhoto[] {
    return photos.filter((p): p is MapPhoto =>
        !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng));
}

type Point = GeoPoint & { photo: MapPhoto };

/** ピンの半径（px）。束の升はこの直径より少し大きく取る */
const PIN_PX = 9;
const CELL_PX = 56;
/** タイルの最大ズーム（OSM の標準タイルは 19 まであるが 18 で十分） */
const MAX_ZOOM = 18;

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
 */
export default function PhotoMap({ photos, locale }: { photos: readonly MapPhoto[]; locale: "ja" | "en" }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const layerRef = useRef<LayerGroup | null>(null);
    // 最新の写真を effect の外から読む（ズームのたびに束ね直すため）
    const photosRef = useRef(photos);
    photosRef.current = photos;

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let cancelled = false;

        void (async () => {
            const L = await import("leaflet");
            if (cancelled || !containerRef.current) return;

            const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: true });
            mapRef.current = map;
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: MAX_ZOOM,
                // OpenStreetMap の利用規約: 帯を出す
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(map);
            const layer = L.layerGroup().addTo(map);
            layerRef.current = layer;

            /** 1枚ぶんのポップアップ（サムネ・タイトルへのリンク・地名）。
             *  **HTML 文字列を組まない。** タイトルは利用者の入力なので、
             *  文字列で innerHTML に入れると注入できる。DOM を作って渡す */
            const cardFor = (photo: MapPhoto): HTMLElement => {
                const a = document.createElement("a");
                a.href = ROUTES.PHOTO(photo.id);
                a.textContent = titleOf(photo, locale);
                a.className = "block text-sm font-semibold";
                const box = document.createElement("div");
                if (photo.thumbSrc || photo.src) {
                    const img = document.createElement("img");
                    img.src = photo.thumbSrc || photo.src;
                    img.alt = "";
                    img.width = 160;
                    img.loading = "lazy";
                    img.className = "rounded-md mb-1 block";
                    box.appendChild(img);
                }
                box.appendChild(a);
                if (photo.location) {
                    const loc = document.createElement("div");
                    loc.textContent = photo.location + (photo.geoApprox ? (locale === "en" ? " (approx.)" : "（おおよそ）") : "");
                    loc.className = "text-xs text-gray-600";
                    box.appendChild(loc);
                }
                return box;
            };

            const draw = () => {
                layer.clearLayers();
                const points: Point[] = photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng, photo: p }));
                for (const c of clusterPoints(points, map.getZoom(), CELL_PX)) {
                    if (c.items.length === 1) {
                        const { photo } = c.items[0];
                        const marker = L.circleMarker([c.lat, c.lng], {
                            radius: PIN_PX, color: "#ffffff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 0.9,
                        });
                        marker.bindPopup(cardFor(photo), { maxWidth: 200 });
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
                        // 割れない**ので、寄れないときは一覧のポップアップを出す
                        const inner = boundsOf(c.items);
                        const splittable = !!inner && (inner.north !== inner.south || inner.east !== inner.west) && map.getZoom() < MAX_ZOOM;
                        if (splittable) {
                            marker.on("click", () => {
                                map.fitBounds([[inner.south, inner.west], [inner.north, inner.east]], { padding: [48, 48], maxZoom: MAX_ZOOM });
                            });
                        } else {
                            const list = document.createElement("div");
                            list.className = "photo-map-list";
                            for (const it of c.items) list.appendChild(cardFor(it.photo));
                            marker.bindPopup(list, { maxWidth: 200, maxHeight: 320 });
                        }
                        marker.addTo(layer);
                    }
                }
            };

            const b = boundsOf(photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng })));
            if (b) {
                map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [32, 32], maxZoom: 12 });
            } else {
                map.setView([36, 138], 4);   // 写真が無ければ日本全体
            }
            draw();
            map.on("zoomend", draw);
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
            className="w-full h-[70vh] min-h-[320px] rounded-2xl overflow-hidden ring-1 ring-white/10 bg-white/5"
            data-testid="photo-map"
        />
    );
}

function titleOf(photo: Photo, locale: "ja" | "en"): string {
    const t = photo.title;
    if (typeof t === "string") return t || (locale === "en" ? "Untitled" : "無題");
    if (t && typeof t === "object") {
        const v = (t as Record<string, unknown>)[locale] ?? (t as Record<string, unknown>).ja ?? (t as Record<string, unknown>).en;
        if (typeof v === "string" && v) return v;
    }
    return locale === "en" ? "Untitled" : "無題";
}
