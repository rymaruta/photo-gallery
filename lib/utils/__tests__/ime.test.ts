import { describe, it, expect } from "vitest";
import { isImeKey } from "../ime";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **変換確定の Enter は、ページには普通の Enter として届く。**
// Chromium（CDP の `Input.imeSetComposition`）で実測した形:
//   変換中の確定 Enter … keydown key="Enter" keyCode=13 isComposing=true
//   確定後の Enter     … keydown key="Enter" keyCode=13 isComposing=false
// つまり `e.key === "Enter"` だけ見るコードは、「きょう」を「今日」に
// 変換した瞬間にも動く。日本語で入力する人は必ず踏む。
describe("isImeKey", () => {
    it("変換中は true", () => {
        expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true);
    });

    // **Safari（mac / iOS）の本命。** 確定の Enter は compositionend のあとに
    // isComposing=false・keyCode=229 で届く。ここを消すと Safari で変換確定と同時に送信される
    it("keyCode 229 も true（Safari の確定の Enter）", () => {
        expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
    });

    // **正常系。確定後の Enter を止めてはいけない**
    // （「誤爆を止める代わりに正当な操作を殺す」を作らない）
    it.each([
        ["確定後の Enter", { isComposing: false, keyCode: 13 }],
        ["Escape", { isComposing: false, keyCode: 27 }],
        ["Ctrl+Enter（IME は消費しないキー）", { isComposing: false, keyCode: 13 }],
    ])("%s は false", (_name, e) => {
        expect(isImeKey(e)).toBe(false);
    });
});

// **引数はネイティブのイベントに限る。**
// `e.nativeEvent` の付け忘れが、いちばん起きやすい書き間違い。
// 型を `{ isComposing: boolean; keyCode: number }`（どちらも必須）にすると、
// React の合成イベント（`isComposing` を持たない）は `tsc` が止める
// ——実測: `isImeKey(e)` に変えると
//   error TS2345: Property 'isComposing' is missing in type
//     'KeyboardEvent<HTMLTextAreaElement>'
// が出る。以前は両方 optional だったので**構造的に適合して素通り**し、
// その状態のガードは `keyCode 229` しか見ない＝実質無効だった。
describe("型がネイティブのイベントを要求する", () => {
    it("isComposing と keyCode の両方を必須にしている", () => {
        const src = readFileSync(join(__dirname, "..", "ime.ts"), "utf8");
        expect(src, "optional に戻すと e.nativeEvent の付け忘れを tsc が止められない")
            .toMatch(/isComposing:\s*boolean;\s*keyCode:\s*number/);
    });
});
