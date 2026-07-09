"use client";

// グローバル音楽プレイヤー。アプリ全体で単一の <audio> を共有し、
// ページ内遷移（App Router のクライアントナビゲーション）でも再生が途切れない。
// プロフィールのマイBGM・旅アルバムBGMはここを通して再生され、
// 画面下のミニプレイヤー（MiniPlayer）に常駐表示される。

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

export type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

type MusicState = {
    queueKey: string | null;   // 再生元の識別子（"bgm:<userId>" / "trip:<tripId>" など）
    queue: SongEntry[];
    index: number;
    playing: boolean;
    progress: number;          // 0..1
    label: string | null;      // ミニプレイヤーに出す出所ラベル（"マイBGM" など）
    shuffle: boolean;          // 次の曲をランダムに選ぶ
    repeatOne: boolean;        // 曲が終わったら同じ曲をもう一度
};

type MusicApi = MusicState & {
    current: SongEntry | null;
    /** キューを差し替えて再生。同じキュー・同じ曲なら再生/一時停止をトグル */
    play: (queueKey: string, queue: SongEntry[], index?: number, label?: string) => void;
    toggle: () => void;
    next: () => void;
    prev: () => void;
    stop: () => void;
    toggleShuffle: () => void;
    toggleRepeatOne: () => void;
};

const EMPTY: MusicState = { queueKey: null, queue: [], index: 0, playing: false, progress: 0, label: null, shuffle: false, repeatOne: false };

// Provider の外（テスト等）でも安全に使える no-op 既定値
const noop = () => { /* noop */ };
const MusicContext = createContext<MusicApi>({ ...EMPTY, current: null, play: noop, toggle: noop, next: noop, prev: noop, stop: noop, toggleShuffle: noop, toggleRepeatOne: noop });

export function useMusic(): MusicApi {
    return useContext(MusicContext);
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
    const [st, setSt] = useState<MusicState>(EMPTY);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const current = st.queue[st.index] ?? null;

    const play = useCallback((queueKey: string, queue: SongEntry[], index = 0, label?: string) => {
        if (queue.length === 0) return;
        const safeIndex = Math.min(Math.max(0, index), queue.length - 1);
        setSt((prev) => {
            const samesong =
                prev.queueKey === queueKey &&
                prev.queue[prev.index]?.previewUrl === queue[safeIndex]?.previewUrl;
            if (samesong) {
                // 同じ曲 → トグル
                const a = audioRef.current;
                if (prev.playing) {
                    a?.pause();
                    return { ...prev, playing: false };
                }
                void a?.play().catch(noop);
                return { ...prev, playing: true };
            }
            return { ...prev, queueKey, queue, index: safeIndex, playing: true, progress: 0, label: label ?? null };
        });
    }, []);

    const toggle = useCallback(() => {
        setSt((prev) => {
            if (!prev.queue.length) return prev;
            const a = audioRef.current;
            if (prev.playing) {
                a?.pause();
                return { ...prev, playing: false };
            }
            void a?.play().catch(noop);
            return { ...prev, playing: true };
        });
    }, []);

    const step = useCallback((d: number) => {
        setSt((prev) => {
            if (prev.queue.length === 0) return prev;
            // シャッフル時は「今と違う曲」からランダムに選ぶ
            let index: number;
            if (prev.shuffle && prev.queue.length > 1) {
                index = Math.floor(Math.random() * (prev.queue.length - 1));
                if (index >= prev.index) index++;
            } else {
                index = (prev.index + d + prev.queue.length) % prev.queue.length;
            }
            return { ...prev, index, progress: 0, playing: true };
        });
    }, []);
    const next = useCallback(() => step(1), [step]);
    const prev = useCallback(() => step(-1), [step]);

    const stop = useCallback(() => {
        audioRef.current?.pause();
        setSt(EMPTY);
    }, []);

    const toggleShuffle = useCallback(() => setSt((p) => ({ ...p, shuffle: !p.shuffle })), []);
    const toggleRepeatOne = useCallback(() => setSt((p) => ({ ...p, repeatOne: !p.repeatOne })), []);

    // src（曲）が切り替わったら再生を試みる
    const lastSrcRef = useRef<string | null>(null);
    React.useEffect(() => {
        const a = audioRef.current;
        const src = current?.previewUrl ?? null;
        if (!a || !src) { lastSrcRef.current = src; return; }
        if (lastSrcRef.current !== src) {
            lastSrcRef.current = src;
            if (st.playing) {
                void a.play().catch(() => setSt((p) => ({ ...p, playing: false })));
            }
        }
        // st.playing は play/toggle 側で audio を直接操作するためここでは追わない
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.previewUrl]);

    const api: MusicApi = { ...st, current, play, toggle, next, prev, stop, toggleShuffle, toggleRepeatOne };

    return (
        <MusicContext.Provider value={api}>
            {children}
            {current && (
                <audio
                    ref={audioRef}
                    src={current.previewUrl}
                    preload="none"
                    onEnded={() => {
                        if (st.repeatOne) {
                            const a = audioRef.current;
                            if (a) { a.currentTime = 0; void a.play().catch(noop); }
                            setSt((p) => ({ ...p, progress: 0 }));
                        } else if (st.queue.length > 1) {
                            next();
                        } else {
                            setSt((p) => ({ ...p, playing: false, progress: 0 }));
                        }
                    }}
                    onTimeUpdate={(e) => {
                        const a = e.currentTarget;
                        if (!a.duration) return;
                        const p = Math.round((a.currentTime / a.duration) * 50) / 50;
                        setSt((prevState) => (prevState.progress === p ? prevState : { ...prevState, progress: p }));
                    }}
                />
            )}
        </MusicContext.Provider>
    );
}
