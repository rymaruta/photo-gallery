import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { emailChangeLines } = require("../diagnose-aws.js") as {
    emailChangeLines: (a: { alias?: string[]; autoVerified?: string[]; requireVerificationBeforeUpdate?: string[] }) => string[];
};

/**
 * **メールアドレス変更を作ってよいプールかを、作る前に見る。**
 *
 * このプールは `AliasAttributes: ["email"]`＝**メールがログインID**。
 * `UpdateUserAttributes` で email を変えると `email_verified` が false に
 * 落ちるので、既定のままだと「新しいメールを確認するまでログインできない」
 * 窓が開く——**確認コードを入れる前にタブを閉じた人は締め出される**。
 *
 * ここが「問題なし」に見えると、その状態で機能を作って利用者を締め出す。
 * だから**足りないときは ✅ を出さない**ことを1つずつ見る。
 */
const OK = { alias: ["email"], autoVerified: ["email"], requireVerificationBeforeUpdate: ["email"] };

describe("メールアドレス変更の前提", () => {
    it("3つとも揃っていれば ✅（締め出されない）", () => {
        const out = emailChangeLines(OK).join("\n");
        expect(out).toContain("✅");
        expect(out).toContain("古いメールが生きる");
        expect(out).not.toContain("❌");
    });

    // **確認コードが送られない＝変更を完了させる手段が無い**
    it("AutoVerifiedAttributes に email が無ければ ❌（✅ を出さない）", () => {
        const out = emailChangeLines({ ...OK, autoVerified: [] }).join("\n");
        expect(out).toContain("❌");
        expect(out).toContain("確認コードが送られない");
        expect(out).not.toContain("✅");
    });

    // **この差分のいちばんの目的。** ここが抜けたまま作ると人が締め出される
    it("AttributesRequireVerificationBeforeUpdate に email が無ければ ❌ と、締め出される旨", () => {
        const out = emailChangeLines({ ...OK, requireVerificationBeforeUpdate: [] }).join("\n");
        expect(out).toContain("❌");
        expect(out).toContain("締め出される");
        expect(out).toContain("update-user-pool");
        expect(out).not.toContain("✅");
    });

    // `update-user-pool` は渡さない項目を既定値に戻す。直し方に書いておかないと
    // 「トリガーは付いたが MFA が消えた」を作る（`attach-post-confirmation` の教訓）
    it("直し方に「渡さない項目は既定値に戻る」の注意を添える", () => {
        expect(emailChangeLines({ ...OK, requireVerificationBeforeUpdate: [] }).join("\n"))
            .toContain("渡さない項目を既定値に戻す");
    });

    // メールがログインIDでなければ、変更中もログインできる＝締め出しの話は出さない
    it("メールがログインIDでなければ、締め出しの話はしない", () => {
        const out = emailChangeLines({ alias: [], autoVerified: ["email"], requireVerificationBeforeUpdate: [] }).join("\n");
        expect(out).toContain("メールがログインIDか（AliasAttributes に email）: いいえ");
        expect(out).not.toContain("締め出される");
        // ただし確認前の更新を許す設定自体は足りないので ❌ のまま
        expect(out).toContain("❌");
    });

    // 未設定（undefined）を「空の配列」と同じに扱う。null 落ちで ✅ にしない
    it("項目が無い（undefined）プールでも ✅ にしない", () => {
        const out = emailChangeLines({}).join("\n");
        expect(out).toContain("❌");
        expect(out).not.toContain("✅");
    });
});
