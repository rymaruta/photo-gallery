import { describe, it, expect } from "vitest";
import { toUploadSafeVideo, hasLocationMarker, neutralizeRange, readBox } from "../video";
import { UnstrippableFileError } from "../image";

// **ストーリーの動画だけ、メタデータを落とさずに原本のまま上がっていた。**
// 写真は「EXIF を落とし、座標は約1kmに丸めて公開する」前提なのに、
// 動画だけ丸めていない緯度経度が公開URLに乗る。
//
// ここで確かめたいのは3つ:
//   1. 位置情報が消えること
//   2. **長さが1バイトも変わらないこと**（stco の絶対位置がずれると
//      再生できない動画になる＝GPS を消す代わりに動画を壊す）
//   3. 消せないものは上げないこと

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** size(4) + type(4) + payload の箱を1つ作る */
function box(type: string, payload: number[] = []): number[] {
    const size = 8 + payload.length;
    return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...enc(type), ...payload];
}

/** 64bit 長の箱（size=1 + largesize(8)） */
function box64(type: string, payload: number[] = []): number[] {
    const size = 16 + payload.length;
    return [0, 0, 0, 1, ...enc(type), 0, 0, 0, 0, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...payload];
}

const XYZ = [0xa9, 0x78, 0x79, 0x7a];                       // ©xyz
/** Android/QuickTime 形式の位置（`©xyz` に "+35.6586+139.7454/"） */
const GEO_UDTA = box("udta", box("©xyz".replace("©", String.fromCharCode(0xa9)), enc("+35.6586+139.7454/")));
/** iPhone 形式（moov/meta に Apple のキー名がそのまま入る） */
const GEO_META = box("meta", [0, 0, 0, 0, ...box("keys", enc("com.apple.quicktime.location.ISO6709")), ...box("ilst", enc("+35.6586+139.7454+000.000/"))]);

const MDAT = box("mdat", new Array(64).fill(0x77));

function fileOf(bytes: number[], type = "video/mp4", name = "story.mp4"): File {
    return new File([new Uint8Array(bytes)], name, { type });
}

/** 典型的な iPhone の並び: ftyp → mdat → moov（moov が最後） */
const iphoneLike = () => [
    ...box("ftyp", enc("qt  ")),
    ...MDAT,
    ...box("moov", [...box("mvhd", new Array(8).fill(1)), ...GEO_META, ...box("trak", [...box("tkhd", new Array(8).fill(2)), ...GEO_UDTA])]),
];

describe("動画の位置情報を落とす", () => {
    it("©xyz も Apple のキーも残らない", async () => {
        const out = await toUploadSafeVideo(fileOf(iphoneLike()));
        const bytes = new Uint8Array(await out.arrayBuffer());
        expect(hasLocationMarker(bytes), "位置情報が残っている").toBe(false);
        expect(new TextDecoder().decode(bytes)).not.toContain("+35.6586");
    });

    // **ここが本命。** 縮めると stco の絶対位置がずれて再生できなくなる
    it("長さが1バイトも変わらない（オフセットをずらさない）", async () => {
        const src = iphoneLike();
        const out = await toUploadSafeVideo(fileOf(src));
        expect(out.size).toBe(src.length);
    });

    it("映像本体（mdat）はそのまま残る", async () => {
        const src = iphoneLike();
        const out = await toUploadSafeVideo(fileOf(src));
        const bytes = new Uint8Array(await out.arrayBuffer());
        const mdatAt = 12 + 8;   // ftyp(8+4) + mdat のヘッダ(8)
        expect(Array.from(bytes.slice(mdatAt, mdatAt + 64))).toEqual(new Array(64).fill(0x77));
    });

    it("消した箱は free になる（読み飛ばしてよい箱）", async () => {
        const out = await toUploadSafeVideo(fileOf(iphoneLike()));
        const text = new TextDecoder("latin1").decode(new Uint8Array(await out.arrayBuffer()));
        expect(text).toContain("free");
        expect(text).not.toContain("udta");
        expect(text).not.toContain("meta");
        // 消してよくないものは残す
        expect(text).toContain("moov");
        expect(text).toContain("trak");
        expect(text).toContain("tkhd");
        expect(text).toContain("mdat");
    });

    it("位置情報の無い動画も通る（正常系）", async () => {
        const clean = [...box("ftyp", enc("isom")), ...MDAT, ...box("moov", box("mvhd", new Array(8).fill(1)))];
        const out = await toUploadSafeVideo(fileOf(clean));
        expect(out.size).toBe(clean.length);
        expect(out.type).toBe("video/mp4");
        expect(out.name).toBe("story.mp4");
    });

    it("64bit 長の箱でも壊さない", async () => {
        const src = [...box("ftyp", enc("isom")), ...box64("moov", GEO_UDTA)];
        const out = await toUploadSafeVideo(fileOf(src));
        const bytes = new Uint8Array(await out.arrayBuffer());
        expect(out.size).toBe(src.length);
        expect(hasLocationMarker(bytes)).toBe(false);
    });

    it("mdat の中身は走査しない（偶然の一致で弾かない）", async () => {
        // 圧縮された映像データに ©xyz の4バイトが偶然並ぶことがある。
        // 全体を見て弾くと、位置情報の無い動画が上げられなくなる
        const src = [...box("ftyp", enc("isom")), ...box("mdat", [...XYZ, ...enc("+11.1+22.2/")]), ...box("moov", box("mvhd", [0, 0, 0, 0]))];
        const out = await toUploadSafeVideo(fileOf(src));
        expect(out.size).toBe(src.length);
    });
});

describe("消せないものは上げない", () => {
    it("WebM（Matroska）は断る", async () => {
        const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05];
        await expect(toUploadSafeVideo(fileOf(ebml, "video/webm", "s.webm"))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    it("空ファイルも断る", async () => {
        await expect(toUploadSafeVideo(fileOf([]))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    // uuid の箱に XMP で座標を入れる機種がある。そこは書き換えないので、
    // 書き換え後の確認で拾って断る（「消せていないのに上げる」を作らない）
    it("知らない箱に残っていたら断る", async () => {
        const src = [
            ...box("ftyp", enc("isom")),
            ...box("moov", box("uuid", [...new Array(16).fill(9), ...XYZ, ...enc("+1.0+2.0/")])),
        ];
        await expect(toUploadSafeVideo(fileOf(src))).rejects.toBeInstanceOf(UnstrippableFileError);
    });
});

// **ここは自分が入れた素通り経路。** 「消せたことを確かめてから返す」と
// 書きながら、条件次第で**原本と1バイト違わないものを返して**いた。
// どれも例外にならず、確認も走らないので、静かに公開される。
describe("素通りさせない（1周目の修正に空いていた穴）", () => {
    const geoUdta = box("udta", box(String.fromCharCode(0xa9) + "xyz", enc("+35.6586+139.7454/")));

    it("箱として端まで読み切れないファイルは断る", async () => {
        // `mdat` の宣言サイズが実体より大きい（末尾が切れている）。
        // 「読めた分だけ返す」にしていたので `ftyp` で走査が終わり、
        // そのうしろの moov には一度も触らないまま原本が返っていた
        const src = [
            ...box("ftyp", enc("isom")),
            0, 0, 0xff, 0xff, ...enc("mdat"), 1, 2, 3, 4,
            ...box("moov", geoUdta),
        ];
        await expect(toUploadSafeVideo(fileOf(src))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    // 上の「端まで読み切れない」と `moov` の確認は**別の場面に効く**。
    // ここは moov を読んだ**あと**に解釈できない尾がある場合で、
    // moov の確認だけでは通ってしまう（尾はそのままコピーされる）
    it("moov を読んだあとに解釈できない尾があれば断る", async () => {
        const xmp = enc("<x:xmpmeta><exif:GPSLatitude>35,39.5N</exif:GPSLatitude></x:xmpmeta>");
        const src = [
            ...box("ftyp", enc("isom")),
            ...box("moov", box("mvhd", [0, 0, 0, 0])),
            0, 0, 0xff, 0xff, ...enc("uuid"), ...xmp,   // 宣言サイズが実体より大きい
        ];
        await expect(toUploadSafeVideo(fileOf(src))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    it("最上位に moov が無いファイルは断る", async () => {
        const src = [...box("ftyp", enc("isom")), ...box("mdat", [...XYZ, ...enc("+35.6+139.7/")])];
        await expect(toUploadSafeVideo(fileOf(src))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    // XMP は**最上位の** `uuid` に入る。`©xyz` しか見ていなかったので
    // `exif:GPSLatitude` がそのまま通っていた
    it("最上位 uuid の XMP に座標があれば断る", async () => {
        const xmp = enc("<x:xmpmeta><exif:GPSLatitude>35,39.5N</exif:GPSLatitude></x:xmpmeta>");
        const src = [
            ...box("ftyp", enc("isom")),
            ...box("uuid", [...new Array(16).fill(1), ...xmp]),
            ...box("moov", box("mvhd", [0, 0, 0, 0])),
        ];
        await expect(toUploadSafeVideo(fileOf(src))).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    it("フラグメント MP4（moof/traf/udta）からも落とす", async () => {
        const src = [
            ...box("ftyp", enc("isom")),
            ...box("moov", box("mvhd", [0, 0, 0, 0])),
            ...box("moof", box("traf", geoUdta)),
        ];
        const out = await toUploadSafeVideo(fileOf(src));
        const bytes = new Uint8Array(await out.arrayBuffer());
        expect(out.size).toBe(src.length);
        expect(hasLocationMarker(bytes), "traf/udta の位置情報が残っている").toBe(false);
    });

    // 確認を moov 全体でやると、`stco` のバイナリに ©xyz が偶然並んだだけで
    // 弾いてしまう（300KB で約1/14,000）。位置情報の無い動画が理由も
    // 分からず上げられなくなる——mdat を見ない理由と同じ
    it("moov の中の偶然の並びでは弾かない", async () => {
        const stbl = box("stbl", box("stco", [...XYZ, ...XYZ]));
        const src = [
            ...box("ftyp", enc("isom")),
            ...box("moov", box("trak", box("mdia", box("minf", stbl)))),
        ];
        const out = await toUploadSafeVideo(fileOf(src));
        expect(out.size).toBe(src.length);
    });
});

describe("壊れた箱で暴走しない", () => {
    it("長さ0の箱で無限ループしない", () => {
        // size=0 は「最後まで」。中に入っても進めないので、そこで止まる
        const bytes = new Uint8Array([0, 0, 0, 0, ...enc("moov"), 0, 0, 0, 0, ...enc("udta")]);
        neutralizeRange(bytes, 0, 0, bytes.length);   // 返ってくれば合格
        expect(bytes.length).toBe(16);
    });

    // 前進の保証は readBox の1か所だけに持たせている。
    // 呼び出し側に「進まなければ止める」を重ねると到達しない守りになり、
    // 片方を壊しても全件緑になる（実際そうなっていた）
    it("readBox が必ず前へ進む（返すなら boxEnd > offset）", () => {
        const cases: number[][] = [
            [0, 0, 0, 0, ...enc("moov")],                      // size=0（最後まで）
            [0, 0, 0, 8, ...enc("moov")],                      // ちょうどヘッダ長
            [0, 0, 0, 1, ...enc("moov"), 0, 0, 0, 0, 0, 0, 0, 16], // 64bit 長
        ];
        for (const c of cases) {
            const bytes = new Uint8Array(c);
            const box = readBox(new DataView(bytes.buffer), 0, bytes.length);
            expect(box, `読めるはずの箱を落とした: ${c.length}バイト`).not.toBeNull();
            expect(box!.boxEnd, "前へ進まない箱を返した（呼び出し側が無限ループする）").toBeGreaterThan(0);
        }
    });

    it("ヘッダより短い長さは読まない", () => {
        const view = new DataView(new Uint8Array([0, 0, 0, 3, ...enc("moov")]).buffer);
        expect(readBox(view, 0, 8)).toBeNull();
    });

    it("親をはみ出す長さは読まない", () => {
        const view = new DataView(new Uint8Array([0, 0, 0, 99, ...enc("moov")]).buffer);
        expect(readBox(view, 0, 8)).toBeNull();
    });
});
