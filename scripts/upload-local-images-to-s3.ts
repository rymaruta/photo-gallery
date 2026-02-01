/**
 * ローカルの画像ファイルをS3に一括アップロードするスクリプト
 * 管理画面のアップロードAPIと同じフローを使用
 * 
 * 使用方法:
 *   1. Next.jsサーバーを起動: npm run dev
 *   2. 別のターミナルで実行: npm run upload-local-images
 * 
 * または:
 *   npx tsx scripts/upload-local-images-to-s3.ts
 */

import { readFile, readdir, stat } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { BASE_PHOTOS } from "../app/data/photos";
import type { Photo } from "../app/data/photos";
import { getConfig } from "../lib/aws/secrets";

// .env.localから環境変数を読み込む
function loadEnvFile() {
    const envPath = path.join(process.cwd(), ".env.local");
    if (existsSync(envPath)) {
        const envContent = readFileSync(envPath, "utf-8");
        const lines = envContent.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
                const [key, ...valueParts] = trimmed.split("=");
                if (key && valueParts.length > 0) {
                    const value = valueParts.join("=").trim();
                    // クォートを削除
                    const unquoted = value.replace(/^["']|["']$/g, "");
                    process.env[key.trim()] = unquoted;
                }
            }
        }
    }
}

// 環境変数を読み込む
loadEnvFile();

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

interface UploadResult {
    localPath: string;
    fileName: string;
    s3Key: string;
    s3Url: string;
    photoId: string;
    success: boolean;
    error?: string;
}

/**
 * Presigned URLを取得
 */
async function getPresignedUrl(fileName: string, fileType: string, fileSize: number, apiKey: string): Promise<{ presignedUrl: string; key: string; publicUrl: string; photoId: string }> {
    const response = await fetch(`${API_BASE_URL}/api/upload/presigned-url`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
        },
        body: JSON.stringify({
            fileName,
            fileType,
            fileSize,
        }),
    });

    if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const errorText = await response.text().catch(() => "Unknown error");

        // APIが想定外のHTML（Nextのページやエラー画面）を返すケースに備えて情報を増やす
        if (contentType.includes("text/html")) {
            throw new Error(
                `presigned-url failed: HTTP ${response.status} ${response.statusText} (text/html)\n` +
                    `${errorText.slice(0, 300)}...`
            );
        }

        let errorMessage = `presigned-url failed: HTTP ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
        } catch {
            if (errorText) errorMessage = `${errorMessage}\n${errorText.slice(0, 300)}...`;
        }
        throw new Error(errorMessage);
    }

    return await response.json();
}

/**
 * ファイルをS3にアップロード（Presigned URLを使用）
 */
async function uploadToS3(presignedUrl: string, fileBuffer: Buffer, contentType: string): Promise<void> {
    const response = await fetch(presignedUrl, {
        method: "PUT",
        body: fileBuffer as unknown as BodyInit, // BufferはNode.jsのfetchでサポートされている
        headers: {
            "Content-Type": contentType,
        },
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`s3 upload failed: HTTP ${response.status} ${response.statusText} - ${errorText.slice(0, 300)}...`);
    }
}

/**
 * 写真データを保存
 */
async function savePhotoData(
    key: string,
    publicUrl: string,
    photoId: string,
    basePhoto: Photo | undefined,
    apiKey: string
): Promise<Photo> {
    const title = basePhoto?.title || { ja: "無題", en: "Untitled" };
    const description = basePhoto?.description;
    const location = basePhoto?.location;
    const category = basePhoto?.category;
    const tags = basePhoto?.tags || [];

    const response = await fetch(`${API_BASE_URL}/api/upload/save`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
        },
        body: JSON.stringify({
            key,
            publicUrl,
            photoId, // presigned-urlから取得したphotoIdを渡す
            title,
            description,
            location,
            category,
            tags,
        }),
    });

    if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const errorText = await response.text().catch(() => "Unknown error");

        if (contentType.includes("text/html")) {
            throw new Error(
                `save failed: HTTP ${response.status} ${response.statusText} (text/html)\n` +
                    `${errorText.slice(0, 300)}...`
            );
        }

        let errorMessage = `save failed: HTTP ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
        } catch {
            if (errorText) errorMessage = `${errorMessage}\n${errorText.slice(0, 300)}...`;
        }
        throw new Error(errorMessage);
    }

    const result = await response.json();
    return result.photo;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: unknown) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`   ⚠️  ${label} retry ${attempt}/${maxAttempts}: ${msg.split("\n")[0]}`);
            if (attempt < maxAttempts) await sleep(300 * attempt);
        }
    }
    throw lastErr;
}

/**
 * ファイル名からMIMEタイプを取得
 */
function getMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
    };
    return mimeTypes[ext || ""] || "image/jpeg";
}

/**
 * ローカルの画像ファイルを取得
 */
async function getLocalImages(): Promise<string[]> {
    const imagesDir = path.join(process.cwd(), "public", "images");
    
    if (!existsSync(imagesDir)) {
        console.error(`❌ エラー: ${imagesDir} が見つかりません`);
        process.exit(1);
    }

    const files = await readdir(imagesDir);
    const imageFiles = files.filter((file) => {
        const ext = file.split(".").pop()?.toLowerCase();
        return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext || "");
    });

    return imageFiles.map((file) => path.join(imagesDir, file));
}

/**
 * BASE_PHOTOSから画像ファイル名を抽出してマッピング
 */
function createPhotoMapping(): Map<string, Photo> {
    const mapping = new Map<string, Photo>();
    
    for (const photo of BASE_PHOTOS) {
        if (photo.src.startsWith("/images/")) {
            const fileName = photo.src.replace("/images/", "");
            mapping.set(fileName.toLowerCase(), photo);
        }
    }
    
    return mapping;
}

/**
 * メイン処理
 */
async function main() {
    console.log("🚀 ローカル画像のS3一括アップロードを開始します...\n");
    console.log(`📡 API Base URL: ${API_BASE_URL}\n`);

    // Secrets Managerまたは環境変数からAPIキーを取得
    let apiKey = "";
    try {
        console.log("📋 AWS設定を取得中...");
        const config = await getConfig();
        apiKey = config.uploadApiKey;
        
        if (!apiKey) {
            // フォールバック: 環境変数から取得
            apiKey = process.env.NEXT_PUBLIC_UPLOAD_API_KEY || process.env.UPLOAD_API_KEY || "";
        }
        
        if (!apiKey) {
            console.error("❌ エラー: UPLOAD_API_KEY が見つかりません");
            console.error("💡 ヒント: Secrets Managerまたは環境変数にUPLOAD_API_KEYを設定してください");
            process.exit(1);
        }
        
        console.log(`✅ APIキーを取得しました（Secrets Managerまたは環境変数から）\n`);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("❌ エラー: 設定の取得に失敗しました:", errorMessage);
        // フォールバック: 環境変数から取得
        apiKey = process.env.NEXT_PUBLIC_UPLOAD_API_KEY || process.env.UPLOAD_API_KEY || "";
        if (!apiKey) {
            console.error("❌ エラー: UPLOAD_API_KEY または NEXT_PUBLIC_UPLOAD_API_KEY が設定されていません");
            process.exit(1);
        }
        console.log(`⚠️  環境変数からAPIキーを取得しました\n`);
    }

    // APIサーバーが起動しているか確認
    try {
        const healthCheck = await fetch(`${API_BASE_URL}/api/photos`, { method: "GET" });
        if (!healthCheck.ok && healthCheck.status !== 404) {
            throw new Error(`API server returned status ${healthCheck.status}`);
        }
    } catch {
        console.error(`❌ エラー: APIサーバーに接続できません (${API_BASE_URL})`);
        console.error("💡 ヒント: Next.jsサーバーを起動してください: npm run dev");
        process.exit(1);
    }

    try {
        // ローカルの画像ファイルを取得
        console.log("📁 ローカルの画像ファイルを検索中...");
        const imageFiles = await getLocalImages();
        console.log(`✅ ${imageFiles.length}個の画像ファイルが見つかりました\n`);

        if (imageFiles.length === 0) {
            console.log("⚠️  アップロードする画像がありません");
            return;
        }

        // 写真マッピングを作成
        const photoMapping = createPhotoMapping();
        console.log(`📸 ${photoMapping.size}個の写真データが見つかりました\n`);

        // アップロード結果
        const results: UploadResult[] = [];

        // 各画像をアップロード
        for (let i = 0; i < imageFiles.length; i++) {
            const filePath = imageFiles[i];
            const fileName = path.basename(filePath);
            const relativePath = path.relative(process.cwd(), filePath);

            console.log(`[${i + 1}/${imageFiles.length}] 📤 ${fileName} をアップロード中...`);

            try {
                // ファイル情報を取得
                const fileStats = await stat(filePath);
                const fileBuffer = await readFile(filePath);
                const fileType = getMimeType(fileName);

                // 1. Presigned URLを取得
                const { presignedUrl, key, publicUrl, photoId } = await withRetry("presigned-url", () =>
                    getPresignedUrl(fileName, fileType, fileStats.size, apiKey)
                );

                // 2. S3にアップロード
                await withRetry("s3-upload", () => uploadToS3(presignedUrl, fileBuffer, fileType));

                // 3. 対応する写真データを取得
                const basePhoto = photoMapping.get(fileName.toLowerCase());

                // 4. 写真データを保存（photoIdはpresigned-urlから取得したものを使用）
                const savedPhoto = await withRetry("save", () =>
                    savePhotoData(key, publicUrl, photoId, basePhoto, apiKey)
                );

                results.push({
                    localPath: relativePath,
                    fileName,
                    s3Key: key,
                    s3Url: publicUrl,
                    photoId: savedPhoto.id,
                    success: true,
                });

                console.log(`   ✅ 成功: ${publicUrl}`);
                console.log(`   📝 写真ID: ${savedPhoto.id}`);
                
                if (basePhoto) {
                    const title = typeof basePhoto.title === "string" 
                        ? basePhoto.title 
                        : basePhoto.title?.ja || basePhoto.title?.en || "無題";
                    console.log(`   📸 タイトル: ${title}`);
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`   ❌ エラー: ${errorMessage}`);
                results.push({
                    localPath: relativePath,
                    fileName,
                    s3Key: "",
                    s3Url: "",
                    photoId: "",
                    success: false,
                    error: errorMessage,
                });
            }

            console.log("");
        }

        // 結果サマリー
        console.log("=".repeat(60));
        console.log("📊 アップロード結果サマリー");
        console.log("=".repeat(60));
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        console.log(`✅ 成功: ${successCount}個`);
        console.log(`❌ 失敗: ${failCount}個`);
        console.log("");

        // 成功したアップロードのURL一覧
        if (successCount > 0) {
            console.log("📋 アップロードされた写真一覧:");
            console.log("-".repeat(60));
            for (const result of results) {
                if (result.success) {
                    console.log(`${result.fileName}`);
                    console.log(`  📝 ID: ${result.photoId}`);
                    console.log(`  🔗 URL: ${result.s3Url}`);
                    console.log(`  🌐 編集ページ: ${API_BASE_URL}/admin/edit/${result.photoId}`);
                    console.log(`  👁️  個別ページ: ${API_BASE_URL}/photo/${result.photoId}`);
                    console.log("");
                }
            }
            console.log("✅ すべての写真が photos.json に保存されました");
        }

        // 失敗したアップロード
        if (failCount > 0) {
            console.log("❌ 失敗したアップロード:");
            console.log("-".repeat(60));
            for (const result of results) {
                if (!result.success) {
                    console.log(`${result.fileName}: ${result.error}`);
                }
            }
        }

        console.log("\n✨ 処理が完了しました！");
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error("\n❌ エラーが発生しました:", errorMessage);
        if (errorStack) {
            console.error(errorStack);
        }
        process.exit(1);
    }
}

// スクリプトを実行
main();
