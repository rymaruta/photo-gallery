/**
 * 既存の写真データ（dev-photos.json）にEXIF情報を追加するスクリプト
 * 
 * 機能:
 *   - S3の画像からEXIF情報を抽出
 *   - ローカルのdev-photos.jsonを上書き（既存データは保持）
 *   - 自動バックアップを作成（.bak-タイムスタンプ.json）
 * 
 * 使用方法:
 *   npm run add-exif
 *   または
 *   npx tsx scripts/add-exif-to-existing-photos.ts
 * 
 * 注意:
 *   - dev-photos.jsonのバックアップが自動的に作成されます
 *   - S3の画像からEXIFを読み取る場合、CORS設定が必要です
 *   - ローカルパス（/images/で始まる）の写真はスキップされます
 *   - EXIF情報が読み取れない場合は、既存のexifフィールドは保持されます
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import exifr from "exifr";
import type { Photo } from "../app/data/photos";

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
                    const unquoted = value.replace(/^["']|["']$/g, "");
                    process.env[key.trim()] = unquoted;
                }
            }
        }
    }
}

loadEnvFile();

interface ExifData {
    camera?: string;
    lens?: string;
    aperture?: string;
    exposure?: string;
    iso?: number;
    focalLength?: string;
    whiteBalance?: string;
    imageSize?: string;
    fileFormat?: string;
}

/**
 * 画像からEXIF情報を抽出
 */
async function extractExif(imageUrl: string): Promise<ExifData | null> {
    try {
        // S3のURL（http/httpsで始まる）の場合
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
            try {
                // Node環境ではURLを直接exifrに渡せないため、fetchしてArrayBufferで渡す
                console.log(`  🔍 画像を取得中...`);
                const response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }
                console.log(`  ✅ 画像取得成功 (${response.headers.get("content-type")})`);
                
                const buffer = await response.arrayBuffer();
                console.log(`  📦 バッファサイズ: ${buffer.byteLength} bytes`);
                
                console.log(`  🔍 EXIF情報を解析中...`);
                const exif = await exifr.parse(buffer, {
                    pick: [
                        "Make",
                        "Model",
                        "LensModel",
                        "FNumber",
                        "ExposureTime",
                        "ISO",
                        "FocalLength",
                        "WhiteBalance",
                        "DateTimeOriginal",
                        "ImageWidth",
                        "ImageHeight",
                        "Orientation",
                    ],
                    // translateKeys: false を削除して、キー名でアクセスできるようにする
                });

                if (exif && Object.keys(exif).length > 0) {
                    console.log(`  ✅ EXIF情報を検出:`, Object.keys(exif).join(", "));
                    // デバッグ: 実際のEXIFデータを確認
                    console.log(`  📋 EXIFデータ（サンプル）:`, JSON.stringify(Object.fromEntries(Object.entries(exif).slice(0, 5)), null, 2));
                    const formatted = formatExifData(exif);
                    if (Object.keys(formatted).length > 0) {
                        console.log(`  ✅ フォーマット済みEXIF:`, Object.keys(formatted).join(", "));
                        return formatted;
                    } else {
                        console.log(`  ⚠️  フォーマット後のEXIFが空です`);
                    }
                } else {
                    console.log(`  ⚠️  EXIF情報が見つかりませんでした（画像にEXIFが含まれていない可能性があります）`);
                    // デバッグ: バッファの最初の数バイトを確認
                    const view = new Uint8Array(buffer);
                    const header = Array.from(view.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    console.log(`  🔍 画像ヘッダー（最初の20バイト）: ${header}`);
                }
            } catch (fetchError: unknown) {
                // fetchまたはEXIF読み取りに失敗した場合
                const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
                console.warn(`  ⚠️  EXIF読み取り失敗: ${errorMessage}`);
                if (fetchError instanceof Error && fetchError.stack) {
                    const stackLines = fetchError.stack.split('\n').slice(0, 5);
                    console.warn(`  📋 スタックトレース:`, stackLines.join('\n'));
                }
            }
        } else {
            // ローカルパス（/images/で始まる）の場合はスキップ
            // S3の画像のみを処理対象とする
            console.warn(`  ⚠️  ローカルパスのためスキップ: ${imageUrl}`);
            return null;
        }
        
        return null;
    } catch (error) {
        console.warn(`  ⚠️  EXIF extraction failed for ${imageUrl}:`, error);
        return null;
    }
}

/**
 * EXIFデータをフォーマット
 */
function formatExifData(exif: Record<string, unknown>): ExifData {
    const data: ExifData = {};
    
    // カメラ
    const make = exif.Make as string | undefined;
    const model = exif.Model as string | undefined;
    if (make && model) {
        data.camera = `${make} ${model}`.trim();
    } else if (make) {
        data.camera = make;
    } else if (model) {
        data.camera = model;
    }
    
    // レンズ
    const lensModel = exif.LensModel as string | undefined;
    if (lensModel) {
        data.lens = lensModel;
    }
    
    // 絞り
    const fNumber = exif.FNumber as number | undefined;
    if (fNumber) {
        data.aperture = `f/${fNumber}`;
    }
    
    // シャッター速度
    const exposureTime = exif.ExposureTime as number | undefined;
    if (exposureTime) {
        if (exposureTime < 1) {
            data.exposure = `1/${Math.round(1 / exposureTime)}s`;
        } else {
            data.exposure = `${exposureTime}s`;
        }
    }
    
    // ISO
    const iso = exif.ISO as number | undefined;
    if (iso) {
        data.iso = iso;
    }
    
    // 焦点距離
    const focalLength = exif.FocalLength as number | undefined;
    if (focalLength) {
        data.focalLength = `${Math.round(focalLength)}mm`;
    }
    
    // ホワイトバランス
    const whiteBalance = exif.WhiteBalance as number | undefined;
    if (whiteBalance !== undefined) {
        data.whiteBalance = whiteBalance === 0 ? "Auto" : "Manual";
    }
    
    // 画像サイズ
    if (exif.ImageWidth && exif.ImageHeight) {
        data.imageSize = `${exif.ImageWidth} × ${exif.ImageHeight}`;
    }
    
    return data;
}

/**
 * メイン処理
 */
async function main() {
    const photosDataPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
    
    if (!existsSync(photosDataPath)) {
        console.error("❌ dev-photos.jsonが見つかりません");
        process.exit(1);
    }
    
    // バックアップを作成（自動）
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
        process.cwd(),
        "app",
        "data",
        `dev-photos.json.bak-${timestamp}`
    );
    const photosData = await readFile(photosDataPath, "utf-8");
    await writeFile(backupPath, photosData, "utf-8");
    console.log(`✅ 自動バックアップを作成しました: ${path.relative(process.cwd(), backupPath)}`);
    
    const photos: Photo[] = JSON.parse(photosData);
    console.log(`📸 ${photos.length}件の写真を処理します...\n`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const photoTitle = typeof photo.title === "string" 
            ? photo.title 
            : photo.title?.ja || photo.title?.en || photo.id;
        
        console.log(`[${i + 1}/${photos.length}] ${photoTitle}`);
        console.log(`  📍 ${photo.src}`);
        
        // S3のURLでない場合はスキップ
        if (!photo.src.startsWith("http://") && !photo.src.startsWith("https://")) {
            console.log(`  ⏭️  ローカルパスのためスキップ（S3の画像のみ処理）`);
            skippedCount++;
            continue;
        }
        
        // 既にexifフィールドがあり、すべての主要フィールドが存在する場合はスキップ
        if (photo.exif && 
            (photo.exif.camera || photo.exif.lens || photo.exif.aperture || photo.exif.exposure || photo.exif.iso)) {
            console.log(`  ⏭️  既にEXIF情報があるためスキップ`);
            skippedCount++;
            continue;
        }
        
        // EXIF情報を抽出（S3の画像から）
        const exifData = await extractExif(photo.src);
        
        if (exifData && Object.keys(exifData).length > 0) {
            // 既存のexifフィールドとマージ（既存のデータを優先）
            photos[i].exif = {
                ...exifData,
                ...photo.exif, // 既存のデータを優先
            };
            
            // updatedAtを更新
            photos[i].updatedAt = new Date().toISOString();
            
            console.log(`  ✅ EXIF情報を追加しました:`, Object.keys(exifData).join(", "));
            updatedCount++;
        } else {
            console.log(`  ⚠️  EXIF情報を読み取れませんでした`);
            errorCount++;
        }
        
        // S3への連続リクエストで負荷が上がらないように短いウェイトを挟む
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    // dev-photos.jsonを上書き（既存データは保持）
    await writeFile(photosDataPath, JSON.stringify(photos, null, 2), "utf-8");
    console.log(`\n📝 dev-photos.jsonを上書きしました`);
    
    console.log(`\n✅ 処理完了！`);
    console.log(`  - 更新: ${updatedCount}件`);
    console.log(`  - スキップ: ${skippedCount}件`);
    console.log(`  - エラー: ${errorCount}件`);
}

main().catch((error) => {
    console.error("❌ エラーが発生しました:", error);
    process.exit(1);
});
