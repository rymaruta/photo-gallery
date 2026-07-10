"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon, CameraIcon, MusicalNoteIcon, MagnifyingGlassIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon, TrophyIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { userFetch } from "../../../lib/utils/api";
import { parseMusicEmbed, musicServiceLabel, searchSongs, type SongResult } from "../../../lib/utils/music";
import RankingCard from "../../components/RankingCard";

type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

type UserProfile = {
    userId: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
    songUrl?: string;
    songStart?: number;
    songEnd?: number;
    songTitle?: string;
    songArtist?: string;
    songArtwork?: string;
    songPreviewUrl?: string;
    songTrackUrl?: string;
    songs?: SongEntry[];
    ranking?: { title?: string; items: string[] };
    tripTitles?: Record<string, string>;
    tripCovers?: Record<string, string>;
    tripSongs?: Record<string, SongEntry>;
    themeColor?: string;
    statusText?: string;
    pinnedPhotoIds?: string[];
};

// "1:23" / "83" → 秒。空や不正は undefined。
function mmssToSec(v: string): number | undefined {
    const t = v.trim();
    if (!t) return undefined;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/^(\d+):([0-5]?\d)$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}
function secToMMSS(s?: number): string {
    if (!s || s <= 0) return "";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export default function ProfileEditPage() {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const { showToast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetching, setFetching] = useState(true);
    const [saving, setSaving] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [statusText, setStatusText] = useState("");
    const [themeColor, setThemeColor] = useState("");
    const [instagram, setInstagram] = useState("");
    const [website, setWebsite] = useState("");
    // マイBGMプレイリスト: アプリ内検索で選んだ曲（最大5曲・順に再生）
    const [selectedSongs, setSelectedSongs] = useState<SongResult[]>([]);
    // マイランキング
    const [rankingTitle, setRankingTitle] = useState("");
    const [rankingItems, setRankingItems] = useState<string[]>(["", "", "", "", ""]);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(false);
    // 検索結果の試聴（同時に1曲だけ）
    const [previewId, setPreviewId] = useState<string | null>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    // テーマソング: リンク貼付（上級者向け・フル尺/区間指定）
    const [showUrlMethod, setShowUrlMethod] = useState(false);
    const [songUrl, setSongUrl] = useState("");
    const [songStartText, setSongStartText] = useState("");
    const [songEndText, setSongEndText] = useState("");
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [coverError, setCoverError] = useState(false);
    const [coverUploading, setCoverUploading] = useState(false);

    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace("/login");
    }, [isAuthenticated, loading, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (res.ok) {
                    const data = await res.json() as UserProfile;
                    setProfile(data);
                    setDisplayName(data.displayName ?? "");
                    setBio(data.bio ?? "");
                    setStatusText(data.statusText ?? "");
                    setThemeColor(data.themeColor ?? "");
                    setInstagram(data.instagram ?? "");
                    setWebsite(data.website ?? "");
                    // 検索の曲と貼付リンクは独立して復元する（両方保持される）
                    if (data.songs && data.songs.length > 0) {
                        setSelectedSongs(data.songs.map((sg) => ({
                            id: sg.previewUrl,
                            title: sg.title,
                            artist: sg.artist ?? "",
                            artwork: sg.artwork ?? "",
                            previewUrl: sg.previewUrl,
                            trackUrl: sg.trackUrl ?? "",
                        })));
                    } else if (data.songPreviewUrl && data.songTitle) {
                        setSelectedSongs([{
                            id: data.songPreviewUrl,
                            title: data.songTitle,
                            artist: data.songArtist ?? "",
                            artwork: data.songArtwork ?? "",
                            previewUrl: data.songPreviewUrl,
                            trackUrl: data.songTrackUrl ?? "",
                        }]);
                    }
                    setRankingTitle(data.ranking?.title ?? "");
                    setRankingItems([...(data.ranking?.items ?? []), "", "", "", "", ""].slice(0, 5));
                    if (data.songUrl) {
                        setShowUrlMethod(true);
                        setSongUrl(data.songUrl);
                        setSongStartText(secToMMSS(data.songStart));
                        setSongEndText(secToMMSS(data.songEnd));
                    }
                }
            } catch { /* ignore */ } finally {
                setFetching(false);
            }
        })();
    }, [isAuthenticated]);

    const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => setCoverPreview(ev.target?.result as string);
        reader.readAsDataURL(file);
        setCoverUploading(true);
        try {
            const res = await userFetch("/profile/avatar/presigned-url", {
                method: "POST",
                body: JSON.stringify({ fileType: file.type, type: "cover" }),
            });
            if (!res.ok) { showToast("カバー写真のアップロードに失敗しました", "error"); return; }
            const { presignedUrl } = await res.json() as { presignedUrl: string };
            const uploadRes = await fetch(presignedUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
            });
            if (!uploadRes.ok) { showToast("カバー写真のアップロードに失敗しました", "error"); return; }
            setCoverError(false);
            showToast("カバー写真を更新しました", "success");
        } catch {
            showToast("カバー写真のアップロードに失敗しました", "error");
        } finally {
            setCoverUploading(false);
        }
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // プレビュー表示
        const reader = new FileReader();
        reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
        reader.readAsDataURL(file);

        setAvatarUploading(true);
        try {
            // Presigned URL 取得
            const res = await userFetch("/profile/avatar/presigned-url", {
                method: "POST",
                body: JSON.stringify({ fileType: file.type }),
            });
            if (!res.ok) { showToast("アバターのアップロードに失敗しました", "error"); return; }
            const { presignedUrl } = await res.json() as { presignedUrl: string };

            // S3 に直接アップロード
            const uploadRes = await fetch(presignedUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
            });
            if (!uploadRes.ok) { showToast("アバターのアップロードに失敗しました", "error"); return; }

            setAvatarError(false);
            showToast("プロフィール写真を更新しました", "success");
        } catch {
            showToast("アバターのアップロードに失敗しました", "error");
        } finally {
            setAvatarUploading(false);
        }
    };

    const stopPreview = () => {
        previewAudioRef.current?.pause();
        setPreviewId(null);
    };

    const togglePreview = (song: SongResult) => {
        if (!previewAudioRef.current) previewAudioRef.current = new Audio();
        const a = previewAudioRef.current;
        if (previewId === song.id) {
            a.pause();
            setPreviewId(null);
            return;
        }
        a.src = song.previewUrl;
        a.currentTime = 0;
        a.onended = () => setPreviewId(null);
        void a.play().catch(() => { /* 再生できない環境は無視 */ });
        setPreviewId(song.id);
    };

    // 画面を離れたら試聴を止める
    useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

    const addSong = (song: SongResult) => {
        setSelectedSongs((cur) => {
            if (cur.some((x) => x.previewUrl === song.previewUrl)) {
                showToast(locale === "en" ? "Already in your playlist" : "すでにプレイリストにあります", "info");
                return cur;
            }
            if (cur.length >= 5) {
                showToast(locale === "en" ? "Up to 5 songs" : "プレイリストは5曲までです", "info");
                return cur;
            }
            return [...cur, song];
        });
    };
    const removeSong = (previewUrl: string) =>
        setSelectedSongs((cur) => cur.filter((x) => x.previewUrl !== previewUrl));
    const moveSong = (idx: number, d: number) =>
        setSelectedSongs((cur) => {
            const j = idx + d;
            if (j < 0 || j >= cur.length) return cur;
            const next = [...cur];
            [next[idx], next[j]] = [next[j], next[idx]];
            return next;
        });

    const handleSongSearch = async () => {
        const q = songQuery.trim();
        if (!q) return;
        stopPreview();
        setSearching(true);
        setSearchError(false);
        try {
            setSongResults(await searchSongs(q));
        } catch {
            setSearchError(true);
            setSongResults([]);
        } finally {
            setSearching(false);
        }
    };

    const handleSave = async () => {
        // 検索の曲 と 貼付リンク を独立して保存する。
        //  - 曲(検索)があれば表示は曲を優先（UserProfileClient 側で判定）
        //  - リンクはそのまま保持され、曲を消すとリンクが使われる
        const trimmedUrl = songUrl.trim();
        if (trimmedUrl && !parseMusicEmbed(trimmedUrl)) {
            showToast(locale === "en"
                ? "Song link must be Spotify, YouTube, or Apple Music."
                : "曲のリンクは Spotify / YouTube / Apple Music に対応しています。", "error");
            return;
        }
        const songPayload = {
            // 貼付リンク（独立）
            songUrl: trimmedUrl,
            songStart: mmssToSec(songStartText),
            songEnd: mmssToSec(songEndText),
            // 検索で選んだ曲（独立）
            songTitle: selectedSongs[0]?.title ?? "",
            songArtist: selectedSongs[0]?.artist ?? "",
            songArtwork: selectedSongs[0]?.artwork ?? "",
            songPreviewUrl: selectedSongs[0]?.previewUrl ?? "",
            songTrackUrl: selectedSongs[0]?.trackUrl ?? "",
            songs: selectedSongs.map((sg) => ({
                title: sg.title,
                artist: sg.artist,
                artwork: sg.artwork,
                previewUrl: sg.previewUrl,
                trackUrl: sg.trackUrl,
            })),
        };
        setSaving(true);
        try {
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify({
                    displayName, bio, instagram, website,
                    statusText,
                    themeColor,
                    ...songPayload,
                    // PUT は全置換のため、このページで編集しない項目も送り返す
                    ranking: { title: rankingTitle, items: rankingItems.map((t) => t.trim()).filter(Boolean) },
                    tripTitles: profile?.tripTitles,
                    tripCovers: profile?.tripCovers,
                    tripSongs: profile?.tripSongs,
                    pinnedPhotoIds: profile?.pinnedPhotoIds,
                }),
            });
            if (res.ok) {
                showToast(locale === "en" ? "Profile saved." : "プロフィールを保存しました。", "success");
            } else {
                showToast(locale === "en" ? "Failed to save." : "保存に失敗しました。", "error");
            }
        } catch {
            showToast(locale === "en" ? "Failed to save." : "保存に失敗しました。", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading || fetching) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const currentAvatarUrl = profile?.userId && CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}`
        : null;
    const currentCoverUrl = profile?.userId && CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(profile.userId)}/cover`
        : null;

    const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors";
    const labelClass = "block text-xs text-white/50 mb-1.5 tracking-wide";

    const songPreview = parseMusicEmbed(songUrl, mmssToSec(songStartText), mmssToSec(songEndText));
    const songInvalid = songUrl.trim().length > 0 && !songPreview;
    const isYouTubePreview = songPreview?.service === "youtube";

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-10"
                >
                    <ArrowLeftIcon className="w-3 h-3" />
                    {locale === "en" ? "Back" : "戻る"}
                </Link>

                <h1 className="text-xl font-bold mb-6">
                    {locale === "en" ? "Edit Profile" : "プロフィール編集"}
                </h1>

                {/* カバー写真 */}
                <div className="mb-6">
                    <p className={labelClass}>{locale === "en" ? "Cover photo" : "カバー写真"}</p>
                    <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        disabled={coverUploading}
                        className="relative w-full h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-colors group"
                    >
                        {coverPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverPreview} alt="" className="w-full h-full object-cover" />
                        ) : currentCoverUrl && !coverError ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={currentCoverUrl} alt="" className="w-full h-full object-cover" onError={() => setCoverError(true)} />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-white/30">
                                <CameraIcon className="w-6 h-6" />
                                <span className="text-xs">{locale === "en" ? "Add cover photo" : "カバー写真を追加"}</span>
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                            {coverUploading
                                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <CameraIcon className="w-6 h-6 text-white" />}
                        </div>
                    </button>
                    <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => void handleCoverChange(e)} />
                </div>

                {/* アバター */}
                <div className="flex flex-col items-center mb-8">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="relative group"
                        aria-label={locale === "en" ? "Change profile photo" : "プロフィール写真を変更"}
                    >
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-white/10 ring-2 ring-white/20 group-hover:ring-white/50 transition-all">
                            {avatarPreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                            ) : currentAvatarUrl && !avatarError ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={currentAvatarUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={() => setAvatarError(true)}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <UserCircleIcon className="w-10 h-10 text-white/30" />
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                            {avatarUploading
                                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <CameraIcon className="w-6 h-6 text-white" />
                            }
                        </div>
                    </button>
                    <p className="text-xs text-white/40 mt-2">
                        {locale === "en" ? "Tap to change photo" : "タップして写真を変更"}
                    </p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleAvatarChange(e)}
                    />
                </div>

                <div className="space-y-5">
                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Display name" : "表示名"}
                        </label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            maxLength={100}
                            placeholder={locale === "en" ? "Your name" : "名前"}
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Bio" : "自己紹介"}
                        </label>
                        <textarea
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            maxLength={300}
                            rows={4}
                            placeholder={locale === "en" ? "Tell us about yourself..." : "旅と写真が好きです…"}
                            className={`${inputClass} resize-none`}
                        />
                        <div className="text-right text-xs text-white/30 mt-1">{bio.length}/300</div>
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Status (one line)" : "今のひとこと"}
                        </label>
                        <input
                            type="text"
                            value={statusText}
                            onChange={e => setStatusText(e.target.value)}
                            maxLength={60}
                            placeholder={locale === "en" ? "🎒 Planning my next trip" : "🎒 次は北海道に行きたい"}
                            className={inputClass}
                        />
                        <p className="text-xs text-white/30 mt-1.5">
                            {locale === "en" ? "Shown under your name. Emoji welcome." : "名前の下に表示されます。絵文字もOK。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Theme color" : "テーマカラー"}
                        </label>
                        <div className="flex flex-wrap gap-2.5">
                            {["#38bdf8", "#34d399", "#f472b6", "#a78bfa", "#fb7185", "#fbbf24", "#f97316", "#22d3ee"].map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setThemeColor(themeColor === c ? "" : c)}
                                    aria-label={c}
                                    aria-pressed={themeColor === c}
                                    className={`w-9 h-9 rounded-full ring-2 ring-offset-2 ring-offset-black active:scale-90 transition ${themeColor === c ? "ring-white scale-110" : "ring-transparent"}`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                        <p className="text-xs text-white/30 mt-1.5">
                            {locale === "en" ? "Colors your avatar ring and accents. Tap again to reset." : "アバターのリングなどの色になります。もう一度押すと解除。"}
                        </p>
                    </div>

                    <div>
                        <label className={labelClass}>Instagram</label>
                        <div className="flex items-center">
                            <span className="text-white/40 text-sm px-3 py-3 bg-white/5 border border-r-0 border-white/10 rounded-l-lg">@</span>
                            <input
                                type="text"
                                value={instagram}
                                onChange={e => setInstagram(e.target.value.replace(/^@/, ""))}
                                maxLength={100}
                                placeholder="username"
                                className={`${inputClass} rounded-l-none`}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>
                            {locale === "en" ? "Website" : "ウェブサイト"}
                        </label>
                        <input
                            type="url"
                            value={website}
                            onChange={e => setWebsite(e.target.value)}
                            maxLength={200}
                            placeholder="https://example.com"
                            className={inputClass}
                        />
                    </div>

                    {/* テーマソング */}
                    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-3">
                        <div className="flex items-center gap-1.5">
                            <MusicalNoteIcon className="w-4 h-4 text-fuchsia-400" />
                            <span className="text-sm font-semibold">{locale === "en" ? "My BGM" : "マイBGM"}</span>
                        </div>

                        {/* 選択済みプレイリスト（並べ替え・削除つき） */}
                        {selectedSongs.length > 0 && (
                            <ul className="space-y-1.5">
                                {selectedSongs.map((song, idx) => (
                                    <li key={song.previewUrl} className="flex items-center gap-2 rounded-xl bg-white/5 ring-1 ring-white/10 p-2">
                                        <span className="w-4 text-center text-xs text-white/50 tabular-nums flex-shrink-0">{idx + 1}</span>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={song.artwork} alt="" loading="lazy" className="w-9 h-9 rounded-md object-cover bg-white/10 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs text-white truncate">{song.title}</p>
                                            <p className="text-[11px] text-white/50 truncate">{song.artist}</p>
                                        </div>
                                        <button type="button" onClick={() => moveSong(idx, -1)} disabled={idx === 0}
                                            aria-label={locale === "en" ? "Move up" : "上へ"}
                                            className="px-1.5 py-1 text-white/40 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↑</button>
                                        <button type="button" onClick={() => moveSong(idx, 1)} disabled={idx === selectedSongs.length - 1}
                                            aria-label={locale === "en" ? "Move down" : "下へ"}
                                            className="px-1.5 py-1 text-white/40 hover:text-white disabled:opacity-25 active:scale-90 transition text-sm">↓</button>
                                        <button type="button" onClick={() => removeSong(song.previewUrl)}
                                            aria-label={locale === "en" ? "Remove" : "削除"}
                                            className="px-1.5 py-1 text-white/40 hover:text-red-400 active:scale-90 transition">
                                            <XMarkIcon className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {selectedSongs.length < 5 && (
                            <>
                                <p className="text-xs text-white/40 -mt-1">
                                    {locale === "en"
                                        ? `Search songs — up to 5 play in order on your profile (${selectedSongs.length}/5).`
                                        : `曲名で検索して追加。プロフィールで順に再生されます（${selectedSongs.length}/5曲）。`}
                                </p>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <MagnifyingGlassIcon className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            value={songQuery}
                                            onChange={e => setSongQuery(e.target.value)}
                                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleSongSearch(); } }}
                                            placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                            className={`${inputClass} pl-9`}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void handleSongSearch()}
                                        disabled={searching || !songQuery.trim()}
                                        className="px-4 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-sm disabled:opacity-40 flex items-center justify-center min-w-[64px]"
                                    >
                                        {searching
                                            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            : (locale === "en" ? "Search" : "検索")}
                                    </button>
                                </div>

                                {searchError && (
                                    <p className="text-xs text-amber-400/80">
                                        {locale === "en" ? "Search failed. Try again." : "検索に失敗しました。もう一度お試しください。"}
                                    </p>
                                )}

                                {songResults.length > 0 && (
                                    <ul className="rounded-xl ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden max-h-72 overflow-y-auto no-scrollbar">
                                        {songResults.map(song => {
                                            const isPreviewing = previewId === song.id;
                                            return (
                                            <li key={song.id} className="flex items-center gap-1 pr-2 hover:bg-white/5 transition">
                                                {/* 試聴（選択とは別。同時に1曲だけ再生） */}
                                                <button
                                                    type="button"
                                                    onClick={() => togglePreview(song)}
                                                    aria-label={isPreviewing ? `${song.title}を停止` : `${song.title}を試聴`}
                                                    className="relative w-10 h-10 ml-2 my-2 rounded-md overflow-hidden bg-white/10 flex-shrink-0 group"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={song.artwork} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                                                    <span className={`absolute inset-0 flex items-center justify-center bg-black/45 ${isPreviewing ? "" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                                                        {isPreviewing ? <PauseIcon className="w-4 h-4 text-white" /> : <PlayIcon className="w-4 h-4 text-white ml-0.5" />}
                                                    </span>
                                                </button>
                                                {/* 選択 */}
                                                <button
                                                    type="button"
                                                    onClick={() => { stopPreview(); addSong(song); }}
                                                    className="min-w-0 flex-1 flex items-center py-2.5 text-left active:opacity-70 transition"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <p className={`text-sm truncate ${isPreviewing ? "text-fuchsia-300" : "text-white"}`}>{song.title}</p>
                                                        <p className="text-xs text-white/50 truncate">{song.artist}</p>
                                                    </div>
                                                    <span className="text-[11px] text-white/40 flex-shrink-0 pl-2">{locale === "en" ? "Add" : "追加"}</span>
                                                </button>
                                            </li>
                                            );
                                        })}
                                    </ul>
                                )}

                            </>
                        )}

                        {/* リンク: 検索の曲とは独立して保存。曲があれば曲を優先し、曲を消すとこのリンクが使われる */}
                        <div className="pt-1 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => setShowUrlMethod(v => !v)}
                                className="w-full flex items-center justify-between text-xs text-white/45 hover:text-white/70 transition pt-2"
                            >
                                <span>{locale === "en" ? "Or paste a link (full song / pick a section)" : "またはリンクを貼る（フル尺・区間指定）"}</span>
                                <ChevronDownIcon className={`w-4 h-4 transition-transform ${showUrlMethod ? "rotate-180" : ""}`} />
                            </button>

                            {selectedSongs.length > 0 && (songUrl.trim() || showUrlMethod) && (
                                <p className="text-[11px] text-white/35 pt-2">
                                    {locale === "en"
                                        ? "A picked song plays first — this link is kept and used when no song is set."
                                        : "曲を選ぶとそちらが優先。リンクは保存され、曲を消すと使われます。"}
                                </p>
                            )}

                            {showUrlMethod && (
                                        <div className="space-y-3 pt-3">
                                            <div>
                                                <input
                                                    type="url"
                                                    value={songUrl}
                                                    onChange={e => setSongUrl(e.target.value)}
                                                    maxLength={500}
                                                    placeholder="https://youtu.be/..."
                                                    className={inputClass}
                                                />
                                                {songInvalid && (
                                                    <p className="text-xs text-amber-400/80 mt-1.5">
                                                        {locale === "en"
                                                            ? "Unsupported link. Use Spotify, YouTube, or Apple Music."
                                                            : "未対応のリンクです。Spotify / YouTube / Apple Music を使ってください。"}
                                                    </p>
                                                )}
                                            </div>

                                            {songPreview && (
                                                <>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1">
                                                            <label className="block text-[11px] text-white/40 mb-1">{locale === "en" ? "Start (m:ss)" : "開始 (m:ss)"}</label>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={songStartText}
                                                                onChange={e => setSongStartText(e.target.value)}
                                                                disabled={!isYouTubePreview}
                                                                placeholder="1:12"
                                                                className={`${inputClass} py-2 disabled:opacity-40`}
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[11px] text-white/40 mb-1">{locale === "en" ? "End (m:ss)" : "終了 (m:ss)"}</label>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={songEndText}
                                                                onChange={e => setSongEndText(e.target.value)}
                                                                disabled={!isYouTubePreview}
                                                                placeholder="1:35"
                                                                className={`${inputClass} py-2 disabled:opacity-40`}
                                                            />
                                                        </div>
                                                    </div>
                                                    <p className="text-[11px] text-white/35">
                                                        {isYouTubePreview
                                                            ? (locale === "en" ? "Set a start/end to play your favorite part." : "開始・終了を指定すると好きな部分だけ再生できます。")
                                                            : (locale === "en" ? `Section trim works with YouTube only (${musicServiceLabel(songPreview.service)} plays from the start).` : `区間指定は YouTube のみ対応（${musicServiceLabel(songPreview.service)} は先頭から再生）。`)}
                                                    </p>
                                                    <div className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-black">
                                                        {isYouTubePreview ? (
                                                            <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                                                                <iframe
                                                                    key={songPreview.embedUrl}
                                                                    src={songPreview.embedUrl}
                                                                    title="theme song preview"
                                                                    className="absolute inset-0 w-full h-full"
                                                                    allow="encrypted-media; picture-in-picture; web-share"
                                                                    referrerPolicy="strict-origin-when-cross-origin"
                                                                    loading="lazy"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <iframe
                                                                key={songPreview.embedUrl}
                                                                src={songPreview.embedUrl}
                                                                title="theme song preview"
                                                                className="w-full"
                                                                style={{ height: songPreview.height ?? 152 }}
                                                                allow="encrypted-media; autoplay; clipboard-write"
                                                                loading="lazy"
                                                            />
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                    </div>

                    {/* マイランキング */}
                    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-3">
                        <div className="flex items-center gap-1.5">
                            <TrophyIcon className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-semibold">{locale === "en" ? "My Ranking" : "マイランキング"}</span>
                        </div>
                        <p className="text-xs text-white/40 -mt-1">
                            {locale === "en"
                                ? "Make your own top 5 — best onsen, best views, anything."
                                : "「行ってよかった温泉TOP5」など、自由なお題でランキングを作れます。"}
                        </p>
                        <input
                            type="text"
                            value={rankingTitle}
                            onChange={e => setRankingTitle(e.target.value)}
                            maxLength={40}
                            placeholder={locale === "en" ? "Ranking title (e.g. Best views)" : "お題（例: 行ってよかった絶景ランキング）"}
                            className={inputClass}
                        />
                        <div className="space-y-2">
                            {rankingItems.map((v, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    {/* 金・銀・銅のミニメダル（表示カードと同じ配色） */}
                                    <span
                                        className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-black tabular-nums ${
                                            [
                                                "bg-gradient-to-br from-amber-100 via-yellow-400 to-amber-600 text-amber-950",
                                                "bg-gradient-to-br from-slate-50 via-slate-300 to-slate-500 text-slate-900",
                                                "bg-gradient-to-br from-orange-200 via-orange-400 to-orange-700 text-orange-950",
                                            ][i] ?? "bg-white/10 text-white/55"
                                        }`}
                                    >
                                        {i + 1}
                                    </span>
                                    <input
                                        type="text"
                                        value={v}
                                        onChange={e => setRankingItems((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                                        maxLength={60}
                                        placeholder={i === 0 ? (locale === "en" ? "e.g. Shirakawa-go" : "例: 白川郷") : ""}
                                        className={`${inputClass} py-2`}
                                    />
                                    {/* 並べ替え（上下の値を入れ替える） */}
                                    <div className="flex flex-col flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setRankingItems((cur) => cur.map((x, j) => (j === i ? cur[i - 1] : j === i - 1 ? cur[i] : x)))}
                                            disabled={i === 0}
                                            aria-label={locale === "en" ? `Move item ${i + 1} up` : `${i + 1}番目を上へ`}
                                            className="p-0.5 text-white/40 hover:text-white disabled:opacity-20 disabled:cursor-default transition"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            <ChevronUpIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRankingItems((cur) => cur.map((x, j) => (j === i ? cur[i + 1] : j === i + 1 ? cur[i] : x)))}
                                            disabled={i === rankingItems.length - 1}
                                            aria-label={locale === "en" ? `Move item ${i + 1} down` : `${i + 1}番目を下へ`}
                                            className="p-0.5 text-white/40 hover:text-white disabled:opacity-20 disabled:cursor-default transition"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            <ChevronDownIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="text-[11px] text-white/35">
                            {locale === "en" ? "Empty rows are skipped. Clear all to remove the ranking." : "空欄はスキップされます。全部空にするとランキング自体が消えます。"}
                        </p>
                        {/* 実際の見た目のプレビュー（入力に合わせてリアルタイム更新） */}
                        {rankingItems.some((t) => t.trim()) && (
                            <div className="pt-1">
                                <p className="text-[11px] tracking-widest uppercase text-white/35 mb-1.5">
                                    {locale === "en" ? "Preview" : "プレビュー"}
                                </p>
                                <RankingCard
                                    title={rankingTitle}
                                    items={rankingItems.map((t) => t.trim()).filter(Boolean)}
                                    locale={locale}
                                />
                            </div>
                        )}
                    </div>

                    <div className="pt-2">
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || avatarUploading}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {saving && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                            {saving
                                ? (locale === "en" ? "Saving..." : "保存中...")
                                : (locale === "en" ? "Save" : "保存する")}
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
