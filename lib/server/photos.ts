// lib/server/photos.ts
// ビルド時（サーバー）に photos.json を読み込む共通ローダー。
// /photo/[id] と同じ方針: app/data/photos.json があればそれを、無ければバンドル済みデータを使う。
// ※ fs を使うためサーバーコンポーネント／ルートからのみ import すること。

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";

export async function loadAllPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        try {
            return JSON.parse(await readFile(photosDataPath, "utf-8")) as Photo[];
        } catch {
            // 破損時はバンドル済みへフォールバック
        }
    }
    return RAW_PHOTOS as Photo[];
}
