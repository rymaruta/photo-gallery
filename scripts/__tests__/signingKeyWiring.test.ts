import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * 画像の署名鍵が、**ワークフローから Lambda まで通っているか**。
 *
 * 🔴 **配線は途中で切れても誰も気づかない。** 今日それを2回踏んだ:
 *
 *  - `stripPrivate` が在るのに `body` に通っていなかった（#134）
 *  - 新しい URL を `ExpressionAttributeValues` に積んだのに `SET` 句に
 *    入れていなかった（案A の配線）
 *
 * どちらも「関数は在る／値は在る」ので単体テストは緑のまま通る。
 * ここは**受け渡しの鎖**そのものを見る:
 *
 *     GitHub Secrets → deploy-api.yml → serverless.yml → Lambda の環境変数
 *                                                      → signedUrl.ts が読む
 */
describe("画像の署名鍵の配線", () => {
    const workflow = read(".github/workflows/deploy-api.yml");
    const serverless = read("api-user/serverless.yml");
    const signer = read("api-user/src/signedUrl.ts");

    it("ワークフローが Secrets を読んでいる", () => {
        expect(workflow).toContain("secrets.CLOUDFRONT_KEY_PAIR_ID");
        expect(workflow).toContain("secrets.CLOUDFRONT_PRIVATE_KEY");
    });

    it("ワークフローが serverless へ渡している", () => {
        expect(workflow).toContain("cloudfrontKeyPairId=");
        expect(workflow).toContain("cloudfrontPrivateKey=");
    });

    // 🔴 **空のまま渡すとデプロイが丸ごと落ちる。** serverless v3 は
    // `--param "k="` を「不正な形式」として弾き、**全変数の解決に失敗する**
    // ——`rebuildRepo` で実際に踏んだ罠（ワークフローの注記）
    it("空のときは旗ごと渡さない", () => {
        for (const name of ["CLOUDFRONT_KEY_PAIR_ID", "CLOUDFRONT_PRIVATE_KEY"]) {
            const line = workflow.split("\n").find(
                (l) => l.includes("--param \"cloudfront") && l.includes("$" + name));
            expect(line, name + " を渡す行が無い").toBeDefined();
            // `if [ -n "${NAME:-}" ]; then …` の守りが同じ行に在ること
            expect(line, name + " が裸で渡っている").toContain("[ -n \"${" + name + ":-}\" ]");
        }
    });

    it("serverless が受け取って、Lambda の環境変数に置いている", () => {
        expect(serverless).toContain("${param:cloudfrontKeyPairId, ''}");
        expect(serverless).toContain("${param:cloudfrontPrivateKey, ''}");
        expect(serverless).toContain("CLOUDFRONT_KEY_PAIR_ID:");
        expect(serverless).toContain("CLOUDFRONT_PRIVATE_KEY:");
    });

    // **秘密鍵は「署名する関数」にだけ配る**（IAM-2 と同じ方針。
    // 再ビルドのトークンが `rebuild` を呼ぶ関数にしか渡っていないのと同じ）
    it("鍵は `provider` に置かない（署名する関数にだけ配る）", () => {
        const providerBlock = serverless.slice(0, serverless.indexOf("functions:"));
        expect(providerBlock).not.toContain("CLOUDFRONT_PRIVATE_KEY");
        // 置き場は `getRestrictedFeed` の中
        const fn = serverless.slice(serverless.indexOf("getRestrictedFeed:"));
        const nextFn = fn.slice(fn.indexOf("\n  ") + 1);
        void nextFn;
        expect(fn.slice(0, fn.indexOf("events:"))).toContain("CLOUDFRONT_PRIVATE_KEY:");
    });

    it("署名する側が、その名前で読んでいる", () => {
        expect(signer).toContain("CLOUDFRONT_KEY_PAIR_ID");
        expect(signer).toContain("CLOUDFRONT_PRIVATE_KEY");
    });

    // **未登録でも壊れない**ことを、言葉ではなくコードで固定する
    it("鍵が無ければ署名しない（`isConfigured` が false）", async () => {
        const { isConfigured, signUrl } = await import("../../api-user/src/signedUrl");
        const empty = {} as NodeJS.ProcessEnv;
        expect(isConfigured(empty)).toBe(false);
        expect(signUrl("https://cdn/uploads/u/a.jpg", { signer: undefined }))
            .toBe("https://cdn/uploads/u/a.jpg");
    });
});
