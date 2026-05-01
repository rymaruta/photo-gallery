"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getUserPublic, type UserProfile } from "../../lib/utils/userApi";
import { publicFetch } from "../../lib/utils/api";
import type { Photo } from "../../lib/data/photos";
import { ROUTES } from "../../lib/routes";
import { UserCircleIcon, PhotoIcon } from "@heroicons/react/24/outline";

function UserProfileContent() {
    const searchParams = useSearchParams();
    const username = searchParams.get("u") ?? "";

    const [user, setUser] = useState<UserProfile | null>(null);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [notFound, setNotFound] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!username) { setNotFound(true); setLoading(false); return; }
        void (async () => {
            const userResult = await getUserPublic(username);
            if (!userResult.success || !userResult.user) {
                setNotFound(true);
                setLoading(false);
                return;
            }
            setUser(userResult.user);

            try {
                const res = await publicFetch("/photos");
                if (res.ok) {
                    const data = await res.json() as Photo[];
                    const userPhotos = data.filter(
                        (p) => (p.userId === userResult.user!.userId || p.uploadedBy === userResult.user!.userId)
                            && p.published !== false
                    );
                    setPhotos(userPhotos);
                }
            } catch {
                // Non-fatal
            }
            setLoading(false);
        })();
    }, [username]);

    if (loading) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    if (notFound) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center px-4">
                <div className="text-center space-y-4">
                    <UserCircleIcon className="w-16 h-16 text-white/20 mx-auto" />
                    <p className="text-white/40 text-sm">ユーザーが見つかりません</p>
                    <Link href={ROUTES.HOME} className="text-xs text-white/30 hover:text-white/50 underline transition-colors">
                        トップに戻る
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white">
            {/* Profile header */}
            <div className="max-w-4xl mx-auto px-4 pt-16 pb-8">
                <div className="flex items-start gap-6">
                    <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {user?.avatarKey ? (
                            <Image
                                src={`${process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? ""}/${user.avatarKey}`}
                                alt={user.displayName}
                                width={80}
                                height={80}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <UserCircleIcon className="w-12 h-12 text-white/30" />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-xl font-semibold text-white truncate">{user?.displayName}</h1>
                        <p className="text-white/40 text-sm mt-0.5">@{user?.username}</p>
                        {user?.bio && (
                            <p className="text-white/60 text-sm mt-3 leading-relaxed whitespace-pre-line">{user.bio}</p>
                        )}
                        <div className="flex items-center gap-1 mt-3">
                            <PhotoIcon className="w-4 h-4 text-white/30" />
                            <span className="text-white/40 text-sm">{photos.length} 枚</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/10" />

            {/* Photo grid */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                {photos.length === 0 ? (
                    <div className="text-center py-16">
                        <PhotoIcon className="w-12 h-12 text-white/20 mx-auto mb-3" />
                        <p className="text-white/30 text-sm">まだ写真がありません</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-0.5">
                        {photos.map((photo) => (
                            <Link key={photo.id} href={ROUTES.PHOTO(photo.id)} className="relative aspect-square overflow-hidden bg-white/5 group">
                                {photo.src ? (
                                    <Image
                                        src={photo.src}
                                        alt={typeof photo.title === "string" ? photo.title : (photo.title as Record<string, string>)?.ja ?? ""}
                                        fill
                                        sizes="(max-width: 640px) 33vw, 25vw"
                                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <PhotoIcon className="w-8 h-8 text-white/20" />
                                    </div>
                                )}
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {/* Back link */}
            <div className="max-w-4xl mx-auto px-4 pb-16">
                <Link href={ROUTES.HOME} className="text-xs text-white/30 hover:text-white/50 transition-colors">
                    ← トップに戻る
                </Link>
            </div>
        </main>
    );
}

export default function UserProfilePage() {
    return (
        <Suspense>
            <UserProfileContent />
        </Suspense>
    );
}
