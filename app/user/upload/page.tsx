"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PhotoIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import LocaleToggle from "../../components/LocaleToggle";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";

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
            // APIキーを取得（環境変数から）
            // 注意: 本番環境では、より安全な認証方法（JWT等）の使用を推奨します
            // 1. Presigned URLを取得
            setProgress(10);
            const { authenticatedFetch, userFetch } = await import("../../../lib/utils/api");
            const apiFetch = isAdminUser ? authenticatedFetch : userFetch;

            let presignedResponse: Response;
            try {
                presignedResponse = await apiFetch("/upload/presigned-url", {
                    method: "POST",
                    body: JSON.stringify({
                        fileName: file.name,
                        fileType: file.type,
                        fileSize: file.size,
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
                    contentType: file.type,
                    fileSize: file.size,
                    fileName: file.name,
                });
                
                const uploadResponse = await fetch(presignedUrl, {
                    method: "PUT",
                    body: file,
                    headers: {
                        "Content-Type": file.type,
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
