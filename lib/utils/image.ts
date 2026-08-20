// JPEG から EXIF（APP1）/ IPTC（APP13）セグメントをバイトレベルで除去する。
// canvas 圧縮が失敗して元ファイルをアップロードするフォールバック時に、
// GPS 位置情報などのメタデータが公開されるのを防ぐ。
export async function stripJpegExif(file: File): Promise<File> {
    if (file.type !== "image/jpeg") return file;
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        // SOI マーカー確認
        if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return file;

        const parts: Uint8Array[] = [buf.slice(0, 2)];
        let i = 2;
        while (i + 4 <= buf.length) {
            if (buf[i] !== 0xFF) break; // 壊れた構造 — 以降はそのまま保持
            const marker = buf[i + 1];
            if (marker === 0xDA) { // SOS: 以降は画像データなので全部保持
                parts.push(buf.slice(i));
                i = buf.length;
                break;
            }
            const len = (buf[i + 2] << 8) | buf[i + 3];
            if (len < 2) break;
            const segEnd = i + 2 + len;
            // APP1 (Exif/XMP) と APP13 (IPTC) を除去、それ以外は保持
            if (marker !== 0xE1 && marker !== 0xED) {
                parts.push(buf.slice(i, segEnd));
            }
            i = segEnd;
        }
        if (i < buf.length) parts.push(buf.slice(i));

        return new File([new Blob(parts as BlobPart[], { type: "image/jpeg" })], file.name, { type: "image/jpeg" });
    } catch {
        return file;
    }
}

/** 長辺が maxPx に収まる縮小後サイズを返す（拡大はしない） */
export function scaleDimensions(width: number, height: number, maxPx: number): { width: number; height: number } {
    if (width <= maxPx && height <= maxPx) return { width, height };
    if (width >= height) return { width: maxPx, height: Math.round(height * maxPx / width) };
    return { width: Math.round(width * maxPx / height), height: maxPx };
}

/** サムネイルのファイル名（拡張子を差し替え、_thumb を付ける） */
export function thumbFileName(name: string, ext: string): string {
    return `${name.replace(/\.[^.]+$/, "")}_thumb.${ext}`;
}

// デコードが返ってこないときの打ち切り時間。
// onload も onerror も鳴らないまま終わる場合があり（巨大な画像でメモリが
// 足りない iOS Safari など）、そのままだとアップロードがスピナーのまま
// 永久に止まる。失敗として扱えば、呼び出し側が「上げない」判断に進める。
const IMAGE_LOAD_TIMEOUT_MS = 15000;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new window.Image();
        const url = URL.createObjectURL(file);
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            fn();
        };
        const timer = setTimeout(
            () => finish(() => reject(new Error("画像の読み込みがタイムアウトしました"))),
            IMAGE_LOAD_TIMEOUT_MS,
        );
        img.onload = () => finish(() => resolve(img));
        img.onerror = () => finish(() => reject(new Error("画像の読み込みに失敗しました")));
        img.src = url;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// canvas を WebP 優先でエンコードする。WebP は JPEG より 25〜35% 小さく透過も保持できる。
// 非対応ブラウザ（toBlob が null または別 type を返す）は従来どおり PNG/JPEG に落とす。
async function encodeCanvas(
    canvas: HTMLCanvasElement,
    img: HTMLImageElement,
    sourceType: string,
    quality: number,
): Promise<{ blob: Blob; type: string; ext: string } | null> {
    const webp = await canvasToBlob(canvas, "image/webp", quality);
    if (webp && webp.type === "image/webp") return { blob: webp, type: "image/webp", ext: "webp" };

    // フォールバック: PNG は透過保持のため PNG のまま、それ以外は白背景の JPEG
    const outputType = sourceType === "image/png" ? "image/png" : "image/jpeg";
    const ctx = canvas.getContext("2d");
    if (outputType === "image/jpeg" && ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!blob) return null;
    return { blob, type: outputType, ext: outputType === "image/png" ? "png" : "jpg" };
}

/**
 * プロフィール画像の保存サイズ（長辺px）。
 * 表示は最大96px四方なので3倍解像度でも足りる。原寸（カメラ写真は数MB）を
 * そのまま置くと、アイコンが並ぶだけで数十MBのダウンロードになる。
 */
export const AVATAR_MAX_PX = 512;
/** カバー写真の保存サイズ（長辺px）。横幅いっぱいの帯なのでこの程度で足りる。 */
export const COVER_MAX_PX = 1280;

export async function compressImage(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
    // GIFはアニメーションを保持するため圧縮しない
    if (file.type === "image/gif") return file;

    const img = await loadImageFromFile(file);
    const { width, height } = scaleDimensions(img.width, img.height, maxPx);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const encoded = await encodeCanvas(canvas, img, file.type, quality);
    if (!encoded) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([encoded.blob], `${baseName}.${encoded.ext}`, { type: encoded.type });
}

/** メタデータを除去できないファイルを上げようとしたときのエラー */
export class UnstrippableFileError extends Error {
    constructor(public readonly fileType: string) {
        super(`メタデータを除去できない形式です: ${fileType || "(不明)"}`);
        this.name = "UnstrippableFileError";
    }
}

/**
 * アップロードしてよい形に整える。整えられなければ投げる。
 *
 * このアプリは「EXIF を落とし、座標は約1kmに丸めて公開する」という前提で
 * 作られている。ところが実際には抜け道があった:
 *   - canvas での再エンコード（＝EXIF が落ちる本命の経路）は、GIF・
 *     2Dコンテキストが取れない・エンコード失敗、で元ファイルを素通しする
 *   - 保険の stripJpegExif は JPEG 以外では何もせず元ファイルを返す
 * その結果、PC の Chrome から HEIC を選ぶとデコードできずに圧縮が失敗し、
 * GPS 入りの原本がそのまま公開URLで配信されていた。
 *
 * 「消せたことを確認できたものだけ上げる」に変える。判定は identity で行う
 * （compressImage も stripJpegExif も、素通し時は同じ File を返す）。
 */
export async function toUploadSafeFile(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
    let compressed: File | null = null;
    try {
        compressed = await compressImage(file, maxPx, quality);
    } catch {
        compressed = null; // 下の除去経路に落とす
    }
    // 再エンコードできていれば EXIF は残らない
    if (compressed && compressed !== file) return compressed;

    // 素通し・失敗時の保険。JPEG ならバイト列から除去できる。
    if (file.type === "image/jpeg") {
        const stripped = await stripJpegExif(file);
        if (stripped !== file) return stripped;
    }

    // ここに来たら消せていない。上げない。
    throw new UnstrippableFileError(file.type);
}

/**
 * 一覧グリッド配信用の小さなサムネイル（既定 512px・WebP 優先）を生成する。
 * フル画像（〜1920px）をグリッドの小さなマスに流すのは帯域の無駄で表示も遅いため、
 * アップロード時に軽量版を併せて作って別キーに保存する。
 * 失敗したら null（サムネなしでもアップロード自体は成立させる）。
 */
export async function createThumbnail(file: File, maxPx = 512, quality = 0.75): Promise<File | null> {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return null;
    try {
        const img = await loadImageFromFile(file);
        const { width, height } = scaleDimensions(img.width, img.height, maxPx);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, width, height);

        const encoded = await encodeCanvas(canvas, img, file.type, quality);
        if (!encoded) return null;
        return new File([encoded.blob], thumbFileName(file.name, encoded.ext), { type: encoded.type });
    } catch {
        return null;
    }
}

/**
 * blur-up 用の極小ぼかしプレビュー（data:image/webp;base64,...）を作る。
 * 長辺 ~20px に縮小して data URI 化（描画時に CSS で blur をかける）。
 * WebP 非対応ブラウザは jpeg/png にフォールバック。失敗/巨大なら null。
 */
export async function createBlurPlaceholder(file: File, maxPx = 20): Promise<string | null> {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return null;
    try {
        const img = await loadImageFromFile(file);
        const { width, height } = scaleDimensions(img.width, img.height, maxPx);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // toDataURL は未対応形式だと image/png を返すため、要求形式と一致した時だけ採用
        for (const type of ["image/webp", "image/jpeg"]) {
            const url = canvas.toDataURL(type, 0.4);
            if (url.startsWith(`data:${type}`) && url.length <= 4000) return url;
        }
        const png = canvas.toDataURL("image/png");
        return png.length <= 4000 ? png : null;
    } catch {
        return null;
    }
}

// ---- 代表色（ドミナントカラー）の抽出 ----
// グリッドの読み込みプレースホルダーに使う。写真を小さなキャンバスに描いて
// ピクセルの平均色を取る（厳密な支配色ではなく「その写真らしい色」で十分）。

/** RGBA ピクセル列の平均色を #rrggbb で返す（透明ピクセルは除外） */
export function averagePixelsToHex(data: Uint8ClampedArray): string | null {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 32) continue; // ほぼ透明は無視
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (n === 0) return null;
    const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 画像ファイルから代表色を抽出する。失敗したら null（アップロードは止めない） */
export async function extractDominantColor(file: File): Promise<string | null> {
    try {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error("image load failed"));
                el.src = url;
            });
            const size = 16; // 16x16 に縮小して平均を取れば十分
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, size, size);
            return averagePixelsToHex(ctx.getImageData(0, 0, size, size).data);
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch {
        return null;
    }
}
