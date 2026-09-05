"use client";

import { usableRows } from "../../../lib/utils/apiRows";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { XMarkIcon, EyeIcon, SpeakerWaveIcon, SpeakerXMarkIcon, TrashIcon, MusicalNoteIcon, PhotoIcon } from "@heroicons/react/24/outline";
import UserAvatar from "../UserAvatar";
import type { StoryGroup, StoryViewer as ViewerEntry } from "@/lib/stories";
import { timeAgo } from "@/lib/stories";
import { log } from "@/lib/utils/log";
import { useMusic } from "../../music/MusicContext";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";

const STORY_DEFAULT_DURATION_SEC = 5; // 画像の表示時間（投稿時に未指定だったとき）
const STORY_MIN_DURATION_SEC = 3;
const STORY_MAX_DURATION_SEC = 15;

/** 曲の再生開始位置（30秒プレビュー内の秒数）。未指定・範囲外は 0。 */
export function songStartSec(startSec: unknown): number {
    const n = typeof startSec === "number" ? startSec : Number(startSec);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(29, Math.round(n));
}

/** 投稿者が指定した表示秒数をミリ秒に。未指定・範囲外は既定値に丸める。 */
export function storyDurationMs(durationSec: unknown): number {
    const n = typeof durationSec === "number" ? durationSec : Number(durationSec);
    if (!Number.isFinite(n)) return STORY_DEFAULT_DURATION_SEC * 1000;
    return Math.min(STORY_MAX_DURATION_SEC, Math.max(STORY_MIN_DURATION_SEC, Math.round(n))) * 1000;
}

type Props = {
    groups: StoryGroup[];
    initialGroupIndex: number;
    locale: "ja" | "en";
    ownUserId?: string | null;
    isAuthenticated: boolean;
    onSeen: (storyId: string) => void;
    /** 自分のストーリーを削除。成功時 true を返すと閉じる */
    onDelete?: (storyId: string) => Promise<boolean>;
    onClose: () => void;
};

export default function StoryViewer({ groups, initialGroupIndex, locale, ownUserId, isAuthenticated, onSeen, onDelete, onClose }: Props) {
    const [g, setG] = useState(initialGroupIndex);
    const [i, setI] = useState(0);
    // 動画の進捗は **DOM に直接書く**（下の rAF ループ）。
    // state 経由にしていた頃は timeupdate（仕様上ブラウザ任せ・実測 250ms
    // 間隔）でしか動かず、120ms の transition で補間しても線が
    // 「進んでは止まり」を繰り返して見えた。しかも更新のたびにビューア全体が
    // 再描画されていた。
    const progressBarRef = useRef<HTMLDivElement | null>(null);
    const [paused, setPaused] = useState(false);
    const [muted, setMuted] = useState(true);

    // ストーリーBGM: 表示中のストーリーに曲が付いていれば再生する。
    // ブラウザの自動再生ポリシーに合わせて既定はミュート（チップかスピーカーで解除）。
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // グローバル音楽（マイBGM等）とは同時に鳴らさない
    const { stop: stopGlobalMusic } = useMusic();
    useEffect(() => { stopGlobalMusic(); }, [stopGlobalMusic]);
    const [viewers, setViewers] = useState<ViewerEntry[] | null>(null);
    // 取得の失敗を「閲覧者0人」と混ぜない（SW-b8）
    const [viewersError, setViewersError] = useState(false);
    const [viewersOpen, setViewersOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const reportedRef = useRef<Set<string>>(new Set());

    const group = groups[g];
    const item = group?.items[i];
    const isVideo = item?.mediaType === "video";
    const isOwnStory = !!ownUserId && group?.userId === ownUserId;

    // 表示したストーリーを既読にする（端末側）
    useEffect(() => {
        if (item) onSeen(item.id);
    }, [item, onSeen]);

    // 閲覧をサーバーに記録（ログイン済み・他人のストーリーのみ・セッション内1回）
    useEffect(() => {
        if (!item || !isAuthenticated || isOwnStory) return;
        if (reportedRef.current.has(item.id)) return;
        reportedRef.current.add(item.id);
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                await userFetch(`/stories/${encodeURIComponent(item.id)}/view`, {
                    method: "POST",
                    body: JSON.stringify({}),
                });
            } catch (e) {
                log.warn("story view report error:", e);
            }
        })();
    }, [item, isAuthenticated, isOwnStory]);

    // 自分のストーリー表示中は閲覧者リストを取得
    useEffect(() => {
        setViewers(null);
        setViewersError(false);   // 前のストーリーの失敗を持ち越さない
        setViewersOpen(false);
        if (!item || !isOwnStory) return;
        // 中断ガード。ストーリーは左右で次々に切り替わるので、前のストーリーの
        // 応答が後から届く。無かった頃は**別のストーリーの閲覧者数と名前**が
        // 出ていた（「誰が見たか」は見せ方として敏感な情報なので、
        // 取り違えたまま出すのは特に良くない）。
        // 同じファイルの閲覧報告の effect には既にこの形が入っている。
        let aborted = false;
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch(`/stories/${encodeURIComponent(item.id)}/viewers`);
                if (aborted) return;
                if (res.ok) {
                    const data = await res.json() as { viewers?: ViewerEntry[] };
                    if (aborted) return;
                    const rows = usableRows<ViewerEntry>(data.viewers, "GET /stories/{id}/viewers");
                    if (!rows) {
                        // **配列でない応答を「まだ閲覧者はいません」にしない**
                        // （下の else と同じ SW-b8）。`?? []` にしていたので
                        // 0人と同じ見た目になっていた。`viewers` は `null` の
                        // まま。**「取得中（…）」との区別は `viewersError` に持たせた**
                        // （数字を出す2か所が読む。記号には差し替えない——下を見よ）
                        // ——一度「`viewersError` が持つ」と書いたが、その時点では
                        // 数字を出す2か所が `viewersError` を読んでおらず、
                        // 失敗しても "…" のままだった（コメントだけが嘘をついていた）
                        setViewersError(true);
                        return;
                    }
                    setViewers(rows);
                    setViewersError(false);
                } else {
                    // 失敗を「まだ閲覧者はいません」と混ぜない（SW-b8）
                    setViewersError(true);
                }
            } catch (e) {
                if (!aborted) {
                    log.warn("story viewers fetch error:", e);
                    setViewersError(true);
                }
            }
        })();
        return () => { aborted = true; };
    }, [item, isOwnStory]);

    // 再生し直し用のカウンタ。進捗アニメーション/動画/BGM を最初から流し直す
    const [replay, setReplay] = useState(0);
    // 写真そのものが取れなかったストーリー（削除・期限切れの掃除の直後、
    // `uploads/` の 403 など）。**理由を出す**——`alt=""` の `<img>` は
    // 失敗すると 0x0 に潰れるので、以前は真っ黒のまま表示秒数
    // （最大15秒）待たされていた。
    //
    // **動画と扱いが違うのは、時間切れが来るかどうかが違うから。**
    // 動画の進捗バーは `v.duration` が有限のときだけ書く（上の rAF）ので、
    // 読み込めなかった動画は NaN のままバーが1ミリも進まず `onEnded` も
    // 来ない——`onError={goNext}` を外すと**永久に固まる**。画像の進捗は
    // 画像と無関係な CSS アニメーション（`onAnimationEnd={goNext}`）なので、
    // 理由を出して待たせても必ず次へ進む。だから画像は飛ばさない
    // （飛ばすと、1枚しか無い人のリングが「押しても無反応」に見える）。
    const [mediaError, setMediaError] = useState(false);
    // BGM の頭出し判定用（「再生し直しで値が変わったか」を見る）
    const lastReplayRef = useRef(0);
    // 「今のストーリーが始まってからの経過」。左タップの挙動を切り替えるのに使う
    const startedAtRef = useRef(Date.now());
    useEffect(() => { startedAtRef.current = Date.now(); }, [item, replay]);
    // **入るたびに下ろす。** 「止める印」を足したら「入るたびに下ろす」も
    // 一緒に書く（台帳の型0の派生）——下ろさないと、1枚失敗しただけで
    // 以降のストーリーが全部「読み込めません」になる。
    // `replay` も見るのは、左タップ（`restart`）で同じ1枚を読み直せるように。
    // deps は `item?.id`——同じファイルの確認シートのリセット（`[item?.id]`）と
    // 揃える。`groups` を作り直す実装が入ったとき、オブジェクト同一性で
    // 見ていると失敗表示が毎回リトライで点滅する
    useEffect(() => { setMediaError(false); }, [item?.id, replay]);

    /** 進捗バーを 0 に戻す（DOM 直書きなので state のリセットは無い） */
    const resetProgressBar = useCallback(() => {
        const bar = progressBarRef.current;
        if (bar) bar.style.transform = "scaleX(0)";
    }, []);

    // 動画の進捗を毎フレーム書く。
    //
    // currentTime を毎フレーム読んで transform を直接書けば、画面の
    // リフレッシュレートで滑らかに動く。React の state を経由しないので、
    // ビューア全体の再描画も起きない。
    // 一時停止（長押し）中は currentTime が進まないので、バーも自然に止まる。
    useEffect(() => {
        if (!isVideo) return;
        let raf = 0;
        const tick = () => {
            const v = videoRef.current;
            const bar = progressBarRef.current;
            if (v && bar && Number.isFinite(v.duration) && v.duration > 0) {
                const ratio = Math.min(1, Math.max(0, v.currentTime / v.duration));
                bar.style.transform = `scaleX(${ratio})`;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isVideo, item?.id, replay]);

    const goNext = useCallback(() => {
        resetProgressBar();
        setReplay(0);
        if (group && i < group.items.length - 1) {
            setI(i + 1);
        } else if (g < groups.length - 1) {
            setG(g + 1);
            setI(0);
        } else {
            onClose();
        }
    }, [group, groups.length, g, i, onClose, resetProgressBar]);

    // 今のストーリーを最初から再生し直す
    const restart = useCallback(() => {
        resetProgressBar();
        setReplay((n) => n + 1);
        const v = videoRef.current;
        if (v) { try { v.currentTime = 0; } catch { /* ignore */ } }
    }, [resetProgressBar]);

    // インスタと同じ: 左タップは「今のストーリーを最初から」。
    // 始まった直後（0.8秒以内）にもう一度押したときだけ1つ前へ戻る。
    const goPrev = useCallback(() => {
        if (Date.now() - startedAtRef.current > 800) {
            restart();
            return;
        }
        resetProgressBar();
        setReplay(0);
        if (i > 0) {
            setI(i - 1);
        } else if (g > 0) {
            const prevGroup = groups[g - 1];
            setG(g - 1);
            setI(Math.max(0, prevGroup.items.length - 1));
        } else {
            restart();
        }
    }, [groups, g, i, restart, resetProgressBar]);

    // 「タップ」か「長押し・スワイプ」かの判定。
    // click は指を離せば必ず発火するため、これが無いと長押しで一時停止したあと
    // 離した瞬間に前後へ移動してしまう。
    const pressRef = useRef<{ t: number; x: number; y: number } | null>(null);
    const LONG_PRESS_MS = 350;
    const MOVE_TOLERANCE_PX = 12;

    const onZonePointerDown = useCallback((e: React.PointerEvent) => {
        pressRef.current = { t: Date.now(), x: e.clientX, y: e.clientY };
        setPaused(true);
    }, []);

    /** 直前の操作が短いタップだったか（長押し・指の移動があれば false） */
    const wasTap = useCallback((e: React.MouseEvent): boolean => {
        const p = pressRef.current;
        pressRef.current = null;
        if (!p) return true; // ポインタ情報が取れない環境では従来どおり動かす
        if (Date.now() - p.t >= LONG_PRESS_MS) return false;
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        return moved <= MOVE_TOLERANCE_PX;
    }, []);

    // ダイアログ表示中は自動送りを止める
    const frozen = paused || viewersOpen || confirmDelete;

    // 画像の進捗は CSS アニメーション（60fps・再描画なし）が駆動し、
    // 完了は onAnimationEnd で検知する。動画は下の onTimeUpdate で進捗を更新。

    // 一時停止/再開を動画にも反映
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (frozen) v.pause();
        else void v.play()?.catch?.(() => { /* 自動再生ブロック等は無視 */ });
    }, [frozen, item]);

    // ストーリーBGM: 曲つきストーリーの表示中だけ再生（frozenで一時停止）。
    // 投稿者が「好きな部分」を指定していればそこから流す。
    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        if (!item?.song || frozen) {
            a.pause();
            return;
        }
        const start = songStartSec(item.song.startSec);
        // 頭出しするのは「別のストーリーに移った」「最初から再生し直した」ときだけ。
        // 一時停止からの復帰では続きから鳴らす。
        // ここを a.paused で判定すると、再生中に呼ばれる再生し直しでは頭出しされず、
        // 映像だけ戻って音楽が続くことになる（startSec が 0 のときは条件自体が常に偽）。
        const replayChanged = lastReplayRef.current !== replay;
        lastReplayRef.current = replay;
        if (replayChanged || a.currentTime < start) {
            try { a.currentTime = start; } catch { /* seek 未対応は無視 */ }
        }
        void a.play().catch(() => { /* 自動再生ブロック等は無視 */ });
    }, [frozen, item, replay]);

    // muted は React の属性反映が不安定なため直接同期する
    useEffect(() => {
        if (audioRef.current) audioRef.current.muted = muted;
    }, [muted, item]);

    const handleDelete = useCallback(async () => {
        if (!item || !onDelete) return;
        setDeleting(true);
        const ok = await onDelete(item.id);
        setDeleting(false);
        if (ok) onClose();
        else setConfirmDelete(false);
    }, [item, onDelete, onClose]);

    // 次の画像をプリロード（動画はブラウザに任せる）
    useEffect(() => {
        const next = group?.items[i + 1] ?? groups[g + 1]?.items[0];
        if (next && next.mediaType !== "video") {
            const img = new window.Image();
            img.src = next.src;
        }
    }, [group, groups, g, i]);

    // Escで閉じる / 矢印キーで移動。
    //
    // シートが開いているときは矢印で送らない。以前は送れてしまい、
    // 「削除しますか」を出したまま → を押すと、背後のストーリーだけが
    // 次に進んで、そのまま「削除」を押すと**別のストーリーが消えた**
    // （しかも成功トーストが出る。元に戻せない）。
    // Esc も同じで、シートを閉じずにビューア全体を閉じていた
    // （他の確認ダイアログと逆の挙動）。
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (confirmDelete || viewersOpen) {
                if (e.key === "Escape") { setConfirmDelete(false); setViewersOpen(false); }
                return;
            }
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowRight") goNext();
            else if (e.key === "ArrowLeft") goPrev();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose, goNext, goPrev, confirmDelete, viewersOpen]);

    // **Tab を中に閉じ込める。** `aria-modal="true"` を付けた8つのうち、
    // ここと StoriesBar の投稿プレビューだけ管理が無かった。全画面
    // （`fixed inset-0 z-[90]`）の裏にはギャラリーの写真リンクが全部あるので、
    // Tab を押すと見えないところへフォーカスが出ていく。
    //
    // 最初に当てるのは**閉じるボタン**。DOM 順の先頭は音量やゴミ箱で、
    // ゴミ箱は確認シートが挟まるとはいえ破壊的な操作なので先頭にしない。
    //
    // 戻り先は既定（開いた瞬間の要素＝押したリングのボタン）。リングは
    // ビューアを開いても消えないので、そのままで戻る。
    const rootRef = useRef<HTMLDivElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(true, rootRef, undefined, closeBtnRef);

    // 表示中のストーリーが変わったら確認シートを閉じる。
    // 開いたときの対象と、押したときの対象がずれないようにする。
    useEffect(() => { setConfirmDelete(false); }, [item?.id]);

    // 背景スクロールロック。**共通の実装に寄せた**（`lib/utils/scrollLock.ts`）。
    // ここは `overflow: hidden` だけの自前実装で、あちらのコメントが
    // 「それでは iOS Safari や内蔵ブラウザで止まらない」と書いている方式
    // そのものだった。位置の控え・復元も無かったので、閉じたときに別の
    // 場所にいることがある。
    // **早期 return より前に置くが、掛けるのは中身がある間だけ。**
    // 無条件で掛けていたので、`groups` が入れ替わって表示対象が消えた
    // ときに「何も描かないのに `position: fixed` のまま」になる
    // ——`overflow: hidden` だけだった頃は「スクロールできない」で
    // 済んでいたが、共通実装に寄せて位置を控えるようになったぶん、
    // ページ先頭へ飛んだまま固まる方に悪化していた（スマホには
    // Escape が無い）
    const showing = !!group && !!item;
    useEffect(() => {
        if (!showing) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [showing]);

    if (!group || !item) return null;

    return (
        <div
            ref={rootRef}
            className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center select-none"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Stories" : "ストーリー"}
        >
            {/* アンビエント背景: メディアをぼかして letterbox を埋める（黒帯の安っぽさを消す） */}
            {!isVideo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={`bg-${item.id}`}
                    src={item.src}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40 pointer-events-none"
                    draggable={false}
                />
            )}

            {/* メディア。写真そのものには何も重ねない（構図を隠さないため） */}
            <div className="relative flex-1 min-h-0 w-full flex items-center justify-center">
                {isVideo ? (
                    <video
                        key={item.id}
                        ref={videoRef}
                        src={item.src}
                        className="block max-w-full max-h-full object-contain rounded-lg story-media-in"
                        autoPlay
                        playsInline
                        // 曲が付いている動画は動画側を常に消す。両方を muted に
                        // 連動させると、ミュート解除で動画の音とBGMが同時に鳴る。
                        muted={muted || !!item.song}
                        onEnded={goNext}
                        onError={goNext}
                    />
                ) : mediaError ? (
                    // 日本語の文言は写真ページ・モーダルと揃える（言い回しを増やさない）。
                    // **英語はここにしか無い**——あちらの2つは日本語ベタ書きで
                    // locale 分岐を持たない（揃えるなら別コミットで向こうを直す）
                    <div className="flex flex-col items-center justify-center text-white/60 gap-2 px-6 text-center">
                        <PhotoIcon className="w-10 h-10" />
                        <p className="text-sm">{locale === "en" ? "Couldn't load image" : "画像を読み込めません"}</p>
                    </div>
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        key={item.id}
                        src={item.src}
                        alt=""
                        className="block max-w-full max-h-full object-contain rounded-lg story-media-in"
                        draggable={false}
                        onError={() => setMediaError(true)}
                    />
                )}
            </div>

            {/* ストーリーBGM音源（表示中のストーリーに追従） */}
            {item.song && (
                <audio
                    key={`audio-${item.id}`}
                    ref={audioRef}
                    src={item.song.previewUrl}
                    muted
                    preload="auto"
                    // 指定された「好きな部分」から繰り返す（loop属性だと必ず0秒に戻ってしまう）
                    onEnded={(e) => {
                        const a = e.currentTarget;
                        try { a.currentTime = songStartSec(item.song?.startSec); } catch { /* ignore */ }
                        void a.play().catch(() => { /* ignore */ });
                    }}
                />
            )}

            {/* 上部グラデーション + プログレスバー + ヘッダー */}
            {/* z-20: 下のタップ領域(z-10)より前面。ノッチ端末では safe-area の分だけ
                ヘッダーが下がり、曲チップがタップ領域に潜って押せなくなるため。 */}
            <div className="absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/70 to-transparent pt-2 pb-8 px-2 pointer-events-none">
                <div className="flex gap-1 mb-3" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
                    {group.items.map((s, idx) => {
                        const done = idx < i;
                        const active = idx === i;
                        return (
                            <div key={s.id} className="flex-1 h-[2.5px] rounded-full bg-white/30 overflow-hidden">
                                {active ? (
                                    isVideo ? (
                                        // 動画: rAF が毎フレーム scaleX を書く（補間は要らない）
                                        <div
                                            ref={progressBarRef}
                                            className="h-full w-full bg-white rounded-full origin-left"
                                            style={{ transform: "scaleX(0)" }}
                                        />
                                    ) : (
                                        // 画像: CSS アニメーションが 0→100% を滑らかに駆動
                                        <div
                                            key={`${item.id}-${replay}`}
                                            className="h-full w-full bg-white rounded-full story-progress-fill"
                                            style={{
                                                animationDuration: `${storyDurationMs(item.durationSec)}ms`,
                                                animationPlayState: frozen ? "paused" : "running",
                                            }}
                                            onAnimationEnd={goNext}
                                        />
                                    )
                                ) : (
                                    <div
                                        className="h-full w-full bg-white rounded-full origin-left"
                                        style={{ transform: done ? "scaleX(1)" : "scaleX(0)" }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="flex items-start gap-2 px-1 pr-24">
                    <UserAvatar userId={group.userId} className="w-8 h-8" iconClassName="w-5 h-5" />
                    <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-white drop-shadow truncate">{group.displayName}</span>
                            <span className="text-xs text-white/60 flex-shrink-0">{timeAgo(item.createdAt, locale)}</span>
                        </div>
                        {/* 曲は名前のすぐ下の段（親は pointer-events-none なのでここで戻す） */}
                        {item.song && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
                                className="pointer-events-auto mt-1 inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full bg-white/15 ring-1 ring-white/15 text-white/90 text-[11px] active:scale-95 transition"
                                style={{ touchAction: "manipulation" }}
                                aria-label={muted ? (locale === "en" ? "Turn sound on" : "音を出す") : (locale === "en" ? "Mute" : "ミュート")}
                            >
                                {muted
                                    ? <SpeakerXMarkIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/60" />
                                    : <MusicalNoteIcon className="w-3.5 h-3.5 flex-shrink-0 text-fuchsia-300" />}
                                <span className="truncate">
                                    {item.song.title}{item.song.artist ? ` — ${item.song.artist}` : ""}
                                </span>
                                {muted && (
                                    <span className="text-[10px] text-white/50 flex-shrink-0">
                                        {locale === "en" ? "Tap for sound" : "タップで再生"}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* 閉じる / ミュート切り替え */}
            <div className="absolute top-3 right-2 z-20 flex items-center gap-1" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
                {(isVideo || item.song) && (
                    <button
                        onClick={() => setMuted((m) => !m)}
                        aria-label={muted ? (locale === "en" ? "Unmute" : "ミュート解除") : (locale === "en" ? "Mute" : "ミュート")}
                        className="p-2.5 text-white/80 hover:text-white"
                        style={{ touchAction: "manipulation" }}
                    >
                        {muted ? <SpeakerXMarkIcon className="w-5 h-5" /> : <SpeakerWaveIcon className="w-5 h-5" />}
                    </button>
                )}
                {isOwnStory && onDelete && (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        aria-label={locale === "en" ? "Delete story" : "ストーリーを削除"}
                        className="p-2.5 text-white/80 hover:text-white"
                        style={{ touchAction: "manipulation" }}
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                )}
                <button
                    ref={closeBtnRef}
                    onClick={onClose}
                    aria-label={locale === "en" ? "Close" : "閉じる"}
                    className="p-2.5 text-white/80 hover:text-white"
                    style={{ touchAction: "manipulation" }}
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>
            </div>

            {/* タップ領域: 左1/3で戻る、右2/3で進む。長押しで一時停止。
                長押し・スワイプでは移動しない（キャプションを読むために止めたのに
                指を離した瞬間に話が進んでしまうのを防ぐ）。 */}
            <div
                className="absolute left-0 w-1/3 z-10"
                style={{ top: 80, bottom: 88, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goPrev(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
            />
            <div
                className="absolute right-0 w-2/3 z-10"
                style={{ top: 80, bottom: 88, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goNext(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
            />

            {/* 画面下: 閲覧者数（自分のみ）とキャプションを同じ段に並べる */}
            {(isOwnStory || item.caption) && (
                <div
                    className="absolute bottom-4 left-4 right-4 z-20 flex items-center gap-2"
                    style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                    {isOwnStory && (
                        <button
                            onClick={() => setViewersOpen(true)}
                            aria-label={locale === "en" ? "Viewers" : "閲覧者を見る"}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
                            style={{ touchAction: "manipulation" }}
                        >
                            <EyeIcon className="w-4 h-4" />
                            {/* **失敗したら数字を出さない。** `viewers === null` だけを
                                見ていたので、読み込めなかったときも "..." のまま
                                永久に止まっていた（再取得は無い）。シートの本文は
                                「読み込めませんでした」と出るのに、同じ画面の
                                ここだけ「取得中」に見える。
                                **記号（`—` など）に差し替えない**——このリポジトリの
                                前例は `FollowButton` の「まだ分からない間は出さない」で、
                                新しい記号を勝手に足さない。押せばシートが理由を出す */}
                            {viewersError
                                ? null
                                : viewers === null
                                ? "..."
                                : locale === "en"
                                    ? `${viewers.length} viewer${viewers.length === 1 ? "" : "s"}`
                                    : `閲覧 ${viewers.length}人`}
                        </button>
                    )}
                    {item.caption && (
                        <p className="min-w-0 flex-1 text-white text-sm leading-snug whitespace-pre-wrap break-words line-clamp-3 drop-shadow pointer-events-none">
                            {item.caption}
                        </p>
                    )}
                </div>
            )}

            {/* 閲覧者リスト（ボトムシート） */}
            {viewersOpen && isOwnStory && (
                <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm" onClick={() => setViewersOpen(false)}>
                    <div
                        className="absolute inset-x-0 bottom-0 bg-[#16181c] ring-1 ring-white/10 rounded-t-3xl max-h-[60%] flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        {/* グラバー */}
                        <div className="flex justify-center pt-2.5 pb-1">
                            <span className="w-9 h-1 rounded-full bg-white/20" />
                        </div>
                        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">
                                {locale === "en" ? "Viewers" : "閲覧者"}
                                {/* **取得中を 0 と言わない。** 同じ画面のボタン側は
                                    `viewers === null` を "..." と出しているのに、
                                    この見出しだけ `?? 0` で潰していて、開いた瞬間
                                    「閲覧者 0」が出てから数字が入っていた */}
                                {/* 失敗したら数字を出さない（上のボタンと同じ）。
                                    本文が「読み込めませんでした」と説明する */}
                                {!viewersError && (
                                    <span className="ml-2 text-white/50 font-normal">{viewers === null ? "…" : viewers.length}</span>
                                )}
                            </h3>
                            <button onClick={() => setViewersOpen(false)} className="p-1 text-white/60 hover:text-white" aria-label={locale === "en" ? "Close" : "閉じる"}>
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="overflow-y-auto p-2">
                            {(viewers ?? []).length === 0 ? (
                                <p className="text-xs text-white/40 text-center py-8">
                                    {viewersError
                                        ? (locale === "en"
                                            ? "Couldn't load viewers."
                                            : "閲覧者を読み込めませんでした")
                                        : (locale === "en"
                                            ? "No viewers yet."
                                            : "まだ閲覧者はいません（ログインユーザーの閲覧のみ記録されます）")}
                                </p>
                            ) : (
                                (viewers ?? []).map((v) => (
                                    <div key={v.userId} className="flex items-center gap-3 px-3 py-2.5">
                                        <UserAvatar userId={v.userId} className="w-9 h-9" iconClassName="w-5 h-5" />
                                        <span className="text-sm text-white/90 flex-1 truncate">
                                            {v.displayName || (locale === "en" ? "User" : "ユーザー")}
                                        </span>
                                        {v.at && <span className="text-[11px] text-white/40">{timeAgo(v.at, locale)}</span>}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 削除確認ダイアログ */}
            {confirmDelete && (
                <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 px-3 pb-3 sm:pb-0" onClick={() => !deleting && setConfirmDelete(false)}>
                    {/* iOS のアクションシート風。装飾は最小限にして、文字そのもので選ばせる */}
                    <div className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl overflow-hidden">
                            <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">
                                {locale === "en"
                                    ? "This story will be deleted. This can't be undone."
                                    : "このストーリーを削除します。この操作は取り消せません。"}
                            </p>
                            <button
                                onClick={() => void handleDelete()}
                                disabled={deleting}
                                className="w-full py-3.5 border-t border-white/10 text-[#ff453a] text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ touchAction: "manipulation" }}
                            >
                                {deleting && <div className="w-3.5 h-3.5 border-2 border-[#ff453a]/40 border-t-[#ff453a] rounded-full animate-spin" />}
                                {locale === "en" ? "Delete" : "削除"}
                            </button>
                        </div>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                            className="w-full py-3.5 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-[#2c2c2e]/95 active:bg-[#2c2c2e] transition disabled:opacity-50"
                            style={{ touchAction: "manipulation", marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                        >
                            {locale === "en" ? "Cancel" : "キャンセル"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
