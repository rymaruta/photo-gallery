import { describe, it, expect } from "vitest";
import { dedupeCameraName } from "../cameraName";

// **保存済みの機材名には、二重のメーカー名が混じっている。**
//
// `formatCameraName`（Make と Model を持っているときの結合）は正しく動くが、
// **それを使う前に保存された行**が残っていて、本番の実データに
// "Hasselblad Hasselblad X2D II 100C" が実在する（公開30枚のうち1機種）。
// 保存された値をそのまま出している所が3つあり、**訪問者が見るモーダルも
// その1つ**だった（`ModalCaption`）。
//
// 直すのは表示だけ。`/admin/edit` の入力欄には当てない——落とした値が
// 保存の差分の比較先に入り「利用者が消した」と読まれる（プロフィールの曲で
// 実際に踏んだ形）。
describe("dedupeCameraName: 二重になったメーカー名を落とす", () => {
    // 本番に実在する値
    it("実データの二重を畳む", () => {
        expect(dedupeCameraName("Hasselblad Hasselblad X2D II 100C")).toBe("Hasselblad X2D II 100C");
    });

    // **正当な値を壊さない**（こちらの方が大事。実データの残り3機種）
    it.each([
        "SONY ILCE-7M3",
        "SONY ILCE-7M5",
        "Apple iPhone 14 Pro",
    ])("%s はそのまま", (v) => {
        expect(dedupeCameraName(v)).toBe(v);
    });

    it("1語だけの機種名はそのまま", () => {
        expect(dedupeCameraName("X100V")).toBe("X100V");
    });

    // 大文字小文字が違っても同じメーカー名として畳む
    it("大文字小文字は無視して見る", () => {
        expect(dedupeCameraName("NIKON Nikon Z8")).toBe("Nikon Z8");
    });

    // 畳むのは1つぶんだけ（3連続を丸ごと潰さない）
    it("落とすのは1つぶん", () => {
        expect(dedupeCameraName("Leica Leica Leica M11")).toBe("Leica Leica M11");
    });

    // **確かめていない形は畳まない。** メーカー名が2語の "NIKON CORPORATION" は
    // 実データに無く、確かめずに広げると正当な機種名を壊す側に倒れる
    it("メーカー名が2語の形は畳まない（実データに無い・未確認）", () => {
        expect(dedupeCameraName("NIKON CORPORATION NIKON D850")).toBe("NIKON CORPORATION NIKON D850");
    });

    // 前後・連続の空白は整える（保存値に紛れることがある）
    it("空白を整える", () => {
        expect(dedupeCameraName("  Leica   Leica M11 ")).toBe("Leica M11");
    });

    it.each([undefined, "", "   "])("空なら undefined（%s）", (v) => {
        expect(dedupeCameraName(v)).toBeUndefined();
    });

    // **部分一致で畳まない。** "Sony" と "Sonyx" は別のメーカー
    it("先頭の語の一部が一致するだけでは畳まない", () => {
        expect(dedupeCameraName("Sony Sonyx 1")).toBe("Sony Sonyx 1");
    });
});
