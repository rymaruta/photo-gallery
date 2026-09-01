import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// **コンテナの中では `run:` の既定シェルが `sh`（dash）になる。**
//
// ランナー直上なら bash なので、同じ書き方でも通ってしまう。
// `set -euo pipefail` は dash に無い `pipefail` を含むため
// `set: Illegal option -o pipefail` で**1行目から落ちる**。
//
// 実際に踏んだ: `deploy.yml` の deploy-frontend は 2026-08-19 に
// コンテナへ移り、8/21 に `set -euo pipefail` が入った。その結果
// **サイトのデプロイは staging も本番も S3 へ出す手前で失敗し続けていた**。
// Next のビルドは成功するので、ログを最後まで見ないと成功に見える。
//
// **YAML パーサに頼らない。** 最初は `python3 -c "import yaml"` で読んで
// いたが、この検査を走らせる**当のコンテナ（Playwright イメージ）に
// PyYAML が無く、デプロイを丸ごと落とした**——検査のために本番の経路を
// 止めては本末転倒。依存を増やさず、必要な形だけを文字列で見る。
const DIR = ".github/workflows";
const files = () => readdirSync(join(process.cwd(), DIR)).filter((f) => f.endsWith(".yml"));
const read = (f: string) => readFileSync(join(process.cwd(), DIR, f), "utf8");

describe("コンテナで動くジョブは shell を明示する", () => {
    it.each(files())("%s", (file) => {
        const src = read(file);
        const usesContainer = /^\s{4}container:\s*$/m.test(src);
        const usesPipefail = /pipefail/.test(src);
        if (!usesContainer || !usesPipefail) return;
        expect(src, `${file}: コンテナの中で pipefail を使うなら shell: bash が要る（dash には無い）`)
            .toMatch(/^\s{4}defaults:\s*\n\s{6}run:\s*\n\s{8}shell:\s*bash\s*$/m);
    });
});

// **`GITHUB_TOKEN` に何も渡さない（IAM-3）。**
// どのワークフローもトークンを使っていない（`actions/checkout` だけ）のに、
// `permissions:` が1つも無く、既定の権限がそのまま渡っていた。リポジトリの
// 設定次第では `contents: write` まで乗る。渡していない権限は漏らせない。
describe("ワークフローは権限を明示する", () => {
    it.each(files())("%s に permissions がある", (file) => {
        expect(read(file), `${file}: permissions が無い（既定の権限がそのまま渡る）`)
            .toMatch(/^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
    });
});
