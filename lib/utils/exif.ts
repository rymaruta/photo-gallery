import exifr from "exifr";

export type ExtractedMeta = {
    dateTimeOriginal?: string;  // 撮影地の壁時計 "YYYY-MM-DDTHH:mm:ss"（ゾーン無し）
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
    dateTimeOriginal?: string; // 撮影地の壁時計 "YYYY-MM-DDTHH:mm:ss"（ゾーン無し）
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

const CAMERA_PICK = [
    "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
    "FocalLength", "WhiteBalance", "ExifImageWidth", "ExifImageHeight",
    "DateTimeOriginal", "CreateDate",
];
const META_PICK = [
    "DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude",
    // 南緯・西経の符号はこの2つで決まる。exifr は
    //   de(deg,min,sec,ref) → "S"/"W" のときだけ符号を反転
    // という実装で、pick は生タグへのフィルタなので、Ref を外すと ref が
    // undefined になり反転が効かない＝座標が常に正になる。
    // 全ファイル読みのフォールバックは fast パスが空のときしか走らないため、
    // 撮影日やメーカー名がある写真（ほぼ全部）は救済されない。
    "GPSLatitudeRef", "GPSLongitudeRef",
    "latitude", "longitude", "Make", "Model",
];

/** exifr.parse を安全に呼ぶ（例外・未対応形式は undefined を返す） */
async function parseSafe(file: File, options: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    try {
        return (await exifr.parse(file, options)) as Record<string, unknown> | undefined;
    } catch {
        return undefined;
    }
}

/** exifr の生データ → 撮影情報カード用 CameraExif */
function mapCameraExif(data: Record<string, unknown> | undefined): CameraExif {
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
    if (dt instanceof Date && !isNaN(dt.getTime())) out.dateTimeOriginal = exifWallClock(dt);
    return out;
}

/**
 * EXIF の撮影日時を、**書いてあるとおりの壁時計**として文字列にする。
 *
 * `toISOString()` を使ってはいけない。exifr は EXIF の
 * `"2024:11:01 07:30:00"` を `new Date(year, month-1, day)` +
 * `setHours(...)` で組む——つまり**実行しているブラウザのローカル時刻**の
 * Date になる（node_modules/exifr/src/dicts/tiff-revivers.mjs の reviveDate）。
 * そこに toISOString を当てると、アップロードした端末のゾーンぶん平行移動する。
 * 日本（UTC+9）から上げると 07:30 の写真が `2024-10-31T22:30:00.000Z` として
 * 保存され、表示は「保存されている通り」に出す規約（lib/utils/photoDate.ts）
 * なので **前日の 22:30** と出ていた。年表の月の区切り・並び順・JSON-LD の
 * dateCreated まで同じ値で決まる。同じ写真でも上げた端末のゾーン次第で
 * 保存値が変わる（＝再現しない）のも同じ原因。
 *
 * EXIF の日時にはゾーンが無い。「その土地の壁時計」なので、変換せずに
 * 数字をそのまま持ち回るのが正しい。ローカル成分を読めば、どのゾーンの
 * 端末でも EXIF に書かれた数字がそのまま返る。
 *
 * 返す形は Z を付けない `YYYY-MM-DDTHH:mm:ss`。サーバーの sanitizeDate が
 * この形をそのまま保存する（日付だけの入力を保つのと同じ扱い）。
 */
function exifWallClock(dt: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
        + `T${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

/** exifr の生データ → 日付/GPS/カメラの ExtractedMeta */
function mapMeta(data: Record<string, unknown> | undefined): ExtractedMeta {
    if (!data) return {};
    const meta: ExtractedMeta = {};
    const dt = data.DateTimeOriginal ?? data.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) meta.dateTimeOriginal = exifWallClock(dt);
    if (typeof data.latitude === "number" && typeof data.longitude === "number") {
        meta.latitude = data.latitude;
        meta.longitude = data.longitude;
    }
    if (typeof data.Make === "string") meta.cameraMake = data.Make.trim();
    if (typeof data.Model === "string") meta.cameraModel = data.Model.trim();
    return meta;
}

/**
 * ファイルから撮影情報を抽出する。失敗したら空オブジェクト（アップロードは止めない）。
 * まず速い chunked+pick で読み、取れなければファイル全体を読んで再挑戦する。
 * これは iPhone の HEIC など EXIF が既定チャンクより後方にある形式での取りこぼしを防ぐため
 * （chunked 読みだと EXIF ブロックに届かず空を返すことがある）。全読みはミス時のみ実行。
 */
export async function extractCameraExif(file: File): Promise<CameraExif> {
    const fast = mapCameraExif(await parseSafe(file, { pick: CAMERA_PICK }));
    if (Object.keys(fast).length > 0) return fast;
    return mapCameraExif(await parseSafe(file, { chunked: false }));
}

export async function extractExifFromFile(file: File): Promise<ExtractedMeta> {
    const fast = mapMeta(await parseSafe(file, { pick: META_PICK }));
    if (Object.keys(fast).length > 0) return fast;
    return mapMeta(await parseSafe(file, { chunked: false }));
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
