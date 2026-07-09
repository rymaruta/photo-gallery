"use client";

// 音楽プレイヤーの滑らかなプログレスバー。
// timeupdate（約4回/秒）での再レンダリングは段階的に見えてカクつくため、
// requestAnimationFrame で <div> の width を直接更新する（60fps・再レンダリングなし）。

import React, { useEffect, useRef } from "react";

type Props = {
    /** 対象の audio 要素を返す（コンテキストや ref から） */
    getAudio: () => HTMLAudioElement | null;
    /** false の間は 0% 表示のまま動かさない（非アクティブなカード等） */
    active: boolean;
    className?: string;
    barClassName?: string;
};

export default function SmoothProgress({ getAudio, active, className, barClassName }: Props) {
    const barRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const bar = barRef.current;
            if (bar) {
                const a = active ? getAudio() : null;
                const p = a && a.duration > 0 ? Math.min(1, a.currentTime / a.duration) : 0;
                bar.style.width = `${p * 100}%`;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [getAudio, active]);

    return (
        <div className={className}>
            <div ref={barRef} className={barClassName} style={{ width: "0%", height: "100%" }} />
        </div>
    );
}
