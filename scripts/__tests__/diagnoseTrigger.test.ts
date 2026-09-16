import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { triggerLines } = require("../diagnose-aws.js") as {
    triggerLines: (a: { attachedArn: string; expectedName: string; fnExists?: boolean; policyAllowsCognito: boolean; policyReadable: boolean }) => string[];
};

/**
 * PostConfirmation トリガーが走る状態かを切り分ける行。本番の診断で
 * 「グループは在るのに入っていない・プロフィール行も無い」＝**トリガーが
 * 走っていない**と出たので、走らない3つの理由を1つずつ言い当てる。
 */
const NAME = "photo-gallery-api-prod-postConfirmation";
const ARN = `arn:aws:lambda:ap-northeast-1:123:function:${NAME}`;
const base = { attachedArn: ARN, expectedName: NAME, fnExists: true, policyAllowsCognito: true, policyReadable: true };

describe("PostConfirmation トリガーの診断", () => {
    it("付いていなければ、そう言い切って直し方を出す", () => {
        const out = triggerLines({ ...base, attachedArn: "" }).join("\n");
        expect(out).toContain("付いていません");
        expect(out).toContain("attach-post-confirmation");
    });
    it("別の関数を指していれば名指しする", () => {
        const out = triggerLines({ ...base, attachedArn: "arn:aws:lambda:ap-northeast-1:123:function:photo-gallery-api-staging-postConfirmation" }).join("\n");
        expect(out).toContain("期待する関数");
        expect(out).toContain("❌");
        expect(out).toContain("attach-post-confirmation");   // 付け替えの道具へ
    });
    it("関数が無ければ ❌ と直し方（デプロイ → 付け直し）", () => {
        const out = triggerLines({ ...base, fnExists: false }).join("\n");
        expect(out).toContain("存在しません");
        expect(out).toContain("attach-post-confirmation");
    });
    it("ポリシーを読めなければ「確認できていません」（問題なしに丸めない）", () => {
        const out = triggerLines({ ...base, policyReadable: false }).join("\n");
        expect(out).toContain("確認できていません");
        expect(out).not.toContain("✅");
    });
    it("Cognito から呼べなければ ❌ と直し方", () => {
        const out = triggerLines({ ...base, policyAllowsCognito: false }).join("\n");
        expect(out).toContain("InvokeFunction が許可されていません");
        expect(out).toContain("attach-post-confirmation");
    });
    it("全部揃っていれば ✅ と、残る可能性（IAM）の見方を出す", () => {
        const out = triggerLines(base).join("\n");
        expect(out).toContain("✅");
        expect(out).toContain("AdminAddUserToGroup failed");
        expect(out).not.toContain("❌");
    });
});
