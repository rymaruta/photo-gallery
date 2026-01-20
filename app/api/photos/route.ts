import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import BASE_PHOTOS from "../../data/photos";

// 写真一覧を取得
export async function GET() {
    try {
        const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");

        // photos.json が存在する場合は、それを「正」として返す（S3参照に統一するため）
        if (existsSync(photosDataPath)) {
            const data = await readFile(photosDataPath, "utf-8");
            const savedPhotos = JSON.parse(data);
            return NextResponse.json(savedPhotos, {
                headers: {
                    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
                },
            });
        }

        // photos.json がない場合のみ BASE_PHOTOS を返す
        const photos: any[] = [...BASE_PHOTOS];

        return NextResponse.json(photos, {
            headers: {
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
            },
        });
    } catch (error: any) {
        console.error("写真取得エラー:", error);
        return NextResponse.json(
            { error: error.message || "写真の取得に失敗しました" },
            { status: 500 }
        );
    }
}
