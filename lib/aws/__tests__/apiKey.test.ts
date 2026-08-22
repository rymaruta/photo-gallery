import { describe, it, expect } from "vitest";
import { isAuthorizedApiKey } from "../secrets";

// 開発用API（app/api/**）のキー検査。`apiKey !== config.uploadApiKey` の
// 直接比較だった頃は、UPLOAD_API_KEY が未設定（= 空文字）のとき、
// **`x-api-key: ""` と空文字のヘッダを送るだけで認証を通った**。
// DELETE /api/photos/<id> まで同じ形だったので、npm run dev を上げている
// マシンの写真を消せた。鍵を設定していない状態は「開いている」ではなく
// 「閉じている」に倒す。
describe("isAuthorizedApiKey", () => {
    it("設定が空なら、空文字のヘッダでも通さない（ここが穴だった）", () => {
        expect(isAuthorizedApiKey("", "")).toBe(false);
    });

    it("設定が空なら、何を送っても通さない", () => {
        expect(isAuthorizedApiKey(null, "")).toBe(false);
        expect(isAuthorizedApiKey("anything", "")).toBe(false);
    });

    it("一致すれば通す（今までの動きを壊していない）", () => {
        expect(isAuthorizedApiKey("secret-key", "secret-key")).toBe(true);
    });

    it("不一致・未送信は通さない", () => {
        expect(isAuthorizedApiKey("wrong", "secret-key")).toBe(false);
        expect(isAuthorizedApiKey(null, "secret-key")).toBe(false);
        expect(isAuthorizedApiKey("", "secret-key")).toBe(false);
    });
});
