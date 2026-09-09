import type { Metadata } from "next";
import CollectionPage from "@/app/components/CollectionPage";
import { collectionStaticParams, collectionMetadata } from "@/lib/server/collections";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return collectionStaticParams("camera", "camera");
}

export async function generateMetadata({ params }: { params: Promise<{ camera: string }> }): Promise<Metadata> {
    const { camera } = await params;
    return collectionMetadata("camera", camera);
}

export default async function CameraPage({ params }: { params: Promise<{ camera: string }> }) {
    const { camera } = await params;
    return <CollectionPage type="camera" slug={camera} />;
}
