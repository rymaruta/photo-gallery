"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { authenticatedFetch, publicFetch } from "../../../lib/utils/api";
import type { Photo } from "../../../lib/data/photos";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

function EditForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const id = searchParams.get("id") ?? "";
    const { isAdminUser, loading: authLoading } = useAuth();

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [titleJa, setTitleJa] = useState("");
    const [titleEn, setTitleEn] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [published, setPublished] = useState(true);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (authLoading) return;
        if (!isAdminUser) { router.push("/admin/login"); return; }
        if (!id) { router.push("/admin"); return; }

        void (async () => {
            try {
                const res = await publicFetch(`/photos/${id}`);
                if (!res.ok) { router.push("/admin"); return; }
                const data = await res.json() as Photo;
                setPhoto(data);
                const t = data.title;
                setTitleJa(typeof t === "string" ? t : (t as Record<string, string>)?.ja ?? "");
                setTitleEn(typeof t === "string" ? "" : (t as Record<string, string>)?.en ?? "");
                setLocation(data.location ?? "");
                setCategory(data.category ?? "");
                setTags(Array.isArray(data.tags) ? data.tags.join(", ") : "");
                setPublished(data.published !== false);
            } catch {
                router.push("/admin");
            } finally {
                setLoading(false);
            }
        })();
    }, [authLoading, isAdminUser, id, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const body: Record<string, unknown> = {
                title: titleEn ? { ja: titleJa, en: titleEn } : titleJa,
                location: location || undefined,
                category: category || undefined,
                tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
                published,
            };
            const res = await authenticatedFetch(`/photos/${id}`, {
                method: "PUT",
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                setError(data.error ?? "更新に失敗しました");
                return;
            }
            setSaved(true);
            setTimeout(() => { setSaved(false); router.push("/admin"); }, 1500);
        } catch (err) {
            setError(err instanceof Error ? err.message : "更新に失敗しました");
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
            <div className="max-w-lg mx-auto px-4 pt-12 pb-16">
                <Link href="/admin" className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 transition-colors mb-8">
                    <ArrowLeftIcon className="w-3 h-3" /> 管理画面に戻る
                </Link>

                <h1 className="text-xl font-semibold mb-8">写真を編集</h1>

                {error && (
                    <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}
                {saved && (
                    <div className="mb-6 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                        保存しました
                    </div>
                )}

                {photo?.src && (
                    <div className="mb-6 rounded-lg overflow-hidden bg-white/5 aspect-video relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.src} alt="" className="w-full h-full object-contain" />
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">タイトル（日本語）</label>
                        <input
                            type="text"
                            value={titleJa}
                            onChange={(e) => setTitleJa(e.target.value)}
                            disabled={submitting}
                            placeholder="山中湖の白鳥"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">タイトル（English）</label>
                        <input
                            type="text"
                            value={titleEn}
                            onChange={(e) => setTitleEn(e.target.value)}
                            disabled={submitting}
                            placeholder="Swans on Lake Yamanaka"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">場所</label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            disabled={submitting}
                            placeholder="山中湖, 山梨"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">カテゴリ</label>
                        <input
                            type="text"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            disabled={submitting}
                            placeholder="nature"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">タグ <span className="text-white/30">（カンマ区切り）</span></label>
                        <input
                            type="text"
                            value={tags}
                            onChange={(e) => setTags(e.target.value)}
                            disabled={submitting}
                            placeholder="swan, lake, winter"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setPublished(!published)}
                            className={`w-10 h-6 rounded-full transition-colors relative ${published ? "bg-white" : "bg-white/20"}`}
                        >
                            <span className={`absolute top-1 w-4 h-4 rounded-full bg-black transition-all ${published ? "left-5" : "left-1"}`} />
                        </button>
                        <label className="text-sm text-white/70">{published ? "公開" : "非公開"}</label>
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                    >
                        {submitting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                        {submitting ? "保存中..." : "保存する"}
                    </button>
                </form>
            </div>
        </main>
    );
}

export default function AdminEditPage() {
    return (
        <Suspense>
            <EditForm />
        </Suspense>
    );
}
