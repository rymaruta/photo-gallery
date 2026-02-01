"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "../../../auth/context";
import { useLocale } from "../../../i18n/context";
import { useToast } from "../../../../lib/hooks/useToast";
import { log } from "../../../../lib/utils/log";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import type { Photo } from "../../../data/photos";

type Props = {
    photoId: string;
};

export default function EditPhotoPageClient({ photoId }: Props) {
    const { isAuthenticated, isAdminUser, loading } = useAuth();
    const router = useRouter();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    const [saving, setSaving] = useState(false);

    // フォームの状態
    const [titleJa, setTitleJa] = useState("");
    const [titleEn, setTitleEn] = useState("");
    const [descriptionJa, setDescriptionJa] = useState("");
    const [descriptionEn, setDescriptionEn] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [lat, setLat] = useState("");
    const [lng, setLng] = useState("");
    const [googleMapLink, setGoogleMapLink] = useState("");

    // 認証チェック
    useEffect(() => {
        if (!loading) {
            if (!isAuthenticated || !isAdminUser) {
                router.push("/login");
            }
        }
    }, [isAuthenticated, isAdminUser, loading, router]);

    const loadPhoto = useCallback(async () => {
        try {
            setLoadingPhoto(true);
            // 管理者ページでは常に最新データを取得するためキャッシュを無効化
            const { publicFetch } = await import("../../../../lib/utils/api");
            const response = await publicFetch(`/photos/${photoId}`, {
                cache: "no-store",
            });
            if (response.ok) {
                const data = await response.json();
                setPhoto(data);

                // フォームに値を設定
                if (typeof data.title === "string") {
                    setTitleJa(data.title);
                    setTitleEn(data.title);
                } else if (data.title) {
                    setTitleJa(data.title.ja || "");
                    setTitleEn(data.title.en || "");
                }

                if (typeof data.description === "string") {
                    setDescriptionJa(data.description);
                    setDescriptionEn("");
                } else if (data.description) {
                    setDescriptionJa(Array.isArray(data.description.ja) ? data.description.ja.join("\n") : data.description.ja || "");
                    setDescriptionEn(Array.isArray(data.description.en) ? data.description.en.join("\n") : data.description.en || "");
                }

                setLocation(data.location || "");
                setCategory(data.category || "");
                setTags(data.tags ? data.tags.join(", ") : "");

                // 座標
                if (data.coords) {
                    setLat(data.coords.lat?.toString() || "");
                    setLng(data.coords.lng?.toString() || "");
                } else {
                    setLat("");
                    setLng("");
                }

                    // 地図リンク
                    if (data.mapLinks) {
                        setGoogleMapLink(data.mapLinks.google || "");
                    } else {
                        setGoogleMapLink("");
                    }
            } else {
                showToast("写真の取得に失敗しました", "error");
                router.push("/admin");
            }
        } catch (error) {
            log.error("写真取得エラー:", error);
            showToast("写真の取得に失敗しました", "error");
            router.push("/admin");
        } finally {
            setLoadingPhoto(false);
        }
    }, [photoId, router, showToast]);

    // 写真データを取得
    useEffect(() => {
        if (isAuthenticated && isAdminUser && photoId) {
            loadPhoto();
        }
    }, [isAuthenticated, isAdminUser, photoId, loadPhoto]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!photo) return;

        setSaving(true);

        try {
            const { authenticatedFetch } = await import("../../../../lib/utils/api");

            const updateData: Record<string, unknown> = {
                title: {
                    ja: titleJa || undefined,
                    en: titleEn || undefined,
                },
                description: {
                    ja: descriptionJa ? descriptionJa.split("\n").filter(Boolean) : undefined,
                    en: descriptionEn ? descriptionEn.split("\n").filter(Boolean) : undefined,
                },
                location: location || undefined,
                category: category || undefined,
                tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
            };

            // 座標（緯度・経度の両方が入力されている場合のみ）
            if (lat && lng) {
                const latNum = parseFloat(lat);
                const lngNum = parseFloat(lng);
                if (!isNaN(latNum) && !isNaN(lngNum)) {
                    updateData.coords = { lat: latNum, lng: lngNum };
                }
            }

                // 地図リンク（入力されている場合のみ）
                if (googleMapLink) {
                    updateData.mapLinks = {
                        google: googleMapLink,
                    };
                }

            const response = await authenticatedFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify(updateData),
            });

            if (response.ok) {
                showToast(
                    locale === "en" ? "Photo updated successfully" : "写真を更新しました",
                    "success"
                );
                router.push("/admin");
            } else {
                const error = await response.json();
                showToast(
                    error.error || (locale === "en" ? "Failed to update photo" : "更新に失敗しました"),
                    "error"
                );
            }
        } catch (error: unknown) {
            log.error("更新エラー:", error);
            showToast(
                locale === "en" ? "Failed to update photo" : "更新に失敗しました",
                "error"
            );
        } finally {
            setSaving(false);
        }
    };

    // ローディング中または認証されていない場合
    if (loading || !isAuthenticated || !isAdminUser) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    if (loadingPhoto) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    if (!photo) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full">
                <div className="text-center py-12">
                    <p className="text-white/60">{locale === "en" ? "Photo not found" : "写真が見つかりません"}</p>
                    <Link href="/admin" className="mt-4 inline-block text-white/80 hover:text-white">
                        {locale === "en" ? "← Back to management" : "← 管理ページに戻る"}
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full">
            <div className="mb-6">
                <Link
                    href="/admin"
                    className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-4"
                >
                    <ArrowLeftIcon className="w-5 h-5" />
                    <span>{locale === "en" ? "Back to management" : "管理ページに戻る"}</span>
                </Link>
                <h1 className="text-2xl sm:text-3xl font-bold">
                    {locale === "en" ? "Edit Photo" : "写真を編集"}
                </h1>
            </div>

            {/* 写真プレビュー */}
            <div className="mb-6">
                <div className="relative w-full h-64 rounded-lg overflow-hidden bg-black">
                    <Image
                        src={photo.src}
                        alt={typeof photo.title === "string" ? photo.title : photo.title?.ja || photo.title?.en || ""}
                        fill
                        className="object-contain"
                        sizes="(max-width: 768px) 100vw, 768px"
                    />
                </div>
            </div>

            {/* 編集フォーム */}
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* タイトル（日本語） */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Title (Japanese)" : "タイトル（日本語）"}
                    </label>
                    <input
                        type="text"
                        value={titleJa}
                        onChange={(e) => setTitleJa(e.target.value)}
                        placeholder={locale === "en" ? "Enter title in Japanese" : "日本語のタイトルを入力"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                        disabled={saving}
                    />
                </div>

                {/* タイトル（英語） */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Title (English)" : "タイトル（英語）"}
                    </label>
                    <input
                        type="text"
                        value={titleEn}
                        onChange={(e) => setTitleEn(e.target.value)}
                        placeholder={locale === "en" ? "Enter title in English" : "英語のタイトルを入力"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                        disabled={saving}
                    />
                </div>

                {/* 説明（日本語） */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Description (Japanese)" : "説明（日本語）"}
                    </label>
                    <textarea
                        value={descriptionJa}
                        onChange={(e) => setDescriptionJa(e.target.value)}
                        placeholder={locale === "en" ? "Enter description in Japanese (one paragraph per line)" : "日本語の説明を入力（1行1段落）"}
                        rows={6}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 resize-none"
                        disabled={saving}
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "One paragraph per line" : "1行1段落で入力してください"}
                    </p>
                </div>

                {/* 説明（英語） */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Description (English)" : "説明（英語）"}
                    </label>
                    <textarea
                        value={descriptionEn}
                        onChange={(e) => setDescriptionEn(e.target.value)}
                        placeholder={locale === "en" ? "Enter description in English (one paragraph per line)" : "英語の説明を入力（1行1段落）"}
                        rows={6}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 resize-none"
                        disabled={saving}
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "One paragraph per line" : "1行1段落で入力してください"}
                    </p>
                </div>

                {/* 場所 */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Location" : "場所"}
                    </label>
                    <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder={locale === "en" ? "Enter location" : "場所を入力"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                        disabled={saving}
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: Minato City, Tokyo" : "例: 東京都港区"}
                    </p>
                </div>

                {/* カテゴリ */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Category" : "カテゴリ"}
                    </label>
                    <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder={locale === "en" ? "Enter category" : "カテゴリを入力"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                        disabled={saving}
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: Landscape" : "例: 風景"}
                    </p>
                </div>

                {/* タグ */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Tags (comma-separated)" : "タグ（カンマ区切り）"}
                    </label>
                    <input
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder={locale === "en" ? "tag1, tag2, tag3" : "タグ1, タグ2, タグ3"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                        disabled={saving}
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: Tokyo, night view, tower, city" : "例: 東京, 夜景, タワー, 都市"}
                    </p>
                </div>

                    {/* 座標（緯度・経度） */}
                    <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                            {locale === "en" ? "Coordinates (Latitude, Longitude)" : "座標（緯度、経度）"}
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <input
                                    type="number"
                                    step="any"
                                    value={lat}
                                    onChange={(e) => setLat(e.target.value)}
                                    placeholder={locale === "en" ? "Latitude" : "緯度"}
                                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                                    disabled={saving}
                                />
                                <p className="mt-1 text-xs text-white/40">
                                    {locale === "en" ? "Latitude" : "緯度"}
                                </p>
                            </div>
                            <div>
                                <input
                                    type="number"
                                    step="any"
                                    value={lng}
                                    onChange={(e) => setLng(e.target.value)}
                                    placeholder={locale === "en" ? "Longitude" : "経度"}
                                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                                    disabled={saving}
                                />
                                <p className="mt-1 text-xs text-white/40">
                                    {locale === "en" ? "Longitude" : "経度"}
                                </p>
                            </div>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-white/40">
                            <p className="font-medium text-white/50">
                                {locale === "en" ? "What are coordinates used for?" : "座標の用途:"}
                            </p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>
                                    {locale === "en" 
                                        ? "Automatically generates a Google Maps link if you haven't set one manually"
                                        : "Google Mapsリンクを手動で設定していない場合、自動的に生成されます"}
                                </li>
                                <li>
                                    {locale === "en" 
                                        ? "Used as a fallback when the Google Maps link field is empty"
                                        : "Google Mapsリンク欄が空の場合のフォールバックとして使用されます"}
                                </li>
                            </ul>
                            <div className="mt-2 pt-2 border-t border-white/10">
                                <p className="font-medium text-white/50 mb-1">
                                    {locale === "en" ? "How to get coordinates:" : "座標の取得方法:"}
                                </p>
                                <ol className="list-decimal list-inside space-y-1 ml-2">
                                    <li>
                                        {locale === "en" 
                                            ? "Search for the location on Google Maps"
                                            : "Google Mapsで場所を検索"}
                                    </li>
                                    <li>
                                        {locale === "en" 
                                            ? "Right-click on the location marker and select \"What's here?\""
                                            : "場所のマーカーを右クリックして「この場所について」を選択"}
                                    </li>
                                    <li>
                                        {locale === "en" 
                                            ? "Copy the latitude and longitude values"
                                            : "緯度と経度の値をコピー"}
                                    </li>
                                </ol>
                            </div>
                            <div className="mt-2 pt-2 border-t border-white/10">
                                <p className="font-medium text-white/50 mb-1">
                                    {locale === "en" ? "Example:" : "例:"}
                                </p>
                                <p className="font-mono text-xs text-white/50 ml-2">
                                    {locale === "en" ? "35.6586, 139.7454 (Tokyo Tower)" : "35.6586, 139.7454（東京タワー）"}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 地図リンク */}
                    <div>
                        <label className="block text-sm font-medium text-white/70 mb-2">
                            {locale === "en" ? "Google Maps Link" : "Google Mapsリンク"}
                        </label>
                        <input
                            type="url"
                            value={googleMapLink}
                            onChange={(e) => setGoogleMapLink(e.target.value)}
                            placeholder={locale === "en" ? "https://maps.app.goo.gl/abc123xyz" : "https://maps.app.goo.gl/abc123xyz"}
                            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                            disabled={saving}
                        />
                        <div className="mt-2 space-y-1 text-xs text-white/40">
                            <p className="font-medium text-white/50">
                                {locale === "en" ? "How to get the link:" : "リンクの取得方法:"}
                            </p>
                            <ol className="list-decimal list-inside space-y-1 ml-2">
                                <li>
                                    {locale === "en" 
                                        ? "Search for the location on Google Maps"
                                        : "Google Mapsで場所を検索"}
                                </li>
                                <li>
                                    {locale === "en" 
                                        ? "Copy the URL from your browser's address bar"
                                        : "ブラウザのアドレスバーからURLをコピー"}
                                </li>
                                <li>
                                    {locale === "en" 
                                        ? "Paste it into the field above"
                                        : "上記の入力欄に貼り付け"}
                                </li>
                            </ol>
                            <div className="mt-2 pt-2 border-t border-white/10">
                                <p className="font-medium text-white/50 mb-1">
                                    {locale === "en" ? "Example URL:" : "URLの例:"}
                                </p>
                                <p className="font-mono text-xs break-all text-white/50 ml-2">
                                    https://maps.app.goo.gl/abc123xyz
                                </p>
                            </div>
                        </div>
                    </div>

                {/* 保存ボタン */}
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => router.push("/admin")}
                        disabled={saving}
                        className="flex-1 px-6 py-3 bg-white/10 text-white rounded-md font-medium hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex-1 px-6 py-3 bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {saving ? (
                            <>
                                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                <span>{locale === "en" ? "Saving..." : "保存中..."}</span>
                            </>
                        ) : (
                            <span>{locale === "en" ? "Save" : "保存"}</span>
                        )}
                    </button>
                </div>
            </form>
        </main>
    );
}
