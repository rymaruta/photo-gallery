import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "../../../../lib/aws/secrets";
import exifr from "exifr";

// 写真データを保存
export async function POST(request: NextRequest) {
    try {
        // 設定を取得（ローカルは.env、本番はSecrets Manager）
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
        const { key, publicUrl, photoId, title, description, location, category, tags, exif } = body;

        if (!key || !publicUrl) {
            return NextResponse.json(
                { error: "ファイル情報が必要です" },
                { status: 400 }
            );
        }

        // 写真IDが提供されていない場合は生成（後方互換性のため）
        // 通常はpresigned-urlからphotoIdが渡される
        const finalPhotoId = photoId || uuidv4();

        // EXIF情報を抽出（クライアント側から送信されていない場合、S3のURLから読み取る）
        let exifData = exif;
        if (!exifData && publicUrl) {
            try {
                // S3のURLからEXIF情報を読み取る（オプション、失敗してもエラーにしない）
                const extractedExif = await exifr.parse(publicUrl, {
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
                    ],
                    translateKeys: false,
                });

                if (extractedExif) {
                    exifData = {
                        camera: extractedExif.Make && extractedExif.Model
                            ? `${extractedExif.Make} ${extractedExif.Model}`.trim()
                            : extractedExif.Make || extractedExif.Model || undefined,
                        lens: extractedExif.LensModel || undefined,
                        aperture: extractedExif.FNumber ? `f/${extractedExif.FNumber}` : undefined,
                        exposure: extractedExif.ExposureTime
                            ? extractedExif.ExposureTime < 1
                                ? `1/${Math.round(1 / extractedExif.ExposureTime)}s`
                                : `${extractedExif.ExposureTime}s`
                            : undefined,
                        iso: extractedExif.ISO || undefined,
                        focalLength: extractedExif.FocalLength
                            ? `${Math.round(extractedExif.FocalLength)}mm`
                            : undefined,
                        whiteBalance: extractedExif.WhiteBalance !== undefined
                            ? extractedExif.WhiteBalance === 0 ? "Auto" : "Manual"
                            : undefined,
                        imageSize: extractedExif.ImageWidth && extractedExif.ImageHeight
                            ? `${extractedExif.ImageWidth} × ${extractedExif.ImageHeight}`
                            : undefined,
                    };
                }
            } catch (exifError) {
                // EXIF読み取りに失敗してもエラーにしない（オプション機能）
                console.warn("EXIF情報の抽出に失敗しました（無視されます）:", exifError);
            }
        }

        // 写真データを生成
        const photoData: any = {
            id: finalPhotoId,
            src: publicUrl,
            title: title || { ja: "無題", en: "Untitled" },
            description: description
                ? typeof description === "string"
                    ? { ja: [description], en: [] }
                    : description
                : undefined,
            location: location || undefined,
            category: category || undefined,
            tags: tags && Array.isArray(tags) ? tags : [],
            published: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // EXIF情報がある場合は追加
        if (exifData && Object.keys(exifData).length > 0) {
            photoData.exif = exifData;
        }

        // 写真データをJSONファイルに追加
        const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
        let photos: any[] = [];

        // 既存のデータを読み込む（存在する場合）
        if (existsSync(photosDataPath)) {
            const data = await readFile(photosDataPath, "utf-8");
            photos = JSON.parse(data);
        } else {
            // 既存のBASE_PHOTOSを読み込む
            const { default: BASE_PHOTOS } = await import("../../../data/photos");
            photos = [...BASE_PHOTOS];
        }

        // 新しい写真を追加
        photos.push(photoData);

        // JSONファイルに保存
        await writeFile(photosDataPath, JSON.stringify(photos, null, 2), "utf-8");

        return NextResponse.json({
            success: true,
            photo: photoData,
        });
    } catch (error: any) {
        console.error("保存エラー:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
