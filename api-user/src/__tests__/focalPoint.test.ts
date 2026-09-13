import { describe, it, expect } from "vitest";
import { sanitizeFocalPoint } from "../sanitize";
import { sanitizeFocalPoint as adminSanitizeFocalPoint } from "../../../api/src/sanitize";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 一覧での切り抜き位置（`focalPoint`）。
 *
 * **読む側は前からこれを見ていたのに、書く口がどこにも無かった。**
 * `GalleryGrid` / `ModalImage` / 写真ページが `object-position` に使うのに、
 * `api-user` も `api` も `scripts` も一度も保存していなかった（grep で 0 件）
 * ＝実質いつでも中央。owner の「固定ではなくユーザが任意にずらせるといいね」。
 */
describe("切り抜き位置のサニタイズ", () => {
    it("0〜1 の範囲は通す", () => {
        expect(sanitizeFocalPoint({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
        expect(sanitizeFocalPoint({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    });

    // **丸めない。** 丸めると、こちらの想定していない単位（%・px）で
    // 送られたときに「端に貼り付いた位置」が保存され、利用者には
    // 「ずらしたのに端に飛ぶ」としか見えない。捨てれば中央のまま
    it.each([
        [{ x: -0.1, y: 0.5 }],
        [{ x: 1.1, y: 0.5 }],
        [{ x: 0.5, y: -0.01 }],
        [{ x: 0.5, y: 50 }],        // % で送られた
        [{ x: 200, y: 300 }],       // px で送られた
    ])("範囲の外は捨てる（丸めない）: %j", (fp) => {
        expect(sanitizeFocalPoint(fp)).toBeNull();
    });

    it.each([
        [null], [undefined], ["0.5,0.5"], [{ x: "0.5", y: "0.5" }], [{ x: 0.5 }],
        [{ x: NaN, y: 0.5 }], [{ x: Infinity, y: 0.5 }], [[0.5, 0.5]],
    ])("形が違えば捨てる: %j", (fp) => {
        expect(sanitizeFocalPoint(fp)).toBeNull();
    });

    // `object-position` は % で使うので、それ以上の桁は表示に効かないうえ
    // 静的JSON（`photos.json` は全ページに載る）を太らせる
    it("小数第4位まで", () => {
        expect(sanitizeFocalPoint({ x: 0.123456789, y: 0.987654321 })).toEqual({ x: 0.1235, y: 0.9877 });
    });

    // **api と api-user は別々にデプロイされる。** 片方だけ直すと、
    // 同じ `PUT /photos/{id}` でも通る API によって保存されるものが変わる
    // （実際にそうなっていた、と `sanitize.ts` の冒頭が書いている）
    it("api 側の実装と同じ判定になる", () => {
        for (const fp of [
            { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: 1, y: 1 },
            { x: -1, y: 0.5 }, { x: 0.5, y: 2 }, { x: 0.123456789, y: 0.5 },
            null, "x", { x: "0.5", y: 0.5 },
        ]) {
            expect(adminSanitizeFocalPoint(fp), `食い違い: ${JSON.stringify(fp)}`)
                .toEqual(sanitizeFocalPoint(fp));
        }
    });
});

describe("保存の配線", () => {
    const read = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8");

    // **`META_KEYS` に足し忘れると 400「更新項目がありません」で断られる。**
    // 切り抜き位置だけを直す保存は、本文に入っていても「何も送られていない」
    // と見なされる——画面からは「保存できない」としか見えない
    it("photoUpdate の META_KEYS に focalPoint が入っている", () => {
        const src = read("api-user/src/photoUpdate.ts");
        const line = /const META_KEYS = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
        expect(line, "focalPoint だけの保存が 400 になる").toContain("focalPoint");
    });

    it("photoUpdate が focalPoint を applyMeta に通している", () => {
        expect(read("api-user/src/photoUpdate.ts")).toContain('applyMeta("focalPoint"');
    });

    it("savePhoto（アップロード）も保存する", () => {
        expect(read("api-user/src/upload.ts")).toContain("sanitizeFocalPoint(body.focalPoint)");
    });

    // **静的サイトへ流れないと、一覧（`photos.json` から作る）に効かない。**
    // `sync-photos-from-ddb.js` は「落とすものを並べる」形（denylist）なので
    // 自動で流れる。ここが allowlist に変わったら落ちる
    it("静的データへ流れる（落とす項目に入っていない）", () => {
        const src = read("scripts/sync-photos-from-ddb.js");
        const line = /const PRIVATE_FIELDS = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
        expect(line, "PRIVATE_FIELDS を読めなかった").not.toBe("");
        expect(line).not.toContain("focalPoint");
    });
});
