import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **写真の投稿・削除で起動された再ビルドはテストを飛ばす。**
//
// なぜ: 1回の再ビルド 7分02秒のうち **4分34秒（65%）がテストの再実行**で、
// ビルドそのものは21秒だった（Deploy Site run 360 の実測）。
// `repository_dispatch` は API が「写真が増えた／消えた」と頼んでくる経路で、
// **コードは1行も変わっていない**——同じ commit のテストは push のときに
// このジョブが既に通している。
//
// この時間は「投稿が世に出る回数」の上限（`REBUILD_MONTHLY_MAX`）に直結する:
// 月2,000分に対し、再ビルド200本が 1,400分(70%) → 400分(20%) になる。
//
// **ここで縛るのは「飛ばしすぎない」方**。push で飛ばすと、`checks.yml` の
// push 実行が止めてある今、**フロントのテストが CI から完全に消える**
// （このジョブが唯一の関門）。条件は「repository_dispatch のときだけ」でなければ
// ならない。「守りを足して逆向きの失敗を作る」を、削る側でやらないため。
//
// **YAML パーサは使わない**——`js-yaml` はどの package.json にも書かれておらず、
// 推移依存に寄りかかることになる（`deployConfig.test.ts` / `publicLambdaRole.test.ts`
// と同じ判断）。ステップの区切りで割れば足りる。
const src = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");
/** コメントを落とす。**コメントに書いてあるだけ**を緑にしないため */
const code = src.replace(/^\s*#.*$/gm, "");
const steps = code.split(/\n {6}- /).slice(1);

/** `npm test` を走らせるステップ */
const testStep = () => steps.find((st) => /\brun:\s*npm test\b/.test(st));

describe("再ビルドでテストを飛ばすのは repository_dispatch のときだけ", () => {
    it("テストを走らせるステップが存在する", () => {
        expect(testStep(), "npm test を走らせるステップが消えた").toBeTruthy();
    });

    it("条件が付いている（無条件だと投稿のたびに4分半 払う）", () => {
        expect(testStep(), "ステップが無い").toBeTruthy();
        expect(/\bif:\s*\S/.test(testStep()!), "条件が無い").toBe(true);
    });

    // **本題。** 条件が広がると、コードが変わった回までテストを飛ばす。
    it("飛ばすのは repository_dispatch だけ（push を飛ばさない）", () => {
        const m = /\bif:\s*(.+)/.exec(testStep()!);
        expect(m, "if の行を読めない").not.toBeNull();
        const cond = m![1];
        expect(cond).toContain("repository_dispatch");
        for (const ev of ["push", "schedule", "workflow_dispatch"]) {
            expect(cond, `${ev} まで飛ばしている（テストの関門が消える）`).not.toContain(ev);
        }
    });

    // 向きが逆（`==`）だと「投稿のときだけ走らせる」になり、意味が反転する
    it("向きが逆になっていない", () => {
        expect(testStep()!).toMatch(/if:\s*github\.event_name\s*!=\s*'repository_dispatch'/);
    });

    // 区切り方が壊れて空振りしていないか（このファイル自身の見張り）
    it("ステップを実際に割れている", () => {
        expect(steps.length).toBeGreaterThan(5);
    });
});
