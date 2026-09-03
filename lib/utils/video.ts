import { UnstrippableFileError } from "./image";

/**
 * 動画から位置情報を落とす。落とせなければ投げる。
 *
 * **ストーリーの動画だけ、メタデータを一切落とさずに原本のまま上がっていた。**
 * `StoriesBar` は `mediaType === "image"` のときだけ `toUploadSafeFile` を
 * 通しており、動画には `else` が無かった。写真は「EXIF を落とし、座標は
 * 約1kmに丸めて公開する」という前提で作られているのに、動画だけ
 * **丸めていない緯度経度**が付いたまま公開URLに置かれる
 * （iPhone の .mov なら `com.apple.quicktime.location.ISO6709`、
 * Android の .mp4 なら `©xyz`）。
 *
 * ## やり方: 消さずに「読み飛ばしてよい箱」に書き換える
 *
 * MP4/MOV（ISO-BMFF）は箱の入れ子で、`moov/udta` と `moov/meta` に
 * メタデータが入る。**バイトを削ってはいけない**——`stco`/`co64` は
 * ファイル先頭からの**絶対位置**で各チャンクを指しているので、前を削ると
 * 全部ずれて**再生できない動画になる**（GPS を消す代わりに動画を壊す、
 * という一番やってはいけない直し方）。
 *
 * そこで箱の**種別だけ `free` に書き換え、中身を 0 で埋める**。
 * `free` は「読み飛ばしてよい箱」として規格に定義されていて、長さは
 * 1バイトも変わらないので、どのオフセットもずれない。
 *
 * ## 消せたことを確かめてから返す
 *
 * `toUploadSafeFile` と同じ方針（「消せたことを確認できたものだけ上げる」）に
 * 揃える。書き換えたあとの `moov` を走査して、既知の目印が1つでも残って
 * いたら投げる。`uuid` の箱に XMP で座標を入れる機種があり、そこまでは
 * 書き換えないので、この確認で拾う。
 *
 * **走査するのはメタデータの箱だけで、`mdat` は見ない。** 全体を見ると、
 * 圧縮された映像データに `©xyz` の4バイトが**偶然並ぶ**（50MB なら1%強）。
 * それで弾くと、位置情報の無い動画が理由も分からず上げられなくなる。
 *
 * ## ISO-BMFF 以外は上げない
 *
 * WebM（Matroska）は構造が違うのでここでは解釈できない。「たぶん入って
 * いない」で通すと、このファイルが直そうとしている「消せていないのに
 * 上げる」に戻る。受け口（accept と `ALLOWED_VIDEO_TYPES`）は変えず、
 * 中身を見てから断る（呼び出し側が `UnstrippableFileError` を拾って
 * 「この形式は安全にアップロードできません」を出す）。
 */

/** 位置情報が入っている箱。中身ごと `free` にする */
const METADATA_BOXES = new Set(["udta", "meta"]);

/** 中に入って探す箱（この中に udta / meta がぶら下がる）。
 *  `moof`/`traf` を落とすと、フラグメント MP4 の `traf/udta` が素通りする */
const CONTAINER_BOXES = new Set(["moov", "trak", "moof", "traf"]);

/**
 * 走査と書き換えの対象にする、最上位の箱。
 *
 * `uuid` を入れているのは**確認のため**（書き換えはしない）。XMP は
 * 最上位の `uuid` に入るので、ここを外すとそのまま公開される
 * ——実際に外れていて、`exif:GPSLatitude` が素通りしていた。
 */
const TOP_LEVEL_TARGETS = new Set(["moov", "meta", "udta", "moof", "uuid"]);

/**
 * 残っていたら「消せていない」と判断する目印。
 *
 * `©xyz`（0xA9 + "xyz"）は 3GPP/QuickTime の位置。Apple はキー名を
 * 文字列でそのまま持つので、そちらは ASCII で探す。
 */
const LOCATION_MARKERS: readonly number[][] = [
    [0xa9, 0x78, 0x79, 0x7a],                                   // ©xyz
    Array.from("com.apple.quicktime.location", (c) => c.charCodeAt(0)),
    Array.from("location.ISO6709", (c) => c.charCodeAt(0)),
    // XMP（`uuid` の箱に入る）。**`©xyz` だけ見ていたので素通りしていた**
    Array.from("exif:GPSLatitude", (c) => c.charCodeAt(0)),
    Array.from("exif:GPSLongitude", (c) => c.charCodeAt(0)),
    Array.from("GPSCoordinates", (c) => c.charCodeAt(0)),
];

const FREE = [0x66, 0x72, 0x65, 0x65]; // "free"

/** 箱のヘッダを読むのに要る最大バイト数（64bit 長のとき 16） */
const MAX_HEADER = 16;

export type Box = { type: string; start: number; headerSize: number; boxEnd: number };

function typeAt(view: DataView, offset: number): string {
    let s = "";
    for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
}

/**
 * 箱を1つ読む。**壊れた長さでは進めない**（ヘッダより短い、親をはみ出す）。
 * 進めないときは null を返し、呼び出し側はそこで走査をやめる
 * ——無限ループにも、隣の箱を巻き込む書き換えにもしないため。
 *
 * **不変条件: 箱を返すなら必ず `boxEnd > offset`。**
 * `size` はヘッダ長（8以上）以上か、`size32 === 0` のときは `end - offset`
 * （`offset < end` のときだけ呼ばれるので正）。呼び出し側に
 * 「進まなければ止める」を重ねて書くと**到達しない守り**になり、
 * 片方を壊しても全件緑になる（この campaign で何度も出ている型）ので、
 * 前進の保証はここ1か所に持たせる。`readBox が必ず前へ進む` のテストで固定。
 *
 * `view` はファイル全体でなくてもよい。`base` はこの view の先頭が
 * ファイル上のどこかを表す（返す位置はファイル基準に揃える）。
 */
export function readBox(view: DataView, offset: number, end: number, base = 0): Box | null {
    const local = offset - base;
    if (local + 8 > view.byteLength || offset + 8 > end) return null;
    const size32 = view.getUint32(local);
    const type = typeAt(view, local + 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
        if (local + 16 > view.byteLength || offset + 16 > end) return null;
        // 64bit 長。2^53 を超える値はこのアプリの動画では出ないので Number で見る
        size = view.getUint32(local + 8) * 0x1_0000_0000 + view.getUint32(local + 12);
        headerSize = 16;
    } else if (size32 === 0) {
        size = end - offset;   // 「最後まで」
    }
    if (size < headerSize) return null;
    const boxEnd = offset + size;
    if (boxEnd > end) return null;
    return { type, start: offset, headerSize, boxEnd };
}

/**
 * その範囲の箱を歩いて、メタデータの箱を `free` + 0 埋めにする。
 * `bytes` の先頭がファイル上の `base` に当たる。
 */
export function neutralizeRange(
    bytes: Uint8Array,
    base: number,
    start: number,
    end: number,
    /** 目印を探す範囲（`uuid` と、**箱として読めなかった残り**。下の理由を見よ） */
    checkRanges: Array<[number, number]> = [],
): Array<[number, number]> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = start;
    while (offset < end) {
        const box = readBox(view, offset, end, base);
        if (!box) {
            // **読めずに降りた残りは「触っていない」。**
            //
            // ここは以前ただの `break` で、走査をやめた先は書き換えも確認も
            // されずに通っていた。実測（この形の3通りとも原本と1バイト違わない
            // まま「安全」として返っていた）:
            //
            //   moov の先頭に長さの壊れた箱 → 後ろの udta/©xyz に到達しない
            //   moov/udta の宣言サイズが moov をはみ出す → 同上
            //
            // 最上位で同じことが起きる場合は `topLevelBoxes` が null を返して
            // 断る（`97d57eb` のレビューで塞いだ）のに、**入れ子の中だけ
            // 素通りしていた**。読めなかった残りは目印を探す対象に入れ、
            // 見つかれば上げない。
            //
            // 誤検知の心配は小さい——正しい MP4 なら `moov` の子は端まで
            // 箱として読める（読めない時点でそのファイルは壊れている）。
            checkRanges.push([offset - base, end - base]);
            break;
        }
        const local = box.start - base;
        if (METADATA_BOXES.has(box.type)) {
            for (let i = 0; i < 4; i++) bytes[local + 4 + i] = FREE[i];
            bytes.fill(0, local + box.headerSize, box.boxEnd - base);
        } else if (CONTAINER_BOXES.has(box.type)) {
            neutralizeRange(bytes, base, box.start + box.headerSize, box.boxEnd, checkRanges);
        } else if (box.type === "uuid") {
            checkRanges.push([local, box.boxEnd - base]);
        }
        offset = box.boxEnd;   // readBox の不変条件により必ず前へ進む
    }
    return checkRanges;
}

/** 目印が残っていないか。1つでもあれば「消せていない」 */
export function hasLocationMarker(bytes: Uint8Array): boolean {
    for (const marker of LOCATION_MARKERS) {
        outer: for (let i = 0; i + marker.length <= bytes.length; i++) {
            for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) continue outer;
            return true;
        }
    }
    return false;
}

/**
 * 最上位の箱を並べる。ヘッダだけを読むので、大きなファイルでも中身は読まない。
 *
 * **途中で読めなくなったら null を返す**（読めた分を返さない）。
 * 以前は「読めた分だけ返す」にしていたので、`mdat` の宣言サイズが実体と
 * 食い違うファイルでは `ftyp` だけを読んだところで走査が終わり、
 * **`moov` に一度も触れないまま原本と1バイト違わないものを返していた**
 * ——`ftyp` があるので例外にもならず、確認も走らない。このファイルが
 * 直そうとした「消せていないのに上げる」がそのまま残っていた。
 */
async function topLevelBoxes(file: File): Promise<Box[] | null> {
    const out: Box[] = [];
    let offset = 0;
    while (offset < file.size) {
        const head = new DataView(await file.slice(offset, offset + MAX_HEADER).arrayBuffer());
        const box = readBox(head, offset, file.size, offset);
        if (!box) return null;   // 端まで読み切れない＝解釈できていない
        out.push(box);
        offset = box.boxEnd;   // readBox の不変条件により必ず前へ進む
    }
    return out;
}

/**
 * メタデータを落とした動画を返す。落とせなければ `UnstrippableFileError`。
 *
 * **長さは1バイトも変わらない**（箱の種別を差し替えて中を 0 で埋めるだけ）。
 * 映像本体（`mdat`）は読み込まずに `Blob` の切り出しで持ち回るので、
 * 端末のメモリに載るのはメタデータの箱だけ。
 */
export async function toUploadSafeVideo(file: File): Promise<File> {
    const boxes = await topLevelBoxes(file);
    // 端まで箱として読み切れない＝ISO-BMFF として解釈できていない（WebM など）
    if (!boxes) throw new UnstrippableFileError(file.type);

    const parts: BlobPart[] = [];
    let cursor = 0;
    let sawMoov = false;
    for (const box of boxes) {
        if (box.type === "moov") sawMoov = true;
        if (!TOP_LEVEL_TARGETS.has(box.type)) continue;
        if (box.start > cursor) parts.push(file.slice(cursor, box.start));
        const region = new Uint8Array(await file.slice(box.start, box.boxEnd).arrayBuffer());
        const checkRanges = box.type === "uuid"
            ? [[0, region.length] as [number, number]]   // 最上位の uuid はそれ自体が対象
            : neutralizeRange(region, box.start, box.start, box.boxEnd);

        // **確認するのは `uuid` と、箱として読めなかった残りだけ。**
        //
        // 書き換えた箱（`udta`/`meta`）は 0 で埋めてあるので、残るとしたら
        // 知らない箱＝実質 `uuid`（XMP はここに入る）か、走査が降りられ
        // なかった範囲。一方、`moov` 全体を
        // 見ると `stco`/`stsz` のバイナリに `©xyz` の4バイトが**偶然並ぶ**
        // （300KB で約1/14,000）。そのとき利用者には「位置情報を取り除け
        // ません」としか出ず、位置情報の無い動画が理由も分からず弾かれる。
        // `mdat` を見ない理由（コミット 97d57eb）と同じ理屈が `moov` にも
        // 当たる、というだけのこと。
        for (const [from, to] of checkRanges) {
            if (hasLocationMarker(region.subarray(from, to))) throw new UnstrippableFileError(file.type);
        }
        parts.push(region);
        cursor = box.boxEnd;
    }

    // **`moov` に触れないまま返さない。** ここが無いと、最上位に `moov` の
    // 無いファイル（や読み違えたファイル）で原本がそのまま通る
    if (!sawMoov) throw new UnstrippableFileError(file.type);

    if (cursor < file.size) parts.push(file.slice(cursor));
    return new File(parts, file.name, { type: file.type, lastModified: file.lastModified });
}

/**
 * **直していない穴（記録）**: 時系列メタデータのトラック。
 *
 * GoPro などは GPS を「トラック」として持ち、値は `mdat` に入る。ここで
 * 消しているのは容器のメタデータ（`udta`/`meta`/XMP）だけなので、その形の
 * 座標は残る。消すにはトラックごと外すことになり、`stco` の作り直しが要る
 * ——「GPS を消す代わりに動画を壊す」に一番近づく変更なので、実機の動画で
 * 確かめられるまで手を付けない。iPhone / Android の通常の撮影は容器側に
 * 入るので、そちらはここで落ちる。
 */
