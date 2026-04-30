import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Photo } from "./types";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

const BUCKET = process.env.PHOTOS_BUCKET!;
const KEY = process.env.PHOTOS_KEY!;

export async function loadPhotos(): Promise<Photo[]> {
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
        const body = await res.Body?.transformToString();
        return body ? (JSON.parse(body) as Photo[]) : [];
    } catch (e: unknown) {
        if ((e as { name?: string }).name === "NoSuchKey") return [];
        throw e;
    }
}

export async function savePhotos(photos: Photo[]): Promise<void> {
    await s3.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: KEY,
            Body: JSON.stringify(photos, null, 2),
            ContentType: "application/json",
            CacheControl: "no-cache",
        })
    );
}

export { s3 };
