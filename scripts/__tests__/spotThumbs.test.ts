import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
    makeSpotThumb, sha1Of, syncSpotThumbs, thumbSizeFor, MANIFEST_PATH, SRC_DIR, THUMB_DIR, THUMB_DIR_NAME, THUMB_SHORT_SIDE,
} from "../spot-thumbs.mjs";
import { SPOT_THUMB_DIR } from "../../lib/data/spotThumbs";

/**
 * **撮影スポットの写真の小さい版を作る道具**（`scripts/spot-thumbs.mjs`・2026-10-08）。
 * 短い辺 240px・縦横比のまま・プログレッシブの JPEG。
 */

/** 単色ではなく模様のある画像（単色だと JPEG が小さくなりすぎて大きさを試せない） */
async function photoLike(width: number, height: number, opts: { orientation?: number; shift?: number } = {}): Promise<Buffer> {
    const shift = opts.shift ?? 0;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            raw[i] = (Math.round((x / width) * 255) + shift) & 255;
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
        // 作業用の一時ファイルを残さない（在るのはサムネと控えだけ）
        expect(fs.readdirSync(path.join(src, "thumb")).sort()).toEqual(["a.jpg", "b.jpg", "manifest.json"]);
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

    /** レビューの指摘（2026-10-08）: 寸法だけ見ていた頃は、同じ 3:2 の別の写真に差し替えても作り直さなかった */
    it("🔴 同じ寸法の別の写真に差し替えても作り直す（元の SHA-1 で見る）", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        await syncSpotThumbs({ srcDir: src });
        const before = fs.readFileSync(path.join(src, "thumb", "a.jpg"));
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640, { shift: 128 }));
        const check = await syncSpotThumbs({ srcDir: src, check: true });
        expect(check.stale).toEqual(["a.jpg"]);
        const r = await syncSpotThumbs({ srcDir: src });
        expect(r.created).toEqual(["a.jpg"]);
        const after = fs.readFileSync(path.join(src, "thumb", "a.jpg"));
        expect(after.equals(before)).toBe(false);
        expect(after.equals((await makeSpotThumb(path.join(src, "a.jpg"))).data)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(path.join(src, "thumb", "manifest.json"), "utf8"));
        expect(manifest).toEqual({ "a.jpg": sha1Of(path.join(src, "a.jpg")) });
    });

    it("既定の形は元の無いサムネを消し、控えからも外す", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        fs.writeFileSync(path.join(src, "b.jpg"), await photoLike(960, 640));
        await syncSpotThumbs({ srcDir: src });
        fs.rmSync(path.join(src, "b.jpg"));
        const r = await syncSpotThumbs({ srcDir: src });
        expect(r.removed).toEqual(["b.jpg"]);
        expect(fs.existsSync(path.join(src, "thumb", "b.jpg"))).toBe(false);
        expect(Object.keys(JSON.parse(fs.readFileSync(path.join(src, "thumb", "manifest.json"), "utf8")))).toEqual(["a.jpg"]);
    });

    it("作れなかった写真は、古いサムネも一時ファイルも残さない（フィードが thumbUrl を出さない）", async () => {
        const src = tmpDir();
        fs.writeFileSync(path.join(src, "a.jpg"), await photoLike(960, 640));
        await syncSpotThumbs({ srcDir: src });
        fs.writeFileSync(path.join(src, "a.jpg"), "これは JPEG ではない");
        const r = await syncSpotThumbs({ srcDir: src });
        expect(r.failed.length).toBe(1);
        expect(fs.readdirSync(path.join(src, "thumb"))).toEqual(["manifest.json"]);
        // 控えに載らないので、次の回にまた作ろうとする
        expect(JSON.parse(fs.readFileSync(path.join(src, "thumb", "manifest.json"), "utf8"))).toEqual({});
    });

    it("--check は書かずに、無い・元が変わった・元の無いサムネを数える", async () => {
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
 * **コミット済みのサムネを見張る。ただし、写真を足した・消した・差し替えた PR は落とさない。**
 *
 * このテストは本番の反映（`deploy.yml` の Run tests）でも流れる。写真の PR がサムネの道具を
 * 流し忘れても、本番のビルドが `next build` の前に揃える（`prepare-static-build.js`）ので、
 * 無い・元が変わった・元の無いサムネは**数えて出すだけ**にする（落とすと、害の無いことで
 * 本番の反映が止まる）。落とすのは、ビルドでは直らないもの——**控えの上では最新なのに
 * 寸法や形式が違う**（＝道具そのものが壊れた）ときだけ
 */
describe("コミット済みの public/images/spots/thumb/", () => {
    it("揃っていないものは数えて出すだけ。控えの上で最新のサムネは、いまの元から計算した寸法のプログレッシブ JPEG", async () => {
        expect(THUMB_DIR).toBe(path.join(SRC_DIR, "thumb"));
        const r = await syncSpotThumbs({ check: true });
        expect(r.total, "元の写真が読めていない").toBeGreaterThan(0);
        const drift = r.missing.length + r.stale.length + r.orphans.length;
        if (drift > 0) {
            console.warn(`[spot-thumbs] 揃っていないサムネ: 無い ${r.missing.length}・元が変わった ${r.stale.length}・元の無い ${r.orphans.length}`
                + "（本番のビルドが揃える。手元では node scripts/spot-thumbs.mjs）");
        }
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
        const skip = new Set<string>([...r.missing, ...r.stale, ...r.orphans]);
        const fresh = Object.keys(manifest).filter((n) => !skip.has(n));
        expect(fresh.length, "控えの上で最新のサムネが1枚も無い（控えか読み取りが壊れている）").toBeGreaterThan(0);
        for (const name of fresh) {
            const src = await sharp(path.join(SRC_DIR, name)).metadata();
            const thumb = await sharp(path.join(THUMB_DIR, name)).metadata();
            expect([thumb.width, thumb.height], name).toEqual(Object.values(thumbSizeFor(src.width!, src.height!)));
            expect(thumb.format, name).toBe("jpeg");
            expect(thumb.isProgressive, name).toBe(true);
        }
    }, 60_000);

    it("控えは public/ の外（配らない）", () => {
        expect(path.relative(path.join(SRC_DIR, "..", ".."), MANIFEST_PATH).startsWith("..")).toBe(true);
    });
});

describe("写真を置く道具も小さい版を揃える", () => {
    it("localize-spot-images.mjs が syncSpotThumbs を呼ぶ", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "localize-spot-images.mjs"), "utf8").replace(/^\s*\/\/.*$/gm, "");
        expect(src).toMatch(/import \{ syncSpotThumbs \} from "\.\/spot-thumbs\.mjs"/);
        expect(src).toMatch(/await syncSpotThumbs\(\)/);
    });
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
