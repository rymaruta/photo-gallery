import exifr from "exifr";

export type ExtractedMeta = {
    dateTimeOriginal?: string;  // ISO 8601
    latitude?: number;
    longitude?: number;
    cameraMake?: string;
    cameraModel?: string;
};

export async function extractExifFromFile(file: File): Promise<ExtractedMeta> {
    try {
        const data = await exifr.parse(file, {
            pick: [
                "DateTimeOriginal",
                "CreateDate",
                "GPSLatitude",
                "GPSLongitude",
                "latitude",
                "longitude",
                "Make",
                "Model",
            ],
        }) as Record<string, unknown> | undefined;

        if (!data) return {};

        const meta: ExtractedMeta = {};
        const dt = data.DateTimeOriginal ?? data.CreateDate;
        if (dt instanceof Date && !isNaN(dt.getTime())) {
            meta.dateTimeOriginal = dt.toISOString();
        }
        if (typeof data.latitude === "number" && typeof data.longitude === "number") {
            meta.latitude = data.latitude;
            meta.longitude = data.longitude;
        }
        if (typeof data.Make === "string") meta.cameraMake = data.Make.trim();
        if (typeof data.Model === "string") meta.cameraModel = data.Model.trim();
        return meta;
    } catch {
        return {};
    }
}

// 簡易リバースジオコーディング（OpenStreetMap Nominatim、無料・APIキー不要）
// 利用規約上、1リクエスト/秒の制限あり。呼び出し側で順次実行することを推奨。
//
// プライバシー: 自宅などの撮影地特定を防ぐため、座標を小数第2位（約1km）に丸め、
// zoom=10（市区町村レベル）で問い合わせる。番地・建物レベルの情報は取得しない。
export async function reverseGeocode(lat: number, lng: number, locale: "ja" | "en" = "ja"): Promise<string | null> {
    try {
        const rlat = Math.round(lat * 100) / 100;
        const rlng = Math.round(lng * 100) / 100;
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${rlat}&lon=${rlng}&zoom=10&accept-language=${locale}`;
        const res = await fetch(url, {
            headers: { "Accept": "application/json" },
        });
        if (!res.ok) return null;
        const data = await res.json() as { address?: Record<string, string>; display_name?: string };
        const a = data.address ?? {};
        // 都市レベルの位置名を組み立てる
        const parts = [
            a.city ?? a.town ?? a.village ?? a.suburb ?? a.county,
            a.state ?? a.region,
            a.country,
        ].filter(Boolean);
        if (parts.length > 0) return parts.join(", ");
        return data.display_name ?? null;
    } catch {
        return null;
    }
}
