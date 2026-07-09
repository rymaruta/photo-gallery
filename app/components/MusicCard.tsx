"use client";

// グローバル音楽（MusicContext）で再生する "Now Playing" カード。
// プロフィールのマイBGMプレイリストと旅アルバムBGMで使う。
// ここから再生した曲は、ページを移動してもミニプレイヤーで流れ続ける。

import React, { useEffect } from "react";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import { MusicalNoteIcon } from "@heroicons/react/24/outline";
import { useMusic, type SongEntry } from "../music/MusicContext";

type Props = {
    /** 再生キューの識別子（例: "bgm:<userId>" / "trip:<tripId>"） */
    queueKey: string;
    songs: SongEntry[];
    label: string;
    locale: string;
    /** マウント時に自動で再生を開始する（旅アルバムを開いた時など） */
    autoPlay?: boolean;
};

export default function MusicCard({ queueKey, songs, label, locale, autoPlay = false }: Props) {
    const music = useMusic();
    const active = music.queueKey === queueKey;
    const index = active ? music.index : 0;
    const cur = songs[Math.min(index, songs.length - 1)];
    const playing = active && music.playing;
    const progress = active ? music.progress : 0;

    // 開いたときに自動再生（タップ起点なのでブラウザに許可されやすい。失敗時は手動で）
    useEffect(() => {
        if (autoPlay && songs.length > 0) music.play(queueKey, songs, 0, label);
        // マウント時のみ
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!cur) return null;

    return (
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden max-w-md">
            <div className="flex items-center gap-1.5 px-3.5 pt-2.5 pb-1.5">
                <MusicalNoteIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                <span className="text-[11px] tracking-widest uppercase text-white/45">
                    {label}{songs.length > 1 ? ` ${index + 1}/${songs.length}` : ""}
                </span>
            </div>
            <div className="flex items-center gap-3 px-3 pb-3">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 ring-1 ring-white/10">
                    {cur.artwork ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cur.artwork} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <MusicalNoteIcon className="w-6 h-6 text-white/30" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    {cur.trackUrl ? (
                        <a href={cur.trackUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white truncate block hover:underline">{cur.title}</a>
                    ) : (
                        <p className="text-sm font-semibold text-white truncate">{cur.title}</p>
                    )}
                    <p className="text-xs text-white/50 truncate">{cur.artist ?? ""}</p>
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-white/70 rounded-full transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                </div>
                <button
                    onClick={() => music.play(queueKey, songs, index, label)}
                    aria-label={playing ? (locale === "en" ? "Pause" : "一時停止") : (locale === "en" ? "Play" : "再生")}
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 active:scale-95 transition flex-shrink-0 shadow-lg shadow-black/30"
                >
                    {playing ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
                </button>
            </div>
            {songs.length > 1 && (
                <div className="flex items-center justify-center gap-4 pb-2.5 -mt-1">
                    <button
                        onClick={() => { if (active) music.prev(); else music.play(queueKey, songs, Math.max(0, songs.length - 1), label); }}
                        aria-label={locale === "en" ? "Previous song" : "前の曲"}
                        className="px-3 py-0.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition text-sm"
                    >
                        ‹
                    </button>
                    <div className="flex items-center gap-1.5">
                        {songs.map((_, d) => (
                            <span key={d} className={`w-1.5 h-1.5 rounded-full transition-colors ${d === index ? "bg-white/80" : "bg-white/25"}`} />
                        ))}
                    </div>
                    <button
                        onClick={() => { if (active) music.next(); else music.play(queueKey, songs, Math.min(1, songs.length - 1), label); }}
                        aria-label={locale === "en" ? "Next song" : "次の曲"}
                        className="px-3 py-0.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition text-sm"
                    >
                        ›
                    </button>
                </div>
            )}
        </div>
    );
}
