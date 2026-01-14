import type { Photo } from "../../data/photos";
import RAW_PHOTOS from "../../data/photos";
import PhotoPageClient from "./PhotoPageClient";

// 静的生成用のパラメータ生成関数
export function generateStaticParams() {
    const photos = RAW_PHOTOS as Photo[];
    return photos.map((photo) => ({
        id: photo.id,
    }));
}

type PageProps = {
    params: Promise<{ id: string }>;
};

export default async function PhotoPage({ params }: PageProps) {
    const { id } = await params;
    return <PhotoPageClient photoId={id} />;
}
