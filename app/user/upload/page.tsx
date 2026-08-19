"use client";

import React, { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PhotoIcon, XMarkIcon, UserCircleIcon, MapPinIcon, CalendarIcon, ChevronDownIcon, CheckCircleIcon, ExclamationTriangleIcon, CameraIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import AddToHomeScreenHint from "../../components/AddToHomeScreenHint";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { getCurrentSession } from "../../../lib/auth/cognito";
import { compressImage, createThumbnail, stripJpegExif, extractDominantColor, createBlurPlaceholder } from "../../../lib/utils/image";
import { extractExifFromFile, extractCameraExif, reverseGeocode } from "../../../lib/utils/exif";
import { readSharedPayload, clearSharedPayload } from "../../../lib/utils/shareStore";
import { ROUTES } from "../../../lib/routes";

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

// アップロード写真のプレビュー。写真全体を表示しつつ、ギャラリー一覧で
// 表示される「中央の正方形」を白枠で示し、枠外を暗くして
// "どこまで反映されるか" を明示する。
function CropPreview({ src, hint }: { src: string; hint: string }) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [box, setBox] = useState<{ side: number; left: number; top: number } | null>(null);

    const measure = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        const side = Math.min(w, h);
        setBox({ side, left: (w - side) / 2, top: (h - side) / 2 });
    }, []);

    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    return (
        <div className="relative bg-black flex justify-center">
            <div className="relative inline-block overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    ref={imgRef}
                    src={src}
                    alt=""
                    onLoad={measure}
                    className="block w-auto max-h-56 max-w-full"
                    draggable={false}
                />
                {box && (
                    <div
                        className="absolute border-2 border-white/90 pointer-events-none"
                        style={{
                            width: box.side,
                            height: box.side,
                            left: box.left,
                            top: box.top,
                            // 枠外を暗くする（コンテナで overflow-hidden 済み）
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                        }}
                    >
                        <span className="absolute -top-px left-0 right-0 h-px bg-white/40" />
                    </div>
                )}
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 text-[11px] text-white/90 pointer-events-none whitespace-nowrap">
                {hint}
            </span>
        </div>
    );
}

function UploadPageInner() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const fromShare = searchParams?.get("from") === "share";

    const [items, setItems] = useState<Item[]>([]);
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [uploading, setUploading] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // GPS からの撮影地自動入力（プライバシー配慮でオフにできる。設定は保持）
    const [gpsAutofill, setGpsAutofill] = useState(true);
    useEffect(() => {
        try { setGpsAutofill(localStorage.getItem("jp_gps_autofill") !== "0"); } catch { /* ignore */ }
    }, []);
    const toggleGpsAutofill = useCallback(() => {
        setGpsAutofill((v) => {
            const next = !v;
            try { localStorage.setItem("jp_gps_autofill", next ? "1" : "0"); } catch { /* ignore */ }
            return next;
        });
    }, []);

    // アンマウント時の Object URL 解放用に最新の items を ref で保持
    // （useEffect([]) のクロージャは初期の空配列しか見えないため）
    const itemsRef = useRef<Item[]>([]);
    itemsRef.current = items;

    useEffect(() => {
        return () => {
            if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
            itemsRef.current.forEach((it) => { try { URL.revokeObjectURL(it.preview); } catch { /* ignore */ } });
        };
    }, []);

    // 認証チェック
    useEffect(() => {
        if (!loading && (!isAuthenticated || (!isAdminUser && !isGeneralUser))) {
            router.push("/login");
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    // PWA Share Target で渡された写真の取り込み。
    // ログインリダイレクトで ?from=share が失われても、IndexedDB に残った
    // 新しいペイロード（1時間以内）は次回のページ表示時に取り込む。
    const shareImportedRef = useRef(false);
    useEffect(() => {
        if (loading || !isAuthenticated || shareImportedRef.current) return;
        shareImportedRef.current = true;
        void (async () => {
            const payload = await readSharedPayload();
            if (!payload || payload.files.length === 0) return;
            const isFresh = Date.now() - payload.t < 60 * 60 * 1000;
            if (!fromShare && !isFresh) {
                await clearSharedPayload();
                return;
            }
            await addFiles(payload.files, { title: payload.title, text: payload.text });
            await clearSharedPayload();
            showToast(locale === "en" ? `${payload.files.length} photo(s) imported` : `${payload.files.length} 枚を取り込みました`, "success");
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromShare, loading, isAuthenticated]);

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

    const addFiles = useCallback(async (files: File[], shared?: { title?: string; text?: string }) => {
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

        // 共有シート経由のタイトルは単一ファイルのときのみ適用、テキストは全ファイルの説明に適用
        const sharedTitle = shared?.title?.trim() && accepted.length === 1 ? shared.title.trim() : "";
        const sharedText = shared?.text?.trim() ?? "";

        const newItems: Item[] = accepted.map((file) => ({
            id: makeId(),
            file,
            preview: URL.createObjectURL(file),
            title: sharedTitle,
            description: sharedText,
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

        // GPS → 場所名（Nominatim 1秒/req のため直列）。トグルOFF時はスキップ
        if (gpsAutofill) {
            for (const r of exifResults) {
                if (r.meta.latitude !== undefined && r.meta.longitude !== undefined) {
                    const place = await reverseGeocode(r.meta.latitude, r.meta.longitude, locale);
                    if (place) {
                        setItems((prev) => prev.map((it) => (it.id === r.id && !it.location ? { ...it, location: place } : it)));
                    }
                    await new Promise((res) => setTimeout(res, 1100));
                }
            }
        }
    }, [locale, gpsAutofill]);

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

    const handleUploadAll = useCallback(async (published: boolean) => {
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
                catch (e) {
                    // 圧縮失敗時は元ファイルを使うが、GPS等のメタデータは必ず除去する
                    log.error("compress fail, stripping EXIF from original:", e);
                    uploadFile = await stripJpegExif(item.file);
                }
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
                updateItem(item.id, { progress: 70 });

                // 一覧グリッド用の 512px WebP サムネイルを併せてアップロードする。
                // グリッドがフル画像（〜1920px）を落とすのが読み込みの遅さの主因。
                // サムネ生成/アップロードに失敗しても本体の投稿は成立させる。
                let thumbUrl: string | undefined;
                try {
                    const thumb = await createThumbnail(item.file);
                    if (thumb) {
                        const thumbPresign = await apiFetch("/upload/presigned-url", {
                            method: "POST",
                            body: JSON.stringify({ fileName: thumb.name, fileType: thumb.type, fileSize: thumb.size }),
                        });
                        if (thumbPresign.ok) {
                            const t = await thumbPresign.json() as { presignedUrl: string; publicUrl: string };
                            const thumbPut = await fetch(t.presignedUrl, {
                                method: "PUT",
                                body: thumb,
                                headers: { "Content-Type": thumb.type, "Cache-Control": "max-age=31536000" },
                            });
                            if (thumbPut.ok) thumbUrl = t.publicUrl;
                        }
                    }
                } catch (e) {
                    log.error("thumbnail upload failed (continuing without thumb):", e);
                }
                updateItem(item.id, { progress: 85 });

                // 撮影地座標: GPS自動入力がONのときのみ、約1km精度に丸めて保存
                const coords = gpsAutofill && item.latitude !== undefined && item.longitude !== undefined
                    ? { lat: Math.round(item.latitude * 100) / 100, lng: Math.round(item.longitude * 100) / 100 }
                    : undefined;

                // 代表色: グリッドの読み込みプレースホルダーに使う（失敗しても続行）
                const dominantColor = await extractDominantColor(item.file);

                // ぼかしプレビュー（blur-up 用の極小画像）。失敗しても続行
                const blurDataURL = await createBlurPlaceholder(item.file);

                // 撮影情報（カメラ・レンズ・絞り等）: 圧縮で EXIF が失われる前に
                // 元ファイルから抽出して保存する。GPS は含めない（coords で別管理）
                const cameraExif = await extractCameraExif(item.file);

                const saveResponse = await apiFetch("/upload/save", {
                    method: "POST",
                    body: JSON.stringify({
                        key, publicUrl, photoId,
                        published,
                        title: item.title || undefined,
                        description: item.description || undefined,
                        location: item.location || undefined,
                        category: category || undefined,
                        tags: tagList,
                        ...(coords ? { coords } : {}),
                        ...(dominantColor ? { dominantColor } : {}),
                        ...(blurDataURL ? { blurDataURL } : {}),
                        ...(thumbUrl ? { thumbUrl } : {}),
                        ...(Object.keys(cameraExif).length > 0 ? { exif: cameraExif } : {}),
                    }),
                });
                if (!saveResponse.ok) {
                    const t = await saveResponse.text();
                    throw new Error(`Save ${saveResponse.status}: ${t.slice(0, 80)}`);
                }
                // 行きたいリストの場所に到達していたら祝う
                try {
                    const saved = await saveResponse.json() as { inspired?: number };
                    if (typeof saved.inspired === "number" && saved.inspired > 0) {
                        showToast(
                            locale === "en"
                                ? "You made it to a place on your travel list! 🎉"
                                : "行きたかった場所に到達！撮影者に伝わりました 🎉",
                            "success",
                        );
                    }
                } catch { /* レスポンス解析失敗は無視 */ }
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
                published
                    ? (locale === "en" ? `${successCount} photo(s) uploaded` : `${successCount} 枚アップロードしました`)
                    : (locale === "en"
                        ? `Saved ${successCount} draft(s). Fill in details later and publish.`
                        : `${successCount} 枚を下書き保存しました。あとで編集して公開できます`),
                "success",
            );
            // 全件成功時に遷移（items はループ開始時のクロージャなのでカウントで判定する）。
            // 公開はトップへ、下書きは下書き一覧へ。
            if (successCount === pending.length) {
                const dest = published ? "/" : ROUTES.DRAFTS;
                redirectTimerRef.current = setTimeout(() => router.push(dest), 1500);
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
    }, [items, category, tags, gpsAutofill, isAdminUser, locale, router, showToast, updateItem]);

    if (loading || !isAuthenticated || (!isAdminUser && !isGeneralUser)) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const inputCls = "w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";
    const doneCount = items.filter((i) => i.status === "done").length;
    const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full pb-32">
            <div className="flex items-start justify-between gap-3 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">
                    {locale === "en" ? "Upload Photos" : "写真をアップロード"}
                </h1>
            </div>

            {/* iOS向け「ホーム画面に追加」ヒント（該当時のみ表示） */}
            <AddToHomeScreenHint />

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

            {/* カメラ直撮り（スマホで背面カメラを直接起動）。ギャラリー選択とは別入力にする */}
            <label
                htmlFor="camera-input"
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition-colors mb-4 cursor-pointer text-sm text-white/80"
                style={{ touchAction: "manipulation", minHeight: "44px" }}
            >
                <CameraIcon className="w-5 h-5 text-white/60" />
                {locale === "en" ? "Take a photo" : "写真を撮る"}
                <input
                    id="camera-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading}
                />
            </label>

            {/* GPS 自動入力トグル */}
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none" style={{ touchAction: "manipulation" }}>
                <input
                    type="checkbox"
                    checked={gpsAutofill}
                    onChange={toggleGpsAutofill}
                    disabled={uploading}
                    className="w-4 h-4 accent-white"
                />
                <span className="text-xs text-white/60">
                    <MapPinIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
                    {locale === "en"
                        ? "Auto-fill shooting location from photo GPS (city level)"
                        : "写真のGPSから撮影地を自動入力（市区町村レベル）"}
                </span>
            </label>

            {fileError && <p className="text-sm text-red-400 mb-3">{fileError}</p>}

            {/* 共通設定 */}
            {items.length > 0 && (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-3.5 mb-4 space-y-2">
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
                        {/* トリミングプレビュー（一覧表示範囲を白枠で明示） */}
                        <div className="relative">
                            <CropPreview
                                src={it.preview}
                                hint={locale === "en" ? "White frame = shown in the grid" : "白い枠が一覧に表示されます"}
                            />
                            <button
                                type="button"
                                onClick={() => removeItem(it.id)}
                                disabled={uploading || it.status === "uploading"}
                                className="absolute top-2 right-2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors disabled:opacity-30 z-10"
                                aria-label={locale === "en" ? "Remove" : "削除"}
                                style={{ touchAction: "manipulation" }}
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3">
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
                        </div>
                        {/* ステータス */}
                        {it.status !== "pending" && (
                            <div className="px-3 pb-3">
                                {it.status === "uploading" && (
                                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                        <div className="h-full rounded-full bg-gradient-to-r from-white/70 to-white transition-all" style={{ width: `${it.progress}%` }} />
                                    </div>
                                )}
                                {it.status === "done" && (
                                    <p className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" />{locale === "en" ? "Uploaded" : "アップロード完了"}</p>
                                )}
                                {it.status === "error" && (
                                    <p className="text-xs text-red-400 inline-flex items-center gap-1"><ExclamationTriangleIcon className="w-4 h-4" />{it.error ?? (locale === "en" ? "Failed" : "失敗")}</p>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* アップロードバー（固定） */}
            {items.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40">
                    <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
                        <p className="hidden sm:block text-sm text-white/70 flex-shrink-0">
                            {doneCount > 0 ? `${doneCount}/${items.length} ` : ""}
                            {locale === "en" ? `${pendingCount} ready` : `${pendingCount} 枚待ち`}
                        </p>
                        <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end">
                            {/* 下書き保存: 必須項目なしで非公開保存。あとで編集して公開できる */}
                            <button
                                onClick={() => handleUploadAll(false)}
                                disabled={uploading || pendingCount === 0}
                                className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {locale === "en" ? "Save draft" : "下書き保存"}
                            </button>
                            <button
                                onClick={() => handleUploadAll(true)}
                                disabled={uploading || pendingCount === 0}
                                className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {uploading
                                    ? (locale === "en" ? "Uploading..." : "アップロード中...")
                                    : (locale === "en" ? `Publish ${pendingCount}` : `${pendingCount}枚を公開`)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* プロフィール写真 */}
            <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-4 mt-8">
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
                            <span className="px-3.5 py-2 text-sm bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-lg transition inline-flex items-center"
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
                                        try { compressed = await compressImage(avatarFile, 512, 0.9); }
                                        catch { compressed = await stripJpegExif(avatarFile); }
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
                                className="px-3 py-2 text-sm bg-white text-black rounded-full font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
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
