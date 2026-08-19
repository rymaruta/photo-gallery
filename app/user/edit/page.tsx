"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { Photo, LocalizedParagraphs } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";
const labelCls = "block text-sm text-white/60 mb-1";

// title/description は string か {ja,en}/{ja:[],en:[]} の両対応。編集は単一フィールドに集約する。
function titleToText(t: Photo["title"]): string {
    if (!t) return "";
    if (typeof t === "string") return t;
    const o = t as Record<string, string>;
    return o.ja || o.en || "";
}
function descToText(d: Photo["description"]): string {
    if (!d) return "";
    if (typeof d === "string") return d;
    const o = d as LocalizedParagraphs;
    const arr = o.ja && o.ja.length ? o.ja : o.en;
    return Array.isArray(arr) ? arr.join("\n") : "";
}

function EditContent() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const isJa = locale === "ja";

    const photoId = searchParams.get("id");

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    const [saving, setSaving] = useState(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");

    // 認証ゲート（一般ユーザー or 管理者）。upload ページと同じ方針。
    useEffect(() => {
        if (!loading && (!isAuthenticated || (!isAdminUser && !isGeneralUser))) {
            router.push(ROUTES.LOGIN);
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    // 対象写真の取得: 公開 /photos/{id} は下書きを404にするため、認証済み /user/photos から探す
    useEffect(() => {
        if (!photoId || !isAuthenticated || (!isAdminUser && !isGeneralUser)) return;
        const load = async () => {
            setLoadingPhoto(true);
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch("/user/photos");
                if (res.ok) {
                    const all = await res.json() as Photo[];
                    const found = Array.isArray(all) ? all.find((p) => p.id === photoId) ?? null : null;
                    if (found) {
                        setPhoto(found);
                        setTitle(titleToText(found.title));
                        setDescription(descToText(found.description));
                        setLocation(found.location ?? "");
                        setCategory(found.category ?? "");
                        setDate(found.date ?? "");
                        setTagsInput(Array.isArray(found.tags) ? found.tags.join(", ") : "");
                    } else {
                        showToast(isJa ? "写真が見つかりません" : "Photo not found", "error");
                        router.push(ROUTES.DRAFTS);
                    }
                } else {
                    showToast(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                }
            } catch (e) {
                log.error("edit load error:", e);
                showToast(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
            } finally {
                setLoadingPhoto(false);
            }
        };
        void load();
    }, [photoId, isAuthenticated, isAdminUser, isGeneralUser, router, showToast, isJa]);

    const save = useCallback(async (published: boolean) => {
        if (!photoId) return;
        setSaving(true);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({
                    title,
                    description,
                    location,
                    category,
                    date,
                    tags,
                    published,
                }),
            });
            if (res.ok) {
                showToast(
                    published
                        ? (isJa ? "公開しました" : "Published")
                        : (isJa ? "下書きを保存しました" : "Draft saved"),
                    "success",
                );
                router.push(ROUTES.DRAFTS);
            } else {
                const err = await res.json().catch(() => ({})) as { error?: string };
                showToast(err.error ?? (isJa ? "保存に失敗しました" : "Save failed"), "error");
            }
        } catch (e) {
            log.error("edit save error:", e);
            showToast(isJa ? "保存に失敗しました" : "Save failed", "error");
        } finally {
            setSaving(false);
        }
    }, [photoId, title, description, location, category, date, tagsInput, isJa, router, showToast]);

    if (loading || loadingPhoto) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        );
    }
    if (!photo) return null;

    const isDraft = photo.published === false;
    const ex = photo.exif ?? {};
    const exifSummary = [ex.camera, ex.lens, ex.dateTimeOriginal].filter(Boolean).join(" · ");

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8 pb-28">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.DRAFTS} className="text-white/60 hover:text-white transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isDraft ? (isJa ? "下書きを編集" : "Edit draft") : (isJa ? "写真を編集" : "Edit photo")}
                    </h1>
                </div>

                {photo.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={photo.thumbSrc || photo.src}
                        alt=""
                        className="w-full max-h-64 object-contain rounded-lg mb-3 bg-white/5"
                    />
                )}
                {exifSummary && (
                    <p className="text-xs text-white/40 mb-6">{isJa ? "撮影情報（自動）: " : "EXIF (auto): "}{exifSummary}</p>
                )}

                <form onSubmit={(e) => { e.preventDefault(); void save(true); }} className="space-y-5">
                    <div>
                        <label className={labelCls}>{isJa ? "タイトル" : "Title"}</label>
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                            className={inputCls} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意" : "Optional"} />
                    </div>

                    <div>
                        <label className={labelCls}>{isJa ? "説明" : "Description"}</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            rows={5} className={inputCls + " resize-y"} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意（改行で段落）" : "Optional (newline = paragraph)"} />
                    </div>

                    <div className="grid grid-cols-2 gap-4 [&>div]:min-w-0">
                        <div>
                            <label className={labelCls}>{isJa ? "場所" : "Location"}</label>
                            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "任意" : "Optional"} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "例: 風景" : "e.g. Landscape"} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "撮影日" : "Date"}</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タグ（カンマ区切り）" : "Tags (comma separated)"}</label>
                            <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "自然, 山" : "nature, mountain"} />
                        </div>
                    </div>
                </form>
            </div>

            {/* 固定アクションバー: 下書き保存 / 公開する */}
            <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40">
                <div className="max-w-2xl mx-auto flex items-center gap-2 justify-end">
                    <button
                        type="button"
                        onClick={() => void save(false)}
                        disabled={saving}
                        className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "下書き保存" : "Save draft"}
                    </button>
                    <button
                        type="button"
                        onClick={() => void save(true)}
                        disabled={saving}
                        className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "公開する" : "Publish")}
                    </button>
                </div>
            </div>
        </main>
    );
}

export default function UserEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        }>
            <EditContent />
        </Suspense>
    );
}
