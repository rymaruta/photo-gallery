import { describe, it, expect } from "vitest";

// テストが「実装」ではなく「環境」を測っていないことを固定する。
//
// 実際に踏んだ事故: api-user の presign のテストが本物の getSignedUrl を
// 呼んでいて、この環境には AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY が
// あるので**手元では通り、CI では CredentialsProviderError で落ちた**。
// 1,136件が緑だったのに本番デプロイが止まった（386eeef）。
//
// vitest.setup.ts で認証情報を消してあるので、モックを忘れたテストは
// どこでも同じ理由で落ちる。その前提が外れたらここで気づく。
describe("テスト環境に AWS の認証情報が無いこと", () => {
    it.each([
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_PROFILE",
    ])("%s が設定されていない", (key) => {
        expect(process.env[key]).toBeUndefined();
    });

    it("リージョンだけは残す（秘密ではなく、無いと別の理由で落ちるため）", () => {
        expect(process.env.AWS_REGION).toBeTruthy();
    });

    // 同じ考え方で、テーブル名も本番の名前をわざと使わない
    // （モックが外れても存在しないテーブルに当たって失敗する）。
    it("テーブル名に本番の接頭辞を使っていない", () => {
        for (const k of ["PHOTOS_TABLE", "USERS_TABLE", "UPLOAD_BUCKET"]) {
            expect(process.env[k]).toBeTruthy();
            expect(process.env[k]).not.toContain("prod-");
        }
    });
});
