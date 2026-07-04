"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, UserCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { compressImage, stripJpegExif } from "../../../lib/utils/image";
import { log } from "../../../lib/utils/log";
import {
    groupStories, hasUnseen, loadSeenStoryIds, markStorySeen,
    type Story, type StoryGroup,
} from "../../../lib/stories";
import StoryViewer from "./StoryViewer";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
const USER_API_BASE = process.env.NEXT_PUBLIC_USER_API_BASE_URL ?? "";

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_VIDEO_SECONDS = 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// インスタ風のグラデーションリング
const RING_UNSEEN = "conic-gradient(from 210deg, #f9ce34, #ee2a7b, #6228d7, #f9ce34)";

function Avatar({ userId, size = 56 }: { userId: string; size?: number }) {
    const [err, setErr] = useState(false);
    const url = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}` : "";
    return (
        <div
            className="rounded-full overflow-hidden bg-white/10 flex items-center justify-center"
            style={{ width: size, height: size }}
        >
            {url && !err ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="w-full h-full object-cover" onError={() => setErr(true)} />
            ) : (
                <UserCircleIcon className="text-white/40" style={{ width: size * 0.6, height: size * 0.6 }} />
            )}
        </div>
    );
}

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
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadStories = useCallback(async () => {
        if (!USER_API_BASE) return;
        try {
            const res = await fetch(`${USER_API_BASE}/stories`);
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
        setSeen(loadSeenStoryIds());
        void loadStories();
    }, [loadStories]);

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
                    ...(displayName ? { displayName } : {}),
                }),
            });
            if (!saveRes.ok) throw new Error(`save ${saveRes.status}`);

            showToast(locale === "en" ? "Story posted!" : "ストーリーを投稿しました", "success");
            closeDraft();
            await loadStories();
        } catch (e) {
            log.error("story upload error:", e);
            showToast(locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました", "error");
        } finally {
            setPosting(false);
        }
    }, [draft, caption, locale, showToast, loadStories, closeDraft]);

    // 未ログインでストーリーが無ければバー自体を出さない
    if (!isAuthenticated && groups.length === 0) return null;

    return (
        <div className="mb-4">
            <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
                {/* 自分の「+」（ログイン時のみ） */}
                {isAuthenticated && userId && (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={posting}
                        className="flex flex-col items-center gap-1 flex-shrink-0 disabled:opacity-50"
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                    >
                        <div className="relative">
                            <div className="p-[3px] rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>
                                <div className="p-[2px] rounded-full bg-black">
                                    <Avatar userId={userId} />
                                </div>
                            </div>
                            <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-sky-500 ring-2 ring-black flex items-center justify-center">
                                {posting
                                    ? <div className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                                    : <PlusIcon className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                            </div>
                        </div>
                        <span className="text-[11px] text-white/50">
                            {locale === "en" ? "Add story" : "ストーリー"}
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
                            className="flex flex-col items-center gap-1 flex-shrink-0"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                            <div
                                className="p-[3px] rounded-full"
                                style={{ background: unseen ? RING_UNSEEN : "rgba(255,255,255,0.2)" }}
                            >
                                <div className="p-[2px] rounded-full bg-black">
                                    <Avatar userId={group.userId} />
                                </div>
                            </div>
                            <span className="text-[11px] text-white/60 max-w-[64px] truncate">
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
                    onClose={() => setViewerGroup(null)}
                />
            )}
        </div>
    );
}
