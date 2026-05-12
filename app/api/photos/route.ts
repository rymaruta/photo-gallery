import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import BASE_PHOTOS from "../../data/photos";
import type { Photo } from "../../data/photos";

// 静的エクスポートではAPI Routesは生成されない（本番環境ではAPI Gateway + Lambdaを使用）

// 写真一覧を取得
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");

        // photos.json が存在する場合は、それを「正」として返す（S3参照に統一するため）
        let allPhotos: Photo[];
        if (existsSync(photosDataPath)) {
            const data = await readFile(photosDataPath, "utf-8");
            allPhotos = JSON.parse(data) as Photo[];
        } else {
            allPhotos = [...BASE_PHOTOS];
        }

        const photos = userId ? allPhotos.filter(p => p.userId === userId) : allPhotos;

        return NextResponse.json(photos, {
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
