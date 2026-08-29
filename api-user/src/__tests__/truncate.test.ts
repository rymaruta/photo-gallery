import { describe, it, expect } from "vitest";
import { truncate, sanitizeText, sanitizeTags, sanitizeTitle } from "../sanitize";

// `slice(0, max)` は UTF-16 のコードユニットで切るので、末尾が絵文字だと
// その半分（上位サロゲート）だけが残る。UTF-8 に落とした時点で
// **U+FFFD（`�`）** に確定するので、静的HTMLにもAPIの応答にも `あああ�` が出る。
// 一度保存すると本人が末尾を消すまで直らない（保存し直しても同じ位置で切られる）。
//
// さらに、孤立サロゲートは `encodeURIComponent` が `URIError` で投げる。
// タグや撮影地でそれが起きると、集約ページの generateMetadata が落ちて
// **静的ビルドが丸ごと止まる**。

/** UTF-8 に落として戻したときに壊れていないか（配信されるのはこの形） */
const survivesUtf8 = (s: string) => Buffer.from(s, "utf8").toString("utf8") === s;

describe("truncate: サロゲートペアを割らない", () => {
    it("末尾の絵文字が半分だけ残らない", () => {
        const input = "あ".repeat(199) + "👍";   // 見た目200・コードユニット201
        const out = truncate(input, 200);
        expect(out.length).toBe(199);
        expect(out.endsWith("あ")).toBe(true);
        expect(survivesUtf8(out)).toBe(true);
    });

    it("ちょうど収まる絵文字は落とさない", () => {
        const input = "あ".repeat(198) + "👍";   // コードユニット200
        expect(truncate(input, 200)).toBe(input);
    });

    // **切り口が普通の文字なら1文字も削らない。** 「末尾が上位サロゲートか」
    // を見ずに常に1つ削る実装でも、上の3本は通ってしまう（どれも切り口が
    // 絵文字か、短くて早期 return する）。
    it("切り口が普通の文字なら、ちょうど上限まで残す", () => {
        const out = truncate("あ".repeat(210), 200);
        expect(out.length).toBe(200);
        expect(out).toBe("あ".repeat(200));
    });

    it("上限より短ければそのまま", () => {
        expect(truncate("こんにちは👋", 100)).toBe("こんにちは👋");
    });

    it("切ったあとも URL に載せられる（ビルドを落とさない）", () => {
        const input = "旅".repeat(49) + "😊";
        expect(() => encodeURIComponent(truncate(input, 50))).not.toThrow();
        // 直さないとこうなる、を並べて示す
        expect(() => encodeURIComponent(input.slice(0, 50))).toThrow(URIError);
    });

    it("絵文字だけの文字列でも壊れない", () => {
        const out = truncate("😀".repeat(10), 5);   // 5 は2で割り切れない
        expect(out.length).toBe(4);
        expect(survivesUtf8(out)).toBe(true);
    });
});

// 実際に保存に使う入口も通す（helper だけ直して呼び出し側が古いまま、を防ぐ）
describe("保存の入口も壊れた半分を残さない", () => {
    it("sanitizeText", () => {
        const out = sanitizeText("あ".repeat(199) + "👍", 200)!;
        expect(survivesUtf8(out)).toBe(true);
    });

    it("sanitizeTags（タグは50文字）", () => {
        const out = sanitizeTags(["旅".repeat(49) + "😊"])!;
        expect(survivesUtf8(out[0])).toBe(true);
        expect(() => encodeURIComponent(out[0])).not.toThrow();
    });

    it("sanitizeTitle（ja/en の両方）", () => {
        const out = sanitizeTitle({ ja: "あ".repeat(199) + "👍", en: "a".repeat(199) + "👍" });
        expect(survivesUtf8((out as { ja: string }).ja)).toBe(true);
        expect(survivesUtf8((out as { en: string }).en)).toBe(true);
    });
});
