"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { buildJourneyPoints } from "@/lib/utils/journey";
import { ROUTES } from "@/lib/routes";

type Props = {
    photos: Photo[];
    locale: "ja" | "en";
    // 撮影日順に写真をつなぐ「足あと」ルートを描く（プロフィールの足あとタブ用）。
    // 全ユーザーの写真を混在表示する /map では意味をなさないため既定は false。
    showRoute?: boolean;
    // Journey Replay: 0 以外に変わると旅の再生を開始。0 に戻すと中断。
    replayToken?: number;
    // 再生が最後まで到達したときに呼ばれる
    onReplayEnd?: () => void;
};

// 撮影地マップ本体。Leaflet は window に依存するため、
// このコンポーネントは必ず dynamic(..., { ssr: false }) 経由で読み込むこと。
export default function MapView({ photos, locale, showRoute = false, replayToken = 0, onReplayEnd }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    // 再生中は静的レイヤーを消してアニメーションだけ見せる
    const [isReplaying, setIsReplaying] = useState(false);
    const onReplayEndRef = useRef(onReplayEnd);
    useEffect(() => { onReplayEndRef.current = onReplayEnd; }, [onReplayEnd]);

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
        if (isReplaying) return; // 再生中はアニメーションレイヤーに任せる

        const layer = L.layerGroup().addTo(map);
        const bounds: L.LatLngTuple[] = [];

        const mappable = photos.filter(
            (p) => p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number" && p.published !== false,
        );

        // 「足あと」ルート: 撮影日（date 優先、なければ createdAt）の昇順で写真をつなぐ。
        // 始点・終点を色分けして「どこから旅が始まりどこで終わったか」が一目でわかるようにする。
        let startId = "";
        let endId = "";
        if (showRoute) {
            const dated = mappable
                .map((p) => ({ p, t: Date.parse(String(p.date ?? p.createdAt ?? "")) }))
                .filter((x) => !isNaN(x.t))
                .sort((a, b) => a.t - b.t)
                .map((x) => x.p);
            if (dated.length >= 2) {
                const routeCoords = dated.map((p) => [p.coords!.lat, p.coords!.lng] as L.LatLngTuple);
                startId = dated[0].id;
                endId = dated[dated.length - 1].id;
                // 下地のグロー + 点線（足あと）の2本重ねで奥行きを出す
                L.polyline(routeCoords, { color: "#38bdf8", weight: 7, opacity: 0.12, lineJoin: "round" }).addTo(layer);
                L.polyline(routeCoords, { color: "#7dd3fc", weight: 2, opacity: 0.9, dashArray: "1 9", lineCap: "round" }).addTo(layer);
            }
        }

        for (const photo of mappable) {
            const c = photo.coords!;
            bounds.push([c.lat, c.lng]);

            const isStart = showRoute && photo.id === startId;
            const isEnd = showRoute && photo.id === endId;
            const fillColor = isStart ? "#34d399" : isEnd ? "#fb7185" : "#38bdf8";

            const marker = L.circleMarker([c.lat, c.lng], {
                radius: isStart || isEnd ? 10 : 9,
                color: "#ffffff",
                weight: 2,
                fillColor,
                // 場所名からのおおよその位置は破線リング + 薄めの塗りで区別する
                ...(photo.geoApprox ? { dashArray: "3 4", fillOpacity: 0.55 } : { fillOpacity: 0.9 }),
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
    }, [photos, locale, showRoute, isReplaying]);

    // Journey Replay: 撮影日順にピンが打たれ、ルートが伸び、写真がポップアップする
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !replayToken) return;
        const pts = buildJourneyPoints(photos);
        if (pts.length < 2) { onReplayEndRef.current?.(); return; }

        setIsReplaying(true);
        const layer = L.layerGroup().addTo(map);
        const glow = L.polyline([], { color: "#38bdf8", weight: 7, opacity: 0.15, lineJoin: "round" }).addTo(layer);
        const line = L.polyline([], { color: "#7dd3fc", weight: 2.5, opacity: 0.95, lineCap: "round" }).addTo(layer);
        let popup: L.Popup | null = null;
        let i = 0;

        map.flyTo([pts[0].lat, pts[0].lng], Math.max(map.getZoom(), 6), { duration: 0.7 });

        const step = () => {
            const p = pts[i];
            glow.addLatLng([p.lat, p.lng]);
            line.addLatLng([p.lat, p.lng]);
            L.circleMarker([p.lat, p.lng], {
                radius: i === 0 || i === pts.length - 1 ? 9 : 7,
                color: "#ffffff",
                weight: 2,
                fillColor: i === 0 ? "#34d399" : i === pts.length - 1 ? "#fb7185" : "#38bdf8",
                fillOpacity: 0.95,
            }).addTo(layer);
            map.panTo([p.lat, p.lng], { animate: true, duration: 0.8 });
            popup?.remove();
            const img = document.createElement("img");
            img.src = p.photo.src;
            img.alt = "";
            img.loading = "eager";
            img.style.cssText = "width:110px;height:78px;object-fit:cover;border-radius:8px;display:block;";
            popup = L.popup({ closeButton: false, autoPan: false, offset: [0, -8] })
                .setLatLng([p.lat, p.lng])
                .setContent(img)
                .openOn(map);
            i++;
        };

        step();
        const timer = window.setInterval(() => {
            if (i >= pts.length) {
                window.clearInterval(timer);
                window.setTimeout(() => {
                    popup?.remove();
                    map.fitBounds(pts.map((p) => [p.lat, p.lng] as L.LatLngTuple), { padding: [50, 50], maxZoom: 10 });
                    setIsReplaying(false);
                    onReplayEndRef.current?.();
                }, 1400);
                return;
            }
            step();
        }, 1000);

        return () => {
            window.clearInterval(timer);
            popup?.remove();
            layer.remove();
            setIsReplaying(false);
        };
    }, [replayToken, photos]);

    return <div ref={containerRef} className="w-full h-full" style={{ background: "#0a0d10" }} />;
}
