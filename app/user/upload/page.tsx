"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PhotoIcon, XMarkIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import LocaleToggle from "../../components/LocaleToggle";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { getCurrentSession } from "../../../lib/auth/cognito";
import { compressImage } from "../../../lib/utils/image";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export default function UploadPage() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const { locale, setLocale, labels } = useLocale();
    const { showToast } = useToast();

    // すべてのHooksを早期リターンの前に定義
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (redirectTimerRef.current !== null) {
                clearTimeout(redirectTimerRef.current);
            }
        };
    }, []);

    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [fileError, setFileError] = useState<string | null>(null);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");

    // プロフィール写真用
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarCacheBust, setAvatarCacheBust] = useState(Date.now());

    useEffect(() => {
        getCurrentSession().then(session => {
            const sub = session?.getIdToken()?.payload?.sub as string | undefined;
            if (sub) setCurrentUserId(sub);
        }).catch(() => { /* ignore */ });
    }, []);

    // ファイル選択
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFileError(null);

        // ファイルサイズチェック（50MB制限）
        if (selectedFile.size > 50 * 1024 * 1024) {
            setFileError(locale === "en" ? "File size is too large (max 50MB)" : "ファイルサイズが大きすぎます（最大50MB）");
            return;
        }

        // 画像ファイルかチェック
        if (!selectedFile.type.startsWith("image/")) {
            setFileError(locale === "en" ? "Please select an image file" : "画像ファイルを選択してください");
            return;
        }

        setFile(selectedFile);

        // プレビューを生成
        const reader = new FileReader();
        reader.onloadend = () => {
            setPreview(reader.result as string);
        };
        reader.readAsDataURL(selectedFile);
    }, [locale]);

    // ファイルをクリア
    const handleClearFile = useCallback(() => {
        setFile(null);
        setPreview(null);
        const input = document.getElementById("file-input") as HTMLInputElement;
        if (input) input.value = "";
    }, []);

    // アップロード処理
    const handleUpload = useCallback(async () => {
        if (!file) {
            showToast(
                locale === "en"
                    ? "Please select a file"
                    : "ファイルを選択してください",
                "error"
            );
            return;
        }

        setUploading(true);
        setProgress(0);

        try {
            setProgress(5);
            let uploadFile = file;
            try {
                uploadFile = await compressImage(file);
                log.info("画像圧縮完了:", { original: file.size, compressed: uploadFile.size });
            } catch (compressErr) {
                log.error("画像圧縮失敗（元ファイルを使用）:", compressErr);
            }

            // 1. Presigned URLを取得
            setProgress(10);
            const { authenticatedFetch, userFetch } = await import("../../../lib/utils/api");
            const apiFetch = isAdminUser ? authenticatedFetch : userFetch;

            let presignedResponse: Response;
            try {
                presignedResponse = await apiFetch("/upload/presigned-url", {
                    method: "POST",
                    body: JSON.stringify({
                        fileName: uploadFile.name,
                        fileType: uploadFile.type,
                        fileSize: uploadFile.size,
                    }),
                });
            } catch (fetchError: unknown) {
                // authenticatedFetchがエラーを投げた場合（例: 認証トークンが取得できない）
                const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
                log.error("[1/3] Presigned URL取得エラー（認証エラー）:", {
                    error: errorMessage,
                    isLambda: !!process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_USE_LOCAL_API !== "true",
                    hasApiBaseUrl: !!process.env.NEXT_PUBLIC_API_BASE_URL,
                    useLocalApi: process.env.NEXT_PUBLIC_USE_LOCAL_API === "true",
                });
                
                let msg = errorMessage;
                if (errorMessage.includes("認証が必要")) {
                    const isLambda = !!process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_USE_LOCAL_API !== "true";
                    if (isLambda) {
                        msg += "\n\n解決方法:\n" +
                            "1. ログインページ（/login）でログインしてください\n" +
                            "2. adminグループに属しているユーザーでログインしてください\n" +
                            "3. ログイン後、このページを再読み込みしてください\n" +
                            "4. それでもエラーが出る場合は、Lambda側のCOGNITO_USER_POOL_ID設定を確認してください";
                    } else {
                        msg += "\n\n解決方法:\n" +
                            ".env.localにNEXT_PUBLIC_UPLOAD_API_KEYを設定してください\n" +
                            "または、NEXT_PUBLIC_USE_LOCAL_API=trueを設定してローカルAPIを使用してください";
                    }
                }
                throw new Error(`[1/3] ${msg}`);
            }

            if (!presignedResponse.ok) {
                const rawText = await presignedResponse.text();
                let error: { error?: string; message?: string } = {};
                try {
                    error = rawText ? JSON.parse(rawText) : {};
                } catch {
                    error = { error: rawText.slice(0, 200) || "Unknown error" };
                }
                let msg = error.error || error.message || (Object.keys(error).length === 0
                    ? `Presigned URLの取得に失敗しました (HTTP ${presignedResponse.status})`
                    : "Failed to get upload URL");
                if (presignedResponse.status === 401 && (msg.includes("認証に失敗") || msg.includes("認証が必要"))) {
                    const isLambda = !!process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_USE_LOCAL_API !== "true";
                    if (isLambda) {
                        msg += "\n\n解決方法:\n" +
                            "1. ログインページ（/login）でログインしてください\n" +
                            "2. adminグループに属しているユーザーでログインしてください\n" +
                            "3. ログイン後、このページを再読み込みしてください\n" +
                            "4. それでもエラーが出る場合は、Lambda側のCOGNITO_USER_POOL_ID設定を確認してください";
                    } else {
                        msg += "\n\n解決方法:\n" +
                            ".env.localにNEXT_PUBLIC_UPLOAD_API_KEYを設定してください\n" +
                            "または、NEXT_PUBLIC_USE_LOCAL_API=trueを設定してローカルAPIを使用してください";
                    }
                }
                const isLambda = !!process.env.NEXT_PUBLIC_API_BASE_URL && process.env.NEXT_PUBLIC_USE_LOCAL_API !== "true";
                log.error("[1/3] Presigned URL取得エラー:", {
                    status: presignedResponse.status,
                    statusText: presignedResponse.statusText,
                    body: error,
                    rawPreview: rawText.slice(0, 300),
                    isLambda,
                    hasApiBaseUrl: !!process.env.NEXT_PUBLIC_API_BASE_URL,
                    useLocalApi: process.env.NEXT_PUBLIC_USE_LOCAL_API === "true",
                    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
                    cognitoUserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
                });
                
                // Lambda APIを使用している場合、追加の診断情報を表示
                if (isLambda && presignedResponse.status === 401) {
                    log.error("\n🔍 Lambda API認証エラーの診断:");
                    log.error("  1. 開発用Secrets Managerを確認:");
                    log.error("     npm run check:dev-secrets");
                    log.error("  2. Lambda側のログを確認:");
                    log.error("     aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow");
                    log.error("  3. ログイン状態を確認:");
                    log.error("     - /login ページでログインしているか");
                    log.error("     - adminグループに属しているか");
                    log.error("  4. Cognito User Pool IDの一致を確認:");
                    log.error(`     - .env.local: ${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`);
                    log.error(`     - Secrets Manager (dev-journey-photo-upload): 上記コマンドで確認`);
                }
                throw new Error(`[1/3] ${msg}`);
            }

            const { presignedUrl, key, publicUrl, photoId } = await presignedResponse.json();

            if (!presignedUrl) {
                log.error("[1/3] Presigned URLが空です");
                throw new Error("[1/3] Presigned URLが取得できませんでした");
            }

            log.info("Presigned URL取得成功:", { 
                key, 
                publicUrl,
                presignedUrlLength: presignedUrl.length,
                presignedUrlPreview: presignedUrl.substring(0, 100) + "..."
            });

            // 2. S3に直接アップロード
            setProgress(30);
            try {
                log.info("S3アップロード開始:", {
                    method: "PUT",
                    contentType: uploadFile.type,
                    fileSize: uploadFile.size,
                    fileName: uploadFile.name,
                });

                const uploadResponse = await fetch(presignedUrl, {
                    method: "PUT",
                    body: uploadFile,
                    headers: {
                        "Content-Type": uploadFile.type,
                        "Cache-Control": "max-age=31536000",
                    },
                });

                if (!uploadResponse.ok) {
                    const errorText = await uploadResponse.text().catch(() => "Unknown error");
                    log.error("[2/3] S3アップロードエラー:", {
                        status: uploadResponse.status,
                        statusText: uploadResponse.statusText,
                        error: errorText,
                    });
                    throw new Error(`[2/3] S3アップロードに失敗: ${uploadResponse.status} ${uploadResponse.statusText}${errorText.slice(0, 80) ? ` — ${errorText.slice(0, 80)}` : ""}`);
                }
                
                log.info("S3アップロード成功:", { key, status: uploadResponse.status });
            } catch (fetchError: unknown) {
                const errorName = fetchError instanceof Error ? fetchError.name : "Unknown";
                const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
                const errorStack = fetchError instanceof Error ? fetchError.stack : undefined;
                log.error("Fetch error詳細:", {
                    name: errorName,
                    message: errorMessage,
                    stack: errorStack,
                    presignedUrl: presignedUrl ? presignedUrl.substring(0, 200) + "..." : "null",
                });
                
                if (fetchError instanceof Error && fetchError.name === "TypeError" && errorMessage.includes("Failed to fetch")) {
                    const origin = typeof window !== "undefined" ? window.location.origin : "unknown";
                    // バケット名は環境に応じて変わるため、汎用的なエラーメッセージに変更
                    const errorMsg = `[2/3] S3への接続に失敗しました。アップロード用S3バケットの CORS を確認してください（AllowedOrigins に ${origin}、Method に PUT、AllowedHeaders に Content-Type）。`;
                    log.error(errorMsg);
                    throw new Error(errorMsg);
                }
                throw new Error(`[2/3] ${errorMessage}`);
            }

            setProgress(70);

            // 3. 写真データを保存
            const saveResponse = await apiFetch("/upload/save", {
                method: "POST",
                body: JSON.stringify({
                    key,
                    publicUrl,
                    photoId, // presigned-urlから取得したphotoIdを渡す
                    title: title || undefined,
                    description: description || undefined,
                    location: location || undefined,
                    category: category || undefined,
                    tags: tags
                        ? tags.split(",").map((t) => t.trim()).filter(Boolean)
                        : undefined,
                }),
            });

            if (!saveResponse.ok) {
                const raw = await saveResponse.text();
                let err: { error?: string } = {};
                try { err = raw ? JSON.parse(raw) : {}; } catch { err = { error: raw.slice(0, 150) }; }
                log.error("[3/3] 写真データの保存エラー:", { status: saveResponse.status, body: err, rawPreview: raw.slice(0, 200) });
                throw new Error(`[3/3] ${err.error || "写真データの保存に失敗しました"}`);
            }

            setProgress(100);

            showToast(
                locale === "en"
                    ? "Upload successful!"
                    : "アップロードが完了しました！"
            );

            // 少し待ってからリダイレクト
            redirectTimerRef.current = setTimeout(() => {
                router.push("/");
            }, 1000);
        } catch (error: unknown) {
            log.error("Upload error:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            showToast(
                locale === "en"
                    ? `Upload failed: ${errorMessage}`
                    : `アップロードに失敗しました: ${errorMessage}`,
                "error"
            );
        } finally {
            setUploading(false);
            setProgress(0);
        }
    }, [file, title, description, location, category, tags, locale, showToast, router, isAdminUser]);

    // 認証チェック - 未認証ユーザーはリダイレクト（admin / user グループ両方可）
    useEffect(() => {
        if (!loading) {
            if (!isAuthenticated || (!isAdminUser && !isGeneralUser)) {
                router.push("/login");
            }
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    // ローディング中または認証されていない場合は何も表示しない
    if (loading || !isAuthenticated || (!isAdminUser && !isGeneralUser)) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full pb-20">
            {/* ヘッダー */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
                <div className="flex-1">
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                        {locale === "en" ? "Upload Photo" : "写真をアップロード"}
                    </h1>
                </div>
                <div className="flex-shrink-0">
                    <LocaleToggle
                        locale={locale}
                        setLocale={setLocale}
                        labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                    />
                </div>
            </div>

            {/* アップロードフォーム */}
            <div className="space-y-6">
                {/* ファイル選択 */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Select Photo" : "写真を選択"}
                    </label>
                    {!preview ? (
                        <label
                            htmlFor="file-input"
                            className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-white/40 transition-colors"
                            style={{
                                touchAction: "manipulation",
                                minHeight: "200px",
                            }}
                        >
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <PhotoIcon className="w-12 h-12 text-white/40 mb-4" />
                                <p className="mb-2 text-sm text-white/60">
                                    <span className="font-semibold">
                                        {locale === "en" ? "Click to upload" : "クリックしてアップロード"}
                                    </span>
                                </p>
                                <p className="text-xs text-white/40">
                                    {locale === "en"
                                        ? "PNG, JPG, GIF up to 50MB"
                                        : "PNG、JPG、GIF（最大50MB）"}
                                </p>
                            </div>
                            <input
                                id="file-input"
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleFileSelect}
                                disabled={uploading}
                            />
                        </label>
                    ) : (
                        <div className="relative">
                            <div className="relative w-full h-64 rounded-lg overflow-hidden bg-black">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={preview}
                                    alt="Preview"
                                    className="w-full h-full object-contain"
                                />
                            </div>
                            <button
                                onClick={handleClearFile}
                                disabled={uploading}
                                className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-full transition-colors"
                                style={{
                                    touchAction: "manipulation",
                                    minWidth: "44px",
                                    minHeight: "44px",
                                }}
                            >
                                <XMarkIcon className="w-5 h-5 text-white" />
                            </button>
                        </div>
                    )}
                </div>

                {fileError && (
                    <p className="text-sm text-red-400 mt-1" role="alert">{fileError}</p>
                )}

                {/* タイトル */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Title" : "タイトル"}
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={locale === "en" ? "Enter title" : "タイトルを入力"}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 text-base"
                        disabled={uploading}
                        style={{ fontSize: "16px" }} // iOSで自動ズームを防ぐ
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: Tokyo Tower at night" : "例: 東京タワーの夜景"}
                    </p>
                </div>

                {/* 説明 */}
                <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                        {locale === "en" ? "Description" : "説明"}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={locale === "en" ? "Enter description" : "説明を入力"}
                        rows={4}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 resize-none text-base"
                        disabled={uploading}
                        style={{ fontSize: "16px" }} // iOSで自動ズームを防ぐ
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: A beautiful night view of Tokyo Tower captured at sunset" : "例: 夕暮れ時に撮影した東京タワーの美しい夜景です"}
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
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 text-base"
                        disabled={uploading}
                        style={{ fontSize: "16px" }} // iOSで自動ズームを防ぐ
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
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 text-base"
                        disabled={uploading}
                        style={{ fontSize: "16px" }} // iOSで自動ズームを防ぐ
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
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30 text-base"
                        disabled={uploading}
                        style={{ fontSize: "16px" }} // iOSで自動ズームを防ぐ
                    />
                    <p className="mt-1 text-xs text-white/40">
                        {locale === "en" ? "Example: Tokyo, night view, tower, city" : "例: 東京, 夜景, タワー, 都市"}
                    </p>
                </div>

                {/* ──────────────────────────────
                    プロフィール写真
                ────────────────────────────── */}
                <div className="border border-white/10 rounded-lg p-4 space-y-4">
                    <h2 className="text-sm font-medium text-white/70">
                        {locale === "en" ? "Profile Photo" : "プロフィール写真"}
                    </h2>
                    <div className="flex items-center gap-4">
                        {/* 現在のアバター */}
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
                                <span className="px-3 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                                    style={{ touchAction: "manipulation", minHeight: "44px", display: "inline-flex", alignItems: "center" }}>
                                    {locale === "en" ? "Choose photo" : "写真を選択"}
                                </span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={avatarUploading}
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (!f) return;
                                        if (!f.type.startsWith("image/")) return;
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
                                            let compressedAvatar = avatarFile;
                                            try { compressedAvatar = await compressImage(avatarFile, 512, 0.9); } catch { /* use original */ }
                                            const { userFetch, authenticatedFetch } = await import("../../../lib/utils/api");
                                            const apiFetch = isAdminUser ? authenticatedFetch : userFetch;
                                            const res = await apiFetch("/profile/avatar/presigned-url", {
                                                method: "POST",
                                                body: JSON.stringify({ fileType: compressedAvatar.type }),
                                            });
                                            if (!res.ok) throw new Error("Presigned URL取得失敗");
                                            const { presignedUrl } = await res.json() as { presignedUrl: string };
                                            const upload = await fetch(presignedUrl, {
                                                method: "PUT",
                                                body: compressedAvatar,
                                                headers: { "Content-Type": compressedAvatar.type },
                                            });
                                            if (!upload.ok) throw new Error("S3アップロード失敗");
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

                {/* アップロードボタン */}
                <div className="flex flex-col gap-3">
                    {uploading && (
                        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-white h-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}
                    <button
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        className="w-full px-6 py-3 bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            touchAction: "manipulation",
                            minHeight: "44px",
                        }}
                    >
                        {uploading
                            ? locale === "en"
                                ? "Uploading..."
                                : "アップロード中..."
                            : locale === "en"
                                ? "Upload"
                                : "アップロード"}
                    </button>
                </div>
            </div>
        </main>
    );
}
