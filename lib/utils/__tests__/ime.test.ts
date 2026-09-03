import { describe, it, expect } from "vitest";
import { isImeKey } from "../ime";

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

    // `isComposing` を持たない環境向けの保険（変換中のキーを 229 で送る実装）
    it("keyCode 229 も true", () => {
        expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
        expect(isImeKey({ keyCode: 229 })).toBe(true);
    });

    // **正常系。確定後の Enter を止めてはいけない**
    // （「誤爆を止める代わりに正当な操作を殺す」を作らない）
    it.each([
        ["確定後の Enter", { isComposing: false, keyCode: 13 }],
        ["英語入力の Enter", { keyCode: 13 }],
        ["Escape", { isComposing: false, keyCode: 27 }],
        ["何も持たない", {}],
    ])("%s は false", (_name, e) => {
        expect(isImeKey(e)).toBe(false);
    });
});
