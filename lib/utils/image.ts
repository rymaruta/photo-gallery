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

export async function compressImage(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
    // GIFはアニメーションを保持するため圧縮しない
    if (file.type === "image/gif") return file;

    return new Promise((resolve, reject) => {
        const img = new window.Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxPx || height > maxPx) {
                if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
                else { width = Math.round(width * maxPx / height); height = maxPx; }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { resolve(file); return; }

            // JPEG は透過をサポートしないので白背景を敷く
            const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
            if (outputType === "image/jpeg") {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
            }
            ctx.drawImage(img, 0, 0, width, height);

            const ext = outputType === "image/png" ? "png" : "jpg";
            const baseName = file.name.replace(/\.[^.]+$/, "");
            canvas.toBlob(
                (blob) => {
                    if (!blob) { resolve(file); return; }
                    resolve(new File([blob], `${baseName}.${ext}`, { type: outputType }));
                },
                outputType,
                quality,
            );
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像の読み込みに失敗しました")); };
        img.src = url;
    });
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
