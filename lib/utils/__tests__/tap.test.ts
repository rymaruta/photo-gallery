import { describe, it, expect } from "vitest";
import { movedBeyondTap, wasShortTap, TAP_MOVE_TOLERANCE_PX, LONG_PRESS_MS } from "../tap";

/**
 * 「タップ」と「なぞった」の見分け。
 *
 * **数を2か所に書かない。** ストーリーの閲覧（送り・一時停止）と
 * 下書きの文字の置き方が同じ判断をする。ずれると、片方では「なぞった」が
 * もう片方では「タップ」になる。
 */
const at = (x: number, y: number, t = 1000) => ({ t, x, y });

describe("movedBeyondTap", () => {
    // 指は静止していても数 px 揺れる。それで動かしたことにしない
    it("しきい値までは動いたことにしない", () => {
        expect(movedBeyondTap(at(100, 100), 100, 100)).toBe(false);
        expect(movedBeyondTap(at(100, 100), 100 + TAP_MOVE_TOLERANCE_PX, 100)).toBe(false);
    });

    it("しきい値を超えたら動いたことにする", () => {
        expect(movedBeyondTap(at(100, 100), 100 + TAP_MOVE_TOLERANCE_PX + 1, 100)).toBe(true);
        expect(movedBeyondTap(at(100, 100), 100, 100 - TAP_MOVE_TOLERANCE_PX - 1)).toBe(true);
    });

    // **斜めも同じ距離で見る**（縦横だけで見ると、斜めのなぞりを取り逃がす）
    it("斜めも距離で見る", () => {
        const d = TAP_MOVE_TOLERANCE_PX;
        expect(movedBeyondTap(at(0, 0), d, d), "斜めの移動を取り逃がしている").toBe(true);
    });
});

describe("wasShortTap", () => {
    it("短く押して動かなければタップ", () => {
        expect(wasShortTap(at(10, 10, 0), 10, 10, 100)).toBe(true);
    });

    it("長く押したらタップではない", () => {
        expect(wasShortTap(at(10, 10, 0), 10, 10, LONG_PRESS_MS)).toBe(false);
    });

    it("動いたらタップではない", () => {
        expect(wasShortTap(at(10, 10, 0), 100, 10, 100)).toBe(false);
    });

    // **押し始めが取れない環境では従来どおり動かす**（何もできなくしない）
    it("押し始めが分からなければタップとして扱う", () => {
        expect(wasShortTap(null, 10, 10)).toBe(true);
    });
});
