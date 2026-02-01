import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import RAW_PHOTOS from "../../../data/photos";
import type { Photo } from "../../../data/photos";
import EditPhotoPageClient from "./EditPhotoPageClient";

// 静的生成用のパラメータ生成関数
export async function generateStaticParams() {
    const photosDataPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
    let photos: Photo[];
    
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        photos = JSON.parse(data);
    } else {
        photos = RAW_PHOTOS as Photo[];
    }
    
    // すべての写真IDを返す（管理者ページではすべての写真を編集可能にするため）
    return photos.map((photo) => ({
        id: photo.id,
    }));
}

type PageProps = {
    params: Promise<{ id: string }>;
};

export default async function EditPhotoPage({ params }: PageProps) {
    const { id } = await params;
    return <EditPhotoPageClient photoId={id} />;
}
