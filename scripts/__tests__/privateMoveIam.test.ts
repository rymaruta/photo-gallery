import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **絞った写真を `private/` へ移すのに要る権限。**
 *
 * `s3Move.ts` の CopyObject は「元の読み取り」と「先の書き込み」の両方が要る。
 * 2026-09-28 まで `s3:GetObject` がどこにも無く、`private/*` への権限も無かった
 * ——テストは S3 を作り物にしているので全部通り、**本番では移動が必ず
 * AccessDenied**（公開範囲をあとから変えると 500）だった。
 * `serverless.yml` は型もテストも見ないので、ここで文面を固定する。
 */
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** `- Effect: Allow` の塊ごとに、Action と Resource を取り出す（共通ロールの statements） */
function statements(yml: string): { actions: string[]; resources: string[] }[] {
    const roleStart = yml.indexOf("  iam:\n    role:\n      statements:");
    const body = yml.slice(roleStart, yml.indexOf("\nfunctions:", roleStart));
    return body.split(/\n\s*- Effect: Allow/).slice(1).map((chunk) => ({
        actions: [...chunk.matchAll(/-\s*(s3:\w+)/g)].map((m) => m[1]),
        resources: [...chunk.matchAll(/arn:aws:s3:::\$\{param:uploadBucket\}\/([\w*/]+)/g)].map((m) => m[1]),
    }));
}
const allows = (yml: string, action: string, resource: string) =>
    statements(yml).some((s) => s.actions.includes(action) && s.resources.includes(resource));

describe("api-user: 絞った写真を移す権限", () => {
    const yml = read("api-user/serverless.yml");
    it.each([
        ["s3:GetObject", "uploads/*"],
        ["s3:GetObject", "private/*"],
        ["s3:PutObject", "private/*"],
        ["s3:DeleteObject", "private/*"],
    ])("%s を %s に持つ", (action, resource) => {
        expect(allows(yml, action, resource), `${action} ${resource} が無い＝本番で移動が AccessDenied`).toBe(true);
    });

    it("profiles/* を読む権限は足していない（要らない権限は漏らせない）", () => {
        expect(allows(yml, "s3:GetObject", "profiles/*")).toBe(false);
    });
});

describe("api（管理）: private/ に移った写真を消す権限", () => {
    it("s3:DeleteObject を private/* に持つ", () => {
        expect(allows(read("api/serverless.yml"), "s3:DeleteObject", "private/*")).toBe(true);
    });
});
