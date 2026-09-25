/**
 * EXIF の**向き**（IFD0 / tag 0x0112）だけを読む。読めなければ `undefined`。
 *
 * ここで読むのは値1つだけで、**元のバイトは1つも持ち出さない**。
 * GPS を含む他のタグには触れない。
 */
function readOrientationFromApp1(buf: Uint8Array, payloadStart: number, segEnd: number): number | undefined {
    const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
    if (payloadStart + EXIF.length > segEnd) return undefined;
    for (let k = 0; k < EXIF.length; k++) if (buf[payloadStart + k] !== EXIF[k]) return undefined;
    const tiff = payloadStart + EXIF.length;
    if (tiff + 8 > segEnd) return undefined;
    const be = buf[tiff] === 0x4D && buf[tiff + 1] === 0x4D;
    const le = buf[tiff] === 0x49 && buf[tiff + 1] === 0x49;
    if (!be && !le) return undefined;
    const u16 = (q: number) => (be ? (buf[q] << 8) | buf[q + 1] : (buf[q + 1] << 8) | buf[q]);
    const u32 = (q: number) => (be
        ? ((buf[q] << 24) | (buf[q + 1] << 16) | (buf[q + 2] << 8) | buf[q + 3]) >>> 0
        : ((buf[q + 3] << 24) | (buf[q + 2] << 16) | (buf[q + 1] << 8) | buf[q]) >>> 0);
    if (u16(tiff + 2) !== 42) return undefined;
    const ifd = tiff + u32(tiff + 4);
    if (ifd < tiff || ifd + 2 > segEnd) return undefined;
    const count = u16(ifd);
    for (let n = 0; n < count; n++) {
        const e = ifd + 2 + n * 12;
        if (e + 12 > segEnd) return undefined;
        if (u16(e) !== 0x0112) continue;
        if (u16(e + 2) !== 3) return undefined; // SHORT 以外は読まない
        if (u32(e + 4) !== 1) return undefined; // 個数が1でなければ、値の欄はオフセット
        const v = u16(e + 8);                   // SHORT は4バイト領域の先頭に入る
        return v >= 1 && v <= 8 ? v : undefined;
    }
    return undefined;
}

/**
 * **向きだけを持つ APP1 をゼロから組み立てる。** 元のファイルのバイトは
 * 1つも運ばないので、GPS が紛れ込む余地が無い（運ぶのは 1〜8 の数値1つだけ）。
 *
 * 36バイト固定:
 *   FF E1 00 22                     APP1・長さ34（長さ欄自身を含む）
 *   "Exif\0\0"                      6
 *   4D 4D 00 2A 00 00 00 08         TIFF ヘッダ（ビッグエンディアン・IFD0 は +8）
 *   00 01                           IFD0 のエントリ数 = 1
 *   01 12 00 03 00 00 00 01         tag=Orientation / type=SHORT / count=1
 *   00 vv 00 00                     値（SHORT は4バイト領域の先頭2バイト）
 *   00 00 00 00                     次の IFD は無し
 */
function buildOrientationApp1(orientation: number): Uint8Array {
    return new Uint8Array([
        0xFF, 0xE1, 0x00, 0x22,
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
        0x00, orientation & 0xFF, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ]);
}

/** APP2 の中身が MPF（"MPF\0"）か */
function isMpfSegment(buf: Uint8Array, dataStart: number, segEnd: number): boolean {
    return segEnd - dataStart >= 4
        && buf[dataStart] === 0x4D && buf[dataStart + 1] === 0x50
        && buf[dataStart + 2] === 0x46 && buf[dataStart + 3] === 0x00;
}

/** 走査のあいだに置かれていても落とす区切り（位置情報を持ちうるもの） */
const isMetadataSegment = (buf: Uint8Array, marker: number, dataStart: number, segEnd: number): boolean =>
    marker === 0xE1 || marker === 0xED || (marker === 0xE2 && isMpfSegment(buf, dataStart, segEnd));

/**
 * 最初の SOS（`sosAt` の位置の 0xFF）から主画像の EOI までを、メタデータの
 * 区切りを除いて写し取る。`complete` は EOI まで読めたか。
 *
 * 圧縮データの中の 0xFF は必ず 0x00（詰め物）か RSTn（D0〜D7）が続く。
 * それ以外のマーカーは、プログレッシブ JPEG の次の走査（SOS・DHT など、
 * 長さを持つ区切り）か EOI。区切りは長さで読み飛ばす——中身のバイトに
 * FF D9 が偶然あっても EOI と取り違えない。
 * **走査のあいだの APP1 / APP13 / MPF も落とす**（ヘッダの外に置く機材がある）。
 */
function copyPrimaryImage(buf: Uint8Array, sosAt: number): { parts: Uint8Array[]; complete: boolean } {
    const parts: Uint8Array[] = [];
    let i = sosAt;
    while (i + 1 < buf.length) {
        // i は 0xFF（区切りの先頭）を指しているはず。違えば構造が壊れている
        if (buf[i] !== 0xFF) break;
        // fill byte を飛ばす
        let m = i + 1;
        while (m < buf.length && buf[m] === 0xFF) m++;
        if (m >= buf.length) break;
        const marker = buf[m];
        if (marker === 0xD9) { parts.push(buf.slice(i, m + 1)); return { parts, complete: true }; } // EOI
        // **長さを持たないマーカー（SOI・TEM・RSTn）がここに来るのは壊れている**
        // ——EOI の無い主画像の直後に、後ろの画像の SOI（FF D8）が来た形。
        // 長さとして読むと、後ろの画像の APP1（位置情報）を丸ごと写してしまう
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) break;
        if (m + 2 >= buf.length) break;
        const len = (buf[m + 1] << 8) | buf[m + 2];
        if (len < 2) break;
        const segEnd = m + 1 + len;
        if (segEnd > buf.length) break;
        let j = segEnd;
        if (marker === 0xDA) {
            // 圧縮データを読み進め、次の本物のマーカーを探す
            while (j + 1 < buf.length) {
                if (buf[j] === 0xFF) {
                    const n = buf[j + 1];
                    if (n === 0x00 || (n >= 0xD0 && n <= 0xD7) || n === 0xFF) { j += n === 0xFF ? 1 : 2; continue; }
                    break;
                }
                j++;
            }
            if (j + 1 >= buf.length) { parts.push(buf.slice(i)); return { parts, complete: false }; }
        }
        if (!isMetadataSegment(buf, marker, m + 3, segEnd)) parts.push(buf.slice(i, j));
        i = j;
    }
    parts.push(buf.slice(i));
    return { parts, complete: false };
}

/** 残りのバイトに EXIF / XMP の目印があるか（EOI が見つからなかったときの確認） */
function hasMetadataSignature(buf: Uint8Array, from: number): boolean {
    const sigs = [
        [0x45, 0x78, 0x69, 0x66, 0x00, 0x00],                         // "Exif\0\0"
        [0x68, 0x74, 0x74, 0x70, 0x3A, 0x2F, 0x2F, 0x6E, 0x73, 0x2E], // "http://ns." (XMP)
        [0x50, 0x68, 0x6F, 0x74, 0x6F, 0x73, 0x68, 0x6F, 0x70, 0x20, 0x33, 0x2E, 0x30], // "Photoshop 3.0" (IPTC)
    ];
    for (let k = from; k < buf.length; k++) {
        for (const sig of sigs) {
            if (k + sig.length <= buf.length && sig.every((b, t) => buf[k + t] === b)) return true;
        }
    }
    return false;
}

/**
 * JPEG から EXIF（APP1）/ IPTC（APP13）セグメントをバイトレベルで除去する。
 * canvas 圧縮が失敗して元ファイルをアップロードするフォールバック時に、
 * GPS 位置情報などのメタデータが公開されるのを防ぐ。
 *
 * `stripped` は「本当に落としたか」。呼び出し側はこれを見ること。
 * 「新しい File が返ってきた＝消せた」と見なしてはいけない——
 * 走査が途中で止まると、中身が同じ新しい File が返る（下記 fill byte の件）。
 */
export async function stripJpegExifDetailed(
    file: File,
    opts: { keepOrientation?: boolean } = {},
): Promise<{ file: File; stripped: boolean; orientation?: number }> {
    if (file.type !== "image/jpeg") return { file, stripped: false };
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        // SOI マーカー確認
        if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return { file, stripped: false };

        const parts: Uint8Array[] = [buf.slice(0, 2)];
        let orientation: number | undefined;
        let i = 2;
        while (i + 4 <= buf.length) {
            if (buf[i] !== 0xFF) break; // 壊れた構造 — 以降はそのまま保持
            // マーカーの直前には fill byte（0xFF）を何個でも置ける（JPEG 仕様 B.1.1.2）。
            // 読み飛ばさずに buf[i+1] をマーカーだと決めつけていたため、
            // "FF FF E1" のような並びでは 0xFF をマーカー、続く2バイトを
            // 長さとして読み、巨大な長さになって走査が終了していた。
            // その結果 APP1（Exif/GPS）を含む残り全部がそのまま積まれ、
            // **中身が同じ新しい File** が返る。呼び出し側は同一性判定で
            // 「消せた」と誤認し、GPS 入りのまま公開されていた。
            let m = i + 1;
            while (m < buf.length && buf[m] === 0xFF) m++;
            if (m >= buf.length) break;
            const marker = buf[m];
            const segStart = m + 1;
            if (marker === 0xDA) { // SOS: ここから画像データ
                // **主画像の終わり（EOI）までで切る。** iPhone の JPEG は MPF で
                // 後ろに2枚目以降の JPEG（HDR のゲインマップ・深度など）をぶら下げ、
                // それぞれが自分の APP1（EXIF/XMP）を持てる。以前は SOS 以降を
                // 丸ごと残していたので、そちらのメタデータが公開されていた（#46）。
                const primary = copyPrimaryImage(buf, i);
                // **EOI まで読めなかった（壊れている・途中で切れている）ときは、
                // 残りに EXIF / XMP / IPTC の目印があれば「消せた」と言わない。**
                // 後ろにぶら下がった画像の位置情報が、主画像と区別できないまま残るため
                if (!primary.complete && hasMetadataSignature(buf, i)) return { file, stripped: false };
                // **読み切れたと思っても、出すものに目印が残っていないか確かめる。**
                // 構造の読み違い（壊れたファイル）で後ろの画像を写していても、
                // ここで止まる。圧縮データに偶然 6バイト以上の目印が並ぶ確率は
                // 5MB あたりおよそ 2e-8 で、普通の写真を断ることは事実上無い
                const out = new Uint8Array(primary.parts.reduce((n, p) => n + p.length, 0));
                let at = 0;
                for (const p of primary.parts) { out.set(p, at); at += p.length; }
                if (hasMetadataSignature(out, 0)) return { file, stripped: false };
                parts.push(out);
                i = buf.length;
                break;
            }
            if (segStart + 1 >= buf.length) break;
            const len = (buf[segStart] << 8) | buf[segStart + 1];
            if (len < 2) break;
            const segEnd = segStart + len;
            if (segEnd > buf.length) break; // 長さが壊れている — 以降はそのまま保持
            // APP1 (Exif/XMP) と APP13 (IPTC) を除去、それ以外は保持。
            // APP2 のうち MPF（後ろにぶら下げた画像の索引）も落とす——
            // 後ろの画像は上で切り捨てるので、残すと無い画像を指す索引になる。
            // 同じ APP2 でも ICC_PROFILE（色）は残す
            if (marker === 0xE2 && isMpfSegment(buf, segStart + 2, segEnd)) {
                // 落とす
            } else if (marker !== 0xE1 && marker !== 0xED) {
                parts.push(buf.slice(i, segEnd));
            } else if (marker === 0xE1 && orientation === undefined) {
                // 落とす前に**向きだけ**控える（値1つ。バイトは持ち出さない）
                orientation = readOrientationFromApp1(buf, segStart + 2, segEnd);
            }
            i = segEnd;
        }
        if (i < buf.length) {
            // 走査を最後まで終えられなかった。残りに APP1 が埋まっている
            // 可能性があるので「消せた」とは言わない——**既に1つ落としていても**。
            // XMP を別の APP1 に置く機材（DJI など）では、1つ目を落とせても
            // 2つ目に GPS が残る。「途中で読めなくなった＝確認できていない」。
            return { file, stripped: false };
        }

        // **向きは戻す。** 落とした APP1 には Orientation も入っていて、
        // 消しただけだと**縦位置の写真が横向きで公開される**（実測は
        // `imageOrientation.test.ts` の冒頭に書いた）。戻すのは組み立て直した
        // 36バイトで、元のバイトは1つも含まない。
        if (opts.keepOrientation && orientation !== undefined && orientation >= 2 && orientation <= 8) {
            parts.splice(1, 0, buildOrientationApp1(orientation)); // parts[0] は SOI
        }
        const out = new File([new Blob(parts as BlobPart[], { type: "image/jpeg" })], file.name, { type: "image/jpeg" });
        // メタデータが元から無かった場合も「安全な状態」として扱う。
        // 走査は SOS まで到達しているので、元の APP1 は存在しない。
        return { file: out, stripped: true, orientation };
    } catch {
        return { file, stripped: false };
    }
}

/** 後方互換の薄いラッパー。新しいコードは stripJpegExifDetailed を使うこと */
export async function stripJpegExif(file: File): Promise<File> {
    return (await stripJpegExifDetailed(file)).file;
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
//
// **書き出せないと分かったら、次からは試さない。** Safari（iOS）は
// `toBlob("image/webp")` に PNG を返す。毎回試すと、1枚ごとに圧縮とサムネで
// 2回、1920px の PNG を作って捨てていた（メモリの細い iPhone で重い）。
// 「別の形式が返ってきた」＝書き出せない、が確定したときだけ覚える
// （null は一時的な失敗かもしれないので覚えない）。
let canvasWebp: boolean | null = null;
/** テスト用: 覚えた結果を捨てる */
export function resetCanvasWebpProbe(): void { canvasWebp = null; }

/** 使い終わった canvas の画素を手放す（iOS は canvas の合計メモリに上限がある） */
function releaseCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = 0;
    canvas.height = 0;
}
async function encodeCanvas(
    canvas: HTMLCanvasElement,
    img: HTMLImageElement,
    sourceType: string,
    quality: number,
): Promise<{ blob: Blob; type: string; ext: string } | null> {
    if (canvasWebp !== false) {
        const webp = await canvasToBlob(canvas, "image/webp", quality);
        if (webp && webp.type === "image/webp") { canvasWebp = true; return { blob: webp, type: "image/webp", ext: "webp" }; }
        if (webp) canvasWebp = false;
    }

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
    return compressLoadedImage(await loadImageFromFile(file), file, maxPx, quality);
}

/**
 * **読み込みは呼び出し側で1回だけ行う。**
 *
 * `toUploadSafeFile` は圧縮とバイト除去の両方で寸法が要るが、それぞれで
 * 読み直すと `IMAGE_LOAD_TIMEOUT_MS`（15秒）が**2回分**効く——読み込みが
 * 鳴らない端末（コメントが挙げている iOS Safari の OOM）で、
 * **利用者は30秒スピナーを見てから断られる**。実測でも 15,004ms → 30,004ms
 * になっていた。この保険が効く場面は「資源が足りない端末」なので、
 * デコードを2回要求するのは筋が悪い。
 */
async function compressLoadedImage(img: HTMLImageElement, file: File, maxPx: number, quality: number): Promise<File> {
    const once = async (px: number): Promise<File | null> => {
        const { width, height } = scaleDimensions(img.width, img.height, px);
        const canvas = document.createElement("canvas");
        try {
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, width, height);
            const encoded = await encodeCanvas(canvas, img, file.type, quality);
            if (!encoded) return null;
            const baseName = file.name.replace(/\.[^.]+$/, "");
            return new File([encoded.blob], `${baseName}.${encoded.ext}`, { type: encoded.type });
        } finally {
            releaseCanvas(canvas);
        }
    };
    // **canvas が取れなければ、小さくしてもう一度。** iOS は canvas の合計メモリに
    // 上限があり、当たると getContext / toBlob が null を返す。そのまま諦めると
    // 呼び出し側の保険（バイト除去）に落ち、**縮めていない原寸**（12〜48MP・
    // 数MB〜十数MB）が本体として公開されていた（#6）
    return (await once(maxPx)) ?? (maxPx > 1280 ? await once(1280) : null) ?? file;
}

/**
 * 受け付ける画素数の上限。
 *
 * **サーバー側の `sharp` の既定（`limitInputPixels`）と対**。
 * `scripts/generate-thumbnails.js` は S3 の原本を `sharp()` に食わせるので、
 * これを超える原本が上がるとサムネ生成が毎回失敗する。
 *
 * **ただしこの行に来るのは「デコードは成功するが canvas で作り直せない」
 * 場合だけ。** Chromium で本物の JPEG を通して測ると、decode の限界は
 * 約5.36億画素（2^31 ÷ 4バイト）で、268MP〜536MP は圧縮に成功する
 * ——その場合は 1920px の webp になるので、原本が S3 に行くことはない。
 * つまりここは保険の側から原本が出ていく道を塞ぐためのもの。
 *
 * パノラマ合成やフィルムスキャンは 300MP 級になりうるが、その原本を通しても
 * `generate-thumbnails` が拒否して結局サムネの無い写真になる。
 */
const MAX_UPLOAD_PIXELS = 268_402_689;   // sharp の既定（0x3FFF^2）

/**
 * 上げられないファイルを上げようとしたときのエラー。
 *
 * **理由を持たせる。** 呼び出し側は全部「この形式は安全にアップロード
 * できません。JPEG か PNG で保存し直してください」に潰していたが、
 * デコードできない／画素が多すぎる場合は**形式は正しい JPEG**なので、
 * 言われたとおり保存し直しても同じ結果になる（袋小路）。
 */
export type UnstrippableReason = "format" | "undecodable" | "too-many-pixels";

export class UnstrippableFileError extends Error {
    constructor(
        public readonly fileType: string,
        public readonly reason: UnstrippableReason = "format",
    ) {
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
 * 「消せたことを確認できたものだけ上げる」に変える。
 * 再エンコードは identity で判定できる（素通し時は同じ File が返る）が、
 * バイト除去の方は identity では判定できない——走査が途中で止まっても
 * 「中身が同じ新しい File」が返るため。除去側が申告するフラグを見る。
 */
export async function toUploadSafeFile(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
    // **読み込みは1回だけ。** 圧縮とバイト除去の両方で寸法が要るが、
    // それぞれで読み直すとタイムアウトが2回分効く（上の説明を見よ）。
    let img: HTMLImageElement | null = null;
    let compressed: File | null = null;
    try {
        // GIF はアニメーションを保つため圧縮しない（＝同じ File が返る）
        if (file.type !== "image/gif") {
            img = await loadImageFromFile(file);
            compressed = await compressLoadedImage(img, file, maxPx, quality);
        }
    } catch {
        compressed = null; // 下の除去経路に落とす
    }
    // 再エンコードできていれば EXIF は残らない
    if (compressed && compressed !== file) return compressed;

    // 素通し・失敗時の保険。JPEG ならバイト列から除去できる。
    //
    // **ただし「表示できる」ことを確かめてから使う。**
    //
    // この保険は「デコードはできるが canvas で作り直せない」ときのためのもの。
    // ところが**デコードそのものに失敗した場合も**ここへ落ちていたので、
    // 30000x30000 の JPEG（実体は 5MB 程度）がそのまま上がっていた:
    //
    //   Chromium は宣言 30000x30000 の JPEG を **decode しない**（実測。
    //   `<img>` が onerror）→ 圧縮が失敗 → ここでバイト除去だけ成功 →
    //   **原本が公開URLへ**。サムネ・代表色・ぼかしは全部 null なので
    //   `Thumb` は原本を配り、閲覧者は毎回 5MB を落として**壊れた画像**を見る。
    //   サーバー側の `sharp` も `limitInputPixels` で毎回拒否するので、
    //   `generate-thumbnails` は以後ずっと赤いまま。
    //
    // ブラウザがデコードできない画像は、**閲覧者の画面でも表示できない**。
    // 上げても意味が無いので断る（利用者には「保存し直してください」と出る）。
    if (file.type === "image/jpeg") {
        if (!img) throw new UnstrippableFileError(file.type, "undecodable");
        const pixels = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
        if (pixels > MAX_UPLOAD_PIXELS) throw new UnstrippableFileError(file.type, "too-many-pixels");
        const { file: out, stripped: ok } = await stripJpegExifDetailed(file, { keepOrientation: true });
        if (ok) return out;
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
        try {
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, width, height);

            const encoded = await encodeCanvas(canvas, img, file.type, quality);
            if (!encoded) return null;
            return new File([encoded.blob], thumbFileName(file.name, encoded.ext), { type: encoded.type });
        } finally {
            releaseCanvas(canvas);
        }
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
        try {
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
        } finally {
            releaseCanvas(canvas);
        }
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
        // 自前で new Image() を待たない。onload も onerror も鳴らないまま
        // 終わる端末があり（巨大な画像でメモリが足りない iOS Safari など）、
        // そうなるとアップロードが85%のまま永久に止まる——S3 には既に
        // 本体が上がっているので、レコードの無い孤児だけが残る。
        // 打ち切り付きの loadImageFromFile を使う（objectURL も必ず解放される）。
        const img = await loadImageFromFile(file);
        const size = 16; // 16x16 に縮小して平均を取れば十分
        const canvas = document.createElement("canvas");
        try {
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0, size, size);
            return averagePixelsToHex(ctx.getImageData(0, 0, size, size).data);
        } finally {
            releaseCanvas(canvas);
        }
    } catch {
        return null;
    }
}
