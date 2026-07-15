import exifr from "exifr";

export type ExtractedMeta = {
    dateTimeOriginal?: string;  // ISO 8601
    latitude?: number;
    longitude?: number;
    cameraMake?: string;
    cameraModel?: string;
};

// 写真ページの「撮影情報」カードに載せるカメラ情報。
// アップロード時の圧縮（canvas 再エンコード）で EXIF は必ず失われるため、
// 元ファイルから抽出して DynamoDB に保存する。GPS はここに含めない
// （位置は coords として約1km精度に丸めて別管理）。
export type CameraExif = {
    camera?: string;
    lens?: string;
    aperture?: string;       // "f/4"
    exposure?: string;       // "1/640s"
    iso?: number;
    focalLength?: string;    // "70mm"
    whiteBalance?: string;
    imageSize?: string;      // "6000x4000"
    dateTimeOriginal?: string; // ISO 8601
};

/** Make と Model を重複なく結合（"SONY" + "SONY ILCE-7M3" → "SONY ILCE-7M3"） */
export function formatCameraName(make?: string, model?: string): string | undefined {
    const mk = (make ?? "").trim();
    const md = (model ?? "").trim();
    if (!mk && !md) return undefined;
    if (!md) return mk;
    if (!mk || md.toLowerCase().startsWith(mk.toLowerCase())) return md;
    return `${mk} ${md}`;
}

/** 露出時間（秒）→ "1/640s" / "2s" */
export function formatExposure(t?: number): string | undefined {
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return undefined;
    if (t >= 1) return `${Number(t.toFixed(1))}s`;
    return `1/${Math.round(1 / t)}s`;
}

/** ファイルから撮影情報を抽出する。失敗したら空オブジェクト（アップロードは止めない） */
export async function extractCameraExif(file: File): Promise<CameraExif> {
    try {
        const data = await exifr.parse(file, {
            pick: [
                "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
                "FocalLength", "WhiteBalance", "ExifImageWidth", "ExifImageHeight",
                "DateTimeOriginal", "CreateDate",
            ],
        }) as Record<string, unknown> | undefined;
        if (!data) return {};

        const out: CameraExif = {};
        const camera = formatCameraName(
            typeof data.Make === "string" ? data.Make : undefined,
            typeof data.Model === "string" ? data.Model : undefined,
        );
        if (camera) out.camera = camera;
        if (typeof data.LensModel === "string" && data.LensModel.trim()) out.lens = data.LensModel.trim();
        if (typeof data.FNumber === "number" && data.FNumber > 0) out.aperture = `f/${Number(data.FNumber.toFixed(1))}`;
        const exposure = formatExposure(typeof data.ExposureTime === "number" ? data.ExposureTime : undefined);
        if (exposure) out.exposure = exposure;
        if (typeof data.ISO === "number" && data.ISO > 0) out.iso = Math.round(data.ISO);
        if (typeof data.FocalLength === "number" && data.FocalLength > 0) out.focalLength = `${Math.round(data.FocalLength)}mm`;
        // WhiteBalance は数値（0=Auto/1=Manual）または文字列で返る
        if (data.WhiteBalance === 0 || data.WhiteBalance === "Auto") out.whiteBalance = "Auto";
        else if (data.WhiteBalance === 1 || data.WhiteBalance === "Manual") out.whiteBalance = "Manual";
        if (typeof data.ExifImageWidth === "number" && typeof data.ExifImageHeight === "number") {
            out.imageSize = `${data.ExifImageWidth}x${data.ExifImageHeight}`;
        }
        const dt = data.DateTimeOriginal ?? data.CreateDate;
        if (dt instanceof Date && !isNaN(dt.getTime())) out.dateTimeOriginal = dt.toISOString();
        return out;
    } catch {
        return {};
    }
}

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
