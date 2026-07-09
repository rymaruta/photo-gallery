"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, XMarkIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import UserAvatar from "../UserAvatar";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { compressImage, stripJpegExif } from "../../../lib/utils/image";
import { searchSongs, type SongResult } from "../../../lib/utils/music";
import { log } from "../../../lib/utils/log";
import {
    groupStories, hasUnseen, loadSeenStoryIds, markStorySeen,
    type Story, type StoryGroup,
} from "../../../lib/stories";
import StoryViewer from "./StoryViewer";


const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_SECONDS = 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// 未読リング（Instagram のブランドグラデーション）と既読リング（上品なグレー）
const RING_UNSEEN = "linear-gradient(45deg, #FEDA75, #FA7E1E, #D62976, #962FBF, #4F5BD5)";
const RING_SEEN = "#3a3a3d";

// 動画の再生時間を取得（メタデータのみ読み込み）
function getVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(video.duration);
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("動画を読み込めません"));
        };
        video.src = url;
    });
}

type Draft = {
    file: File;
    previewUrl: string;
    mediaType: "image" | "video";
};

export default function StoriesBar() {
    const { isAuthenticated, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const [groups, setGroups] = useState<StoryGroup[]>([]);
    const [seen, setSeen] = useState<Set<string>>(new Set());
    const [viewerGroup, setViewerGroup] = useState<number | null>(null);
    const [posting, setPosting] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [caption, setCaption] = useState("");
    // ストーリーBGM（任意・1曲）
    const [draftSong, setDraftSong] = useState<SongResult | null>(null);
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [songSearching, setSongSearching] = useState(false);
    const searchDraftSongs = async () => {
        const q = songQuery.trim();
        if (!q) return;
        setSongSearching(true);
        try {
            setSongResults(await searchSongs(q));
        } catch {
            setSongResults([]);
        } finally {
            setSongSearching(false);
        }
    };
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadStories = useCallback(async () => {
        try {
            // ストーリーはログインユーザー限定。認証トークン付きで取得する。
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch("/stories");
            if (!res.ok) return;
            const data = await res.json() as Story[];
            if (Array.isArray(data)) {
                setGroups(groupStories(data, userId));
            }
        } catch (e) {
            log.warn("stories fetch error:", e);
        }
    }, [userId]);

    useEffect(() => {
        // 未ログインではストーリーを取得も表示もしない
        if (!isAuthenticated) {
            setGroups([]);
            return;
        }
        setSeen(loadSeenStoryIds());
        void loadStories();
    }, [isAuthenticated, loadStories]);

    const handleSeen = useCallback((storyId: string) => {
        markStorySeen(storyId);
        setSeen((prev) => {
            if (prev.has(storyId)) return prev;
            const next = new Set(prev);
            next.add(storyId);
            return next;
        });
    }, []);

    const closeDraft = useCallback(() => {
        if (draft) { try { URL.revokeObjectURL(draft.previewUrl); } catch { /* ignore */ } }
        setDraft(null);
        setCaption("");
        setDraftSong(null);
        setSongPickerOpen(false);
        setSongQuery("");
        setSongResults([]);
    }, [draft]);

    // ファイル選択 → 検証 → 投稿プレビューを開く
    const handleFileSelect = useCallback(async (file: File) => {
        const isImage = file.type.startsWith("image/");
        const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
        if (!isImage && !isVideo) {
            showToast(locale === "en" ? "Choose a photo or video (mp4)" : "写真または動画（mp4）を選んでください", "error");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            showToast(locale === "en" ? "File too large (max 50MB)" : "ファイルが大きすぎます（最大50MB）", "error");
            return;
        }
        if (isVideo) {
            try {
                const duration = await getVideoDuration(file);
                if (duration > MAX_VIDEO_SECONDS) {
                    showToast(locale === "en" ? "Video must be 60s or shorter" : "動画は60秒以内にしてください", "error");
                    return;
                }
            } catch {
                showToast(locale === "en" ? "Could not read the video" : "動画を読み込めませんでした", "error");
                return;
            }
        }
        setDraft({ file, previewUrl: URL.createObjectURL(file), mediaType: isVideo ? "video" : "image" });
        setCaption("");
    }, [locale, showToast]);

    // 投稿: 圧縮（画像のみ）→ presigned URL → S3 → レコード作成
    const handlePost = useCallback(async () => {
        if (!draft) return;
        setPosting(true);
        try {
            let uploadFile = draft.file;
            if (draft.mediaType === "image") {
                try { uploadFile = await compressImage(draft.file, 1440, 0.85); }
                catch { uploadFile = await stripJpegExif(draft.file); }
            }

            // ストーリーは常にユーザーAPI経由（動画対応・管理者トークンでも有効）
            const { userFetch } = await import("../../../lib/utils/api");

            const presignedRes = await userFetch("/upload/presigned-url", {
                method: "POST",
                body: JSON.stringify({
                    fileName: uploadFile.name,
                    fileType: uploadFile.type,
                    fileSize: uploadFile.size,
                }),
            });
            if (!presignedRes.ok) throw new Error(`presigned ${presignedRes.status}`);
            const { presignedUrl, publicUrl, key } = await presignedRes.json() as { presignedUrl: string; publicUrl: string; key?: string };

            const s3Res = await fetch(presignedUrl, {
                method: "PUT",
                body: uploadFile,
                headers: { "Content-Type": uploadFile.type },
            });
            if (!s3Res.ok) throw new Error(`S3 ${s3Res.status}`);

            // 表示名を取得（ベストエフォート）
            let displayName: string | undefined;
            try {
                const profRes = await userFetch("/user/profile");
                if (profRes.ok) {
                    const prof = await profRes.json() as { displayName?: string };
                    displayName = prof.displayName;
                }
            } catch { /* ignore */ }

            const saveRes = await userFetch("/stories", {
                method: "POST",
                body: JSON.stringify({
                    publicUrl,
                    ...(key ? { key } : {}),
                    mediaType: draft.mediaType,
                    ...(caption.trim() ? { caption: caption.trim() } : {}),
                    ...(draftSong ? { song: { title: draftSong.title, artist: draftSong.artist, artwork: draftSong.artwork, previewUrl: draftSong.previewUrl, trackUrl: draftSong.trackUrl } } : {}),
                    ...(displayName ? { displayName } : {}),
                }),
            });
            if (!saveRes.ok) {
                // 投稿上限（429）はユーザーにそのまま伝える
                if (saveRes.status === 429) {
                    const err = await saveRes.json().catch(() => ({})) as { error?: string };
                    showToast(err.error ?? (locale === "en" ? "Daily story limit reached" : "投稿上限に達しています"), "error");
                    return;
                }
                throw new Error(`save ${saveRes.status}`);
            }

            showToast(locale === "en" ? "Story posted!" : "ストーリーを投稿しました", "success");
            closeDraft();
            await loadStories();
        } catch (e) {
            log.error("story upload error:", e);
            showToast(locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました", "error");
        } finally {
            setPosting(false);
        }
    }, [draft, caption, draftSong, locale, showToast, loadStories, closeDraft]);

    // 自分のストーリーを削除
    const handleDeleteStory = useCallback(async (storyId: string) => {
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch(`/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
            if (!res.ok) throw new Error(`delete ${res.status}`);
            showToast(locale === "en" ? "Story deleted" : "ストーリーを削除しました", "success");
            await loadStories();
            return true;
        } catch (e) {
            log.error("story delete error:", e);
            showToast(locale === "en" ? "Failed to delete" : "削除に失敗しました", "error");
            return false;
        }
    }, [locale, showToast, loadStories]);

    // ストーリーはログインユーザー限定。未ログインではバー自体を出さない
    if (!isAuthenticated) return null;

    return (
        <div className="mb-5">
            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
                {/* 自分の「+」（ログイン時のみ） */}
                {isAuthenticated && userId && (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={posting}
                        className="flex flex-col items-center gap-1.5 flex-shrink-0 disabled:opacity-50 group"
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                    >
                        <div className="relative">
                            <div className="rounded-full p-[2.5px] bg-white/10 group-active:scale-95 transition-transform">
                                <div className="rounded-full p-[2.5px] bg-black">
                                    <UserAvatar userId={userId} className="w-[64px] h-[64px]" iconClassName="w-8 h-8" />
                                </div>
                            </div>
                            <div className="absolute bottom-0 right-0 w-[22px] h-[22px] rounded-full ring-[3px] ring-black flex items-center justify-center" style={{ background: "#0095F6" }}>
                                {posting
                                    ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    : <PlusIcon className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                            </div>
                        </div>
                        <span className="text-[11px] text-white/70 leading-none">
                            {locale === "en" ? "Your story" : "あなた"}
                        </span>
                    </button>
                )}

                {/* 各ユーザーのストーリーリング */}
                {groups.map((group, idx) => {
                    const unseen = hasUnseen(group, seen);
                    return (
                        <button
                            key={group.userId}
                            onClick={() => setViewerGroup(idx)}
                            className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                            <div
                                className="rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                                style={{ background: unseen ? RING_UNSEEN : RING_SEEN }}
                            >
                                <div className="rounded-full p-[2.5px] bg-black">
                                    <UserAvatar userId={group.userId} className="w-[64px] h-[64px]" iconClassName="w-8 h-8" />
                                </div>
                            </div>
                            <span className={`text-[11px] max-w-[68px] truncate leading-none ${unseen ? "text-white/90" : "text-white/50"}`}>
                                {group.displayName}
                            </span>
                        </button>
                    );
                })}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileSelect(f);
                    e.target.value = "";
                }}
            />

            {/* 投稿プレビュー（キャプション入力つき） */}
            {draft && (
                <div className="fixed inset-0 z-[95] bg-black/95 flex flex-col" role="dialog" aria-modal="true">
                    <div className="flex items-center justify-between p-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
                        <h2 className="text-sm font-semibold text-white">
                            {locale === "en" ? "New story" : "新しいストーリー"}
                        </h2>
                        <button onClick={closeDraft} disabled={posting} className="p-2 text-white/70 hover:text-white" aria-label={locale === "en" ? "Cancel" : "キャンセル"}>
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 flex items-center justify-center px-4">
                        {draft.mediaType === "video" ? (
                            <video src={draft.previewUrl} className="max-w-full max-h-full rounded-lg" controls playsInline muted loop autoPlay />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={draft.previewUrl} alt="" className="max-w-full max-h-full rounded-lg object-contain" />
                        )}
                    </div>
                    <div className="p-4 space-y-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
                        <input
                            type="text"
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                            maxLength={200}
                            placeholder={locale === "en" ? "Add a caption..." : "キャプションを追加..."}
                            disabled={posting}
                            className="w-full px-4 py-3 bg-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-white/15"
                            style={{ fontSize: "16px" }}
                        />

                        {/* ストーリーBGM（任意） */}
                        {draftSong ? (
                            <div className="flex items-center gap-2.5 rounded-full bg-white/10 pl-2 pr-3 py-1.5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={draftSong.artwork} alt="" className="w-8 h-8 rounded-full object-cover bg-white/10 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-white truncate">🎵 {draftSong.title}</p>
                                    <p className="text-[11px] text-white/50 truncate">{draftSong.artist}</p>
                                </div>
                                <button onClick={() => setDraftSong(null)} disabled={posting} className="p-1 text-white/50 hover:text-white active:scale-90 transition" aria-label={locale === "en" ? "Remove song" : "曲を外す"}>
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ) : songPickerOpen ? (
                            <div className="rounded-2xl bg-white/10 p-2.5 space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={songQuery}
                                        onChange={(e) => setSongQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchDraftSongs(); } }}
                                        placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                        autoFocus
                                        className="flex-1 min-w-0 px-3 py-2 bg-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-white/15"
                                        style={{ fontSize: "16px" }}
                                    />
                                    <button onClick={() => void searchDraftSongs()} disabled={songSearching || !songQuery.trim()}
                                        className="px-3.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition text-xs text-white disabled:opacity-40 min-w-[56px]">
                                        {songSearching
                                            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
                                            : (locale === "en" ? "Search" : "検索")}
                                    </button>
                                    <button onClick={() => { setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                        className="px-2 text-xs text-white/50 hover:text-white/80 active:scale-95 transition">
                                        {locale === "en" ? "Cancel" : "閉じる"}
                                    </button>
                                </div>
                                {songResults.length > 0 && (
                                    <ul className="rounded-xl bg-black/40 divide-y divide-white/5 overflow-hidden max-h-44 overflow-y-auto no-scrollbar">
                                        {songResults.map((r) => (
                                            <li key={r.id}>
                                                <button
                                                    onClick={() => { setDraftSong(r); setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                                    className="w-full flex items-center gap-2.5 p-2 hover:bg-white/10 active:bg-white/15 transition text-left"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={r.artwork} alt="" loading="lazy" className="w-8 h-8 rounded object-cover bg-white/10 flex-shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs text-white truncate">{r.title}</p>
                                                        <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                    </div>
                                                    <span className="text-[11px] text-white/40 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={() => setSongPickerOpen(true)}
                                disabled={posting}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-white/80 text-xs active:scale-95 transition"
                            >
                                <MusicalNoteIcon className="w-4 h-4 text-fuchsia-300" />
                                {locale === "en" ? "Add music" : "曲を付ける"}
                            </button>
                        )}

                        <button
                            onClick={() => void handlePost()}
                            disabled={posting}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{ touchAction: "manipulation" }}
                        >
                            {posting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                            {posting
                                ? (locale === "en" ? "Posting..." : "投稿中...")
                                : (locale === "en" ? "Share to story" : "ストーリーに投稿")}
                        </button>
                    </div>
                </div>
            )}

            {viewerGroup !== null && groups[viewerGroup] && (
                <StoryViewer
                    groups={groups}
                    initialGroupIndex={viewerGroup}
                    locale={locale}
                    ownUserId={userId}
                    isAuthenticated={isAuthenticated}
                    onSeen={handleSeen}
                    onDelete={handleDeleteStory}
                    onClose={() => setViewerGroup(null)}
                />
            )}
        </div>
    );
}
