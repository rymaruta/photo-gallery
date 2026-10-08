import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
    makeSpotThumb, syncSpotThumbs, thumbSizeFor, SRC_DIR, THUMB_DIR, THUMB_DIR_NAME, THUMB_SHORT_SIDE,
} from "../spot-thumbs.mjs";
import { SPOT_THUMB_DIR } from "../../lib/data/spotThumbs";

/**
 * **撮影スポットの写真の小さい版を作る道具**（`scripts/spot-thumbs.mjs`・2026-10-08）。
 * 短い辺 240px・縦横比のまま・プログレッシブの JPEG。
 */

/** 単色ではなく模様のある画像（単色だと JPEG が小さくなりすぎて大きさを試せない） */
async function photoLike(width: number, height: number, opts: { orientation?: number } = {}): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            raw[i] = Math.round((x / width) * 255);
            raw[i + 1] = Math.round((y / height) * 255);
            raw[i + 2] = Math.round(127 + 100 * Math.sin(x / 23) * Math.cos(y / 17));
        }
    }
    let img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 });
    if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
    return img.toBuffer();
}

const tmpDirs: string[] = [];
function tmpDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "spot-thumbs-gen-"));
    tmpDirs.push(d);
    return d;
}
afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("寸法の決め方", () => {
    it("短い辺を 240 に、長い辺は縦横比のまま", () => {
        expect(thumbSizeFor(960, 640)).toEqual({ width: 360, height: 240 });
        expect(thumbSizeFor(640, 960)).toEqual({ width: 240, height: 360 });
        expect(thumbSizeFor(960, 960)).toEqual({ width: 240, height: 240 });
        expect(thumbSizeFor(960, 541)).toEqual({ width: 426, height: 240 });
    });
    it("元が小さければ引き伸ばさない", () => {
        expect(thumbSizeFor(300, 200)).toEqual({ width: 300, height: 200 });
        expect(thumbSizeFor(240, 400)).toEqual({ width: 240, height: 400 });
    });
    it("置き場の名前がフィードの側と同じ", () => {
        expect(THUMB_DIR_NAME).toBe(SPOT_THUMB_DIR);
        expect(THUMB_SHORT_SIDE).toBe(240);
    });
});

describe("1枚作る", () => {
    it("横長 960×640 → 360×240 のプログレッシブ JPEG・20KB 以下", async () => {
        const out = await makeSpotThumb(await photoLike(960, 640));
        const meta = await sharp(out.data).metadata();
        expect([meta.width, meta.height]).toEqual([360, 240]);
        expect([out.width, out.height]).toEqual([360, 240]);
        expect(meta.format).toBe("jpeg");
        expect(meta.isProgressive).toBe(true);
        expect(out.data.length).toBeLessThan(20_000);
        expect(out.data.length).toBeGreaterThan(1_000);
    });

    it("縦長 640×960 → 240×360（切り抜かない）", async () => {
        const meta = await sharp((await makeSpotThumb(await photoLike(640, 960))).data).metadata();
        expect([meta.width, meta.height]).toEqual([240, 360]);
    });

    it("EXIF の向きを直してから縮める（向き 6 = 90° 回転）", async () => {
        const meta = await sharp((await makeSpotThumb(await photoLike(960, 640, { orientation: 6 }))).data).metadata();
        expect([meta.width, meta.height]).toEqual([240, 360]);
        expect(meta.orientation ?? 1).toBe(1);
    });

    it("小さい元はそのままの寸法", async () => {
        const meta = await sharp((await makeSpotThumb(await photoLike(200, 120))).data).metadata();
        expect([meta.width, meta.height]).toEqual([200, 120]);
    });
});

describe("置き場を揃える", () => {
    it("無いものだけ作り、2回目は何もしない", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        fs.writeFileSync(path.join(src, "b.jpg"), await photoLike(640, 960));
        const r1 = await syncSpotThumbs({ srcDir: src });
        expect(r1.created.sort()).toEqual(["a.jpg", "b.jpg"]);
        expect(r1.failed).toEqual([]);
        const meta = await sharp(path.join(src, "thumb", "b.jpg")).metadata();
        expect([meta.width, meta.height]).toEqual([240, 360]);
        // 作業用の一時ファイルを残さない
        expect(fs.readdirSync(path.join(src, "thumb")).sort()).toEqual(["a.jpg", "b.jpg"]);
        const r2 = await syncSpotThumbs({ srcDir: src });
        expect(r2.created).toEqual([]);
    });

    it("元を差し替えて縦横が変わったら作り直す", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        await syncSpotThumbs({ srcDir: src });
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(640, 960));
        const r = await syncSpotThumbs({ srcDir: src });
        expect(r.created).toEqual(["a.jpg"]);
        const meta = await sharp(path.join(src, "thumb", "a.jpg")).metadata();
        expect([meta.width, meta.height]).toEqual([240, 360]);
    });

    it("--check は書かずに、無い・形違い・元の無いサムネを数える", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        fs.writeFileSync(path.join(src, "b.jpg"), await photoLike(960, 640));
        fs.mkdirSync(path.join(src, "thumb"));
        fs.writeFileSync(path.join(src, "thumb", "b.jpg"), await photoLike(100, 100));
        fs.writeFileSync(path.join(src, "thumb", "gone.jpg"), await photoLike(100, 100));
        const r = await syncSpotThumbs({ srcDir: src, check: true });
        expect(r.missing).toEqual(["a.jpg"]);
        expect(r.stale).toEqual(["b.jpg"]);
        expect(r.orphans).toEqual(["gone.jpg"]);
        expect(r.created).toEqual([]);
        expect(fs.existsSync(path.join(src, "thumb", "a.jpg"))).toBe(false);
    });
});

/**
 * **コミット済みのサムネを見張る。** 元を差し替えた・消したのに作り直していない、を拾う。
 * 無いサムネはここでは落とさない——本番のビルドが `next build` の前に作る
 * （`scripts/prepare-static-build.js`）。無いぶんはフィードが `thumbUrl` を出さないだけ
 */
describe("コミット済みの public/images/spots/thumb/", () => {
    it("元の無いサムネが無く、在るものは全部いまの元から計算した寸法", async () => {
        expect(THUMB_DIR).toBe(path.join(SRC_DIR, "thumb"));
        const r = await syncSpotThumbs({ check: true });
        expect(r.total, "元の写真が読めていない").toBeGreaterThan(0);
        expect(r.orphans, "元の無いサムネ（元を消したら一緒に消す）").toEqual([]);
        expect(r.stale, "元と縦横の合わないサムネ（node scripts/spot-thumbs.mjs で作り直す）").toEqual([]);
        expect(r.failed).toEqual([]);
    }, 60_000);
});

describe("本番のビルドが作る", () => {
    it("prepare-static-build.js が next build より前に spot-thumbs.mjs を流す", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "prepare-static-build.js"), "utf8");
        const thumbs = src.indexOf('"spot-thumbs.mjs"');
        const build = src.indexOf('execSync("npx next build"');
        expect(thumbs).toBeGreaterThan(0);
        expect(build).toBeGreaterThan(thumbs);
    });
});
