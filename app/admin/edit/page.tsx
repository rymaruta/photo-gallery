"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { Photo } from "../../data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";

function AdminEditContent() {
    const { isAuthenticated, isAdminUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const photoId = searchParams.get("id");

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    const [saving, setSaving] = useState(false);

    const [titleJa, setTitleJa] = useState("");
    const [titleEn, setTitleEn] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [tagsInput, setTagsInput] = useState("");
    const [published, setPublished] = useState(true);

    useEffect(() => {
        if (!loading) {
            if (!isAuthenticated) {
                router.push("/admin/login");
            } else if (!isAdminUser) {
                router.push("/");
            }
        }
    }, [isAuthenticated, isAdminUser, loading, router]);

    useEffect(() => {
        if (!photoId || !isAuthenticated || !isAdminUser) return;

        const fetchPhoto = async () => {
            setLoadingPhoto(true);
            try {
                const { publicFetch } = await import("../../../lib/utils/api");
                const res = await publicFetch(`/photos/${photoId}`);
                if (res.ok) {
                    const data = await res.json() as Photo;
                    setPhoto(data);
                    const t = data.title;
                    setTitleJa(typeof t === "object" && t !== null ? (t as Record<string, string>).ja ?? "" : typeof t === "string" ? t : "");
                    setTitleEn(typeof t === "object" && t !== null ? (t as Record<string, string>).en ?? "" : "");
                    setLocation(data.location ?? "");
                    setCategory(data.category ?? "");
                    setTagsInput(Array.isArray(data.tags) ? data.tags.join(", ") : "");
                    setPublished(data.published !== false);
                } else {
                    showToast(locale === "en" ? "Photo not found" : "写真が見つかりません", "error");
                    router.push(ROUTES.ADMIN);
                }
            } catch (e) {
                log.error("fetchPhoto error:", e);
                showToast(locale === "en" ? "Failed to load photo" : "写真の読み込みに失敗しました", "error");
            } finally {
                setLoadingPhoto(false);
            }
        };

        void fetchPhoto();
    }, [photoId, isAuthenticated, isAdminUser]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!photoId) return;

        setSaving(true);
        try {
            const { authenticatedFetch } = await import("../../../lib/utils/api");
            const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
            const res = await authenticatedFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({
                    title: { ja: titleJa, en: titleEn },
                    location: location || undefined,
                    category: category || undefined,
                    tags,
                    published,
                }),
            });

            if (res.ok) {
                showToast(locale === "en" ? "Saved" : "保存しました", "success");
                router.push(ROUTES.ADMIN);
            } else {
                const err = await res.json() as { error?: string };
                showToast(err.error ?? (locale === "en" ? "Save failed" : "保存に失敗しました"), "error");
            }
        } catch (e) {
            log.error("savePhoto error:", e);
            showToast(locale === "en" ? "Save failed" : "保存に失敗しました", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading || loadingPhoto) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        );
    }

    if (!photo) return null;

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="flex items-center gap-4 mb-8">
                    <Link href={ROUTES.ADMIN} className="text-white/60 hover:text-white transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {locale === "en" ? "Edit Photo" : "写真を編集"}
                    </h1>
                </div>

                {photo.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={photo.src}
                        alt=""
                        className="w-full max-h-64 object-contain rounded-lg mb-6 bg-white/5"
                    />
                )}

                <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm text-white/60 mb-1">
                                {locale === "en" ? "Title (Japanese)" : "タイトル（日本語）"}
                            </label>
                            <input
                                type="text"
                                value={titleJa}
                                onChange={(e) => setTitleJa(e.target.value)}
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-white/60 mb-1">
                                {locale === "en" ? "Title (English)" : "タイトル（英語）"}
                            </label>
                            <input
                                type="text"
                                value={titleEn}
                                onChange={(e) => setTitleEn(e.target.value)}
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm text-white/60 mb-1">
                            {locale === "en" ? "Location" : "場所"}
                        </label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-white/60 mb-1">
                            {locale === "en" ? "Category" : "カテゴリ"}
                        </label>
                        <input
                            type="text"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50"
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-white/60 mb-1">
                            {locale === "en" ? "Tags (comma separated)" : "タグ（カンマ区切り）"}
                        </label>
                        <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder={locale === "en" ? "nature, japan, mountain" : "自然, 日本, 山"}
                            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={published}
                            onClick={() => setPublished((v) => !v)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${published ? "bg-blue-500" : "bg-white/20"}`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${published ? "translate-x-6" : "translate-x-1"}`}
                            />
                        </button>
                        <span className="text-sm">
                            {locale === "en" ? "Published" : "公開"}
                        </span>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-2 bg-white text-black rounded-lg font-medium text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
                        >
                            {saving
                                ? (locale === "en" ? "Saving…" : "保存中…")
                                : (locale === "en" ? "Save" : "保存")}
                        </button>
                        <Link
                            href={ROUTES.ADMIN}
                            className="flex-1 py-2 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition-colors text-center"
                        >
                            {locale === "en" ? "Cancel" : "キャンセル"}
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function AdminEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        }>
            <AdminEditContent />
        </Suspense>
    );
}
