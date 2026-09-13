import { describe, it, expect } from "vitest";
import { displayWhiteBalance } from "../exifDisplay";
import { readFileSync } from "node:fs";

/**
 * **日本語のラベルに英語の値が並んでいた。** 実ビルドで **25/30 の写真
 * ページ**が「ホワイトバランス: Manual」と出していた——検索の着地点。
 * `a287ee3` が同じ理由で英語の操作ラベルを日本語にしたのと同じ形。
 */
describe("ホワイトバランスの表示", () => {
    it("規格の2値を日本語にする", () => {
        expect(displayWhiteBalance("Manual")).toBe("マニュアル");
        expect(displayWhiteBalance("Auto")).toBe("オート");
    });

    it("大文字小文字と前後の空白を吸収する", () => {
        expect(displayWhiteBalance(" manual ")).toBe("マニュアル");
        expect(displayWhiteBalance("AUTO")).toBe("オート");
    });

    // **知らない値はそのまま返す。** 機種が独自の文字列を書いていた場合に、
    // こちらの都合で消さない（「分からないなら黙る」ではなく「そのまま出す」
    // ——撮影情報は事実の記録なので、落とすと嘘になる）
    it("知らない値はそのまま出す", () => {
        expect(displayWhiteBalance("Shade")).toBe("Shade");
        expect(displayWhiteBalance("白熱電球")).toBe("白熱電球");
    });

    it("空なら出さない", () => {
        expect(displayWhiteBalance(undefined)).toBeUndefined();
        expect(displayWhiteBalance("")).toBeUndefined();
        expect(displayWhiteBalance("   ")).toBeUndefined();
    });

    // 英語UIは今は到達しないが、値の言語を勝手に変えない側を固定する
    it("英語のときは触らない", () => {
        expect(displayWhiteBalance("Manual", "en")).toBe("Manual");
    });

    /**
     * **`exifr` を引き込まない。** `exif.ts` は1行目で `exifr` を静的 import
     * しているので、この関数をあちらに置くと**写真ページの初期バンドルに
     * exifr（73KB）が戻る**（`cameraName.ts` が切り出されているのと同じ理由。
     * 実際に一度そこへ書いて気づいた）。
     */
    it("置き場所が exifr を引き込まない", () => {
        const src = readFileSync("lib/utils/exifDisplay.ts", "utf-8");
        const imports = [...src.matchAll(/^import .*?from "([^"]+)"/gm)].map((m) => m[1]);
        expect(imports, "exifDisplay が何かを import している").toEqual([]);
    });
});
