"use client";

// 画面下に常駐するミニプレイヤー（Spotify風）。
// グローバル音楽（MusicContext）が再生中のときだけ表示され、
// ページを移動しても音楽と一緒についてくる。

import React from "react";
import { PlayIcon, PauseIcon, ForwardIcon, BackwardIcon } from "@heroicons/react/24/solid";
import { XMarkIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import { useMusic } from "../music/MusicContext";

export default function MiniPlayer() {
    const music = useMusic();
    const { current, playing, progress, queue, label } = music;
    if (!current) return null;

    return (
        <div
            className="fixed inset-x-3 z-[70] max-w-md mx-auto"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
            <div className="relative rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl shadow-black/50 overflow-hidden">
                {/* プログレス（上辺） */}
                <div className="absolute top-0 left-0 h-0.5 bg-fuchsia-400/80 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />

                <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-2">
                    <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                        {current.artwork ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={current.artwork} alt="" className="w-full h-full object-cover" />
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
