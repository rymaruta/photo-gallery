"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline, XMarkIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useFocusTrap, isBehindPriorityOverlay } from "../../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../../lib/utils/scrollLock";
import { publicImageUrl } from "../../../lib/utils/seo";
import { NO_TAP, doubleTapAction, isDoubleTap, type TapMark } from "../../../lib/utils/doubleTap";
import { hapticTap } from "../../../lib/utils/haptics";

/**
 * **写真を全画面で見る**（iOS の `PhotoViewerView`・板 14 PhotoViewer・2026-10-21）。
 * 写真ページのヒーローを押すと開く。
 *
 * - 両指で広げて拡大（1〜4倍）。**離しても倍率を保つ**。拡大中は1本指で動かす
 *   （PC はホイール・トラックパッドのつまみ、キーボードの `+` `-` `0`）
 * - **2回叩いていいね**。決まりは一覧のモーダルと同じ1つ（`lib/utils/doubleTap.ts`）——
 *   いいね済みは消さない・**拡大中の2回叩きは倍率を戻す**
 * - 等倍のとき: 横に払って前後の写真、下に払って閉じる。前後の写真へ送ったら倍率を戻す
 * - Esc で閉じる・フォーカスを閉じ込める・閉じたら開いたボタンへ戻す（`useFocusTrap`）
 * - 閉じるは左上のガラスの丸（44px・板の「写真の上」の戻り方）。写真の上なので白だけ
 */

export type ViewerImage = { src: string; srcAvif?: string };

type Props = {
    images: readonly ViewerImage[];
    index: number;
    onIndexChange: (index: number) => void;
    /** 何枚目の写真の alt（題 → 撮影地。写真ページと同じ規則） */
    altFor: (index: number) => string;
    /** ダイアログの名前（写真の題か代わりの題） */
    title: string;
    liked: boolean;
    likeCount: number;
    likePending?: boolean;
    /** いいねを切り替える（下のハート）。2回叩きは「付ける」ときだけこれを呼ぶ */
    onToggleLike: () => void;
    onClose: () => void;
    locale: "ja" | "en";
};

export const MAX_SCALE = 4;
const SWIPE_PX = 50;
const CLOSE_SWIPE_PX = 80;
/** これより動いたら「叩いた」ではなく「動かした」 */
const MOVE_SLOP = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function PhotoViewer({
    images, index, onIndexChange, altFor, title, liked, likeCount, likePending = false,
    onToggleLike, onClose, locale,
}: Props) {
    const en = locale === "en";
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeRef = useRef<HTMLButtonElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    /** 指で動かしている最中（その間は動きの補間を切る） */
    const [gesturing, setGesturing] = useState(false);
    const [burst, setBurst] = useState(0);

    const scaleRef = useRef(scale);
    useEffect(() => { scaleRef.current = scale; }, [scale]);
    const offsetRef = useRef(offset);
    useEffect(() => { offsetRef.current = offset; }, [offset]);

    const total = images.length;
    const safeIndex = clamp(index, 0, Math.max(0, total - 1));
    const current = images[safeIndex];

    useFocusTrap(true, dialogRef, undefined, closeRef);
    useEscapeKey(true, onClose);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    const resetZoom = useCallback(() => {
        scaleRef.current = 1;
        offsetRef.current = { x: 0, y: 0 };
        setScale(1);
        setOffset({ x: 0, y: 0 });
    }, []);
    // **どの経路で送っても倍率と位置を戻す**（拡大したまま次の写真が出ない）。
    // 描画の中で前の添字と比べて戻す（エフェクトで戻すと、拡大した1コマが次の写真に出る）
    const [shownIndex, setShownIndex] = useState(safeIndex);
    if (shownIndex !== safeIndex) {
        setShownIndex(safeIndex);
        setScale(1);
        setOffset({ x: 0, y: 0 });
    }
    const lastTapRef = useRef<TapMark>(NO_TAP);
    useEffect(() => { lastTapRef.current = NO_TAP; }, [safeIndex]);

    const go = useCallback((delta: number) => {
        if (total < 2) return;
        onIndexChange((safeIndex + delta + total) % total);
    }, [total, safeIndex, onIndexChange]);

    /** 拡大した写真がはみ出す分だけ動かせる（外の黒を引き出さない） */
    const clampOffset = useCallback((o: { x: number; y: number }, s: number) => {
        const stage = stageRef.current?.getBoundingClientRect();
        const img = imgRef.current;
        if (!stage || !img) return o;
        const w = img.offsetWidth * s, h = img.offsetHeight * s;
        const mx = Math.max(0, (w - stage.width) / 2), my = Math.max(0, (h - stage.height) / 2);
        return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) };
    }, []);

    const zoomTo = useCallback((next: number) => {
        const s = clamp(next, 1, MAX_SCALE);
        if (s <= 1.01) { resetZoom(); return; }
        const prev = scaleRef.current;
        scaleRef.current = s;
        setScale(s);
        setOffset((o) => clampOffset({ x: o.x * (s / prev), y: o.y * (s / prev) }, s));
    }, [clampOffset, resetZoom]);

    // ---- 指の操作（Pointer Events。マウス・指・ペンを同じ口で） ----
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<{
        start: { x: number; y: number; ox: number; oy: number } | null;
        pinch: { dist: number; scale: number } | null;
        moved: boolean;
        pinched: boolean;
    }>({ start: null, pinch: null, moved: false, pinched: false });

    const distance = () => {
        const [a, b] = [...pointers.current.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (pointers.current.size === 1) {
            g.moved = false;
            g.pinched = false;
            g.start = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
        } else if (pointers.current.size === 2) {
            g.pinch = { dist: distance() || 1, scale: scaleRef.current };
            g.pinched = true;
            g.moved = true;
        }
        setGesturing(true);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (pointers.current.size >= 2 && g.pinch) {
            const s = clamp(g.pinch.scale * (distance() / g.pinch.dist), 1, MAX_SCALE);
            const prev = scaleRef.current;
            scaleRef.current = s;
            setScale(s);
            setOffset((o) => clampOffset({ x: o.x * (s / prev), y: o.y * (s / prev) }, s));
            return;
        }
        if (!g.start) return;
        const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
        if (Math.hypot(dx, dy) > MOVE_SLOP) g.moved = true;
        // 拡大中だけ写真を動かす。等倍のときは払う向きを離したときに読む
        if (scaleRef.current > 1) setOffset(clampOffset({ x: g.start.ox + dx, y: g.start.oy + dy }, scaleRef.current));
    };

    const onPointerEnd = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.delete(e.pointerId);
        const g = gesture.current;
        if (pointers.current.size === 1) {
            // 2本指の片方を離した: 残った指から動かし直す（跳ねない）
            const [rest] = [...pointers.current.values()];
            g.pinch = null;
            g.start = { x: rest.x, y: rest.y, ox: offsetRef.current.x, oy: offsetRef.current.y };
            return;
        }
        if (pointers.current.size > 0) return;
        setGesturing(false);
        if (g.pinched) {
            g.pinch = null;
            if (scaleRef.current <= 1.01) resetZoom();
            return;
        }
        if (!g.start || scaleRef.current > 1 || e.type === "pointercancel") return;
        const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        else if (dy > CLOSE_SWIPE_PX && dy > Math.abs(dx)) onClose();
    };

    /** 叩いた（動かしていない）ときだけ。2回目なら決まりに従う */
    const onStageClick = (e: React.MouseEvent) => {
        if (gesture.current.moved) { gesture.current.moved = false; return; }
        const tap = { t: Date.now(), x: e.clientX, y: e.clientY };
        if (!isDoubleTap(lastTapRef.current, tap)) { lastTapRef.current = tap; return; }
        lastTapRef.current = NO_TAP;
        const action = doubleTapAction({ isZoomed: scaleRef.current > 1, alreadyLiked: liked });
        if (action === "resetZoom") { resetZoom(); return; }
        if (action === "like") onToggleLike();
        else hapticTap();
        setBurst(tap.t);
    };

    // ホイール・トラックパッドのつまみで拡大（ページは固定してあるので奪ってよい）。
    // React の onWheel は受け身（preventDefault が効かない）なので自分で張る
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
            zoomTo(scaleRef.current * factor);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoomTo]);

    // 矢印で前後・`+` `-` `0` で拡大（Esc は `useEscapeKey`）
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isBehindPriorityOverlay()) return;
            if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(scaleRef.current * 1.5); }
            else if (e.key === "-") { e.preventDefault(); zoomTo(scaleRef.current / 1.5); }
            else if (e.key === "0") { e.preventDefault(); resetZoom(); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [go, zoomTo, resetZoom]);

    if (!current) return null;
    const zoomed = scale > 1;
    const glass = "inline-flex items-center justify-center rounded-full bg-black/55 backdrop-blur-md text-white hover:bg-black/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={en ? `${title} (full screen)` : `${title}（全画面）`}
            className="fixed inset-0 z-50 bg-black text-white select-none"
            data-testid="photo-viewer"
        >
            <div
                ref={stageRef}
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                style={{ touchAction: "none", cursor: zoomed ? "grab" : "zoom-in" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onClick={onStageClick}
                data-testid="photo-viewer-stage"
                data-scale={scale.toFixed(2)}
            >
                <picture className="contents">
                    {current.srcAvif && <source type="image/avif" srcSet={publicImageUrl(current.srcAvif)} />}
                    <img
                        ref={imgRef}
                        key={current.src}
                        src={publicImageUrl(current.src)}
                        alt={altFor(safeIndex)}
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        className="max-w-full max-h-full object-contain"
                        style={{
                            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                            transition: gesturing ? "none" : "transform 200ms ease-out",
                            WebkitTouchCallout: "none",
                        }}
                    />
                </picture>
                {burst > 0 && (
                    <div key={burst} className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
                        <HeartIcon className="w-24 h-24 text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] heart-burst"
                                   onAnimationEnd={() => setBurst(0)} />
                    </div>
                )}
            </div>

            {/* 上の列: 左に閉じる・真ん中に「1 / N」。時計の帯（ホーム画面から起動したとき）の下に置く */}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pointer-events-none"
                 style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}>
                <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label={en ? "Close" : "閉じる"}
                    className={`${glass} pointer-events-auto`}
                    style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                >
                    <XMarkIcon aria-hidden="true" style={{ width: "22px", height: "22px" }} />
                </button>
                {total > 1 && (
                    <>
                        <p aria-hidden="true" className="m-0 px-3 py-1 rounded-full bg-black/55 backdrop-blur-md tabular-nums"
                           style={{ fontSize: "13px", lineHeight: "18px" }}>
                            {safeIndex + 1} / {total}
                        </p>
                        <p className="sr-only" aria-live="polite">
                            {en ? `Photo ${safeIndex + 1} of ${total}` : `${total}枚中${safeIndex + 1}枚目`}
                        </p>
                    </>
                )}
                {/* 左右の釣り合いを取るだけの空き（閉じると同じ幅） */}
                <span aria-hidden="true" style={{ width: "44px" }} />
            </div>

            {total > 1 && !zoomed && (
                <>
                    <button type="button" onClick={() => go(-1)} aria-label={en ? "Previous photo" : "前の写真"}
                            className={`${glass} absolute left-3 top-1/2 -translate-y-1/2`}
                            style={{ width: "44px", height: "44px", touchAction: "manipulation" }}>
                        <ChevronLeftIcon aria-hidden="true" style={{ width: "24px", height: "24px" }} />
                    </button>
                    <button type="button" onClick={() => go(1)} aria-label={en ? "Next photo" : "次の写真"}
                            className={`${glass} absolute right-3 top-1/2 -translate-y-1/2`}
                            style={{ width: "44px", height: "44px", touchAction: "manipulation" }}>
                        <ChevronRightIcon aria-hidden="true" style={{ width: "24px", height: "24px" }} />
                    </button>
                </>
            )}

            {/* 下: いいね（写真の上なので白）。2回叩いた結果がここに出る */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end px-3 pointer-events-none"
                 style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
                <button
                    type="button"
                    onClick={onToggleLike}
                    disabled={likePending}
                    aria-pressed={liked}
                    aria-label={en ? `Like (${likeCount.toLocaleString()})` : `いいね ${likeCount.toLocaleString()}件`}
                    className={`${glass} pointer-events-auto gap-1.5 px-3 disabled:opacity-60`}
                    style={{ minWidth: "44px", height: "44px", touchAction: "manipulation" }}
                >
                    {liked
                        ? <HeartIcon aria-hidden="true" style={{ width: "22px", height: "22px" }} />
                        : <HeartIconOutline aria-hidden="true" style={{ width: "22px", height: "22px" }} />}
                    <span className="tabular-nums" style={{ fontSize: "14px", lineHeight: "18px" }}>{likeCount.toLocaleString()}</span>
                </button>
            </div>
        </div>
    );
}
