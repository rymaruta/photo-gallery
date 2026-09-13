import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { STUB_PNG, STUB_WEBP, STUB_AVIF, stubImageFor } from "../lib/smokeStubImages.mjs";

/**
 * ブラウザ・スモークが画像の要求に返す控えを縛る。
 *
 * **1x1 に戻すと本番のデプロイが落ちる。** `naturalWidth` は素の画素数では
 * なく「いま選ばれている候補の密度で割った値」なので、サムネの
 * `srcset="..._256.avif 256w" sizes="(max-width:640px) 112px, 128px"` に
 * 1x1 を返すと `1 / 2.29` が 0 に丸まり、`Thumb` の ref が
 * 「complete かつ naturalWidth === 0」を壊れた画像と読んで `<picture>` ごと
 * 消す——要求は全部 200 で返っているのに `img=0` になる（2026-09-13・run 377）。
 *
 * 見るのは**綴りではなく実際に decode した大きさ**。
 */

/** 最大の密度は `512w` を 112px の枠に出す 4.57。余裕を見て 256px 以上を要求する */
const MIN_INTRINSIC = 256;

/** `sharp` が返す format 名。AVIF は容器の名前（`heif`）で返る */
const STUBS = [
    ["png", STUB_PNG, "png"],
    ["webp", STUB_WEBP, "webp"],
    ["avif", STUB_AVIF, "heif"],
] as const;

describe("スモークの控え画像", () => {
    it.each(STUBS)("%s は宣言どおりの形式で decode できる", async (_name, buf, format) => {
        const meta = await sharp(buf as Buffer).metadata();
        expect(meta.format).toBe(format);
    });

    it.each(STUBS)("%s は密度で割っても 0 にならない大きさを持つ", async (_name, buf) => {
        const meta = await sharp(buf as Buffer).metadata();
        expect(meta.width).toBeGreaterThanOrEqual(MIN_INTRINSIC);
        expect(meta.height).toBeGreaterThanOrEqual(MIN_INTRINSIC);
    });

    it("この判定は 1x1 を通さない（検出器の自己確認）", async () => {
        const tiny = await sharp({
            create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
        }).png().toBuffer();
        const meta = await sharp(tiny).metadata();
        expect(meta.width).toBeLessThan(MIN_INTRINSIC);
    });

    it("拡張子ごとに違うバイトと content-type を返す", () => {
        const avif = stubImageFor("https://journey-photo.com/uploads/x_256.AVIF");
        const webp = stubImageFor("https://journey-photo.com/uploads/x_512.webp");
        const jpg = stubImageFor("https://journey-photo.com/uploads/x.jpg?v=1");
        expect(avif.contentType).toBe("image/avif");
        expect(avif.body).toBe(STUB_AVIF);
        expect(webp.contentType).toBe("image/webp");
        expect(webp.body).toBe(STUB_WEBP);
        expect(jpg.contentType).toBe("image/png");
        expect(jpg.body).toBe(STUB_PNG);
    });
});
