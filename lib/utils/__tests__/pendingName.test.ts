import { describe, it, expect } from "vitest";
import { pendingNameKey, pendingVerifyKey } from "../pendingName";

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

// 確認コードの再送に必要な「控えたユーザー名（UUID）」のキー。
// 上と同じ正規化が要る。揃っていなかった頃は、大文字入りのメールで
// 登録した人が確認前にタブを閉じると、再送も再登録もできない
// 行き止まりに入っていた（UUID は端末にあるのに読めない）。
describe("pendingVerifyKey", () => {
    it("大文字小文字のゆれで別扱いにしない", () => {
        expect(pendingVerifyKey("Taro@Example.com")).toBe(pendingVerifyKey("taro@example.com"));
    });

    it("前後の空白で別扱いにしない", () => {
        expect(pendingVerifyKey("  a@example.com  ")).toBe(pendingVerifyKey("a@example.com"));
    });

    it("メールアドレスごとに別のキーになる", () => {
        expect(pendingVerifyKey("a@example.com")).not.toBe(pendingVerifyKey("b@example.com"));
    });

    it("表示名のキーとは別物（互いに上書きしない）", () => {
        expect(pendingVerifyKey("a@example.com")).not.toBe(pendingNameKey("a@example.com"));
    });

    it("既存データを読めるように接頭辞は変えない", () => {
        // 接頭辞を変えると、確認待ちの人が端末に控えた UUID を全員失う。
        expect(pendingVerifyKey("a@example.com")).toBe("jp_verify_a@example.com");
    });
});

// 登録から再送までを、大文字入りのメールで通しで見る。
// キーを直接組んでいた頃はここが繋がっていなかった。
describe("登録 → 別の綴りでログイン → 再送", () => {
    it("控えた UUID が、小文字で来た画面から拾える", () => {
        const store = new Map<string, string>();
        // 登録画面で入力したのは大文字入り
        store.set(pendingVerifyKey("Taro@Example.com"), JSON.stringify({ username: "uuid-1", t: Date.now() }));
        // ログイン失敗から /signup?email=taro%40example.com に飛んできた
        expect(store.get(pendingVerifyKey("taro@example.com"))).toContain("uuid-1");
    });
});
