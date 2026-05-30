"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../auth/context";
import { getMe, updateMe, type UserProfile } from "../../../../lib/utils/userApi";
import { ROUTES } from "../../../../lib/routes";
import { UserIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

export default function EditProfilePage() {
    const router = useRouter();
    const { isAuthenticated, loading: authLoading } = useAuth();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) { router.push(ROUTES.LOGIN); return; }
        void (async () => {
            const result = await getMe();
            if (result.success && result.user) {
                setProfile(result.user);
                setDisplayName(result.user.displayName);
                setBio(result.user.bio ?? "");
            } else if (result.error === "NOT_FOUND") {
                // Profile not yet created — redirect to setup isn't needed,
                // but we can't edit what doesn't exist
                setError("プロフィールがまだ作成されていません");
            }
            setLoading(false);
        })();
    }, [isAuthenticated, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!displayName.trim()) { setError("表示名を入力してください"); return; }
        setError("");
        setSubmitting(true);
        try {
            const result = await updateMe({ displayName: displayName.trim(), bio: bio.trim() || undefined });
            if (result.success) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
                if (result.user) setProfile(result.user);
            } else {
                setError(result.error ?? "更新に失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (authLoading || loading) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-sm mx-auto px-4 pt-16 pb-16">
                <button
                    onClick={() => profile ? router.push(ROUTES.USER_PROFILE(profile.userId)) : router.push(ROUTES.HOME)}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-8"
                >
                    <ArrowLeftIcon className="w-3 h-3" />
                    {profile ? `@${profile.username}` : "戻る"}
                </button>

                <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                        <UserIcon className="w-6 h-6 text-white/40" />
                    </div>
                    <div>
                        <h1 className="text-lg font-semibold">プロフィール編集</h1>
                        {profile && <p className="text-white/40 text-xs">@{profile.username}</p>}
                    </div>
                </div>

                {error && (
                    <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}
                {saved && (
                    <div className="mb-6 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                        プロフィールを更新しました
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">表示名</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            required
                            maxLength={50}
                            disabled={submitting}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">自己紹介</label>
                        <textarea
                            value={bio}
                            onChange={(e) => setBio(e.target.value)}
                            rows={4}
                            maxLength={200}
                            disabled={submitting}
                            placeholder="旅と写真が好きです…"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors resize-none"
                        />
                        <p className="text-xs text-white/30 mt-1 text-right">{bio.length}/200</p>
                    </div>

                    <button
                        type="submit"
                        disabled={submitting || !displayName.trim()}
                        className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {submitting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                        {submitting ? "保存中..." : "保存する"}
                    </button>
                </form>
            </div>
        </main>
    );
}
