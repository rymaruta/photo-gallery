import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 退会者の伏せ字（`api-user/src/notify.ts` の `deletedAmong`）は users テーブルを
// **BatchGetItem** で引く。テストのモックは IAM を見ないので、権限が無くても単体テストは
// 緑のまま、本番では AccessDenied → **全員が読めない**扱いになる。名前を写して持つ4つ
// （コメント・通知・ストーリーの返信・閲覧者）は全員を「退会したユーザー」に伏せ、
// フォロー・フォロワー・ブロックの一覧は全員を生きている扱いにする（名前は引き直すので
// 漏れないが、退会者の印も付かない）。呼ぶ関数が乗る2つのロールに権限があることをここで固定する:
//   - provider の共有ロール（getNotifications・getUserFollowing/Followers・listBlocks・
//     getStoryViewers・getStoryReplies）
//   - PublicReadRole（未認証の getComments）
//
// **YAML パーサは使わない**（`publicLambdaRole.test.ts` と同じ理由）。
const yml = readFileSync(join(__dirname, "..", "..", "api-user", "serverless.yml"), "utf8");
const USERS = "table/${param:usersTable}";

/** `- Effect:` ごとに切った文（コメント行を除く） */
const statements = (block: string): string[] =>
    block.replace(/^\s*#.*$/gm, "").split(/\n\s*- Effect:/).slice(1);

const grantsBatchGetOnUsers = (block: string) =>
    statements(block).some((st) => st.includes("dynamodb:BatchGetItem") && st.includes(USERS));

describe("退会者の伏せ字に要る権限（users テーブルの BatchGetItem）", () => {
    it("provider の共有ロール", () => {
        const provider = yml.split(/\nprovider:\n/)[1].split(/\n(?=[a-zA-Z])/)[0];
        expect(grantsBatchGetOnUsers(provider)).toBe(true);
    });

    it("PublicReadRole（未認証の getComments）", () => {
        const res = yml.split(/\nresources:\n/)[1];
        const m = /^ {4}PublicReadRole:$([\s\S]*?)(?=^ {4}\w+:$|(?![\s\S]))/m.exec(res);
        expect(m, "PublicReadRole が見つからない").not.toBeNull();
        expect(grantsBatchGetOnUsers(m![1])).toBe(true);
    });

    it("getComments は PublicReadRole で動く（上の権限が効く相手）", () => {
        const fn = yml.split(/\n {2}getComments:\n/)[1]?.split(/\n(?= {2}\w+:\n)/)[0] ?? "";
        expect(fn).toMatch(/role:\s*PublicReadRole/);
    });
});
