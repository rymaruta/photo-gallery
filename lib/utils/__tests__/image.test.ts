import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripJpegExif, stripJpegExifDetailed, scaleDimensions, thumbFileName, toUploadSafeFile, UnstrippableFileError } from "../image";

// 合成 JPEG バイト列を組み立てるヘルパー
function segment(marker: number, payload: number[]): number[] {
    const len = payload.length + 2; // 長さフィールド自身を含む
    return [0xFF, marker, (len >> 8) & 0xFF, len & 0xFF, ...payload];
}

function buildJpeg({ withExif = true, withIptc = false } = {}): Uint8Array {
    const bytes: number[] = [0xFF, 0xD8]; // SOI
    // APP0 (JFIF) — 保持されるべき
    bytes.push(...segment(0xE0, [0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02]));
    if (withExif) {
        // APP1 (Exif) — 除去されるべき（GPS等のメタデータが入る場所）
        bytes.push(...segment(0xE1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xDE, 0xAD, 0xBE, 0xEF]));
    }
    if (withIptc) {
        // APP13 (IPTC) — 除去されるべき
        bytes.push(...segment(0xED, [0x50, 0x68, 0x6F, 0x74, 0x6F]));
    }
    // DQT — 保持されるべき
    bytes.push(...segment(0xDB, [0x00, 0x01, 0x02, 0x03]));
    // SOS + 画像データ + EOI — 全部保持されるべき
    bytes.push(0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02); // SOS ヘッダ
    bytes.push(0x11, 0x22, 0x33); // 圧縮データ
    bytes.push(0xFF, 0xD9); // EOI
    return new Uint8Array(bytes);
}

function findMarker(buf: Uint8Array, marker: number): boolean {
    for (let i = 2; i + 1 < buf.length; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === marker) return true;
        if (buf[i] === 0xFF && buf[i + 1] === 0xDA) return false; // SOS 以降は探さない
    }
    return false;
}

// `stripped` は「本当に落としたか」の申告。
// 呼び出し側（toUploadSafeFile）はこれを見て公開してよいか決めるので、
// **消せていないのに true** が一番まずい壊れ方になる。
describe("stripJpegExifDetailed: 消せたかどうかの申告", () => {
    const asFile = (b: Uint8Array) =>
        new File([b as BlobPart], "photo.jpg", { type: "image/jpeg" });

    it("落とせたら stripped = true", async () => {
        const r = await stripJpegExifDetailed(asFile(buildJpeg({ withExif: true })));
        expect(r.stripped).toBe(true);
        expect(findMarker(new Uint8Array(await r.file.arrayBuffer()), 0xE1)).toBe(false);
    });

    it("元から無い場合も stripped = true（最後まで読めているため）", async () => {
        expect((await stripJpegExifDetailed(asFile(buildJpeg({ withExif: false })))).stripped).toBe(true);
    });

    it("マーカー前の詰め物（FF FF）があっても正しく落とす", async () => {
        // JPEG は マーカーの直前に 0xFF を任意個置ける（ITU T.81 B.1.1.2）。
        // 読み飛ばさずに buf[i+1] をマーカー扱いしていた頃は、0xFF を
        // マーカー・続く2バイトを長さと読んで走査が止まり、APP1 を含む
        // 残り全部がそのまま積まれていた。しかも「新しい File」が返るので
        // 呼び出し側は同一性判定で「消せた」と誤認していた。
        const src = Array.from(buildJpeg({ withExif: true }));
        const at = src.findIndex((b, i) => b === 0xFF && src[i + 1] === 0xE1);
        src.splice(at, 0, 0xFF, 0xFF); // APP1 の直前に詰め物を2つ
        const r = await stripJpegExifDetailed(asFile(new Uint8Array(src)));
        expect(r.stripped).toBe(true);
        expect(findMarker(new Uint8Array(await r.file.arrayBuffer()), 0xE1)).toBe(false);
    });

    it("途中で構造を読めなくなったら stripped = false", async () => {
        // 長さが壊れている＝以降に何が入っているか分からない。
        // 「1つ落とせたから大丈夫」ではない——XMP を別の APP1 に置く機材では
        // 2つ目に GPS が残る。
        const src = Array.from(buildJpeg({ withExif: true }));
        const dqt = src.findIndex((b, i) => b === 0xFF && src[i + 1] === 0xDB);
        src[dqt + 2] = 0xFF; // 長さを buffer 超えにする
        src[dqt + 3] = 0xFF;
        const r = await stripJpegExifDetailed(asFile(new Uint8Array(src)));
        expect(r.stripped).toBe(false);
    });

    it("JPEG でなければ stripped = false（消せていない）", async () => {
        const png = new File([new Uint8Array([0x89, 0x50]) as BlobPart], "a.png", { type: "image/png" });
        const r = await stripJpegExifDetailed(png);
        expect(r.stripped).toBe(false);
        expect(r.file).toBe(png);
    });

    it("SOI が無い（JPEG として壊れている）なら stripped = false", async () => {
        const r = await stripJpegExifDetailed(asFile(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])));
        expect(r.stripped).toBe(false);
    });
});

describe("stripJpegExif", () => {
    it("APP1 (Exif) セグメントを除去する", async () => {
        const file = new File([buildJpeg({ withExif: true }) as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(findMarker(out, 0xE1)).toBe(false);
    });

    it("APP13 (IPTC) セグメントも除去する", async () => {
        const file = new File([buildJpeg({ withExif: true, withIptc: true }) as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(findMarker(out, 0xE1)).toBe(false);
        expect(findMarker(out, 0xED)).toBe(false);
    });

    it("APP0/DQT/SOS/画像データは保持する", async () => {
        const src = buildJpeg({ withExif: true });
        const file = new File([src as BlobPart], "photo.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        // SOI
        expect(out[0]).toBe(0xFF);
        expect(out[1]).toBe(0xD8);
        // APP0 と DQT は残る
        expect(findMarker(out, 0xE0)).toBe(true);
        expect(findMarker(out, 0xDB)).toBe(true);
        // EOI で終わる（SOS 以降のデータ保持の確認）
        expect(out[out.length - 2]).toBe(0xFF);
        expect(out[out.length - 1]).toBe(0xD9);
    });

    it("EXIF がない JPEG はサイズ以外そのまま", async () => {
        const src = buildJpeg({ withExif: false });
        const file = new File([src as BlobPart], "clean.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(out).toEqual(src);
    });

    it("JPEG 以外のファイルはそのまま返す", async () => {
        const file = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47]) as BlobPart], "img.png", { type: "image/png" });
        const result = await stripJpegExif(file);
        expect(result).toBe(file);
    });

    it("JPEG マジックナンバーがない壊れたファイルはそのまま返す", async () => {
        const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03]) as BlobPart], "broken.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        const out = new Uint8Array(await result.arrayBuffer());
        expect(out).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    });

    it("ファイル名と MIME タイプを維持する", async () => {
        const file = new File([buildJpeg() as BlobPart], "旅の写真.jpg", { type: "image/jpeg" });
        const result = await stripJpegExif(file);
        expect(result.name).toBe("旅の写真.jpg");
        expect(result.type).toBe("image/jpeg");
    });
});

describe("scaleDimensions", () => {
    it("横長画像は長辺（幅）を maxPx に合わせる", () => {
        expect(scaleDimensions(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    });

    it("縦長画像は長辺（高さ）を maxPx に合わせる", () => {
        expect(scaleDimensions(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 });
    });

    it("正方形は両辺 maxPx になる", () => {
        expect(scaleDimensions(2048, 2048, 512)).toEqual({ width: 512, height: 512 });
    });

    it("maxPx 以下の画像は拡大しない", () => {
        expect(scaleDimensions(800, 600, 1920)).toEqual({ width: 800, height: 600 });
    });

    it("サムネイルサイズ（512px）への縮小", () => {
        expect(scaleDimensions(1920, 1080, 512)).toEqual({ width: 512, height: 288 });
    });

    it("端数は四捨五入される", () => {
        const { height } = scaleDimensions(1000, 333, 512);
        expect(height).toBe(Math.round(333 * 512 / 1000));
    });
});

describe("thumbFileName", () => {
    it("拡張子を差し替えて _thumb を付ける", () => {
        expect(thumbFileName("photo.jpg", "webp")).toBe("photo_thumb.webp");
    });

    it("拡張子がない名前にも対応する", () => {
        expect(thumbFileName("photo", "webp")).toBe("photo_thumb.webp");
    });

    it("複数ドットは最後の拡張子のみ差し替える", () => {
        expect(thumbFileName("trip.2024.png", "jpg")).toBe("trip.2024_thumb.jpg");
    });

    it("日本語ファイル名も維持する", () => {
        expect(thumbFileName("旅の写真.jpeg", "webp")).toBe("旅の写真_thumb.webp");
    });
});

// アップロードの入口。「EXIF を落として公開する」という前提には抜け道があった:
//   - canvas 再エンコード（本命）は GIF・2Dコンテキスト不可・エンコード失敗で素通し
//   - 保険の stripJpegExif は JPEG 以外では何もしない
// PC の Chrome から HEIC を選ぶと圧縮が失敗して素通しになり、
// GPS 入りの原本がそのまま公開URLで配信されていた。
describe("toUploadSafeFile", () => {
    const bytes = () => new Uint8Array([1, 2, 3]) as BlobPart;

    // jsdom は画像をデコードしないので onload も onerror も鳴らない。
    // 実ブラウザでは非対応形式で onerror が鳴るので、それを再現する。
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(window.Image.prototype, "src", {
            configurable: true,
            set(this: HTMLImageElement) { queueMicrotask(() => this.onerror?.(new Event("error"))); },
        });
        window.URL.createObjectURL = () => "blob:test";
        window.URL.revokeObjectURL = () => {};
    });
    afterEach(() => { vi.useRealTimers(); });

    /**
     * **デコードは成功する**状態にする（寸法つき）。
     * 既定の stub は onerror なので「デコードできない」側。
     * canvas は jsdom に無いので、この状態＝「読めるが作り直せない」＝
     * バイト除去の保険が効くべき場面になる。
     */
    const decodesTo = (w: number, h: number) => {
        Object.defineProperty(window.Image.prototype, "src", {
            configurable: true,
            set(this: HTMLImageElement) {
                Object.defineProperty(this, "naturalWidth", { configurable: true, value: w });
                Object.defineProperty(this, "naturalHeight", { configurable: true, value: h });
                queueMicrotask(() => this.onload?.(new Event("load")));
            },
        });
    };

    it("HEIC は上げない（Chrome ではデコードできず素通しになる形式）", async () => {
        const heic = new File([bytes()], "IMG_0001.HEIC", { type: "image/heic" });
        await expect(toUploadSafeFile(heic)).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    it("GIF は上げない（圧縮を意図的に素通しするため EXIF が残る）", async () => {
        const gif = new File([bytes()], "a.gif", { type: "image/gif" });
        await expect(toUploadSafeFile(gif)).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    // **30000x30000 の JPEG（実体 5MB 程度）がそのまま上がっていた。**
    //
    // Chromium は宣言 30000x30000 の JPEG をデコードしない（実測: `<img>` が
    // onerror）→ 圧縮が失敗 → バイト除去だけ成功 → **原本が公開URLへ**。
    // サムネ・代表色・ぼかしは全部 null なので `Thumb` は原本を配り、
    // 閲覧者は毎回 5MB を落として**壊れた画像**を見る。サーバー側の `sharp` も
    // `limitInputPixels` で毎回拒否するので、サムネ生成は以後ずっと赤いまま。
    it("デコードできない JPEG は上げない（原本がそのまま出ていた）", async () => {
        // 既定の stub は onerror ＝ デコードできない
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "huge.jpg", { type: "image/jpeg" });
        await expect(toUploadSafeFile(jpeg), "原本がそのまま通っている")
            .rejects.toBeInstanceOf(UnstrippableFileError);
    });

    // **理由を持たせる。** 画面は全部「この形式は…JPEG か PNG で保存し直して
    // ください」に潰していたが、読めない／大きすぎる場合は**形式が正しい
    // JPEG** なので、言われたとおりにしても同じ結果になる（袋小路）
    it.each([
        ["形式（HEIC）", () => new File([bytes()], "a.HEIC", { type: "image/heic" }), "format"],
        ["デコードできない", () => new File([buildJpeg({ withExif: true }) as BlobPart], "a.jpg", { type: "image/jpeg" }), "undecodable"],
    ])("断る理由を持つ（%s）", async (_name, make, reason) => {
        await expect(toUploadSafeFile(make())).rejects.toMatchObject({ reason });
    });

    // サーバーの `sharp` の既定（limitInputPixels）と対。超えるとサムネ生成が
    // 毎回失敗し、そのステップが以後ずっと赤くなる。
    //
    // **この分岐に来るのは「デコードは成功するが canvas で作り直せない」場合
    // だけ。** Chromium で本物の JPEG を通して測ったところ、decode の限界は
    // 約5.36億画素（2^31 ÷ 4バイト）で、268MP〜536MP は decode に成功して
    // 圧縮も通る（上がるのは 1920px の webp なので原本は S3 に行かない）。
    // つまりここは「資源が足りない端末でだけ効く保険」で、
    // **実ブラウザで 900MP が decode 成功する状態は存在しない**。
    // それでも固定するのは、保険の側から原本が出ていく道を塞ぐため。
    it("画素数が多すぎるなら、保険の経路でも原本を上げない", async () => {
        decodesTo(30000, 30000);   // 9億画素
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "huge.jpg", { type: "image/jpeg" });
        await expect(toUploadSafeFile(jpeg)).rejects.toMatchObject({ reason: "too-many-pixels" });
    });

    // 上限は sharp と同じ「超えたら拒否」。ちょうどは通す
    it("上限ちょうどは通す（超えたら拒否）", async () => {
        decodesTo(16383, 16383);   // 268,402,689 = sharp の既定ちょうど
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "edge.jpg", { type: "image/jpeg" });
        await expect(toUploadSafeFile(jpeg)).resolves.toBeInstanceOf(File);
    });

    // 正常系: 実在のカメラの最大級（1億画素）は通す
    it("1億画素（実在するカメラの最大級）は通す", async () => {
        decodesTo(11648, 8736);   // GFX100 相当 ≒ 102MP
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "big.jpg", { type: "image/jpeg" });
        const out = await toUploadSafeFile(jpeg);
        expect(out).not.toBe(jpeg);
    });

    // **読み込みを2回していた。** 圧縮で1回・保険の前にもう1回 読み直して
    // いたので、読み込みが鳴らない端末（`IMAGE_LOAD_TIMEOUT_MS` のコメントが
    // 挙げている iOS Safari の OOM）で**待ち時間が15秒から30秒に倍増**した
    // ——実測 15,004ms → 30,004ms。断ること自体は意図どおりだが、
    // 利用者は30秒スピナーを見てから断られる。
    it("画像の読み込みは1回だけ（タイムアウトが2回分効かない）", async () => {
        let loads = 0;
        Object.defineProperty(window.Image.prototype, "src", {
            configurable: true,
            set(this: HTMLImageElement) {
                loads++;
                Object.defineProperty(this, "naturalWidth", { configurable: true, value: 4000 });
                Object.defineProperty(this, "naturalHeight", { configurable: true, value: 3000 });
                queueMicrotask(() => this.onload?.(new Event("load")));
            },
        });
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "p.jpg", { type: "image/jpeg" });
        await toUploadSafeFile(jpeg);
        expect(loads, "読み直している（待ち時間が2倍になる）").toBe(1);
    });

    it("MIME 不明のファイルも上げない", async () => {
        const unknown = new File([bytes()], "a.bin", { type: "" });
        await expect(toUploadSafeFile(unknown)).rejects.toBeInstanceOf(UnstrippableFileError);
    });

    it("JPEG は圧縮に失敗してもバイト列から EXIF を除去して通す", async () => {
        // jsdom には canvas が無いので compressImage は必ず失敗する＝保険の経路を通る。
        // **デコードは成功する状態にする**——この保険は「読めるが作り直せない」
        // ときのためのもので、読めない画像に使うと原本がそのまま上がる（下のテスト）
        decodesTo(4000, 3000);
        const jpeg = new File([buildJpeg({ withExif: true }) as BlobPart], "p.jpg", { type: "image/jpeg" });
        const out = await toUploadSafeFile(jpeg);
        expect(out).not.toBe(jpeg); // 別ファイルになっている＝除去された
        const buf = new Uint8Array(await out.arrayBuffer());
        expect(findMarker(buf, 0xE1)).toBe(false); // APP1 が無い
        expect(findMarker(buf, 0xE0)).toBe(true);  // JFIF は残る
    });

    it("エラーには形式が入る（原因が分かるように）", async () => {
        const heic = new File([bytes()], "a.heic", { type: "image/heic" });
        await expect(toUploadSafeFile(heic)).rejects.toThrow(/image\/heic/);
    });
});
