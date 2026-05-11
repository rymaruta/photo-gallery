"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { userFetch } from "../../../lib/utils/api";

type UserProfile = {
    userId: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
};

export default function ProfileEditPage() {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const { showToast } = useToast();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [fetching, setFetching] = useState(true);
    const [saving, setSaving] = useState(false);

    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [instagram, setInstagram] = useState("");
    const [website, setWebsite] = useState("");

    useEffect(() => {
        if (!loading && !isAuthenticated) {
            router.replace("/login");
        }
    }, [isAuthenticated, loading, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        const load = async () => {
            try {
                const res = await userFetch("/user/profile");
                if (res.ok) {
                    const data = await res.json() as UserProfile;
                    setProfile(data);
                    setDisplayName(data.displayName ?? "");
                    setBio(data.bio ?? "");
                    setInstagram(data.instagram ?? "");
                    setWebsite(data.website ?? "");
                }
            } catch {
                /* ignore */
            } finally {
                setFetching(false);
            }
        };
        void load();
    }, [isAuthenticated]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify({ displayName, bio, instagram, website }),
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

    const inputClass = "w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30";
    const labelClass = "block text-xs text-white/50 mb-1";

    return (
        <main className="min-h-screen bg-black text-white px-4 py-8 sm:px-6">
            <div className="max-w-lg mx-auto">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm mb-8"
                >
                    <ArrowLeftIcon className="w-4 h-4" />
                    {locale === "en" ? "Back" : "戻る"}
                </Link>

                <h1 className="text-xl font-bold mb-8">
                    {locale === "en" ? "Edit Profile" : "プロフィール編集"}
                </h1>

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
                            placeholder={locale === "en" ? "Tell us about yourself..." : "自己紹介を書いてください..."}
                            className={`${inputClass} resize-none`}
                        />
                        <div className="text-right text-xs text-white/30 mt-1">{bio.length}/300</div>
                    </div>

                    <div>
                        <label className={labelClass}>Instagram</label>
                        <div className="flex items-center">
                            <span className="text-white/40 text-sm px-3 py-2 bg-white/5 border border-r-0 border-white/10 rounded-l-md">@</span>
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

                    <div className="pt-4">
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving}
                            className="w-full py-3 bg-white text-black text-sm font-medium rounded-md hover:bg-white/90 transition-colors disabled:opacity-50"
                        >
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
