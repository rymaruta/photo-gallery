"use client";

import React, { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PhotoIcon, XMarkIcon, UserCircleIcon, MapPinIcon, CalendarIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import LocaleToggle from "../../components/LocaleToggle";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { getCurrentSession } from "../../../lib/auth/cognito";
import { compressImage } from "../../../lib/utils/image";
import { extractExifFromFile, reverseGeocode } from "../../../lib/utils/exif";
import { readSharedPayload, clearSharedPayload } from "../../../lib/utils/shareStore";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

type Status = "pending" | "uploading" | "done" | "error";

type Item = {
    id: string;
    file: File;
    preview: string;
    title: string;
    description: string;
    location: string;
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
    expanded: boolean;
    status: Status;
    progress: number;
    error?: string;
};

function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function UploadPageInner() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale, setLocale, labels } = useLocale();
    const { showToast } = useToast();

    const fromShare = searchParams?.get("from") === "share";

    const [items, setItems] = useState<Item[]>([]);
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [uploading, setUploading] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
            // 解放: object URL のクリーンアップ
            items.forEach((it) => { try { URL.revokeObjectURL(it.preview); } catch { /* ignore */ } });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 認証チェック
    useEffect(() => {
        if (!loading && (!isAuthenticated || (!isAdminUser && !isGeneralUser))) {
            router.push("/login");
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    // PWA Share Target で渡された写真の取り込み
    useEffect(() => {
        if (!fromShare) return;
        void (async () => {
            const payload = await readSharedPayload();
            if (payload && payload.files.length > 0) {
                await addFiles(payload.files);
                await clearSharedPayload();
                showToast(locale === "en" ? `${payload.files.length} photo(s) imported` : `${payload.files.length} 枚を取り込みました`, "success");
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromShare]);

    // プロフィール写真
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarCacheBust, setAvatarCacheBust] = useState(Date.now());

    useEffect(() => {
        getCurrentSession().then((session) => {
            const sub = session?.getIdToken()?.payload?.sub as string | undefined;
            if (sub) setCurrentUserId(sub);
        }).catch(() => { /* ignore */ });
    }, []);

    const addFiles = useCallback(async (files: File[]) => {
        setFileError(null);

        const accepted: File[] = [];
        for (const f of files) {
            if (!f.type.startsWith("image/")) continue;
            if (f.size > 50 * 1024 * 1024) {
                setFileError(locale === "en" ? `Skipped ${f.name} (over 50MB)` : `${f.name} は50MBを超えるためスキップしました`);
                continue;
            }
            accepted.push(f);
        }
        if (accepted.length === 0) return;

        const newItems: Item[] = accepted.map((file) => ({
            id: makeId(),
            file,
            preview: URL.createObjectURL(file),
            title: "",
            description: "",
            location: "",
            expanded: false,
            status: "pending",
            progress: 0,
        }));
        setItems((prev) => [...prev, ...newItems]);

        // EXIF を順次抽出（並列）。GPS リバースジオコードはレート制限のため直列。
        const exifResults = await Promise.all(
            newItems.map(async (it) => ({ id: it.id, meta: await extractExifFromFile(it.file) }))
        );
        setItems((prev) => prev.map((it) => {
            const found = exifResults.find((r) => r.id === it.id);
            if (!found) return it;
            return {
                ...it,
                dateTimeOriginal: found.meta.dateTimeOriginal,
                latitude: found.meta.latitude,
                longitude: found.meta.longitude,
            };
        }));

        // GPS → 場所名（Nominatim 1秒/req のため直列）
        for (const r of exifResults) {
            if (r.meta.latitude !== undefined && r.meta.longitude !== undefined) {
                const place = await reverseGeocode(r.meta.latitude, r.meta.longitude, locale);
                if (place) {
                    setItems((prev) => prev.map((it) => (it.id === r.id && !it.location ? { ...it, location: place } : it)));
                }
                await new Promise((res) => setTimeout(res, 1100));
            }
        }
    }, [locale]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;
        void addFiles(files);
        e.target.value = "";
    }, [addFiles]);

    const updateItem = useCallback((id: string, patch: Partial<Item>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    }, []);

    const removeItem = useCallback((id: string) => {
        setItems((prev) => {
            const it = prev.find((x) => x.id === id);
            if (it) { try { URL.revokeObjectURL(it.preview); } catch { /* ignore */ } }
            return prev.filter((x) => x.id !== id);
        });
    }, []);

    const handleUploadAll = useCallback(async () => {
        const pending = items.filter((it) => it.status === "pending" || it.status === "error");
        if (pending.length === 0) {
            showToast(locale === "en" ? "Nothing to upload" : "アップロードする写真がありません", "error");
            return;
        }

        setUploading(true);
        const { authenticatedFetch, userFetch } = await import("../../../lib/utils/api");
        const apiFetch = isAdminUser ? authenticatedFetch : userFetch;

        const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

        let successCount = 0;
        for (const item of pending) {
            updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
            try {
                let uploadFile = item.file;
                try { uploadFile = await compressImage(item.file); }
                catch (e) { log.error("compress fail, using original:", e); }
                updateItem(item.id, { progress: 20 });

                const presignedResponse = await apiFetch("/upload/presigned-url", {
                    method: "POST",
                    body: JSON.stringify({
                        fileName: uploadFile.name,
                        fileType: uploadFile.type,
                        fileSize: uploadFile.size,
                    }),
                });
                if (!presignedResponse.ok) {
                    const t = await presignedResponse.text();
                    throw new Error(`Presigned URL ${presignedResponse.status}: ${t.slice(0, 80)}`);
                }
                const { presignedUrl, key, publicUrl, photoId } = await presignedResponse.json();
                updateItem(item.id, { progress: 40 });

                const uploadResponse = await fetch(presignedUrl, {
                    method: "PUT",
                    body: uploadFile,
                    headers: { "Content-Type": uploadFile.type, "Cache-Control": "max-age=31536000" },
                });
                if (!uploadResponse.ok) throw new Error(`S3 ${uploadResponse.status}`);
                updateItem(item.id, { progress: 80 });

                const saveResponse = await apiFetch("/upload/save", {
                    method: "POST",
                    body: JSON.stringify({
                        key, publicUrl, photoId,
                        title: item.title || undefined,
                        description: item.description || undefined,
                        location: item.location || undefined,
                        category: category || undefined,
                        tags: tagList,
                    }),
                });
                if (!saveResponse.ok) {
                    const t = await saveResponse.text();
                    throw new Error(`Save ${saveResponse.status}: ${t.slice(0, 80)}`);
                }
                updateItem(item.id, { status: "done", progress: 100 });
                successCount++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log.error(`Upload failed for ${item.file.name}:`, err);
                updateItem(item.id, { status: "error", error: msg });
            }
        }

        setUploading(false);
        if (successCount > 0) {
            showToast(
                locale === "en"
                    ? `${successCount} photo(s) uploaded`
                    : `${successCount} 枚アップロードしました`,
                "success",
            );
            // 全件成功時はトップへ
            const remaining = items.filter((it) => it.status === "pending" || it.status === "error").length;
            if (remaining === 0 || successCount === pending.length) {
                redirectTimerRef.current = setTimeout(() => router.push("/"), 1500);
            }
        }
        if (successCount < pending.length) {
            showToast(
                locale === "en"
                    ? `${pending.length - successCount} upload(s) failed`
                    : `${pending.length - successCount} 件失敗しました`,
                "error",
            );
        }
    }, [items, category, tags, isAdminUser, locale, router, showToast, updateItem]);

    if (loading || !isAuthenticated || (!isAdminUser && !isGeneralUser)) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const inputCls = "w-full px-3 py-2 bg-white/5 border border-white/10 rounded-md text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30";
    const doneCount = items.filter((i) => i.status === "done").length;
    const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full pb-32">
            <div className="flex items-start justify-between gap-3 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">
                    {locale === "en" ? "Upload Photos" : "写真をアップロード"}
                </h1>
                <LocaleToggle
                    locale={locale}
                    setLocale={setLocale}
                    labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                />
            </div>

            {/* ファイル選択 */}
            <label
                htmlFor="files-input"
                className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-white/40 transition-colors mb-4"
                style={{ touchAction: "manipulation", minHeight: "120px" }}
            >
                <PhotoIcon className="w-10 h-10 text-white/40 mb-2" />
                <p className="text-sm text-white/70 font-semibold">
                    {locale === "en" ? "Tap to choose photos" : "タップして写真を選ぶ"}
                </p>
                <p className="text-xs text-white/40 mt-1">
                    {locale === "en" ? "Multiple selection supported (max 50MB each)" : "複数選択OK・各50MBまで"}
                </p>
                <input
                    id="files-input"
                    type="file"
                    multiple
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileSelect}
                    disabled={uploading}
                />
            </label>

            {fileError && <p className="text-sm text-red-400 mb-3">{fileError}</p>}

            {/* 共通設定 */}
            {items.length > 0 && (
                <div className="border border-white/10 rounded-lg p-3 mb-4 space-y-2">
                    <p className="text-xs text-white/50 uppercase tracking-wide">
                        {locale === "en" ? "Common settings (applied to all)" : "共通設定（全写真に適用）"}
                    </p>
                    <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder={locale === "en" ? "Category (e.g. Landscape)" : "カテゴリ（例: 風景）"}
                        className={inputCls}
                        style={{ fontSize: "16px" }}
                        disabled={uploading}
                    />
                    <input
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder={locale === "en" ? "Tags (comma-separated)" : "タグ（カンマ区切り）"}
                        className={inputCls}
                        style={{ fontSize: "16px" }}
                        disabled={uploading}
                    />
                </div>
            )}

            {/* 写真リスト */}
            <div className="space-y-3 mb-6">
                {items.map((it) => (
                    <div key={it.id} className="border border-white/10 rounded-lg overflow-hidden bg-white/5">
                        <div className="flex gap-3 p-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={it.preview} alt="" className="w-20 h-20 object-cover rounded-md flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <input
                                    type="text"
                                    value={it.title}
                                    onChange={(e) => updateItem(it.id, { title: e.target.value })}
                                    placeholder={locale === "en" ? "Title (optional)" : "タイトル（任意）"}
                                    className={inputCls}
                                    style={{ fontSize: "16px" }}
                                    disabled={uploading || it.status === "done"}
                                />
                                {/* EXIF メタ表示 */}
                                <div className="flex flex-wrap gap-2 text-xs text-white/40">
                                    {it.dateTimeOriginal && (
                                        <span className="inline-flex items-center gap-0.5">
                                            <CalendarIcon className="w-3 h-3" />
                                            {new Date(it.dateTimeOriginal).toLocaleDateString(locale === "en" ? "en-US" : "ja-JP")}
                                        </span>
                                    )}
                                    {it.location && (
                                        <span className="inline-flex items-center gap-0.5 truncate max-w-[200px]">
                                            <MapPinIcon className="w-3 h-3" />
                                            {it.location}
                                        </span>
                                    )}
                                </div>
                                {/* 詳細フォーム（折り畳み） */}
                                {it.expanded ? (
                                    <div className="space-y-1.5 pt-1">
                                        <textarea
                                            value={it.description}
                                            onChange={(e) => updateItem(it.id, { description: e.target.value })}
                                            placeholder={locale === "en" ? "Description (optional)" : "説明（任意）"}
                                            rows={2}
                                            className={`${inputCls} resize-none`}
                                            style={{ fontSize: "16px" }}
                                            disabled={uploading || it.status === "done"}
                                        />
                                        <input
                                            type="text"
                                            value={it.location}
                                            onChange={(e) => updateItem(it.id, { location: e.target.value })}
                                            placeholder={locale === "en" ? "Location (optional)" : "場所（任意）"}
                                            className={inputCls}
                                            style={{ fontSize: "16px" }}
                                            disabled={uploading || it.status === "done"}
                                        />
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => updateItem(it.id, { expanded: !it.expanded })}
                                    className="text-xs text-white/40 hover:text-white/70 inline-flex items-center gap-0.5"
                                    disabled={uploading}
                                >
                                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${it.expanded ? "rotate-180" : ""}`} />
                                    {locale === "en" ? "Details" : "詳細"}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeItem(it.id)}
                                disabled={uploading || it.status === "uploading"}
                                className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-30 self-start"
                                aria-label={locale === "en" ? "Remove" : "削除"}
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        {/* ステータス */}
                        {it.status !== "pending" && (
                            <div className="px-3 pb-3">
                                {it.status === "uploading" && (
                                    <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-white h-full transition-all" style={{ width: `${it.progress}%` }} />
                                    </div>
                                )}
                                {it.status === "done" && (
                                    <p className="text-xs text-green-400">✓ {locale === "en" ? "Uploaded" : "アップロード完了"}</p>
                                )}
                                {it.status === "error" && (
                                    <p className="text-xs text-red-400">⚠ {it.error ?? (locale === "en" ? "Failed" : "失敗")}</p>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* アップロードバー（固定） */}
            {items.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40">
                    <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
                        <p className="text-sm text-white/70">
                            {doneCount > 0 ? `${doneCount}/${items.length} ` : ""}
                            {locale === "en" ? `${pendingCount} ready` : `${pendingCount} 枚アップロード待ち`}
                        </p>
                        <button
                            onClick={handleUploadAll}
                            disabled={uploading || pendingCount === 0}
                            className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-md hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {uploading
                                ? (locale === "en" ? "Uploading..." : "アップロード中...")
                                : (locale === "en" ? `Upload ${pendingCount}` : `${pendingCount}枚アップロード`)}
                        </button>
                    </div>
                </div>
            )}

            {/* プロフィール写真 */}
            <div className="border border-white/10 rounded-lg p-4 space-y-4 mt-8">
                <h2 className="text-sm font-medium text-white/70">
                    {locale === "en" ? "Profile Photo" : "プロフィール写真"}
                </h2>
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
                        {avatarPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                        ) : currentUserId && CLOUDFRONT_URL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(currentUserId)}?v=${avatarCacheBust}`}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                        ) : (
                            <UserCircleIcon className="w-10 h-10 text-white/40" />
                        )}
                    </div>
                    <div className="space-y-2">
                        <label className="inline-block cursor-pointer">
                            <span className="px-3 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors inline-flex items-center"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}>
                                {locale === "en" ? "Choose photo" : "写真を選択"}
                            </span>
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={avatarUploading}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (!f || !f.type.startsWith("image/")) return;
                                    setAvatarFile(f);
                                    const reader = new FileReader();
                                    reader.onloadend = () => setAvatarPreview(reader.result as string);
                                    reader.readAsDataURL(f);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                        {avatarFile && (
                            <button
                                onClick={async () => {
                                    if (!avatarFile) return;
                                    setAvatarUploading(true);
                                    try {
                                        let compressed = avatarFile;
                                        try { compressed = await compressImage(avatarFile, 512, 0.9); } catch { /* use original */ }
                                        const { userFetch, authenticatedFetch } = await import("../../../lib/utils/api");
                                        const apiFetch = isAdminUser ? authenticatedFetch : userFetch;
                                        const res = await apiFetch("/profile/avatar/presigned-url", {
                                            method: "POST",
                                            body: JSON.stringify({ fileType: compressed.type }),
                                        });
                                        if (!res.ok) throw new Error("Presigned URL fail");
                                        const { presignedUrl } = await res.json() as { presignedUrl: string };
                                        const upload = await fetch(presignedUrl, {
                                            method: "PUT",
                                            body: compressed,
                                            headers: { "Content-Type": compressed.type },
                                        });
                                        if (!upload.ok) throw new Error("S3 upload fail");
                                        setAvatarFile(null);
                                        setAvatarCacheBust(Date.now());
                                        showToast(locale === "en" ? "Profile photo updated!" : "プロフィール写真を更新しました");
                                    } catch (e) {
                                        log.error("avatar upload error:", e);
                                        showToast(locale === "en" ? "Upload failed" : "アップロードに失敗しました", "error");
                                    } finally {
                                        setAvatarUploading(false);
                                    }
                                }}
                                disabled={avatarUploading}
                                className="px-3 py-2 text-sm bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {avatarUploading
                                    ? (locale === "en" ? "Uploading..." : "アップロード中...")
                                    : (locale === "en" ? "Save" : "保存")}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}

export default function UploadPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        }>
            <UploadPageInner />
        </Suspense>
    );
}
