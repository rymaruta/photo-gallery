import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { titleWithPlace } from "../titlePlace";
import { photoAltText } from "../photoAlt";
import type { Photo } from "../../data/photos";

/**
 * **同じ判断が2か所にあって、片方だけ直した。**
 *
 * `2ba4394d` で写真ページの `<title>` を「撮影地の方が題を含む回」に対応させたが、
 * 画像の `alt` は片方向のままだったので、実ビルドに
 * **`alt="オペラ・ガルニエ（オペラ・ガルニエ（パリ））"` が19回**出ていた。
 * 台帳がいちばん多く記録している型を自分でやったので、決め方を1つに寄せた。
 */
describe("題と撮影地の並べ方", () => {
    it("撮影地が無ければ題だけ", () => {
        expect(titleWithPlace("白鳥と湖", "")).toEqual({ kind: "single", text: "白鳥と湖" });
    });

    it("題が無ければ撮影地だけ", () => {
        expect(titleWithPlace("", "パリ")).toEqual({ kind: "single", text: "パリ" });
    });

    it("題が撮影地を含むなら題だけ（重ねない）", () => {
        expect(titleWithPlace("山中湖の朝", "山中湖")).toEqual({ kind: "single", text: "山中湖の朝" });
    });

    // **これが直したかったこと。** 撮影地が題を丸ごと含むので、撮影地を出せば
    // 何も失わず、括弧が入れ子にならない
    it("撮影地が題で始まるなら撮影地だけ", () => {
        expect(titleWithPlace("オペラ・ガルニエ", "オペラ・ガルニエ（パリ）"))
            .toEqual({ kind: "single", text: "オペラ・ガルニエ（パリ）" });
    });

    // 短い題がたまたま撮影地の途中に現れるだけの回は巻き込まない
    it("題が撮影地の途中に現れるだけなら両方", () => {
        expect(titleWithPlace("海", "茨城県 ひたちなか市 国営ひたち海浜公園"))
            .toEqual({ kind: "both", title: "海", place: "茨城県 ひたちなか市 国営ひたち海浜公園" });
    });

    it("前後の空白は落とす", () => {
        expect(titleWithPlace("  題  ", "  場所  ")).toEqual({ kind: "both", title: "題", place: "場所" });
    });
});

/** 配線: `alt` がこの決め方を通っていること */
describe("画像の alt", () => {
    const P = (over: Partial<Photo>) => ({ id: "p", src: "s", ...over }) as Photo;

    it("撮影地が題を含む回に、括弧を入れ子にしない", () => {
        const alt = photoAltText(P({ title: { ja: "オペラ・ガルニエ" }, location: "オペラ・ガルニエ（パリ）" }), "ja");
        expect(alt, "括弧が入れ子になっている").toBe("オペラ・ガルニエ（パリ）");
    });

    it("普通の回は今までどおり（）でつなぐ", () => {
        expect(photoAltText(P({ title: { ja: "海" }, location: "茨城県 ひたちなか市 国営ひたち海浜公園" }), "ja"))
            .toBe("海（茨城県 ひたちなか市 国営ひたち海浜公園）");
    });

    it("本人が書いた alt が最優先（並べ方に触らない）", () => {
        expect(photoAltText(P({ alt: { ja: "本人の説明" }, title: { ja: "題" }, location: "場所" }), "ja")).toBe("本人の説明");
    });

    // **決め方は1か所に置く。** ここが自前の分岐に戻ると、また片方だけずれる
    it("alt も写真ページの題も、同じ関数を通している", () => {
        for (const rel of ["lib/utils/photoAlt.ts", "app/photo/[id]/page.tsx"]) {
            const src = readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
            expect(src.includes("titleWithPlace"), `${rel} が titleWithPlace を通っていない`).toBe(true);
        }
    });
});
