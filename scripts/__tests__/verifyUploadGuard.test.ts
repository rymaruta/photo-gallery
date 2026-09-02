import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// VERIFY-1 の確認は**本物の S3 に書く**。間違えて本番へ向けると、
// 本番のアップロードバケットに一時オブジェクトが増える（しかも
// 「別の種別だと断られる」を確かめる過程で、意図的に失敗する PUT も投げる）。
//
// `maintenance.yml` はジョブ全体の env が**本番の値**で埋まっているので、
// ステップ側で上書きし忘れると黙って本番へ行く。**二重に止める**:
//   1. ワークフローのステップが staging の値で上書きしている
//   2. スクリプト自身が、バケット名が `staging-` で始まらなければ中止する
const ROOT = join(__dirname, "..", "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "maintenance.yml"), "utf8");
const script = readFileSync(join(ROOT, "scripts", "verify-upload.ts"), "utf8");

/** verify-upload のステップだけを切り出す（コメントは落とす） */
function step(): string {
    const i = wf.indexOf("if: inputs.task == 'verify-upload'");
    expect(i, "verify-upload のステップが無い").toBeGreaterThan(-1);
    const rest = wf.slice(i);
    const end = rest.indexOf("\n      - name:");
    return (end === -1 ? rest : rest.slice(0, end)).replace(/^\s*#.*$/gm, "");
}

describe("verify-upload は staging にしか向かない", () => {
    it("ステップが staging のバケットで上書きしている", () => {
        expect(step()).toMatch(/^\s+UPLOAD_BUCKET:\s*staging-journey-photo-upload\s*$/m);
    });

    it("ステップに本番の値が1つも書かれていない", () => {
        const s = step();
        for (const prod of ["prod-journey-photo-upload", "prod-photo-gallery-photos", "prod-photo-gallery-users"]) {
            expect(s, `${prod} を向いている`).not.toContain(prod);
        }
    });

    // ジョブの env は本番の値なので、**上書きし忘れたら本番に行く**。
    // テーブルも一緒に上書きしていないと、枚数の判定が本番を読む
    it("テーブルも staging に上書きしている", () => {
        const s = step();
        expect(s).toMatch(/PHOTOS_TABLE:\s*staging-/);
        expect(s).toMatch(/USERS_TABLE:\s*staging-/);
    });

    // **スクリプト側の歯止め。** ワークフローを直した誰かが env を消しても、
    // ここで止まる
    it("スクリプトが staging 以外を拒否する", () => {
        const code = script.replace(/^\s*\/\/.*$/gm, "");
        expect(code).toMatch(/startsWith\(["']staging-["']\)/);
        expect(code, "拒否しても止まっていない").toMatch(/process\.exit\(1\)/);
    });

    // 成功だけを見ても意味が無い——縛りが効いていないと、間違った PUT も
    // 通ってしまう。**断られる側**を必ず確かめる
    it("「断られること」も確かめている", () => {
        expect(script).toMatch(/1バイト短いと断られる/);
        expect(script).toMatch(/別の種別だと断られる/);
    });

    // 残すと orphan-uploads に拾われる（そちらは7日より新しいものを触らない
    // ので、しばらく孤児として残り続ける）
    it("一時オブジェクトを片付ける", () => {
        expect(script).toMatch(/DeleteObjectCommand/);
        expect(script).toMatch(/finally\s*\{/);
    });
});

// **実際に走らせる。**
//
// 最初に書いた版は top-level `await` を使っていて、`tsx` が CJS で組む
// このリポジトリでは esbuild が拒否する——**一度も実行しないままコミットし、
// staging で流して初めて落ちた**（台帳の型0c: 書いた守りが動く入力を1つ
// 通すまで、書いたと言わない）。
//
// 中身の検査（正規表現）はいくらでも緑にできるが、「変換が通るか」だけは
// 動かさないと分からない。staging でないバケットを渡せば、AWS に触る前に
// 中止するので、テストから安全に起動できる。
describe("verify-upload は実行できる（変換が通る）", () => {
    it("staging でないバケットなら、AWS に触らず中止する", () => {
        let out = "";
        let code = 0;
        try {
            out = execFileSync("npx", ["tsx", "scripts/verify-upload.ts"], {
                cwd: ROOT,
                // **実在しない名前を渡す。** 本番のバケット名を渡していたが、
                // このテストが存在する理由は「staging ガードが消える変異を
                // 捕まえること」。ガードが消えた瞬間、`...process.env` ごと
                // 渡している AWS の資格情報で**このテスト自身が本番へ書く**
                // （しかも意図的に失敗する PUT を投げる）。安全網の失敗が
                // 本番への書き込みに化ける形だった。
                env: { ...process.env, UPLOAD_BUCKET: "no-such-bucket-for-tests" },
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (e) {
            const err = e as { status?: number; stdout?: string; stderr?: string };
            code = err.status ?? -1;
            out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
        }
        // 変換に失敗していると、この文言ではなく esbuild のエラーが出る
        expect(out, `想定外の出力:\n${out}`).toMatch(/staging- で始まりません/);
        expect(code, "中止したのに 0 で終わっている").toBe(1);
        expect(out).not.toMatch(/Transform failed|not supported/);
    }, 60_000);
});

// **このワークフローの約束は「既定はドライラン」**（`maintenance.yml` の冒頭）。
// この確認は本物の S3 に書く（しかも意図的に失敗する PUT を投げる）ので、
// 例外にしてよい理由が無い。他のタスクは全部 `--apply` を取っている。
describe("verify-upload は --apply が無ければ書かない", () => {
    const runScript = (args: string[], bucket: string) => {
        try {
            return {
                out: execFileSync("npx", ["tsx", "scripts/verify-upload.ts", ...args], {
                    cwd: ROOT,
                    env: { ...process.env, UPLOAD_BUCKET: bucket },
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                }),
                code: 0,
            };
        } catch (e) {
            const err = e as { status?: number; stdout?: string; stderr?: string };
            return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? -1 };
        }
    };

    // **実際に走らせる。** 「`--apply` を見る行がある」だけを正規表現で見ても、
    // 見たうえで無視していたら緑になる
    it("引数が無ければ、AWS に触らずドライランで終わる", () => {
        // staging の名前を渡す＝ガードは通る。ここで止まるのは apply の側だけ
        const { out, code } = runScript([], "staging-journey-photo-upload");
        expect(out, `想定外の出力:\n${out}`).toMatch(/ドライラン/);
        expect(code, "ドライランなのに失敗している").toBe(0);
        // 資格情報を取りに行っていない＝S3 に触っていない
        expect(out).not.toMatch(/Could not load credentials|CredentialsProviderError/);
        expect(out).not.toMatch(/申告どおりの PUT/);
    }, 60_000);

    it("ワークフローが --apply を渡している", () => {
        expect(step()).toMatch(/verify-upload\.ts \$\{\{ inputs\.apply && '--apply' \|\| '' \}\}/);
    });
});
