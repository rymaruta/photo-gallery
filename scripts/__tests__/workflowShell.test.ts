import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// **コンテナの中では `run:` の既定シェルが `sh`（dash）になる。**
//
// ランナー直上なら bash なので、同じ書き方でも通ってしまう。
// `set -euo pipefail` は dash に無い `pipefail` を含むため
// `set: Illegal option -o pipefail` で**1行目から落ちる**。
//
// 実際に踏んだ: `deploy.yml` の deploy-frontend は 2026-08-19 に
// コンテナへ移り、8/21 に `set -euo pipefail` が入った。その結果
// **8/21 以降、サイトのデプロイは staging も本番も S3 へ出す手前で
// 失敗し続けていた**。Next のビルドは成功するので、ログを最後まで
// 見ないと成功に見える（気づいたのは今日 staging を流したとき）。
const DIR = ".github/workflows";

describe("コンテナで動くジョブは shell を明示する", () => {
    const files = readdirSync(join(process.cwd(), DIR)).filter((f) => f.endsWith(".yml"));

    it.each(files)("%s", (file) => {
        // YAML パーサを依存に足さない（この1本のために増やさない）。
        // python は CI にもこの環境にも必ずある
        const doc = JSON.parse(execFileSync("python3", [
            "-c",
            "import sys,yaml,json;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))",
            join(process.cwd(), DIR, file),
        ], { encoding: "utf8" })) as {
            jobs?: Record<string, { container?: unknown; defaults?: { run?: { shell?: string } }; steps?: { run?: string; shell?: string }[] }>;
        };
        for (const [name, job] of Object.entries(doc.jobs ?? {})) {
            if (!job.container) continue;
            const jobShell = job.defaults?.run?.shell;
            for (const step of job.steps ?? []) {
                if (typeof step.run !== "string") continue;
                if (!/set\s+-[a-z]*o\s+pipefail|pipefail/.test(step.run)) continue;
                const shell = step.shell ?? jobShell;
                expect(shell, `${file} の ${name}: コンテナの中で pipefail を使うなら shell: bash が要る（dash には無い）`)
                    .toMatch(/bash/);
            }
        }
    });
});
