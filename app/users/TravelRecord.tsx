"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { arcControls, countriesLine, routeShape, type LatLng } from "../../lib/utils/travelRoute";

/**
 * マイページの「旅の記録」（案 H1「星図」・iOS の `TravelRecordView.swift` と同じ形）。
 *
 * - 真鍮の眉ラベル「旅の記録」と、右へ消えていく真鍮の細線。右端に一番古い写真の年
 * - **数字が主**: 距離は SF の等幅数字（数の段と同じ semibold）に小さな灰の km、国・地域は右
 * - **写真をつないだ線**（`lib/utils/travelRoute.ts`）: 距離と同じ写真・同じ順に撮影地を結んだ形を、
 *   ごく薄い経度・緯度の格子の上に。古い区間ほど薄い真鍮、一番新しい点だけ明るい真鍮
 * - 画面に出たとき**一度だけ**古い順に線を引く。`prefers-reduced-motion` の人には動かさない
 *   （静的な HTML では最初から引き終えた形で出る＝JS が無くても線は見える）
 *
 * 真鍮は黒い地の上だけ（このページの本文は黒地）。数字は白（真鍮は合図と飾りの色）。
 *
 * **人のページにも出す**（2026-10-21・iOS の `TravelRecordSection(isMine: false)`）。数はその人の
 * 公開写真だけから作る（呼ぶ側の `profileTripPhotos`）。**押して撮影地マップへ行けるのは本人だけ**
 * ——地図は全員の写真なので、人のページで押せると「この人の旅の続き」に見えて別のものへ連れて行く。
 * `href` を渡さなければ、押せない塊（`role="group"`）で描く。
 */

/** 線の高さ（iOS と同じ 100。上下 26 は弧のふくらみの分） */
export const ROUTE_HEIGHT = 100;
const INSET = 6;
const BAND = 26;
/** 幅が測れるまでの仮の幅（板の 358） */
const DEFAULT_WIDTH = 358;
/** 線を引き終えるまで（iOS の 1.6 秒） */
const DRAW_MS = 1600;

/** 線の伸び方（ゆっくり出て、ゆっくり止まる） */
function ease(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function reducedMotion(): boolean {
    try {
        return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}

/** 一度だけ線を引く（Web Animations。使えない環境では何もしない＝引き終えた形のまま） */
function play(svg: SVGSVGElement) {
    const segments = Array.from(svg.querySelectorAll<SVGPathElement>("[data-seg]"));
    const n = segments.length;
    if (n === 0 || typeof segments[0].animate !== "function") return;
    segments.forEach((seg, i) => {
        const start = DRAW_MS * ease(i / n);
        const end = DRAW_MS * ease((i + 1) / n);
        seg.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
            { delay: start, duration: Math.max(1, end - start), easing: "linear", fill: "backwards" });
    });
    // 点は線が届いたときに出す
    svg.querySelectorAll<SVGCircleElement>("[data-dot]").forEach((dot) => {
        const k = Number(dot.dataset.dot);
        dot.animate([{ opacity: 0 }, { opacity: Number(dot.getAttribute("opacity") ?? 1) }],
            { delay: DRAW_MS * ease(k / n), duration: 160, fill: "backwards" });
    });
    svg.querySelector<SVGCircleElement>("[data-latest]")?.animate([{ opacity: 0 }, { opacity: 1 }],
        { delay: DRAW_MS, duration: 200, fill: "backwards" });
    // 最後の点の光が一度だけ広がる
    svg.querySelector<SVGCircleElement>("[data-halo]")?.animate([
        { transform: "scale(0.33)", opacity: 0, offset: 0 },
        { transform: "scale(0.33)", opacity: 0.55, offset: 0.01 },
        { transform: "scale(1.6)", opacity: 0, offset: 0.7 },
        { transform: "scale(1)", opacity: 0.35, offset: 1 },
    ], { delay: DRAW_MS - 100, duration: 1800, easing: "ease-out", fill: "backwards" });
}

function TravelRoute({ coordinates }: { coordinates: LatLng[] }) {
    const shape = useMemo(() => routeShape(coordinates), [coordinates]);
    const boxRef = useRef<HTMLSpanElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [width, setWidth] = useState(DEFAULT_WIDTH);

    // 幅に合わせて描き直す（伸縮させると点が楕円になり、線の太さも割れる）
    useEffect(() => {
        const box = boxRef.current;
        if (!box || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver((entries) => {
            const w = Math.round(entries[0]?.contentRect.width ?? 0);
            if (w > 0) setWidth(w);
        });
        ro.observe(box);
        return () => ro.disconnect();
    }, []);

    // 画面に出たとき一度だけ
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg || reducedMotion() || typeof IntersectionObserver === "undefined") return;
        let done = false;
        const io = new IntersectionObserver((entries) => {
            if (done || !entries.some((e) => e.isIntersecting)) return;
            done = true;
            io.disconnect();
            play(svg);
        }, { threshold: 0.4 });
        io.observe(svg);
        return () => io.disconnect();
    }, []);

    if (!shape) return null;
    const rect = { x: INSET, y: BAND, w: Math.max(1, width - INSET * 2), h: Math.max(1, ROUTE_HEIGHT - BAND * 2) };
    const px = (p: { x: number; y: number }) => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
    const points = shape.points.map(px);
    const controls = arcControls(shape.points, { width: rect.w, height: rect.h }, BAND).map(px);
    const segCount = points.length - 1;
    const r = (v: number) => Math.round(v * 10) / 10;
    const newest = points[points.length - 1];

    return (
        <span ref={boxRef} className="block w-full">
            <svg
                ref={svgRef}
                data-testid="travel-route"
                aria-hidden="true"
                width={width}
                height={ROUTE_HEIGHT}
                viewBox={`0 0 ${width} ${ROUTE_HEIGHT}`}
                style={{ display: "block", overflow: "visible", maxWidth: "100%" }}
            >
                {/* 経度・緯度の格子（白 7%・0.5）。線の通る範囲だけ */}
                <g style={{ stroke: "rgb(255 255 255 / 0.07)" }} strokeWidth={0.5}>
                    {shape.meridians.map((m, i) => {
                        const x = r(rect.x + m * rect.w);
                        return <line key={`m${i}`} x1={x} x2={x} y1={0} y2={ROUTE_HEIGHT} />;
                    })}
                    {shape.parallels.map((p, i) => {
                        const y = r(rect.y + p * rect.h);
                        return <line key={`p${i}`} x1={0} x2={width} y1={y} y2={y} />;
                    })}
                </g>
                {/* 線。区間ごとの弧（行きは上・帰りは下）。古い区間ほど薄い真鍮 */}
                <g fill="none" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--color-accent)" }}>
                    {points.slice(1).map((b, i) => {
                        const a = points[i];
                        const c = controls[i];
                        return (
                            <path
                                key={`s${i}`}
                                data-seg={i}
                                d={`M${r(a.x)} ${r(a.y)}Q${r(c.x)} ${r(c.y)} ${r(b.x)} ${r(b.y)}`}
                                pathLength={1}
                                strokeDasharray="1 1"
                                strokeDashoffset={0}
                                opacity={r(0.35 + 0.65 * ((i + 1) / segCount))}
                            />
                        );
                    })}
                </g>
                {/* 点。古いほど薄い */}
                <g style={{ fill: "var(--color-accent)" }}>
                    {points.slice(0, -1).map((p, k) => (
                        <circle key={`d${k}`} data-dot={k} cx={r(p.x)} cy={r(p.y)} r={1.3}
                                opacity={r(0.45 + 0.45 * (segCount > 1 ? k / (segCount - 1) : 1))} />
                    ))}
                </g>
                {/* 一番新しい写真。明るい真鍮の点と、一度だけ広がる光 */}
                <circle data-halo="" cx={r(newest.x)} cy={r(newest.y)} r={6} fill="none" strokeWidth={0.8} opacity={0.35}
                        style={{ stroke: "var(--color-accent-strong)", transformBox: "fill-box", transformOrigin: "center" }} />
                <circle data-latest="" cx={r(newest.x)} cy={r(newest.y)} r={2} style={{ fill: "var(--color-accent-strong)" }} />
            </svg>
        </span>
    );
}

export default function TravelRecord({ distanceKm, countries, coordinates, firstYear, href, isMine = true, locale }: {
    /** 写真をつないだ距離（km）。null なら距離と線を出さない */
    distanceKm: number | null;
    /** 訪れた国・地域（初めて訪れた順）。空なら国を出さない */
    countries: string[];
    /** 撮影地（距離と同じ写真・同じ順） */
    coordinates: LatLng[];
    firstYear: number | null;
    /** 押した先（本人のページだけ）。無ければ押せない */
    href?: string;
    /** 本人の記録か。人の記録は「公開写真の」と読み上げる */
    isMine?: boolean;
    locale: string;
}) {
    const isJa = locale !== "en";
    const km = distanceKm !== null ? Math.round(distanceKm).toLocaleString("ja-JP") : null;
    const label = [
        isJa ? (isMine ? "旅の記録" : "旅の記録（公開写真から）") : (isMine ? "Travel log" : "Travel log (from public photos)"),
        km !== null ? (isJa ? `写真をつないだ距離 ${km} キロメートル` : `Distance between photos, ${km} kilometers`) : null,
        countries.length > 0
            ? (isJa ? `訪れた国・地域 ${countries.length}、${countries.join("、")}` : `Countries and regions visited, ${countries.length}: ${countries.join(", ")}`)
            : null,
        href ? (isJa ? "撮影地マップを開く" : "Open the photo map") : null,
    ].filter(Boolean).join(isJa ? "。" : ". ");

    const body = (
        <>
            {/* 眉ラベル（`eyebrow`）。右へ消える真鍮の線（55% → 0）の後ろに「◯年から」を置くので、線は `eyebrow-line` ではなく手で置く */}
            <span className="flex items-center gap-2.5 eyebrow text-accent">
                <span className="flex-shrink-0">{isJa ? "旅の記録" : "TRAVEL LOG"}</span>
                <span aria-hidden="true" className="flex-1 h-px"
                      style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 55%, transparent), transparent)" }} />
                {firstYear !== null && (
                    <span className="flex-shrink-0 normal-case text-white/60 tabular-nums" style={{ fontSize: "12px", fontWeight: 500, letterSpacing: "0.04em" }}>
                        {isJa ? `${firstYear} 年から` : `Since ${firstYear}`}
                    </span>
                )}
            </span>

            <span className="mt-3 flex items-start justify-between gap-3">
                {km !== null ? (
                    <span className="min-w-0" data-testid="travel-distance">
                        <span className="block leading-none whitespace-nowrap">
                            <span className="tabular-nums" style={{ fontSize: "30px", fontWeight: 600, letterSpacing: "-0.02em" }}>{km}</span>
                            <span className="text-white/60" style={{ fontSize: "13px", marginLeft: "3px" }}>km</span>
                        </span>
                        <span className="block mt-1.5 text-white/60" style={{ fontSize: "12px" }}>
                            {isJa ? "写真をつないだ距離" : "Distance between photos"}
                        </span>
                    </span>
                ) : <span />}
                {countries.length > 0 && (
                    <span className="min-w-0 text-right" data-testid="travel-countries">
                        <span className="block leading-none tabular-nums" style={{ fontSize: "20px", fontWeight: 600, paddingTop: "8px" }}>{countries.length}</span>
                        <span className="block mt-1.5 text-white/60" style={{ fontSize: "12px" }}>
                            {isJa ? "か国・地域" : countries.length === 1 ? "country or region" : "countries & regions"}
                        </span>
                        <span className="block truncate text-white/60" style={{ fontSize: "12px", maxWidth: "12rem" }}>
                            {countriesLine(countries, isJa)}
                        </span>
                    </span>
                )}
            </span>

            {km !== null && (
                <span className="block mt-3">
                    <TravelRoute coordinates={coordinates} />
                </span>
            )}
        </>
    );

    if (!href) {
        // 押せない塊。**読み上げは1回だけ**——`role="group"` に名前を付けて中身も読ませると、
        // 「旅の記録、写真をつないだ距離 …」の後に同じ数と字をもう一度読む（2026-10-21 判断）。
        // まとめた1文を読ませ、見た目の字は読ませない（押せる形の Link と同じ読み方）
        return (
            <div data-testid="travel-record" className="block mb-5 pt-1 pb-2">
                <span className="sr-only">{label}</span>
                <span aria-hidden="true" className="block">{body}</span>
            </div>
        );
    }
    return (
        <Link
            href={href}
            prefetch={false}
            aria-label={label}
            data-testid="travel-record"
            className="block mb-5 pt-1 pb-2 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ touchAction: "manipulation", minHeight: "44px" }}
        >
            {body}
        </Link>
    );
}
