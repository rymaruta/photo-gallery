import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// この確認は **staging の DynamoDB に行を書き、S3 に置き、Lambda を invoke する**。
// `maintenance.yml` のジョブ env は**本番の値**なので、ステップで上書きし忘れると
// 本番のテーブルにダミーのストーリー行が入る。`verify-upload` と同じく二重に止める:
//   1. ワークフローのステップが staging の値で上書きしている
//   2. スクリプト自身が、バケット名・テーブル名が `staging-` で始まらなければ中止する

const ROOT = join(__dirname, "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "maintenance.yml"), "utf8");
const script = readFileSync(join(ROOT, "scripts", "verify-invalidate.ts"), "utf8");

function step(): string {
    const i = wf.indexOf("if: inputs.task == 'verify-invalidate'");
    expect(i, "verify-invalidate のステップが無い").toBeGreaterThan(-1);
    const rest = wf.slice(i);
    const end = rest.indexOf("\n      - name:");
    return (end === -1 ? rest : rest.slice(0, end)).replace(/^\s*#.*$/gm, "");
}

describe("verify-invalidate は staging にしか向かない", () => {
    it("ステップが staging のバケット・テーブル・配信で上書きしている", () => {
        const s = step();
        expect(s).toMatch(/UPLOAD_BUCKET:\s*staging-journey-photo-upload/);
        expect(s).toMatch(/PHOTOS_TABLE:\s*staging-photo-gallery-photos/);
        // staging の配信ID（本番は EYRLTGCPOS9E4）
        expect(s).toMatch(/CLOUDFRONT_DISTRIBUTION_ID:\s*EF2TFEBBP24DL/);
        expect(s).toMatch(/CLEANUP_FUNCTION:\s*photo-gallery-user-api-staging-cleanupStories/);
    });

    it("ステップに本番の値が1つも書かれていない", () => {
        const s = step();
        for (const prod of ["prod-journey-photo-upload", "prod-photo-gallery-photos", "EYRLTGCPOS9E4", "-prod-"]) {
            expect(s, `${prod} を向いている`).not.toContain(prod);
        }
    });

    it("スクリプトが staging 以外を拒否し、そこで止まる", () => {
        const code = script.replace(/^\s*\/\/.*$/gm, "");
        expect(code).toMatch(/startsWith\(["']staging-["']\)/);
        expect(code, "拒否しても止まっていない").toMatch(/process\.exit\(1\)/);
    });

    // 書いたものを残すと、staging に期限切れの行とダミーが溜まる
    it("後始末が finally にある", () => {
        expect(script).toMatch(/finally\s*\{[\s\S]*cleanup\(\)/);
    });

    // **ランナーで同じ関数を呼んでも意味が無い**（あちらには node_modules が
    // あるので必ず成功する）。Lambda を invoke していることを固定する
    it("Lambda を invoke している（ランナーで代用していない）", () => {
        expect(script).toMatch(/InvokeCommand/);
        expect(script, "ランナー側で invalidateUploads を直接呼んでいる").not.toMatch(/from ["'].*cdnInvalidate["']/);
    });
});

// **実際に走らせる。** 正規表現の検査はいくらでも緑にできるが、
// 「tsx で変換が通るか」は動かさないと分からない（`verify-upload` は
// top-level await を書いて staging で初めて落ちた前例がある）。
// staging でない値を渡せば AWS に触る前に中止するので、安全に起動できる。
function run(env: Record<string, string>) {
    const r = spawnSync("npx", ["tsx", "scripts/verify-invalidate.ts"], {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: "utf8",
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? -1 };
}

describe("verify-invalidate を実際に起動する", () => {
    it("本番のバケットを渡すと、AWS に触る前に中止する", () => {
        const { out, code } = run({ UPLOAD_BUCKET: "prod-journey-photo-upload", PHOTOS_TABLE: "prod-photo-gallery-photos" });
        expect(code, "止まっていない").toBe(1);
        expect(out).toMatch(/staging 以外では実行しません/);
    });

    it("staging でも --apply が無ければ何も書かない（やることを出すだけ）", () => {
        const { out, code } = run({
            UPLOAD_BUCKET: "staging-journey-photo-upload",
            PHOTOS_TABLE: "staging-photo-gallery-photos",
            CLOUDFRONT_DISTRIBUTION_ID: "EF2TFEBBP24DL",
            CLEANUP_FUNCTION: "photo-gallery-user-api-staging-cleanupStories",
        });
        expect(code).toBe(0);
        expect(out).toMatch(/ドライラン/);
        expect(out, "資格情報を取りに行っている").not.toMatch(/CredentialsProviderError|InvalidClientTokenId/);
    });
});
