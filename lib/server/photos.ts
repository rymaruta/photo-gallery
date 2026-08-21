// lib/server/photos.ts
// ビルド時（サーバー）に photos.json を読み込む共通ローダー。
// /photo/[id] と同じ方針: app/data/photos.json があればそれを、無ければバンドル済みデータを使う。
// ※ fs を使うためサーバーコンポーネント／ルートからのみ import すること。

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";

/**
 * 公開してはいけない項目（scripts/sync-photos-from-ddb.js の PRIVATE_FIELDS と対）。
 * ここで読んだものは静的HTML と RSC ペイロードに載る＝全員に配られるため、
 * 古い photos.json が残っていても漏れないように、読み出し側でも落とす。
 * srcOriginal は EXIF を落とす前の原本（GPS 入り）のURL。
 */
const PRIVATE_FIELDS = ["srcOriginal", "key"] as const;

export function stripPrivateFields(photos: Photo[]): Photo[] {
    return photos.map((p) => {
        const out = { ...p } as Photo & Record<string, unknown>;
        for (const f of PRIVATE_FIELDS) delete out[f];
        return out;
    });
}

export async function loadAllPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        try {
            return stripPrivateFields(JSON.parse(await readFile(photosDataPath, "utf-8")) as Photo[]);
        } catch {
            // 破損時はバンドル済みへフォールバック
        }
    }
    return stripPrivateFields(RAW_PHOTOS as Photo[]);
}
