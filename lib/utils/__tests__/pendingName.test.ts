import { describe, it, expect } from "vitest";
import { pendingNameKey } from "../pendingName";

// 新規登録で入力した表示名を、確認〜初回ログインまで端末に控えるキー。
//
// 以前は端末で1つの `jp_pending_displayName` だった。登録を途中でやめた人の
// 表示名がそのまま残り、次にその端末でログインした**別人**のプロフィールに
// 付いていた（共有のiPadなど）。付けられた本人にはどこから来た名前なのか
// 分からない。
describe("pendingNameKey", () => {
    it("メールアドレスごとに別のキーになる", () => {
        expect(pendingNameKey("a@example.com")).not.toBe(pendingNameKey("b@example.com"));
    });

    it("端末で共有される裸のキーは使わない", () => {
        expect(pendingNameKey("a@example.com")).not.toBe("jp_pending_displayName");
        expect(pendingNameKey("a@example.com")).toContain("a@example.com");
    });

    it("大文字小文字のゆれで別扱いにしない", () => {
        // Cognito のメールエイリアスは大文字小文字を区別しないので、
        // 「Taro@Example.com で登録 → taro@example.com でログイン」が成立する。
        // 生の入力をキーにすると、その場合だけ控えた名前が拾えず黙って消える。
        expect(pendingNameKey("Taro@Example.com")).toBe(pendingNameKey("taro@example.com"));
    });

    it("前後の空白で別扱いにしない", () => {
        expect(pendingNameKey("  a@example.com  ")).toBe(pendingNameKey("a@example.com"));
    });
});
