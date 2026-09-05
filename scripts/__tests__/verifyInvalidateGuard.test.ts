import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// この確認は **staging の DynamoDB に行を書き、S3 に置き、Lambda を invoke する**。
// `maintenance.yml` のジョブ env は**本番の値**なので、ステップで上書きし忘れると
// 本番のテーブルにダミーのストーリー行が入る。`verify-upload` と同じく二重に止める:
//   1. ワークフローのステップが staging の値で上書きしている
//   2. スクリプト自身が、**バケット名・テーブル名・invoke 先の関数名**が
//      staging のものでなければ中止する
//
// **2 は最初、バケットとテーブルしか見ていなかった。** 「バケットとテーブルは
// staging・関数名は本番」の組み合わせが素通りし、`--apply` を付ければ
// **本番の cleanupStories を叩けた**（レビュー指摘・再現済み）。
// 本番と staging は同じアカウント・同じ資格情報で、区別は名前だけ。

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
        // **api-user が動いても api の証拠にはならない**（別サービス＝別の
        // IAM・別の環境変数）。管理API側の関数も向けていることを固定する
        expect(s).toMatch(/ADMIN_DELETE_FUNCTION:\s*photo-gallery-api-staging-deletePhoto/);
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
    // **`finally { … cleanup() }` の緩い一致では足りない**——ファイル内の
    // どこかの finally とどこかの cleanup に当たるだけで、前半の finally を
    // 消しても後半のそれで満たされる（レビューが変異で実証）
    it("2つのフェーズが、それぞれ finally で後始末している", () => {
        const finallies = script.match(/finally\s*\{\s*await cleanup\(/g) ?? [];
        expect(finallies.length, "どちらかのフェーズが後始末していない").toBe(2);
    });

    // 後始末に失敗したことを黙らせない（残った行は次回の偽陽性の種になる）
    it("後始末の失敗を報告する", () => {
        expect(script).toMatch(/後始末に失敗しました/);
    });

    // **ランナーで同じ関数を呼んでも意味が無い**（あちらには node_modules が
    // あるので必ず成功する）。Lambda を invoke していることを固定する
    // **時刻の窓だけで数えない。** `CallerReference` は `del-<ms>-…` で
    // どの実行が作ったか分からないので、窓に入った他の削除
    // （毎時の掃除・別の利用者）を自分の成果にする（レビューが実証）
    it("自分が置いたパスを含む無効化だけを数える", () => {
        expect(script, "時刻だけで数えている").toMatch(/Paths\?\.Items \?\? \[\]\)\.includes\(wantPath\)/);
        expect(script).toMatch(/lambdaInvalidationsFor\(DIST, started, `\/\$\{KEY\}`\)/);
        expect(script).toMatch(/lambdaInvalidationsFor\(DIST, started, `\/\$\{key\}`\)/);
    });

    // 行が消えたことも判定に入れる（表示するだけだと「削除は失敗・無効化は
    // 誰か別の実行のもの」でも成功と出る）
    it("行が消えたことも成功の条件にしている", () => {
        expect((script.match(/!left\.Item && refs\.length > 0/g) ?? []).length).toBe(2);
    });

    // 未設定を「成功」にしない（緑のまま片肺になる）
    it("ADMIN_DELETE_FUNCTION が無ければ失敗にする", () => {
        expect(script).toMatch(/ADMIN_DELETE_FUNCTION が未設定です[\s\S]{0,40}return false/);
    });

    // **どちらのフェーズが どちらの関数を叩くか**まで見る。
    // 管理API側の `FunctionName: fn` を `FN`（掃除の関数）に取り違える変異が
    // 素通りしていた——api 側を一度も叩かずに「管理APIでも動いている」と出る
    it("管理APIのフェーズは ADMIN_DELETE_FUNCTION を叩く", () => {
        const i = script.indexOf("async function verifyAdminDelete(");
        expect(i, "verifyAdminDelete が無い").toBeGreaterThan(-1);
        const body = script.slice(i, script.indexOf("\nasync function main(", i));
        expect(body, "掃除の関数（CLEANUP_FUNCTION）を叩いている").toContain("FunctionName: fn");
        expect(body).not.toContain("FunctionName: FN");
        expect(body).toContain('process.env.ADMIN_DELETE_FUNCTION');
    });

    it("Lambda を invoke している（ランナーで代用していない）", () => {
        expect(script).toMatch(/InvokeCommand/);
        // 2経路とも invoke する（片方だけだと、もう片方の IAM・環境変数は未確認のまま）
        expect(script).toMatch(/CLEANUP_FUNCTION/);
        expect(script).toMatch(/ADMIN_DELETE_FUNCTION/);
        expect(script, "管理者クレームを付けずに叩いている").toMatch(/cognito:groups/);
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

const STAGING = {
    UPLOAD_BUCKET: "staging-journey-photo-upload",
    PHOTOS_TABLE: "staging-photo-gallery-photos",
    CLOUDFRONT_DISTRIBUTION_ID: "EF2TFEBBP24DL",
    CLEANUP_FUNCTION: "photo-gallery-user-api-staging-cleanupStories",
    ADMIN_DELETE_FUNCTION: "photo-gallery-api-staging-deletePhoto",
};

describe("verify-invalidate を実際に起動する", () => {
    // **片方だけ本番**の組み合わせを1つずつ踏む。前は prod×prod しか
    // 渡しておらず、`PHOTOS_TABLE` の判定を落としても素通りした（実測）
    it.each([
        ["バケットだけ本番", { UPLOAD_BUCKET: "prod-journey-photo-upload" }, /staging 以外では実行しません/],
        ["テーブルだけ本番", { PHOTOS_TABLE: "prod-photo-gallery-photos" }, /staging 以外では実行しません/],
        ["両方本番", { UPLOAD_BUCKET: "prod-journey-photo-upload", PHOTOS_TABLE: "prod-photo-gallery-photos" }, /staging 以外では実行しません/],
        // **invoke 先が本番**——ここが素通りしていた。`--apply` を付ければ
        // 本番の cleanupStories を叩く（本番の期限切れを実際に消す）
        ["掃除の関数だけ本番", { CLEANUP_FUNCTION: "photo-gallery-user-api-prod-cleanupStories" }, /staging 以外の関数は叩きません/],
        ["管理APIの関数だけ本番", { ADMIN_DELETE_FUNCTION: "photo-gallery-api-prod-deletePhoto" }, /staging 以外の関数は叩きません/],
    ])("%s なら、AWS に触る前に中止する", (_name, override, expected) => {
        const { out, code } = run({ ...STAGING, ...override });
        expect(code, "止まっていない").toBe(1);
        expect(out).toMatch(expected);
    });

    it("staging でも --apply が無ければ何も書かない（やることを出すだけ）", () => {
        const { out, code } = run(STAGING);
        expect(code).toBe(0);
        expect(out).toMatch(/ドライラン/);
        expect(out, "資格情報を取りに行っている").not.toMatch(/CredentialsProviderError|InvalidClientTokenId/);
    });
});
