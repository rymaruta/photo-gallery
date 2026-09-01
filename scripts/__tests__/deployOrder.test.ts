import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-01、`main` へのマージで **API のデプロイが失敗したのに
// フロントだけ本番へ出た**。`Deploy API Lambdas` と `Deploy Site` は
// 別ワークフローとして並走するので、片方の失敗はもう片方に伝わらない。
// 結果、新しい画面が古い API を叩き、**写真の削除が 404** になった
// （`DELETE /photos/{id}` が旧版に無い）。
//
// PR には「API を先、フロントを後」と書いてあったが、**止まる仕掛けが
// 無ければそれは約束ではない**。`api-gate` がその仕掛け。
//
// ここで固定するのは2つで、**2つ目の方が大事**:
//   1. フロントの反映が api-gate を待つ
//   2. **止めるのは「失敗を見たとき」だけ**。見つからない・読めない・
//      時間切れは通す。ここで詰まらせると、API と無関係な変更まで
//      出せなくなる（「守りを足して逆向きの失敗を作る」の再発）。
const src = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");

/** コメントを落とす。**コメントに書いてあるだけ**を緑にしないため */
const code = src.replace(/^\s*#.*$/gm, "");

describe("フロントの反映は、同じコミットの API デプロイの結果を見る", () => {
    it("api-gate というジョブがある", () => {
        expect(code).toMatch(/^ {2}api-gate:\s*$/m);
    });

    it("deploy-frontend が api-gate を待つ", () => {
        expect(code).toMatch(/needs:\s*\[\s*config\s*,\s*api-gate\s*\]/);
    });

    // push 以外（手動・定期・repository_dispatch）では api-gate は skipped に
    // なる。`always()` で受けたうえで **failure のときだけ**止める——
    // `success()` で受けると、写真を消したときの repository_dispatch が
    // 二度と走らなくなる（＝消したページが残り続ける。塞ぎたかったものと同じ穴）
    it("skipped では止めず、failure のときだけ止める", () => {
        const m = /if:\s*always\(\)[^\n]*needs\.api-gate\.result\s*!=\s*'failure'/.exec(code);
        expect(m, "deploy-frontend の if が always()+failure 判定になっていない").not.toBeNull();
        expect(code).not.toMatch(/needs\.api-gate\.result\s*==\s*'success'/);
    });

    it("api-gate は push のときだけ動く", () => {
        expect(code).toMatch(/if:\s*github\.event_name\s*==\s*'push'/);
    });

    // 読むのは同じコミットの結果でなければ意味が無い。
    // ブランチ名や「最新の実行」で見ると、無関係な実行の成功で通してしまう
    it("同じコミット（head_sha）の実行を見る", () => {
        expect(code).toContain("deploy-api.yml/runs?head_sha=$SHA");
    });

    // **本題。** 判断できないときに止めない。
    it("失敗を見たときだけ exit 1（時間切れは警告で通す）", () => {
        expect(code, "completed:* の分岐で止めていない").toMatch(/completed:\*\)[\s\S]{0,600}?exit 1/);
        // 待ちループを抜けた先が exit 1 になっていない＝時間切れは通す
        const afterLoop = code.slice(code.indexOf("sleep 15\n          done"));
        expect(afterLoop.slice(0, 400)).toMatch(/::warning::/);
        expect(afterLoop.slice(0, 400)).not.toMatch(/exit 1/);
    });

    it("成功したら待たずに進む", () => {
        expect(code).toMatch(/completed:success\)[\s\S]{0,200}?exit 0/);
    });

    // API を触っていない push まで待たせると、必ず時間切れになる
    // （`Deploy API Lambdas` は api/** の paths フィルタ付きで起動しない）
    it("API を触っていない push は待たない", () => {
        expect(code).toMatch(/git diff --name-only[^\n]*api api-user/);
        expect(code).toMatch(/touched=false/);
    });

    it("結果を読むための actions: read があり、書き込みは足していない", () => {
        // コメントに `contents: write まで` という説明があるので、
        // ここでも落としてから見る（説明文で緑にも赤にもしない）
        const head = code.slice(0, code.indexOf("\non:"));
        expect(head).toMatch(/^ {2}actions:\s*read\s*$/m);
        expect(head).not.toMatch(/write/);
    });
});
