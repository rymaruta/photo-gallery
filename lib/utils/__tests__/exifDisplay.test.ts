import { describe, it, expect } from "vitest";
import { displayWhiteBalance, exifSettingsLine, exifGearLine } from "../exifDisplay";
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

describe("v2 の撮影情報の1行", () => {
    it("「24mm · f/8 · 1/125 s · ISO 100」（板の書き方）", () => {
        expect(exifSettingsLine({ focalLength: "24mm", aperture: "f/8", exposure: "1/125s", iso: 100 }))
            .toBe("24mm · f/8 · 1/125 s · ISO 100");
    });
    it("アプリの書き方（f/ も s も無い）も同じ形にする", () => {
        expect(exifSettingsLine({ aperture: "8", exposure: "1/125", iso: "100" })).toBe("f/8 · 1/125 s · ISO 100");
    });
    it("持っているものだけを繋ぐ（区切りだけ残さない）・ISO 0 は出さない", () => {
        expect(exifSettingsLine({ exposure: "2s", iso: 0 })).toBe("2 s");
        expect(exifSettingsLine({})).toBeUndefined();
        expect(exifSettingsLine(undefined)).toBeUndefined();
    });
    it("機材の1行は 機種 · レンズ", () => {
        expect(exifGearLine({ camera: "Hasselblad X2D II 100C", lens: "XCD 35-100E" }))
            .toBe("Hasselblad X2D II 100C · XCD 35-100E");
        expect(exifGearLine({ camera: "SONY ILCE-7M3" })).toBe("SONY ILCE-7M3");
        expect(exifGearLine({ lens: " " })).toBeUndefined();
    });
});
