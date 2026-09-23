"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { SpotLink } from "@/lib/data/spotLink";
import "leaflet/dist/leaflet.css";

/** 公式ガイドの公開位置だけを使う。投稿のGPSや撮影地点の推測は扱わない。 */
export function plottableOfficialSpots(spots: readonly SpotLink[]): SpotLink[] {
    return spots.filter((s) => s.coords
        && Number.isFinite(s.coords.lat) && Number.isFinite(s.coords.lng)
        && Math.abs(s.coords.lat) <= 90 && Math.abs(s.coords.lng) <= 180);
}

export default function OfficialSpotExplorer({ spots, locale }: {
    spots: readonly SpotLink[]; locale: "ja" | "en";
}) {
    const en = locale === "en";
    const plotted = useMemo(() => plottableOfficialSpots(spots), [spots]);
    const [selected, setSelected] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(false);
    const mapContainer = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const layerRef = useRef<LayerGroup | null>(null);
    const spot = plotted.find((s) => s.slug === selected) ?? plotted[0] ?? null;

    // 写真マップとは別のレイヤー。公開スポット0件でマップ初期化をしない。
    useEffect(() => {
        if (!plotted.length || !mapContainer.current) return;
        let cancelled = false;
        void (async () => {
            const L = await import("leaflet");
            if (cancelled || !mapContainer.current) return;
            const reduced = typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const map = L.map(mapContainer.current, {
                zoomControl: true, attributionControl: true, minZoom: 2,
                worldCopyJump: true, zoomAnimation: !reduced,
                fadeAnimation: !reduced, inertia: !reduced,
            });
            mapRef.current = map;
            L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 18,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(map);
            const layer = L.layerGroup().addTo(map);
            layerRef.current = layer;
            // icon HTML に名称や URL を差し込まない。文字はアクセシブルな title と alt に渡す。
            for (const s of plotted) {
                const marker = L.marker([s.coords!.lat, s.coords!.lng], {
                    icon: L.divIcon({
                        className: "jp-official-spot-pin",
                        html: '<span aria-hidden="true"></span>',
                        iconSize: [32, 40], iconAnchor: [16, 40],
                    }),
                    title: s.name, alt: s.name, keyboard: true,
                });
                marker.on("click", () => setSelected(s.slug));
                marker.on("keypress", (event) => {
                    if ((event as { originalEvent?: KeyboardEvent }).originalEvent?.key === "Enter") {
                        setSelected(s.slug);
                    }
                });
                marker.addTo(layer);
            }
            if (plotted.length === 1) {
                map.setView([plotted[0].coords!.lat, plotted[0].coords!.lng], 11);
            } else {
                map.fitBounds(plotted.map((s) => [s.coords!.lat, s.coords!.lng] as [number, number]), {
                    padding: [35, 35], maxZoom: 11,
                });
            }
            setMapReady(true);
        })().catch(() => {
            if (!cancelled) setMapError(true);
        });
        return () => {
            cancelled = true;
            layerRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // マスタは静的ビルドで生成されるので表示中に配列の内容は変化しない。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plotted]);

    const focus = (s: SpotLink) => {
        setSelected(s.slug);
        if (s.coords) mapRef.current?.setView([s.coords.lat, s.coords.lng],
            Math.max(mapRef.current.getZoom(), 10), { animate: false });
    };

    if (!spots.length) return null;

    return (
        <section className="jp-official-map">
            <header className="mb-3">
                <p className="m-0 text-[11px] font-semibold tracking-[0.14em] text-link">JOURNEY GUIDE / MAP</p>
                <h2 className="m-0 mt-1 font-serif text-[22px] font-bold text-white">
                    {en ? "Find your next view" : "次に撮りたい景色を、地図から"}
                </h2>
                <p className="m-0 mt-1 text-xs leading-5 text-white/70">
                    {en ? "Officially published guides appear even when nobody has posted a photo."
                        : "ユーザーの投稿がなくても、公開中の公式撮影地ガイドから探せます。"}
                </p>
            </header>
            {plotted.length > 0 ? (
                <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-5">
                    <div className="order-2 min-w-0 lg:order-1">
                        {spot && <div className="mb-3 overflow-hidden rounded-2xl border border-line bg-surface">
                            <Link href={`/spots/${spot.slug}`} prefetch={false}
                                  className="group flex items-center gap-3 p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
                                <SpotCover spot={spot} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[11px] font-semibold text-link">{en ? "OFFICIAL GUIDE" : "公式撮影地ガイド"}</span>
                                    <span className="block font-serif text-[17px] font-semibold text-white">{spot.name}</span>
                                    {spot.region && <span className="mt-0.5 block text-xs text-white/70">{spot.region}</span>}
                                    <span className="mt-1 block text-xs text-link">{en ? "View the guide →" : "撮影ガイドを見る →"}</span>
                                    {spot.cover?.credit && <span className="mt-1 block break-words text-[11px] leading-4 text-white/75">{spot.cover.credit}</span>}
                                </span>
                            </Link>
                        </div>}
                        <ul className="m-0 flex max-h-[28vh] flex-col gap-1 overflow-y-auto p-0 lg:max-h-[calc(100dvh-390px)]" style={{ listStyle: "none" }}>
                            {plotted.map((s) => (
                                <li key={s.slug}>
                                    <button type="button" onClick={() => focus(s)}
                                            aria-pressed={spot?.slug === s.slug}
                                            className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${spot?.slug === s.slug ? "bg-surface-2 text-white" : "text-white/75 hover:bg-surface"}`}>
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium">{s.name}</span>
                                            {s.region && <span className="block truncate text-[11px] text-white/60">{s.region}</span>}
                                        </span>
                                        <span aria-hidden="true" className="text-link">⌖</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="order-1 relative min-w-0 overflow-hidden rounded-2xl border border-line bg-surface-2 lg:order-2">
                        <div ref={mapContainer} role="region"
                             aria-label={en ? "Map of published official spots" : "公開済み公式スポットの地図"}
                             className="jp-official-map__canvas h-[50dvh] min-h-[300px] lg:h-[calc(100dvh-220px)] lg:min-h-[480px]" />
                        {!mapReady && <p role={mapError ? "alert" : "status"} className="pointer-events-none absolute left-3 top-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-white/85">
                            {mapError ? (en ? "Couldn\u0027t load the map. Open a guide from the list." : "地図を読み込めませんでした。左の一覧から撮影地を選べます。") : (en ? "Loading map…" : "地図を読み込み中…")}
                        </p>}
                    </div>
                </div>
            ) : <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-white/70">
                {en ? "No published spots have a confirmed public map location yet." : "公開できる地図上の位置が確認されたスポットは、まだありません。"}
            </div>}
            {spots.length > plotted.length && (
                <div className="mt-4">
                    <h3 className="mb-2 text-sm font-semibold text-white">{en ? "More official guides" : "その他の撮影地ガイド"}</h3>
                    <div className="flex flex-wrap gap-2">
                        {spots.filter((s) => !plotted.includes(s)).map((s) => (
                            <Link key={s.slug} href={`/spots/${s.slug}`} prefetch={false}
                                  className="rounded-full border border-line bg-surface px-3 py-2 text-sm text-white/85 hover:text-link">
                                {s.name}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}

function SpotCover({ spot }: { spot: SpotLink }) {
    return (
        <span className="relative flex h-[90px] w-[90px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-3xl text-link">
            {spot.cover ? <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spot.cover.src} alt={spot.cover.alt} loading="lazy" decoding="async"
                     className="h-full w-full object-cover" />
            </> : <span aria-hidden="true">⌖</span>}
        </span>
    );
}
