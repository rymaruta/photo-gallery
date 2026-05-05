"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { Photo, LocalizedParagraphs } from "../../data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";

const inputCls = "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/50";
const labelCls = "block text-sm text-white/60 mb-1";
const sectionCls = "border-t border-white/10 pt-5";

function parseParagraphs(desc: Photo["description"], lang: "ja" | "en"): string {
    if (!desc) return "";
    if (typeof desc === "string") return desc;
    const arr = (desc as LocalizedParagraphs)[lang];
    return Array.isArray(arr) ? arr.join("\n") : "";
}

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

    // Basic
    const [titleJa, setTitleJa] = useState("");
    const [titleEn, setTitleEn] = useState("");
    // Description
    const [descJa, setDescJa] = useState("");
    const [descEn, setDescEn] = useState("");
    // Metadata
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");
    const [published, setPublished] = useState(true);
    // EXIF
    const [exifCamera, setExifCamera] = useState("");
    const [exifLens, setExifLens] = useState("");
    const [exifAperture, setExifAperture] = useState("");
    const [exifExposure, setExifExposure] = useState("");
    const [exifIso, setExifIso] = useState("");
    const [exifFocalLength, setExifFocalLength] = useState("");
    const [exifWhiteBalance, setExifWhiteBalance] = useState("");

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
                    const titleJaVal = typeof t === "object" && t !== null
                        ? (t as Record<string, string>).ja ?? ""
                        : typeof t === "string" ? t : "";
                    const titleEnVal = typeof t === "object" && t !== null
                        ? (t as Record<string, string>).en ?? ""
                        : typeof t === "string" ? t : "";
                    setTitleJa(titleJaVal);
                    setTitleEn(titleEnVal);

                    setDescJa(parseParagraphs(data.description, "ja"));
                    setDescEn(parseParagraphs(data.description, "en"));

                    setLocation(data.location ?? "");
                    setCategory(data.category ?? "");
                    setDate(data.date ?? "");
                    setTagsInput(Array.isArray(data.tags) ? data.tags.join(", ") : "");
                    setPublished(data.published !== false);

                    const ex = data.exif ?? {};
                    setExifCamera(ex.camera ?? "");
                    setExifLens(ex.lens ?? "");
                    setExifAperture(ex.aperture ?? "");
                    setExifExposure(ex.exposure ?? "");
                    setExifIso(ex.iso != null ? String(ex.iso) : "");
                    setExifFocalLength(ex.focalLength ?? "");
                    setExifWhiteBalance(ex.whiteBalance ?? "");
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
    }, [photoId, isAuthenticated, isAdminUser, showToast, router, locale]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!photoId) return;

        setSaving(true);
        try {
            const { authenticatedFetch } = await import("../../../lib/utils/api");
            const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

            const exif: Record<string, string | number> = {};
            if (exifCamera) exif.camera = exifCamera;
            if (exifLens) exif.lens = exifLens;
            if (exifAperture) exif.aperture = exifAperture;
            if (exifExposure) exif.exposure = exifExposure;
            if (exifIso) exif.iso = Number(exifIso);
            if (exifFocalLength) exif.focalLength = exifFocalLength;
            if (exifWhiteBalance) exif.whiteBalance = exifWhiteBalance;

            const descJaParagraphs = descJa.split("\n").map((s) => s.trim()).filter(Boolean);
            const descEnParagraphs = descEn.split("\n").map((s) => s.trim()).filter(Boolean);

            const res = await authenticatedFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({
                    title: { ja: titleJa, en: titleEn },
                    description: { ja: descJaParagraphs, en: descEnParagraphs },
                    location: location || undefined,
                    category: category || undefined,
                    date: date || undefined,
                    tags,
                    published,
                    exif: Object.keys(exif).length > 0 ? exif : undefined,
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

    const isJa = locale === "ja";

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="flex items-center gap-4 mb-8">
                    <Link href={ROUTES.ADMIN} className="text-white/60 hover:text-white transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isJa ? "写真を編集" : "Edit Photo"}
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

                    {/* タイトル */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>{isJa ? "タイトル（日本語）" : "Title (Japanese)"}</label>
                            <input type="text" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タイトル（英語）" : "Title (English)"}</label>
                            <input type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputCls} />
                        </div>
                    </div>

                    {/* 説明 */}
                    <div className={sectionCls}>
                        <p className="text-xs text-white/40 mb-3">{isJa ? "説明（1行 = 1段落）" : "Description (1 line = 1 paragraph)"}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>{isJa ? "説明（日本語）" : "Description (Japanese)"}</label>
                                <textarea
                                    value={descJa}
                                    onChange={(e) => setDescJa(e.target.value)}
                                    rows={5}
                                    className={inputCls + " resize-y"}
                                    placeholder={isJa ? "段落ごとに改行" : "One paragraph per line"}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "説明（英語）" : "Description (English)"}</label>
                                <textarea
                                    value={descEn}
                                    onChange={(e) => setDescEn(e.target.value)}
                                    rows={5}
                                    className={inputCls + " resize-y"}
                                    placeholder={isJa ? "段落ごとに改行" : "One paragraph per line"}
                                />
                            </div>
                        </div>
                    </div>

                    {/* メタデータ */}
                    <div className={sectionCls + " grid grid-cols-2 gap-4"}>
                        <div>
                            <label className={labelCls}>{isJa ? "場所" : "Location"}</label>
                            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "撮影日" : "Date"}</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タグ（カンマ区切り）" : "Tags (comma separated)"}</label>
                            <input
                                type="text"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                                placeholder={isJa ? "自然, 日本, 山" : "nature, japan, mountain"}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    {/* EXIF */}
                    <div className={sectionCls}>
                        <p className="text-xs text-white/40 mb-3">EXIF</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={labelCls}>{isJa ? "カメラ" : "Camera"}</label>
                                <input type="text" value={exifCamera} onChange={(e) => setExifCamera(e.target.value)} className={inputCls} placeholder="Sony α7IV" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "レンズ" : "Lens"}</label>
                                <input type="text" value={exifLens} onChange={(e) => setExifLens(e.target.value)} className={inputCls} placeholder="FE 24-70mm F2.8 GM" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "絞り" : "Aperture"}</label>
                                <input type="text" value={exifAperture} onChange={(e) => setExifAperture(e.target.value)} className={inputCls} placeholder="f/2.8" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "シャッタースピード" : "Exposure"}</label>
                                <input type="text" value={exifExposure} onChange={(e) => setExifExposure(e.target.value)} className={inputCls} placeholder="1/250s" />
                            </div>
                            <div>
                                <label className={labelCls}>ISO</label>
                                <input type="number" value={exifIso} onChange={(e) => setExifIso(e.target.value)} className={inputCls} placeholder="400" min="0" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "焦点距離" : "Focal Length"}</label>
                                <input type="text" value={exifFocalLength} onChange={(e) => setExifFocalLength(e.target.value)} className={inputCls} placeholder="50mm" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "ホワイトバランス" : "White Balance"}</label>
                                <input type="text" value={exifWhiteBalance} onChange={(e) => setExifWhiteBalance(e.target.value)} className={inputCls} placeholder="Auto" />
                            </div>
                        </div>
                    </div>

                    {/* 公開設定 */}
                    <div className={sectionCls + " flex items-center gap-3"}>
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
                        <span className="text-sm">{isJa ? "公開" : "Published"}</span>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-2 bg-white text-black rounded-lg font-medium text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
                        >
                            {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "保存" : "Save")}
                        </button>
                        <Link
                            href={ROUTES.ADMIN}
                            className="flex-1 py-2 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition-colors text-center"
                        >
                            {isJa ? "キャンセル" : "Cancel"}
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
