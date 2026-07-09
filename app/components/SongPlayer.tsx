"use client";

import React, { useRef, useState } from "react";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import { MusicalNoteIcon } from "@heroicons/react/24/outline";

type Props = {
    title: string;
    artist: string;
    artwork?: string;
    previewUrl: string;
    /** 外部（Apple Music など）へのリンク */
    trackUrl?: string;
    /** カード上部のラベル。既定は「マイBGM」 */
    label?: string;
    /** 再生終了時（プレイリストの次曲送りに使う） */
    onEnded?: () => void;
    /** マウント時に自動再生を試みる（曲送り時。失敗しても無視） */
    autoPlay?: boolean;
};

// 30秒プレビュー音源を再生する自作の "Now Playing" カード。
// iframe 埋め込みより軽く、デザイン言語に揃った見た目にできる。
export default function SongPlayer({ title, artist, artwork, previewUrl, trackUrl, label, onEnded, autoPlay = false }: Props) {
    // 曲が変わったら、親側で key={previewUrl} を渡して作り直す前提（stateリセット不要）
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0); // 0..1

    // 曲送りで作り直されたときは自動で再生を試みる（ブロックされたら無視）
    React.useEffect(() => {
        if (autoPlay) void audioRef.current?.play().catch(() => { /* noop */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggle = () => {
        const a = audioRef.current;
        if (!a) return;
        if (playing) a.pause();
        else void a.play().catch(() => { /* 再生できない環境では無視 */ });
    };

    return (
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden max-w-md">
            <div className="flex items-center gap-1.5 px-3.5 pt-2.5 pb-1.5">
                <MusicalNoteIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                <span className="text-[11px] tracking-widest uppercase text-white/45">{label ?? "マイBGM"}</span>
            </div>
            <div className="flex items-center gap-3 px-3 pb-3">
                <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 ring-1 ring-white/10">
                    {artwork ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={artwork} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <MusicalNoteIcon className="w-6 h-6 text-white/30" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    {trackUrl ? (
                        <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white truncate block hover:underline">{title}</a>
                    ) : (
                        <p className="text-sm font-semibold text-white truncate">{title}</p>
                    )}
                    <p className="text-xs text-white/50 truncate">{artist}</p>
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-white/70 rounded-full transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                </div>
                <button
                    onClick={toggle}
                    aria-label={playing ? "一時停止" : "再生"}
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-white/90 active:scale-95 transition flex-shrink-0 shadow-lg shadow-black/30"
                >
                    {playing ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
                </button>
            </div>
            <audio
                ref={audioRef}
                src={previewUrl}
                preload="none"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setProgress(0); onEnded?.(); }}
                onTimeUpdate={(e) => {
                    const a = e.currentTarget;
                    if (a.duration) setProgress(a.currentTime / a.duration);
                }}
            />
        </div>
    );
}
