"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { XMarkIcon, EyeIcon, SpeakerWaveIcon, SpeakerXMarkIcon, TrashIcon } from "@heroicons/react/24/outline";
import UserAvatar from "../UserAvatar";
import type { StoryGroup, StoryViewer as ViewerEntry } from "@/lib/stories";
import { timeAgo } from "@/lib/stories";
import { log } from "@/lib/utils/log";

const STORY_DURATION_MS = 5000; // 画像の表示時間
const TICK_MS = 50;

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
    const [progress, setProgress] = useState(0); // 0-100
    const [paused, setPaused] = useState(false);
    const [muted, setMuted] = useState(true);
    const [viewers, setViewers] = useState<ViewerEntry[] | null>(null);
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
        setViewersOpen(false);
        if (!item || !isOwnStory) return;
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch(`/stories/${encodeURIComponent(item.id)}/viewers`);
                if (res.ok) {
                    const data = await res.json() as { viewers?: ViewerEntry[] };
                    setViewers(Array.isArray(data.viewers) ? data.viewers : []);
                }
            } catch (e) {
                log.warn("story viewers fetch error:", e);
            }
        })();
    }, [item, isOwnStory]);

    const goNext = useCallback(() => {
        setProgress(0);
        if (group && i < group.items.length - 1) {
            setI(i + 1);
        } else if (g < groups.length - 1) {
            setG(g + 1);
            setI(0);
        } else {
            onClose();
        }
    }, [group, groups.length, g, i, onClose]);

    const goPrev = useCallback(() => {
        setProgress(0);
        if (i > 0) {
            setI(i - 1);
        } else if (g > 0) {
            const prevGroup = groups[g - 1];
            setG(g - 1);
            setI(Math.max(0, prevGroup.items.length - 1));
        }
    }, [groups, g, i]);

    // ダイアログ表示中は自動送りを止める
    const frozen = paused || viewersOpen || confirmDelete;

    // 画像: 自動送りタイマー / 動画: timeupdate で進捗（下の video ハンドラ）
    useEffect(() => {
        if (frozen || !item || isVideo) return;
        const timer = setInterval(() => {
            setProgress((p) => Math.min(100, p + (TICK_MS / STORY_DURATION_MS) * 100));
        }, TICK_MS);
        return () => clearInterval(timer);
    }, [frozen, item, isVideo]);

    useEffect(() => {
        if (!isVideo && progress >= 100) goNext();
    }, [progress, goNext, isVideo]);

    // 一時停止/再開を動画にも反映
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (frozen) v.pause();
        else void v.play().catch(() => { /* ignore */ });
    }, [frozen, item]);

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

    // Escで閉じる / 矢印キーで移動
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowRight") goNext();
            else if (e.key === "ArrowLeft") goPrev();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose, goNext, goPrev]);

    // 背景スクロールロック
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = prev; };
    }, []);

    if (!group || !item) return null;

    return (
        <div
            className="fixed inset-0 z-[90] bg-black flex items-center justify-center select-none"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Stories" : "ストーリー"}
        >
            {/* メディア */}
            {isVideo ? (
                <video
                    key={item.id}
                    ref={videoRef}
                    src={item.src}
                    className="max-w-full max-h-full object-contain"
                    autoPlay
                    playsInline
                    muted={muted}
                    onTimeUpdate={(e) => {
                        const v = e.currentTarget;
                        if (v.duration > 0) setProgress((v.currentTime / v.duration) * 100);
                    }}
                    onEnded={goNext}
                    onError={goNext}
                />
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={item.id}
                    src={item.src}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                    draggable={false}
                />
            )}

            {/* キャプション */}
            {item.caption && (
                <div className="absolute inset-x-0 bottom-20 px-6 flex justify-center pointer-events-none">
                    <p className="max-w-md text-center text-white text-base font-semibold leading-relaxed px-4 py-2 rounded-2xl bg-black/50 backdrop-blur-sm whitespace-pre-wrap break-words">
                        {item.caption}
                    </p>
                </div>
            )}

            {/* 上部グラデーション + プログレスバー + ヘッダー */}
            <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/70 to-transparent pt-2 pb-8 px-2 pointer-events-none">
                <div className="flex gap-1 mb-2.5" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
                    {group.items.map((s, idx) => (
                        <div key={s.id} className="flex-1 h-0.5 rounded-full bg-white/25 overflow-hidden">
                            <div
                                className="h-full bg-white"
                                style={{ width: idx < i ? "100%" : idx === i ? `${progress}%` : "0%" }}
                            />
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2 px-1">
                    <UserAvatar userId={group.userId} className="w-8 h-8" iconClassName="w-5 h-5" />
                    <span className="text-sm font-semibold text-white drop-shadow">{group.displayName}</span>
                    <span className="text-xs text-white/60">{timeAgo(item.createdAt, locale)}</span>
                </div>
            </div>

            {/* 閉じる / ミュート切り替え */}
            <div className="absolute top-3 right-2 z-20 flex items-center gap-1" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
                {isVideo && (
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
                    onClick={onClose}
                    aria-label={locale === "en" ? "Close" : "閉じる"}
                    className="p-2.5 text-white/80 hover:text-white"
                    style={{ touchAction: "manipulation" }}
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>
            </div>

            {/* タップ領域: 左1/3で戻る、右2/3で進む。長押しで一時停止 */}
            <div
                className="absolute left-0 w-1/3 z-10"
                style={{ top: 80, bottom: 88, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={goPrev}
                onPointerDown={() => setPaused(true)}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
            />
            <div
                className="absolute right-0 w-2/3 z-10"
                style={{ top: 80, bottom: 88, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={goNext}
                onPointerDown={() => setPaused(true)}
                onPointerUp={() => setPaused(false)}
                onPointerLeave={() => setPaused(false)}
            />

            {/* 自分のストーリー: 閲覧者数（タップでリスト表示） */}
            {isOwnStory && (
                <button
                    onClick={() => setViewersOpen(true)}
                    className="absolute bottom-4 left-4 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
                    style={{ marginBottom: "env(safe-area-inset-bottom, 0px)", touchAction: "manipulation" }}
                >
                    <EyeIcon className="w-4 h-4" />
                    {viewers === null
                        ? "..."
                        : locale === "en"
                            ? `${viewers.length} viewer${viewers.length === 1 ? "" : "s"}`
                            : `閲覧 ${viewers.length}人`}
                </button>
            )}

            {/* 閲覧者リスト（ボトムシート） */}
            {viewersOpen && isOwnStory && (
                <div className="absolute inset-0 z-30" onClick={() => setViewersOpen(false)}>
                    <div
                        className="absolute inset-x-0 bottom-0 bg-[#101214] rounded-t-2xl max-h-[60%] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">
                                {locale === "en" ? "Viewers" : "閲覧者"}
                                <span className="ml-2 text-white/50 font-normal">{viewers?.length ?? 0}</span>
                            </h3>
                            <button onClick={() => setViewersOpen(false)} className="p-1 text-white/60 hover:text-white" aria-label={locale === "en" ? "Close" : "閉じる"}>
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="overflow-y-auto p-2">
                            {(viewers ?? []).length === 0 ? (
                                <p className="text-xs text-white/40 text-center py-8">
                                    {locale === "en" ? "No viewers yet." : "まだ閲覧者はいません（ログインユーザーの閲覧のみ記録されます）"}
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
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-6" onClick={() => !deleting && setConfirmDelete(false)}>
                    <div className="w-full max-w-xs rounded-2xl bg-[#101214] p-5 text-center" onClick={(e) => e.stopPropagation()}>
                        <p className="text-white text-sm font-semibold mb-1">
                            {locale === "en" ? "Delete this story?" : "このストーリーを削除しますか？"}
                        </p>
                        <p className="text-white/50 text-xs mb-5">
                            {locale === "en" ? "This can't be undone." : "この操作は取り消せません。"}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmDelete(false)}
                                disabled={deleting}
                                className="flex-1 py-2.5 rounded-full bg-white/10 text-white text-sm font-medium hover:bg-white/15 disabled:opacity-50"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Cancel" : "キャンセル"}
                            </button>
                            <button
                                onClick={() => void handleDelete()}
                                disabled={deleting}
                                className="flex-1 py-2.5 rounded-full bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
                                style={{ touchAction: "manipulation" }}
                            >
                                {deleting && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                                {locale === "en" ? "Delete" : "削除"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
