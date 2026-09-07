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
import { clampMiniPlayerPos } from "../../lib/utils/miniPlayerPos";

// 画面下に固定の操作バーがあるページでは、その上へ逃がす。
// **高さは決め打ちしない。** 以前は「`p-4` + ボタン44px + 枠線 ≒ 80px」と
// 見積もっていたが、幅320px ではラベルが折り返してバーが 95px になり
// **3px 重なっていた**（同じ z-40 でミニプレイヤーが後に描かれるので、
// 「公開」を押したつもりでプレイヤーのボタンが反応する）。
// いまはバー自身が実測値を `--bottom-bar-h` に出す
// （`lib/hooks/useBottomBarHeight.ts`）。ページ名の一覧も要らなくなった
// ——一覧に足し忘れると静かに重なる、という二重管理が1つ減る。

const STORAGE_KEY = "jp_miniplayer_pos";

type Pos = { x: number; y: number };

// ヘッダー（メニューバー）の高さ + 余白。ミニプレイヤーはこの帯へ絶対に侵入させない。
function headerBandHeight(): number {
    if (typeof document === "undefined") return 72 + 8;
    const h = document.querySelector("header")?.getBoundingClientRect().height;
    return (h && h > 0 ? h : 72) + 8;
}

// 現在のビューポート・ヘッダー高さで位置をクランプ（ヘッダー帯を避け画面内へ）。
function clampToView(pos: Pos, w: number, h: number): Pos {
    return clampMiniPlayerPos(pos, { w, h }, { vw: window.innerWidth, vh: window.innerHeight }, headerBandHeight());
}

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
            setPos(clampToView({ x: p.x, y: p.y }, w, h));
        } catch { /* ignore */ }
    }, [draggable]);

    // 画面リサイズ時に画面外へ出ないよう補正。
    // deps を [pos] にしていた頃は、ドラッグ中の setPos のたびに
    // リスナが外れて張り直されていた（毎フレーム）。clamp は寸法を
    // その場で読み、位置は関数型更新で触るので、購読は1回でよい。
    // pos が無い間（下部固定モード）は clamp が何もしない。
    useEffect(() => {
        const clamp = () => {
            const el = boxRef.current;
            if (!el) return;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            setPos((p) => p ? clampToView(p, w, h) : p);
        };
        window.addEventListener("resize", clamp);
        return () => window.removeEventListener("resize", clamp);
    }, []);

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
        setPos(clampToView({ x: e.clientX - d.dx, y: e.clientY - d.dy }, d.w, d.h));
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
    // z-index はヘッダー(z-50)より下(z-40)。常駐する装飾はヘッダーより前面に出さない
    // （万一クランプが崩れてもメニューボタンが hit-test で必ず勝つ）。ヘッダー帯へは
    // clampMiniPlayerPos が物理的に侵入させないので、視覚的な重なりも起きない。
    const positioned = draggable && pos !== null;
    const outerClass = positioned ? "fixed z-40" : "fixed inset-x-3 z-40 max-w-md mx-auto";
    // 画面下に固定バーがあるページでは、その上に逃がす。
    // 同じ z-40 でミニプレイヤーが後に描画されるため、重なると「公開」ボタンを
    // 押したつもりでプレイヤーのボタンが反応していた（iPhone で顕著）。
    const outerStyle: React.CSSProperties = positioned
        ? { left: pos!.x, top: pos!.y, width: "min(28rem, calc(100vw - 24px))" }
        : { bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px + var(--bottom-bar-h, 0px))" };

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
