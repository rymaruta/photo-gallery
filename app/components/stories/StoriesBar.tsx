"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, XMarkIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import UserAvatar from "../UserAvatar";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { compressImage, stripJpegExif } from "../../../lib/utils/image";
import { searchSongs, type SongResult } from "../../../lib/utils/music";
import { startFromPointer, clampStart } from "../../../lib/utils/songTrim";
import { log } from "../../../lib/utils/log";
import {
    groupStories, hasUnseen, loadSeenStoryIds, markStorySeen,
    type Story, type StoryGroup,
} from "../../../lib/stories";
import StoryViewer from "./StoryViewer";


// 画像ストーリーの表示秒数。投稿者が選べる（既定5秒）
const STORY_DEFAULT_DURATION_SEC = 5;
const STORY_DURATION_CHOICES = [3, 5, 7, 10, 15];
// iTunes プレビューの長さ。「好きな部分」の開始位置はこの範囲で選ぶ
const SONG_PREVIEW_SEC = 30;

// 0:07 形式（プレビューは30秒なので分は常に0）
const fmtSec = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

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
    // 曲の「好きな部分」= 30秒プレビュー内の開始位置（秒）
    const [songStart, setSongStart] = useState(0);
    // 画像ストーリーの表示秒数（投稿者が選ぶ）
    const [durationSec, setDurationSec] = useState(STORY_DEFAULT_DURATION_SEC);

    // 試聴用オーディオ（検索結果も選択中の曲も、常に1つだけ鳴らす）
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const [previewingId, setPreviewingId] = useState<string | null>(null);
    // 再生位置（秒）。選んだ範囲のどこを鳴らしているかを見せる
    const [previewTime, setPreviewTime] = useState(0);
    // 繰り返す範囲。timeupdate から最新値を読むため ref に持つ
    const loopRangeRef = useRef<{ start: number; end: number } | null>(null);

    const stopPreview = useCallback(() => {
        previewAudioRef.current?.pause();
        loopRangeRef.current = null;
        setPreviewingId(null);
    }, []);

    /**
     * 曲を試聴する。loopSec を渡すと start〜start+loopSec だけを繰り返す
     * （インスタと同じで、ストーリーに実際に乗る範囲がそのまま聴ける）。
     */
    const playPreview = useCallback((song: SongResult, startSec = 0, loopSec?: number) => {
        let a = previewAudioRef.current;
        if (!a) {
            a = new Audio();
            a.onended = () => {
                const range = loopRangeRef.current;
                const el = previewAudioRef.current;
                if (range && el) {
                    try { el.currentTime = range.start; } catch { /* ignore */ }
                    void el.play().catch(() => setPreviewingId(null));
                    return;
                }
                setPreviewingId(null);
            };
            a.ontimeupdate = () => {
                const el = previewAudioRef.current;
                if (!el) return;
                setPreviewTime(el.currentTime);
                const range = loopRangeRef.current;
                if (range && el.currentTime >= range.end) {
                    try { el.currentTime = range.start; } catch { /* ignore */ }
                }
            };
            previewAudioRef.current = a;
        }
        loopRangeRef.current = loopSec
            ? { start: startSec, end: Math.min(SONG_PREVIEW_SEC, startSec + loopSec) }
            : null;
        if (a.src !== song.previewUrl) a.src = song.previewUrl;
        try { a.currentTime = startSec; } catch { /* seek 未対応は無視 */ }
        setPreviewTime(startSec);
        void a.play()
            .then(() => setPreviewingId(song.id))
            .catch(() => setPreviewingId(null)); // 自動再生ブロック等
    }, []);

    // 画面を離れるときに音を止める
    useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

    // 曲を流す長さ＝ストーリーの表示時間（動画は長さが可変なのでプレビュー全体を使う）
    const songWindowSec = draft?.mediaType === "video" ? SONG_PREVIEW_SEC : durationSec;
    const maxSongStart = Math.max(0, SONG_PREVIEW_SEC - songWindowSec);

    // 「好きな部分」バーのドラッグ
    const trimBarRef = useRef<HTMLDivElement | null>(null);
    const [trimDragging, setTrimDragging] = useState(false);

    /** 開始秒を反映し、再生中なら音もその場で追従させる（止めない） */
    const applyTrimStart = useCallback((raw: number) => {
        const next = clampStart(raw, songWindowSec, SONG_PREVIEW_SEC);
        setSongStart(next);
        const a = previewAudioRef.current;
        if (a && draftSong && previewingId === draftSong.id) {
            try { a.currentTime = next; } catch { /* ignore */ }
            setPreviewTime(next);
        }
    }, [songWindowSec, draftSong, previewingId]);

    const applyTrimFromPointer = useCallback((clientX: number) => {
        const rect = trimBarRef.current?.getBoundingClientRect();
        if (!rect) return;
        applyTrimStart(startFromPointer(clientX, rect.left, rect.width, songWindowSec, SONG_PREVIEW_SEC));
    }, [applyTrimStart, songWindowSec]);

    // 再生中に範囲や長さを変えたら、繰り返す区間も追従させる
    useEffect(() => {
        if (draftSong && previewingId === draftSong.id) {
            loopRangeRef.current = { start: songStart, end: Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec) };
        }
    }, [songStart, songWindowSec, draftSong, previewingId]);

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
        stopPreview();
        setDraft(null);
        setCaption("");
        setDraftSong(null);
        setSongPickerOpen(false);
        setSongQuery("");
        setSongResults([]);
        setSongStart(0);
        setDurationSec(STORY_DEFAULT_DURATION_SEC);
    }, [draft, stopPreview]);

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
        stopPreview();
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
                    ...(draftSong ? { song: { title: draftSong.title, artist: draftSong.artist, artwork: draftSong.artwork, previewUrl: draftSong.previewUrl, trackUrl: draftSong.trackUrl, ...(songStart > 0 ? { startSec: songStart } : {}) } } : {}),
                    ...(draft.mediaType === "image" ? { durationSec } : {}),
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
    }, [draft, caption, draftSong, songStart, durationSec, locale, showToast, loadStories, closeDraft, stopPreview]);

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

    // 自分のストーリーは「あなた」の枠に統合して表示する（同じ人が2つ並ばないように）
    const ownGroupIdx = userId ? groups.findIndex((g) => g.userId === userId) : -1;
    const ownUnseen = ownGroupIdx >= 0 && hasUnseen(groups[ownGroupIdx], seen);

    return (
        <div className="mb-5">
            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
                {/* 自分の枠は常に1つだけ。すでに投稿があればリング＝自分のストーリー、
                    右下の「+」で追加投稿。まだ無ければ「+」だけを出す。 */}
                {isAuthenticated && userId && (
                    <div className="relative flex flex-col items-center gap-1.5 flex-shrink-0">
                        <button
                            onClick={() => { if (ownGroupIdx >= 0) setViewerGroup(ownGroupIdx); else fileInputRef.current?.click(); }}
                            disabled={posting}
                            className="disabled:opacity-50 group"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                            aria-label={ownGroupIdx >= 0
                                ? (locale === "en" ? "View your story" : "自分のストーリーを見る")
                                : (locale === "en" ? "Add a story" : "ストーリーを追加")}
                        >
                            <div
                                className="rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                                style={{ background: ownGroupIdx >= 0 ? (ownUnseen ? RING_UNSEEN : RING_SEEN) : "rgba(255,255,255,0.1)" }}
                            >
                                <div className="rounded-full p-[2.5px] bg-black">
                                    <UserAvatar userId={userId} className="w-[64px] h-[64px]" iconClassName="w-8 h-8" />
                                </div>
                            </div>
                        </button>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={posting}
                            className="absolute top-[50px] right-0 w-[22px] h-[22px] rounded-full ring-[3px] ring-black flex items-center justify-center active:scale-90 transition disabled:opacity-50"
                            style={{ background: "#0095F6", touchAction: "manipulation" }}
                            aria-label={locale === "en" ? "Add a story" : "ストーリーを追加"}
                        >
                            {posting
                                ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                : <PlusIcon className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                        </button>
                        <span className="text-[11px] text-white/70 leading-none">
                            {locale === "en" ? "Your story" : "あなた"}
                        </span>
                    </div>
                )}

                {/* 他ユーザーのストーリーリング（自分は上の枠に統合済みなので除く） */}
                {groups.map((group, idx) => {
                    if (idx === ownGroupIdx) return null;
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
                <div className="fixed inset-0 z-[95] bg-black flex flex-col" role="dialog" aria-modal="true">
                    {/* 写真は画面いっぱいの背面に固定。入力欄はその上に重ねるので、
                        キャプションや曲を入れている間もずっと写真を見ていられる。 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        {draft.mediaType === "video" ? (
                            <video src={draft.previewUrl} className="w-full h-full object-contain" playsInline muted loop autoPlay />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={draft.previewUrl} alt="" className="w-full h-full object-contain" />
                        )}
                    </div>
                    {/* 上下のスクリム（文字と写真が重なっても読めるように） */}
                    <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/60 to-transparent pointer-events-none" />

                    <div className="relative flex items-center justify-between p-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
                        <h2 className="text-sm font-semibold text-white drop-shadow">
                            {locale === "en" ? "New story" : "新しいストーリー"}
                        </h2>
                        <button onClick={closeDraft} disabled={posting} className="p-2 text-white/80 hover:text-white drop-shadow" aria-label={locale === "en" ? "Cancel" : "キャンセル"}>
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex-1 min-h-0" />
                    <div className="relative p-4 space-y-3 max-h-[70%] overflow-y-auto no-scrollbar" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
                        <input
                            type="text"
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                            maxLength={200}
                            placeholder={locale === "en" ? "Add a caption..." : "キャプションを追加..."}
                            disabled={posting}
                            className="w-full px-4 py-3 bg-black/55 backdrop-blur-sm ring-1 ring-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:bg-black/70"
                            style={{ fontSize: "16px" }}
                        />

                        {/* ストーリーBGM（任意） */}
                        {draftSong ? (
                            <div className="rounded-2xl bg-black/50 backdrop-blur-sm ring-1 ring-white/10 p-2.5 space-y-2.5">
                                <div className="flex items-center gap-2.5">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={draftSong.artwork} alt="" className="w-9 h-9 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-white truncate">{draftSong.title}</p>
                                        <p className="text-[11px] text-white/50 truncate">{draftSong.artist}</p>
                                    </div>
                                    <button
                                        onClick={() => previewingId === draftSong.id ? stopPreview() : playPreview(draftSong, songStart, songWindowSec)}
                                        disabled={posting}
                                        className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center active:scale-90 transition flex-shrink-0"
                                        aria-label={previewingId === draftSong.id ? (locale === "en" ? "Pause" : "停止") : (locale === "en" ? "Play" : "再生")}
                                    >
                                        {previewingId === draftSong.id
                                            ? <PauseIcon className="w-4 h-4 text-white" />
                                            : <PlayIcon className="w-4 h-4 text-white" />}
                                    </button>
                                    <button onClick={() => { stopPreview(); setDraftSong(null); setSongStart(0); }} disabled={posting} className="p-1 text-white/50 hover:text-white active:scale-90 transition flex-shrink-0" aria-label={locale === "en" ? "Remove song" : "曲を外す"}>
                                        <XMarkIcon className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* 好きな部分。ストーリーに乗る範囲を白枠で示し、その中だけを
                                    繰り返し再生する（インスタと同じ考え方）。秒数を頭で考えなくていい */}
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[11px] text-white/60">
                                            {locale === "en" ? "Drag to pick the part" : "ドラッグで好きな部分を選ぶ"}
                                        </span>
                                        <span className="text-[11px] text-white/80 tabular-nums">
                                            {fmtSec(songStart)} – {fmtSec(Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec))}
                                        </span>
                                    </div>
                                    {/* バーのどこを押しても、押した位置が範囲の中央になる。
                                        透明な range 入力だと iOS では見えないつまみを掴まないと
                                        動かず「反応しない」ため、ポインタを直接扱う。 */}
                                    <div
                                        ref={trimBarRef}
                                        role="slider"
                                        tabIndex={posting ? -1 : 0}
                                        aria-label={locale === "en" ? "Song start position" : "曲の開始位置"}
                                        aria-valuemin={0}
                                        aria-valuemax={maxSongStart}
                                        aria-valuenow={Math.min(songStart, maxSongStart)}
                                        aria-valuetext={`${fmtSec(songStart)} – ${fmtSec(Math.min(SONG_PREVIEW_SEC, songStart + songWindowSec))}`}
                                        onPointerDown={(e) => {
                                            if (posting) return;
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                            setTrimDragging(true);
                                            applyTrimFromPointer(e.clientX);
                                        }}
                                        onPointerMove={(e) => {
                                            if (!trimDragging) return;
                                            e.preventDefault();
                                            applyTrimFromPointer(e.clientX);
                                        }}
                                        onPointerUp={(e) => {
                                            setTrimDragging(false);
                                            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
                                        }}
                                        onPointerCancel={() => setTrimDragging(false)}
                                        onKeyDown={(e) => {
                                            const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
                                            if (step === 0 && e.key !== "Home" && e.key !== "End") return;
                                            e.preventDefault();
                                            const next = e.key === "Home" ? 0 : e.key === "End" ? maxSongStart : songStart + step;
                                            applyTrimStart(next);
                                        }}
                                        className={`relative h-12 rounded-lg bg-white/10 overflow-hidden select-none ${posting ? "opacity-50" : "cursor-pointer"} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60`}
                                        // 縦スクロールにドラッグを取られないようにする
                                        style={{ touchAction: "none", WebkitTapHighlightColor: "transparent" }}
                                    >
                                        {/* 選ばれている範囲 */}
                                        <div
                                            className={`absolute inset-y-0 bg-white/25 ring-2 ring-white/70 rounded-lg pointer-events-none ${trimDragging ? "" : "transition-[left] duration-75"}`}
                                            style={{
                                                left: `${(songStart / SONG_PREVIEW_SEC) * 100}%`,
                                                width: `${(songWindowSec / SONG_PREVIEW_SEC) * 100}%`,
                                            }}
                                        >
                                            {/* 掴めることが分かるつまみ */}
                                            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-1 rounded-full bg-white/80" />
                                        </div>
                                        {/* 再生位置 */}
                                        {previewingId === draftSong.id && (
                                            <div
                                                className="absolute inset-y-0 w-[2px] bg-white pointer-events-none"
                                                style={{ left: `${(previewTime / SONG_PREVIEW_SEC) * 100}%` }}
                                            />
                                        )}
                                    </div>
                                    <p className="mt-1.5 text-[10px] text-white/40">
                                        {locale === "en"
                                            ? `Plays ${songWindowSec}s from here, matching the story length.`
                                            : `ここから${songWindowSec}秒（ストーリーの表示時間ぶん）が流れます`}
                                    </p>
                                </div>
                            </div>
                        ) : songPickerOpen ? (
                            <div className="rounded-2xl bg-black/60 backdrop-blur-sm ring-1 ring-white/10 p-2.5 space-y-2">
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
                                    <button onClick={() => { stopPreview(); setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                        className="px-2 text-xs text-white/50 hover:text-white/80 active:scale-95 transition">
                                        {locale === "en" ? "Cancel" : "閉じる"}
                                    </button>
                                </div>
                                {songResults.length > 0 && (
                                    <ul className="rounded-xl bg-black/40 divide-y divide-white/5 overflow-hidden max-h-44 overflow-y-auto no-scrollbar">
                                        {songResults.map((r) => (
                                            <li key={r.id} className="flex items-center gap-1 pr-2">
                                                {/* 試聴（曲を決める前に雰囲気を確かめられる）*/}
                                                <button
                                                    onClick={() => previewingId === r.id ? stopPreview() : playPreview(r)}
                                                    className="relative w-8 h-8 ml-2 my-2 rounded overflow-hidden flex-shrink-0 active:scale-90 transition"
                                                    aria-label={previewingId === r.id
                                                        ? (locale === "en" ? `Pause ${r.title}` : `${r.title} を停止`)
                                                        : (locale === "en" ? `Play ${r.title}` : `${r.title} を試聴`)}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={r.artwork} alt="" loading="lazy" className="w-full h-full object-cover bg-white/10" />
                                                    <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                                        {previewingId === r.id
                                                            ? <PauseIcon className="w-4 h-4 text-white" />
                                                            : <PlayIcon className="w-4 h-4 text-white" />}
                                                    </span>
                                                </button>
                                                <button
                                                    onClick={() => { stopPreview(); setDraftSong(r); setSongStart(0); setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                                    className="flex-1 min-w-0 flex items-center gap-2.5 py-2 hover:bg-white/10 active:bg-white/15 transition text-left"
                                                >
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
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/10 hover:bg-black/70 text-white/85 text-xs active:scale-95 transition"
                            >
                                <MusicalNoteIcon className="w-4 h-4 text-fuchsia-300" />
                                {locale === "en" ? "Add music" : "曲を付ける"}
                            </button>
                        )}

                        {/* 表示時間（画像のみ。動画は動画の長さで決まる）*/}
                        {draft.mediaType === "image" && (
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-white/60 flex-shrink-0">
                                    {locale === "en" ? "Duration" : "表示時間"}
                                </span>
                                <div className="flex gap-1.5">
                                    {STORY_DURATION_CHOICES.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => {
                                                setDurationSec(s);
                                                // 表示時間を伸ばしたら、曲の範囲が30秒を超えないように詰める
                                                setSongStart((v) => Math.min(v, Math.max(0, SONG_PREVIEW_SEC - s)));
                                            }}
                                            disabled={posting}
                                            aria-pressed={durationSec === s}
                                            className={`px-3 py-1.5 rounded-full text-xs transition active:scale-95 ${durationSec === s
                                                ? "bg-white text-black font-semibold"
                                                : "bg-black/55 backdrop-blur-sm ring-1 ring-white/10 text-white/70"}`}
                                        >
                                            {s}
                                            {locale === "en" ? "s" : "秒"}
                                        </button>
                                    ))}
                                </div>
                            </div>
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
