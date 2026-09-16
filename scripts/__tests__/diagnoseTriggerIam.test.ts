import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { allowsAddUserToGroup, triggerIamLines, roleNameFromArn } = require("../diagnose-aws.js") as {
    allowsAddUserToGroup: (docs: unknown[], poolArn: string) => boolean;
    triggerIamLines: (a: { roleName?: string; readable?: boolean; allowed?: boolean; attachedManaged?: string[] }) => string[];
    roleNameFromArn: (arn: unknown) => string;
};

/**
 * **「新規登録した人が投稿できる」の鎖の、最後の1本。**
 *
 * トリガーが付いていて・関数が在って・Cognito が呼べても、**関数の IAM が
 * `AdminAddUserToGroup` を許していなければ中で拒否される**。しかも
 * `addToUserGroup` は「何があっても投げない」ので、**画面にも応答にも
 * ログ以外どこにも出ない**——新規登録した人だけが投稿を開けないまま残る。
 *
 * ここが「問題なし」に見えると、その状態を見逃す。だから
 * **読めなかったときは ✅ を出さない**ことまで見る。
 */
const POOL = "arn:aws:cognito-idp:ap-northeast-1:123:userpool/ap-northeast-1_AAAA";
const OTHER_POOL = "arn:aws:cognito-idp:ap-northeast-1:123:userpool/ap-northeast-1_BBBB";
const allow = (over: Record<string, unknown> = {}) => ({
    Statement: [{ Effect: "Allow", Action: "cognito-idp:AdminAddUserToGroup", Resource: POOL, ...over }],
});

describe("トリガーの関数が AdminAddUserToGroup を許されているか", () => {
    it("このプール宛ての Allow があれば true", () => {
        expect(allowsAddUserToGroup([allow()], POOL)).toBe(true);
    });

    // `serverless.yml` は配列で書く（AdminAddUserToGroup と CreateGroup）
    it("Action / Resource が配列でも読む", () => {
        expect(allowsAddUserToGroup([{
            Statement: [{
                Effect: "Allow",
                Action: ["cognito-idp:CreateGroup", "cognito-idp:AdminAddUserToGroup"],
                Resource: [OTHER_POOL, POOL],
            }],
        }], POOL)).toBe(true);
    });

    // **別のプール宛ての許可を「許されている」と読まない。** 環境を増やしたときに
    // 起きる形（本番の関数に staging のプールだけ書いてある）
    it("別のプール宛てだけなら false", () => {
        expect(allowsAddUserToGroup([allow({ Resource: OTHER_POOL })], POOL)).toBe(false);
    });

    it("Deny・別のアクション・空は false", () => {
        expect(allowsAddUserToGroup([allow({ Effect: "Deny" })], POOL)).toBe(false);
        expect(allowsAddUserToGroup([allow({ Action: "cognito-idp:CreateGroup" })], POOL)).toBe(false);
        expect(allowsAddUserToGroup([{ Statement: [] }], POOL)).toBe(false);
        expect(allowsAddUserToGroup([], POOL)).toBe(false);
        expect(allowsAddUserToGroup(undefined as unknown as unknown[], POOL)).toBe(false);
    });

    // ワイルドカードは**末尾の `*` だけ**見る（IAM の一致を完全に再実装しない）
    it("末尾のワイルドカードと全体の `*` を通す", () => {
        expect(allowsAddUserToGroup([allow({ Resource: "arn:aws:cognito-idp:ap-northeast-1:123:userpool/*" })], POOL)).toBe(true);
        expect(allowsAddUserToGroup([allow({ Resource: "*" })], POOL)).toBe(true);
        expect(allowsAddUserToGroup([allow({ Action: "cognito-idp:*" })], POOL)).toBe(true);
        expect(allowsAddUserToGroup([allow({ Action: "*" })], POOL)).toBe(true);
        // 前方一致しないワイルドカードは通さない
        expect(allowsAddUserToGroup([allow({ Resource: "arn:aws:s3:::*" })], POOL)).toBe(false);
    });

    // `Statement` が単体（配列でない）方針も実在する
    it("Statement が単体でも読む", () => {
        expect(allowsAddUserToGroup([{
            Statement: { Effect: "Allow", Action: "cognito-idp:AdminAddUserToGroup", Resource: POOL },
        }], POOL)).toBe(true);
    });
});

describe("ロール名の取り出し", () => {
    it("ARN から名前を取る", () => {
        expect(roleNameFromArn("arn:aws:iam::123:role/photo-gallery-api-prod-ap-northeast-1-lambdaRole"))
            .toBe("photo-gallery-api-prod-ap-northeast-1-lambdaRole");
    });
    // サービスロールはパス付きで返る
    it("パス付きでもパスごと返す（GetRolePolicy は名前だけを取る）", () => {
        expect(roleNameFromArn("arn:aws:iam::123:role/service-role/foo")).toBe("service-role/foo");
    });
    it("読めなければ空", () => {
        expect(roleNameFromArn(undefined)).toBe("");
        expect(roleNameFromArn("not-an-arn")).toBe("");
    });
});

describe("出る行", () => {
    it("許されていれば ✅ と「鎖は全部つながった」", () => {
        const out = triggerIamLines({ roleName: "r", readable: true, allowed: true }).join("\n");
        expect(out).toContain("✅");
        expect(out).not.toContain("❌");
    });

    // **いちばん大事。** 読めないのを「問題なし」に丸めない
    it("読めなければ「確認できていません」（✅ も ❌ も出さない）", () => {
        const out = triggerIamLines({ roleName: "r", readable: false }).join("\n");
        expect(out).toContain("確認できていません");
        expect(out).not.toContain("✅");
        expect(out).not.toContain("❌");
    });

    it("許されていなければ ❌ と、静かに壊れる旨と直し方", () => {
        const out = triggerIamLines({ roleName: "r", readable: true, allowed: false }).join("\n");
        expect(out).toContain("❌");
        expect(out).toContain("握って先へ進む");
        expect(out).toContain("再デプロイ");
        expect(out).not.toContain("✅");
    });

    it("ロールを読めなければ、そこで止める", () => {
        const out = triggerIamLines({ roleName: "", readable: false }).join("\n");
        expect(out).toContain("確認できていません");
        expect(out).not.toContain("✅");
    });
});
