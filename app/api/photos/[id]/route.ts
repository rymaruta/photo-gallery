import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getConfig } from "../../../../lib/aws/secrets";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import BASE_PHOTOS from "../../../data/photos";
import { log } from "../../../../lib/utils/log";

import type { Photo } from "../../../data/photos";

// 静的エクスポートではAPI Routesは生成されない（本番環境ではAPI Gateway + Lambdaを使用）

// 写真データを読み込む共通関数（キャッシュ付き）
let photosCache: { photos: Photo[]; timestamp: number } | null = null;
const PHOTOS_CACHE_TTL = 30 * 1000; // 30秒

async function loadPhotos(): Promise<Photo[]> {
    // キャッシュをチェック
    if (photosCache && Date.now() - photosCache.timestamp < PHOTOS_CACHE_TTL) {
        return photosCache.photos;
    }

    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");

    // photos.json が存在する場合は、それを「正」として読み込む（S3参照に統一するため）
    let photos: Photo[];
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        photos = JSON.parse(data) as Photo[];
    } else {
        photos = [...BASE_PHOTOS];
    }

    // キャッシュに保存
    photosCache = {
        photos,
        timestamp: Date.now(),
    };

    return photos;
}

// キャッシュをクリアする関数
function clearPhotosCache() {
    photosCache = null;
}

// 写真を取得
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const photos = await loadPhotos();

        const photo = photos.find((p) => p.id === id);
        if (!photo) {
            return NextResponse.json(
                { error: "写真が見つかりません" },
                { status: 404 }
            );
        }

        return NextResponse.json(photo, {
            headers: {
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
            },
        });
    } catch (error: unknown) {
        console.error("写真取得エラー:", error);
        const errorMessage = error instanceof Error ? error.message : "写真の取得に失敗しました";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

// 写真を更新
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const config = await getConfig();

        // 認証チェック
        const apiKey = request.headers.get("x-api-key");
        if (apiKey !== config.uploadApiKey) {
            return NextResponse.json(
                { error: "認証に失敗しました" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const photos = await loadPhotos();

        const photoIndex = photos.findIndex((p) => p.id === id);
        if (photoIndex === -1) {
            return NextResponse.json(
                { error: "写真が見つかりません" },
                { status: 404 }
            );
        }

        // 写真データを更新
        const updatedPhoto = {
            ...photos[photoIndex],
            ...body,
            updatedAt: new Date().toISOString(),
        };

        photos[photoIndex] = updatedPhoto;

        // すべての写真（ベース写真を含む）を保存
        // ベース写真の編集も可能にするため、photos.jsonに保存
        const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
        
        // 既存のアップロード写真と編集されたベース写真を保存
        let existingPhotos: Photo[] = [];
        if (existsSync(photosDataPath)) {
            const data = await readFile(photosDataPath, "utf-8");
            existingPhotos = JSON.parse(data) as Photo[];
        }

        // 編集された写真を追加または更新
        const existingIndex = existingPhotos.findIndex((p: Photo) => p.id === id);
        if (existingIndex >= 0) {
            existingPhotos[existingIndex] = updatedPhoto;
        } else {
            existingPhotos.push(updatedPhoto);
        }

        await writeFile(photosDataPath, JSON.stringify(existingPhotos, null, 2), "utf-8");

        // キャッシュをクリア
        clearPhotosCache();

        return NextResponse.json({
            success: true,
            photo: updatedPhoto,
        });
    } catch (error: unknown) {
        console.error("更新エラー:", error);
        const errorMessage = error instanceof Error ? error.message : "更新に失敗しました";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

// 写真を削除
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const config = await getConfig();

        // 認証チェック
        const apiKey = request.headers.get("x-api-key");
        if (apiKey !== config.uploadApiKey) {
            return NextResponse.json(
                { error: "認証に失敗しました" },
                { status: 401 }
            );
        }

        const photos = await loadPhotos();

        const photoIndex = photos.findIndex((p) => p.id === id);
        if (photoIndex === -1) {
            return NextResponse.json(
                { error: "写真が見つかりません" },
                { status: 404 }
            );
        }

        const photo = photos[photoIndex];

        // S3から画像を削除（srcがS3のURLの場合）
        if (photo.src && photo.src.startsWith("http")) {
            try {
                log.info("S3削除開始:", {
                    photoId: id,
                    photoSrc: photo.src,
                    bucket: config.awsS3BucketName,
                    region: config.awsRegion,
                    useIamRole: config.useIamRole,
                });

                // S3クライアントの設定
                const s3ClientConfig: {
                    region: string;
                    credentials?: {
                        accessKeyId: string;
                        secretAccessKey: string;
                    };
                } = {
                    region: config.awsRegion,
                };

                // IAMロールを使用しない場合は認証情報を設定
                // IAMロールを使用する場合は、認証情報を設定せずにAWS SDKが自動的にIAMロールを使用
                if (!config.useIamRole && config.awsAccessKeyId && config.awsSecretAccessKey) {
                    s3ClientConfig.credentials = {
                        accessKeyId: config.awsAccessKeyId,
                        secretAccessKey: config.awsSecretAccessKey,
                    };
                    log.info("S3削除: 認証情報を使用（IAMロールではない）");
                } else {
                    log.info("S3削除: IAMロールを使用（認証情報なし）");
                }

                const s3Client = new S3Client(s3ClientConfig);

                // URLからキーを抽出
                let key: string;
                try {
                    const url = new URL(photo.src);
                    // pathnameから先頭の/を削除してキーを取得
                    key = url.pathname.substring(1);
                    
                    // CloudFront URLの場合は、pathnameがそのままキーになる
                    // S3直接URLの場合も、pathnameがそのままキーになる
                    // 例: https://bucket.s3.region.amazonaws.com/uploads/file.jpg -> uploads/file.jpg
                    // 例: https://cloudfront.net/uploads/file.jpg -> uploads/file.jpg
                    
                    log.info("S3削除: URL解析", {
                        originalUrl: photo.src,
                        pathname: url.pathname,
                        extractedKey: key,
                        bucket: config.awsS3BucketName,
                    });
                } catch (urlError) {
                    console.error("URL解析エラー:", urlError);
                    throw new Error(`無効なURL形式: ${photo.src}`);
                }

                if (!key || !key.trim()) {
                    throw new Error(`キーが抽出できませんでした: ${photo.src}`);
                }

                if (!config.awsS3BucketName || !config.awsS3BucketName.trim()) {
                    throw new Error(`S3バケット名が設定されていません`);
                }

                log.info("S3削除実行:", {
                    bucket: config.awsS3BucketName,
                    key: key,
                    region: config.awsRegion,
                });

                const deleteCommand = new DeleteObjectCommand({
                    Bucket: config.awsS3BucketName,
                    Key: key,
                });

                const deleteResponse = await s3Client.send(deleteCommand);

                log.info("S3削除成功:", {
                    key: key,
                    bucket: config.awsS3BucketName,
                    response: deleteResponse,
                });
            } catch (s3Error: unknown) {
                const errorMessage = s3Error instanceof Error ? s3Error.message : String(s3Error);
                const errorCode = (s3Error as { Code?: string; code?: string })?.Code || (s3Error as { Code?: string; code?: string })?.code;
                const errorName = s3Error instanceof Error ? s3Error.name : undefined;
                const errorStack = s3Error instanceof Error ? s3Error.stack : undefined;
                console.error("S3削除エラー:", {
                    error: errorMessage,
                    code: errorCode,
                    name: errorName,
                    stack: errorStack,
                    photoSrc: photo.src,
                    bucket: config.awsS3BucketName,
                    region: config.awsRegion,
                    useIamRole: config.useIamRole,
                });
                // S3の削除に失敗した場合はエラーを返す
                // これにより、photos.jsonからの削除も実行されず、データの不整合を防ぐ
                const s3ErrorMessage = errorMessage || errorCode || "Unknown error";
                return NextResponse.json(
                    { 
                        error: `S3からの削除に失敗しました: ${s3ErrorMessage}` 
                    },
                    { status: 500 }
                );
            }
        } else {
            log.info("S3削除スキップ: ローカルファイルまたは無効なURL", {
                photoId: id,
                photoSrc: photo.src,
            });
        }

        // photos.jsonから削除（ベース写真の削除も可能）
        const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
        let existingPhotos: Photo[] = [];
        if (existsSync(photosDataPath)) {
            const data = await readFile(photosDataPath, "utf-8");
            existingPhotos = JSON.parse(data) as Photo[];
        }

        // 削除対象の写真を除外
        existingPhotos = existingPhotos.filter((p: Photo) => p.id !== id);
        await writeFile(photosDataPath, JSON.stringify(existingPhotos, null, 2), "utf-8");

        // キャッシュをクリア
        clearPhotosCache();

        return NextResponse.json({
            success: true,
        });
    } catch (error: unknown) {
        console.error("削除エラー:", error);
        const errorMessage = error instanceof Error ? error.message : "削除に失敗しました";
        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}
