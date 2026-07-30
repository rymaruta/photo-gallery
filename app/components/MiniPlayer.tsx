"use client";

// 画面下に常駐するミニプレイヤー（Spotify風）。
// グローバル音楽（MusicContext）が再生中のときだけ表示され、
// ページを移動しても音楽と一緒についてくる。
//
// デスクトップ（hover 可能・細かいポインタ）ではジャケット/曲名部分をつまんで
// 自由に移動できる。移動先は localStorage に保存し、リロード後も維持する。
// タッチ端末ではスクロールと競合するため従来どおり画面下に固定する。

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon, ForwardIcon, BackwardIcon } from "@heroicons/react/24/solid";
import { XMarkIcon, MusicalNoteIcon, ArrowsRightLeftIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { useMusic } from "../music/MusicContext";
import SmoothProgress from "./SmoothProgress";

const STORAGE_KEY = "jp_miniplayer_pos";

type Pos = { x: number; y: number };

export default function MiniPlayer() {
    const music = useMusic();
    const { current, playing, queue, label, shuffle, repeatOne } = music;

    const boxRef = useRef<HTMLDivElement | null>(null);
    const [draggable, setDraggable] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    // ドラッグ中の状態: ポインタと要素左上のオフセット + 要素サイズ
    const dragRef = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);

    // デスクトップ（hover 可能・細かいポインタ）だけ移動を許可
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setDraggable(mq.matches);
        update();
        mq.addEventListener?.("change", update);
        return () => mq.removeEventListener?.("change", update);
    }, []);

    // 保存された位置を復元（画面外に出ないよう補正）
    useEffect(() => {
        if (!draggable) return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const p = JSON.parse(raw) as Partial<Pos>;
            if (typeof p.x !== "number" || typeof p.y !== "number") return;
            const el = boxRef.current;
            const w = el?.offsetWidth ?? 448;
            const h = el?.offsetHeight ?? 60;
            // localStorage からの初期同期（マウント時 1 回）なのでこのパターンは許容
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPos({
                x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
                y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
            });
        } catch { /* ignore */ }
    }, [draggable]);

    // 画面リサイズ時に画面外へ出ないよう補正
    useEffect(() => {
        if (!pos) return;
        const clamp = () => {
            const el = boxRef.current;
            if (!el) return;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            setPos((p) => p ? {
                x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - w)),
                y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - h)),
            } : p);
        };
        window.addEventListener("resize", clamp);
        return () => window.removeEventListener("resize", clamp);
    }, [pos]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        if (!draggable) return;
        const el = boxRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        e.preventDefault();
    }, [draggable]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        setPos({
            x: Math.min(Math.max(0, e.clientX - d.dx), Math.max(0, window.innerWidth - d.w)),
            y: Math.min(Math.max(0, e.clientY - d.dy), Math.max(0, window.innerHeight - d.h)),
        });
    }, []);

    const endDrag = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        setPos((p) => {
            if (p) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
            return p;
        });
    }, []);

    if (!current) return null;

    // 移動済み（デスクトップ）は left/top で自由配置。既定はこれまで通り画面下中央に固定。
    const positioned = draggable && pos !== null;
    const outerClass = positioned ? "fixed z-[70]" : "fixed inset-x-3 z-[70] max-w-md mx-auto";
    const outerStyle: React.CSSProperties = positioned
        ? { left: pos!.x, top: pos!.y, width: "min(28rem, calc(100vw - 24px))" }
        : { bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" };

    return (
        <div ref={boxRef} className={outerClass} style={outerStyle}>
            <div className="relative rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl shadow-black/50 overflow-hidden">
                {/* プログレス（上辺・rAFで滑らかに更新） */}
                <SmoothProgress
                    getAudio={music.getAudio}
                    active
                    className="absolute top-0 left-0 right-0 h-0.5"
                    barClassName="bg-fuchsia-400/80"
                />

                <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-2">
                    {/* ジャケット + 曲名 = ドラッグハンドル（デスクトップのみ移動可能） */}
                    <div
                        className={`flex items-center gap-2.5 min-w-0 flex-1 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        style={draggable ? { touchAction: "none" } : undefined}
                        title={draggable ? "ドラッグで移動" : undefined}
                    >
                        <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                            {current.artwork ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={current.artwork} alt="" className="w-full h-full object-cover" draggable={false} />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <MusicalNoteIcon className="w-4 h-4 text-white/30" />
                                </div>
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">{current.title}</p>
                            <p className="text-[11px] text-white/50 truncate">
                                {current.artist ?? ""}{label ? `　·　${label}` : ""}
                            </p>
                        </div>
                    </div>

                    {queue.length > 1 && (
                        <button
                            onClick={music.toggleShuffle}
                            aria-label="シャッフル"
                            aria-pressed={shuffle}
                            className={`p-1.5 active:scale-90 transition ${shuffle ? "text-fuchsia-300" : "text-white/40 hover:text-white/70"}`}
                        >
                            <ArrowsRightLeftIcon className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={music.toggleRepeatOne}
                        aria-label="1曲リピート"
                        aria-pressed={repeatOne}
                        className={`p-1.5 active:scale-90 transition ${repeatOne ? "text-fuchsia-300" : "text-white/40 hover:text-white/70"}`}
                    >
                        <ArrowPathIcon className="w-4 h-4" />
                    </button>
                    {queue.length > 1 && (
                        <button onClick={music.prev} aria-label="前の曲" className="p-1.5 text-white/60 hover:text-white active:scale-90 transition">
                            <BackwardIcon className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={music.toggle}
                        aria-label={playing ? "一時停止" : "再生"}
                        className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 active:scale-95 transition flex-shrink-0"
                    >
                        {playing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4 ml-0.5" />}
                    </button>
                    {queue.length > 1 && (
                        <button onClick={music.next} aria-label="次の曲" className="p-1.5 text-white/60 hover:text-white active:scale-90 transition">
                            <ForwardIcon className="w-4 h-4" />
                        </button>
                    )}
                    <button onClick={music.stop} aria-label="閉じる" className="p-1.5 text-white/40 hover:text-white/80 active:scale-90 transition">
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
