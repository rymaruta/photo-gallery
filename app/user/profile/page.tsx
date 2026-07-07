"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon, CameraIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { userFetch } from "../../../lib/utils/api";
import { parseMusicEmbed, musicServiceLabel } from "../../../lib/utils/music";

type UserProfile = {
    userId: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
    songUrl?: string;
    songStart?: number;
    songEnd?: number;
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
    const [instagram, setInstagram] = useState("");
    const [website, setWebsite] = useState("");
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
                    setInstagram(data.instagram ?? "");
                    setWebsite(data.website ?? "");
                    setSongUrl(data.songUrl ?? "");
                    setSongStartText(secToMMSS(data.songStart));
                    setSongEndText(secToMMSS(data.songEnd));
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

    const handleSave = async () => {
        // 曲URLが未対応サービスなら保存前に知らせる
        const trimmedSong = songUrl.trim();
        if (trimmedSong && !parseMusicEmbed(trimmedSong)) {
            showToast(locale === "en"
                ? "Song link must be Spotify, YouTube, or Apple Music."
                : "曲のリンクは Spotify / YouTube / Apple Music に対応しています。", "error");
            return;
        }
        const songStart = mmssToSec(songStartText);
        const songEnd = mmssToSec(songEndText);
        setSaving(true);
        try {
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify({
                    displayName, bio, instagram, website,
                    songUrl: trimmedSong,
                    songStart, songEnd,
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
                            <span className="text-sm font-semibold">{locale === "en" ? "Theme song" : "テーマソング"}</span>
                        </div>
                        <p className="text-xs text-white/40 -mt-1">
                            {locale === "en"
                                ? "Paste a Spotify / YouTube / Apple Music link. It plays on your profile."
                                : "Spotify / YouTube / Apple Music のリンクを貼るとプロフィールで再生できます。"}
                        </p>
                        <div>
                            <input
                                type="url"
                                value={songUrl}
                                onChange={e => setSongUrl(e.target.value)}
                                maxLength={500}
                                placeholder="https://open.spotify.com/track/..."
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

                        {/* 好きな部分だけ再生（YouTube のみ） */}
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
                                        ? (locale === "en" ? "Set a start/end to loop your favorite part." : "開始・終了を指定すると好きな部分だけ再生できます。")
                                        : (locale === "en" ? `Trimming a section works with YouTube links only (${musicServiceLabel(songPreview.service)} plays from the start).` : `好きな部分の指定は YouTube リンクのみ対応です（${musicServiceLabel(songPreview.service)} は先頭から再生）。`)}
                                </p>

                                {/* ライブプレビュー */}
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

                    <div className="pt-2">
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || avatarUploading}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
