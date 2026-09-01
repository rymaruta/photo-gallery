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
    /** プログレスバー描画用: 再生中の audio 要素を返す */
    getAudio: () => HTMLAudioElement | null;
};

const EMPTY: MusicState = { queueKey: null, queue: [], index: 0, playing: false, label: null, shuffle: false, repeatOne: false };

// Provider の外（テスト等）でも安全に使える no-op 既定値
const noop = () => { /* noop */ };
const MusicContext = createContext<MusicApi>({ ...EMPTY, current: null, play: noop, toggle: noop, next: noop, prev: noop, stop: noop, toggleShuffle: noop, toggleRepeatOne: noop, getAudio: () => null });

export function useMusic(): MusicApi {
    return useContext(MusicContext);
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
    const [st, setSt] = useState<MusicState>(EMPTY);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    /**
     * 再生を試み、失敗したら「再生中」表示を取り消す。
     *
     * 以前は play() の失敗を握りつぶして必ず playing:true を返していたため、
     * 音が出ていないのにミニプレイヤーが一時停止アイコンのまま止まり、
     * 進捗も0%から動かない状態になっていた（低電力モードの iPhone など、
     * ブラウザが自動再生を拒否する場面で起きる）。
     */
    const playOrMarkStopped = useCallback((a: HTMLAudioElement | null | undefined) => {
        if (!a) return;
        void a.play().catch(() => setSt((p) => ({ ...p, playing: false })));
    }, []);
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
                playOrMarkStopped(a);
                return { ...prev, playing: true };
            }
            return { ...prev, queueKey, queue, index: safeIndex, playing: true, label: label ?? null };
        });
    }, [playOrMarkStopped]);

    const toggle = useCallback(() => {
        setSt((prev) => {
            if (!prev.queue.length) return prev;
            const a = audioRef.current;
            if (prev.playing) {
                a?.pause();
                return { ...prev, playing: false };
            }
            playOrMarkStopped(a);
            return { ...prev, playing: true };
        });
    }, [playOrMarkStopped]);

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
            return { ...prev, index, playing: true };
        });
    }, []);
    const next = useCallback(() => step(1), [step]);
    const prev = useCallback(() => step(-1), [step]);

    const stop = useCallback(() => {
        audioRef.current?.pause();
        setSt(EMPTY);
    }, []);

    const getAudio = useCallback(() => audioRef.current, []);
    const toggleShuffle = useCallback(() => setSt((p) => ({ ...p, shuffle: !p.shuffle })), []);
    const toggleRepeatOne = useCallback(() => setSt((p) => ({ ...p, repeatOne: !p.repeatOne })), []);

    // 曲が切り替わったら再生を試みる。
    //
    // **「同じ曲か」は previewUrl だけでは決まらない。** 別の写真が同じ曲を
    // 持っていることがあり、その写真で再生を押すと queueKey は変わるのに
    // previewUrl は同じ。src しか見ていなかった頃は、ここが「変わっていない」
    // と判断して再生を始めず、状態だけ playing:true になっていた
    // ——**「再生中」の見た目のまま音が出ない**。
    // どの列から鳴らしているか（queueKey）も一緒に見る。
    const lastSrcRef = useRef<string | null>(null);
    const lastKeyRef = useRef<string | null>(null);
    React.useEffect(() => {
        const a = audioRef.current;
        const src = current?.previewUrl ?? null;
        if (!a || !src) { lastSrcRef.current = src; lastKeyRef.current = st.queueKey; return; }
        if (lastSrcRef.current !== src || lastKeyRef.current !== st.queueKey) {
            lastSrcRef.current = src;
            lastKeyRef.current = st.queueKey;
            // 既に同じ音が鳴っているなら触らない（頭出しに戻してしまう）
            if (st.playing && a.paused) {
                void a.play().catch(() => setSt((p) => ({ ...p, playing: false })));
            }
        }
        // st.playing は play/toggle 側で audio を直接操作するためここでは追わない
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.previewUrl, st.queueKey]);

    const api: MusicApi = { ...st, current, play, toggle, next, prev, stop, toggleShuffle, toggleRepeatOne, getAudio };

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
                        } else if (st.queue.length > 1) {
                            next();
                        } else {
                            setSt((p) => ({ ...p, playing: false }));
                        }
                    }}
                />
            )}
        </MusicContext.Provider>
    );
}
