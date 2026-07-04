"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";

type Props = {
    photos: Photo[];
    locale: "ja" | "en";
};

// 撮影地マップ本体。Leaflet は window に依存するため、
// このコンポーネントは必ず dynamic(..., { ssr: false }) 経由で読み込むこと。
export default function MapView({ photos, locale }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<L.Map | null>(null);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: [36.5, 138.0], // 日本のほぼ中心
            zoom: 5,
            scrollWheelZoom: true,
            zoomControl: true,
        });
        mapRef.current = map;

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // 写真マーカーの描画（photos の更新に追従）
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const layer = L.layerGroup().addTo(map);
        const bounds: L.LatLngTuple[] = [];

        for (const photo of photos) {
            const c = photo.coords;
            if (!c || typeof c.lat !== "number" || typeof c.lng !== "number") continue;
            if (photo.published === false) continue;
            bounds.push([c.lat, c.lng]);

            const marker = L.circleMarker([c.lat, c.lng], {
                radius: 9,
                color: "#ffffff",
                weight: 2,
                fillColor: "#38bdf8",
                fillOpacity: 0.85,
            }).addTo(layer);

            // ポップアップは DOM 生成で組み立てる（title等の文字列を innerHTML に入れない）
            const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
            const el = document.createElement("a");
            el.href = ROUTES.PHOTO(photo.id);
            el.style.cssText = "display:block;width:140px;text-decoration:none;color:#111;";
            const img = document.createElement("img");
            img.src = photo.src;
            img.alt = title;
            img.loading = "lazy";
            img.style.cssText = "width:140px;height:100px;object-fit:cover;border-radius:6px;display:block;";
            el.appendChild(img);
            const caption = document.createElement("span");
            caption.textContent = title || (locale === "en" ? "View photo" : "写真を見る");
            caption.style.cssText = "display:block;margin-top:6px;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            el.appendChild(caption);
            if (photo.location) {
                const loc = document.createElement("span");
                loc.textContent = `📍 ${photo.location}`;
                loc.style.cssText = "display:block;margin-top:2px;font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                el.appendChild(loc);
            }
            marker.bindPopup(el, { closeButton: true, minWidth: 150 });
        }

        if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
        }

        return () => {
            layer.remove();
        };
    }, [photos, locale]);

    return <div ref={containerRef} className="w-full h-full" style={{ background: "#0a0d10" }} />;
}
