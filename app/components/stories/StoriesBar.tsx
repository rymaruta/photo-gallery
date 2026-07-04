"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, UserCircleIcon } from "@heroicons/react/24/outline";
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

export default function StoriesBar() {
    const { isAuthenticated, isAdminUser, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const [groups, setGroups] = useState<StoryGroup[]>([]);
    const [seen, setSeen] = useState<Set<string>>(new Set());
    const [viewerGroup, setViewerGroup] = useState<number | null>(null);
    const [posting, setPosting] = useState(false);
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

    // ストーリー投稿: 画像選択 → 圧縮 → presigned URL → S3 → レコード作成
    const handleStoryUpload = useCallback(async (file: File) => {
        if (!file.type.startsWith("image/")) return;
        setPosting(true);
        try {
            let uploadFile = file;
            try { uploadFile = await compressImage(file, 1440, 0.85); }
            catch { uploadFile = await stripJpegExif(file); }

            const { userFetch, authenticatedFetch } = await import("../../../lib/utils/api");
            const apiFetch = isAdminUser ? authenticatedFetch : userFetch;

            const presignedRes = await apiFetch("/upload/presigned-url", {
                method: "POST",
                body: JSON.stringify({
                    fileName: uploadFile.name,
                    fileType: uploadFile.type,
                    fileSize: uploadFile.size,
                }),
            });
            if (!presignedRes.ok) throw new Error(`presigned ${presignedRes.status}`);
            const { presignedUrl, publicUrl } = await presignedRes.json() as { presignedUrl: string; publicUrl: string };

            const s3Res = await fetch(presignedUrl, {
                method: "PUT",
                body: uploadFile,
                headers: { "Content-Type": uploadFile.type },
            });
            if (!s3Res.ok) throw new Error(`S3 ${s3Res.status}`);

            // 表示名を取得（ベストエフォート）してストーリーレコードを作成
            const { userFetch: uf } = await import("../../../lib/utils/api");
            let displayName: string | undefined;
            try {
                const profRes = await uf("/user/profile");
                if (profRes.ok) {
                    const prof = await profRes.json() as { displayName?: string };
                    displayName = prof.displayName;
                }
            } catch { /* ignore */ }

            const saveRes = await uf("/stories", {
                method: "POST",
                body: JSON.stringify({ publicUrl, ...(displayName ? { displayName } : {}) }),
            });
            if (!saveRes.ok) throw new Error(`save ${saveRes.status}`);

            showToast(locale === "en" ? "Story posted!" : "ストーリーを投稿しました", "success");
            await loadStories();
        } catch (e) {
            log.error("story upload error:", e);
            showToast(locale === "en" ? "Failed to post story" : "ストーリーの投稿に失敗しました", "error");
        } finally {
            setPosting(false);
        }
    }, [isAdminUser, locale, showToast, loadStories]);

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
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleStoryUpload(f);
                    e.target.value = "";
                }}
            />

            {viewerGroup !== null && groups[viewerGroup] && (
                <StoryViewer
                    groups={groups}
                    initialGroupIndex={viewerGroup}
                    locale={locale}
                    onSeen={handleSeen}
                    onClose={() => setViewerGroup(null)}
                />
            )}
        </div>
    );
}
