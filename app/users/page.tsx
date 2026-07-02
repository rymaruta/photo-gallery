"use client";

import React, { useEffect, useState, useMemo, useCallback, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon, UserCircleIcon, GlobeAltIcon, EyeSlashIcon, ShareIcon, LinkIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../i18n/context";
import { useToast } from "../../lib/hooks/useToast";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { log } from "../../lib/utils/log";
import { getCurrentSession } from "../../lib/auth/cognito";
import { copyToClipboard, shareToTwitter, shareToLine } from "../../lib/utils/share";
import { publicFetch, userFetch } from "../../lib/utils/api";
import PHOTOS_JSON from "../data/photos.json";

type UserProfile = {
    userId: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
};

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

function ProfileAvatar({ userId, size = "md" }: { userId: string; size?: "md" | "lg" }) {
    const [avatarError, setAvatarError] = useState(false);
    const avatarUrl = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}` : "";
    const dim = size === "lg" ? "w-16 h-16 sm:w-20 sm:h-20" : "w-10 h-10";
    const iconDim = size === "lg" ? "w-10 h-10 sm:w-12 sm:h-12" : "w-6 h-6";

    if (!avatarUrl || avatarError) {
        return (
            <div className={`${dim} rounded-full bg-white/10 flex items-center justify-center flex-shrink-0`}>
                <UserCircleIcon className={`${iconDim} text-white/40`} />
            </div>
        );
    }

    return (
        <div className={`${dim} rounded-full overflow-hidden bg-white/10 flex-shrink-0`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={avatarUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setAvatarError(true)}
            />
        </div>
    );
}

function CoverPhoto({ userId }: { userId: string }) {
    const [coverError, setCoverError] = useState(false);
    const coverUrl = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}/cover` : "";

    if (!coverUrl || coverError) {
        return <div className="w-full h-20 sm:h-28 bg-gradient-to-b from-white/5 to-black" />;
    }

    return (
        <div className="w-full h-32 sm:h-44 relative overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={coverUrl}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setCoverError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
        </div>
    );
}

function PhotoCard({ photo, locale, isOwner, onTogglePublish }: {
    photo: Photo;
    locale: string;
    isOwner: boolean;
    onTogglePublish?: (id: string, published: boolean) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const title = getLocalized(photo.title, locale as "ja" | "en") || (typeof photo.title === "string" ? photo.title : "");
    const isHidden = photo.published === false;

    return (
        <div className="relative" style={{ paddingTop: "100%" }}>
            <Link
                href={`/photo/${photo.id}`}
                className={`absolute inset-0 overflow-hidden bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${isHidden ? "opacity-40" : ""}`}
            >
                {!imageError ? (
                    <Image
                        src={photo.src}
                        alt={title}
                        fill
                        className="object-cover"
                        sizes="(max-width:640px) 33vw, (max-width:1024px) 25vw, 20vw"
                        loading="lazy"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                        <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                )}
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors" />
            </Link>

            {/* 自分のプロフィール: 公開/非公開トグル */}
            {isOwner && (
                <button
                    onClick={(e) => { e.preventDefault(); onTogglePublish?.(photo.id, !isHidden); }}
                    className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-colors z-10 ${
                        isHidden
                            ? "bg-black/80 text-white/80 hover:bg-black"
                            : "bg-black/0 text-white/0 hover:bg-black/60 hover:text-white/80"
                    }`}
                    title={isHidden ? (locale === "en" ? "Show" : "公開する") : (locale === "en" ? "Hide" : "非公開にする")}
                >
                    <EyeSlashIcon className="w-4 h-4" />
                </button>
            )}

            {/* 非公開バッジ */}
            {isOwner && isHidden && (
                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/80 rounded text-xs text-white/70 pointer-events-none">
                    {locale === "en" ? "Hidden" : "非公開"}
                </div>
            )}
        </div>
    );
}

function UsersPageInner() {
    const { locale } = useLocale();
    const { showToast } = useToast();
    const searchParams = useSearchParams();
    const userId = searchParams.get("id");

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [isOwner, setIsOwner] = useState(false);

    useEffect(() => {
        if (!userId) {
            setLoading(false);
            setError("no-id");
            return;
        }

        // JSON から即時表示（API 待ちなし）
        const jsonPhotos = (PHOTOS_JSON as Photo[]).filter(p => p.userId === userId);
        setPhotos(jsonPhotos);
        setLoading(false);

        const controller = new AbortController();
        const load = async () => {
            try {
                const userApiBase = process.env.NEXT_PUBLIC_USER_API_BASE_URL ?? "";
                const [profileRes, sessionResult] = await Promise.all([
                    fetch(`${userApiBase}/profile/${encodeURIComponent(userId)}`, { signal: controller.signal }),
                    getCurrentSession(),
                ]);
                if (profileRes.ok) {
                    const prof = await profileRes.json() as UserProfile;
                    setUserProfile(prof);
                }
                const isCurrentUserOwner = !!sessionResult &&
                    (sessionResult.getIdToken().payload["sub"] as string | undefined) === userId;
                if (isCurrentUserOwner) setIsOwner(true);

                // API から新しい写真も取得（オーナー以外のみ — オーナーは非公開写真がJSONにある）
                if (!isCurrentUserOwner) {
                    const photosRes = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, { signal: controller.signal });
                    if (photosRes.ok) {
                        const data = await photosRes.json() as unknown;
                        if (Array.isArray(data)) {
                            setPhotos(data as Photo[]);
                        }
                    }
                }
            } catch (e) {
                if ((e as { name?: string }).name !== "AbortError") {
                    log.error("user profile fetch error:", e);
                }
            }
        };
        void load();
        return () => controller.abort();
    }, [userId]);

    const displayName = useMemo(() => {
        if (userProfile?.displayName) return userProfile.displayName;
        return photos.find(p => p.displayName)?.displayName ?? null;
    }, [userProfile, photos]);

    const publishedPhotos = useMemo(
        () => photos.filter(p => p.published !== false),
        [photos]
    );

    const handleTogglePublish = useCallback(async (photoId: string, publish: boolean) => {
        try {
            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({ published: publish }),
            });
            if (res.ok) {
                setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, published: publish } : p));
                showToast(publish
                    ? (locale === "en" ? "Photo is now public" : "写真を公開しました")
                    : (locale === "en" ? "Photo is now hidden" : "写真を非公開にしました"),
                    "success"
                );
            } else {
                showToast(locale === "en" ? "Failed to update" : "更新に失敗しました", "error");
            }
        } catch {
            showToast(locale === "en" ? "Failed to update" : "更新に失敗しました", "error");
        }
    }, [locale, showToast]);

    const handleShareProfile = useCallback(async () => {
        const url = typeof window !== "undefined" ? window.location.href : "";
        try {
            await copyToClipboard(url);
            showToast(locale === "en" ? "Link copied!" : "リンクをコピーしました", "success");
        } catch {
            showToast(locale === "en" ? "Failed to copy" : "コピーに失敗しました", "error");
        }
    }, [locale, showToast]);

    if (!userId || error === "no-id") {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
                    <p className="text-white/60 text-sm">
                        {locale === "en" ? "No user ID specified." : "ユーザーIDが指定されていません。"}
                    </p>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors text-sm"
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        {locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            </main>
        );
    }

    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen text-white bg-black">
            {/* カバー写真 */}
            <CoverPhoto userId={userId} />

            <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8">
                {/* 戻るリンク（カバー写真の上に重ねる） */}
                <div className="-mt-8 relative z-10 mb-4">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors drop-shadow"
                        style={{ minHeight: "44px" }}
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        <span className="text-sm">{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>

                {/* プロフィールヘッダー */}
                <div className="pb-6">
                    {/* アバター + 名前・投稿数 */}
                    <div className="flex items-end gap-4 mb-4 -mt-8">
                        <div className="ring-4 ring-black rounded-full flex-shrink-0">
                            <ProfileAvatar userId={userId} size="lg" />
                        </div>
                        <div className="flex-1 min-w-0 pb-1">
                            <h1 className="text-xl sm:text-2xl font-bold leading-tight truncate">
                                {displayName ?? (locale === "en" ? "Anonymous" : "ユーザー")}
                            </h1>
                            {/* 投稿数 + シェアボタン */}
                            <div className="flex items-center gap-3 mt-1">
                                <span className="inline-flex items-baseline gap-1">
                                    <span className="text-base font-bold">{isOwner ? photos.length : publishedPhotos.length}</span>
                                    <span className="text-xs text-white/50">{locale === "en" ? "posts" : "投稿"}</span>
                                </span>
                                <div className="flex items-center gap-0.5 ml-auto">
                                    <button
                                        onClick={() => void handleShareProfile()}
                                        className="p-1.5 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                        title={locale === "en" ? "Copy profile link" : "リンクをコピー"}
                                    >
                                        <LinkIcon className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => shareToTwitter(typeof window !== "undefined" ? window.location.href : "", displayName ?? "")}
                                        className="p-1.5 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                        title="X"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                                    </button>
                                    <button
                                        onClick={() => shareToLine(typeof window !== "undefined" ? window.location.href : "", displayName ?? "")}
                                        className="p-1.5 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                                        title="LINE"
                                    >
                                        <ShareIcon className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {userProfile?.bio && (
                        <p className="text-sm text-white/70 whitespace-pre-wrap mb-3 leading-relaxed">{userProfile.bio}</p>
                    )}

                    {(userProfile?.instagram || userProfile?.website) && (
                        <div className="flex flex-wrap gap-3">
                            {userProfile.instagram && (
                                <a
                                    href={`https://instagram.com/${userProfile.instagram}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
                                >
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                                    </svg>
                                    <span>@{userProfile.instagram}</span>
                                </a>
                            )}
                            {userProfile.website && /^https?:\/\//.test(userProfile.website) && (
                                <a
                                    href={userProfile.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
                                >
                                    <GlobeAltIcon className="w-3.5 h-3.5" />
                                    <span className="truncate max-w-[180px]">{userProfile.website.replace(/^https?:\/\//, "")}</span>
                                </a>
                            )}
                        </div>
                    )}

                    {/* 自分のプロフィール: 編集・アップロード導線（インスタ風） */}
                    {isOwner && (
                        <div className="flex gap-2 mt-4">
                            <Link
                                href="/user/profile"
                                className="flex-1 text-center px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors"
                                style={{ touchAction: "manipulation", minHeight: "40px", lineHeight: "24px" }}
                            >
                                {locale === "en" ? "Edit profile" : "プロフィール編集"}
                            </Link>
                            <Link
                                href="/user/upload"
                                className="flex-1 text-center px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-white/90 transition-colors"
                                style={{ touchAction: "manipulation", minHeight: "40px", lineHeight: "24px" }}
                            >
                                {locale === "en" ? "Add photos" : "写真を追加"}
                            </Link>
                        </div>
                    )}
                </div>

                <div className="border-t border-white/10 mb-0.5" />

                {photos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-white/50 gap-2">
                        <UserCircleIcon className="w-12 h-12" />
                        <p className="text-sm">
                            {locale === "en" ? "No photos yet." : "まだ写真がありません。"}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-0.5">
                        {(isOwner ? photos : publishedPhotos).map(photo => (
                            <PhotoCard key={photo.id} photo={photo} locale={locale} isOwner={isOwner} onTogglePublish={handleTogglePublish} />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

export default function UsersPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        }>
            <UsersPageInner />
        </Suspense>
    );
}
