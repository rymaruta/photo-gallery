import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { nodeEnvTestGlobs } from "./scripts/lib/testEnvClassify.mjs";

const ROOT = __dirname;

// レビューや変異テストの一時置き場を拾わない。
// 中身は本物のソースのコピーなので、放っておくと**同じテストを
// 二重に走らせて件数まで狂わせる**（実際に 1,503 と数えていた回が
// 1,582 に膨れていた）。.gitignore だけでは vitest は止まらない。
const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/__ztmp/**"];

// **重いテスト（`*.slow.test.ts`）は `npm run verify` でだけ流す。**
//
// 別のプログラム（`tsc`・`tsx`）を起動するもので、1本で数秒〜30秒かかる。
// `npm test` は本番反映の Actions（Deploy Site）でも毎回流れ、その分数は
// owner の財布から出る（CLAUDE.md「GitHub Actions の枠」）。verify は別の枝へ
// 入れる前に必ず通す決まりなので、そこで流せば確かめる力は落ちない。
// `scripts/verify-local.sh` が `RUN_SLOW_TESTS=1` を付ける
// （`scripts/__tests__/slowTests.test.ts` が見張る）。
const SLOW = "**/*.slow.test.{ts,tsx,js,mjs}";
const SKIP_SLOW = process.env.RUN_SLOW_TESTS === "1" ? [] : [SLOW];

// **jsdom を建てるのは、DOM を触るテストだけにする。**
//
// 全部に jsdom を掛けていた頃の実測（2026-09-22・4コア）:
//   498本 / 6,724件 / 271.75秒 のうち **environment が 393.27秒**
//   （並列なので所要を超える）。実働の `tests` は 215.56秒 しかない。
//
// 振り分けは `scripts/lib/testEnvClassify.mjs` が **import を辿って**決める。
// 一覧を手で持たないのは、新しいテストが増えた日に更新し忘れて
// 黙って遅いままになるのを避けるため。判定の中身と「安全側にしか
// 間違えない」理由はあちらの冒頭に書いてある。
//
// **グロブとして書く。** `app/photo/[id]/**` のようなパスを生のまま渡すと
// `[id]` が文字クラスとして読まれ、**余計なパスにも当たる**（`escapeGlob` 参照）。
const NODE_TESTS = nodeEnvTestGlobs(ROOT);

// **1本も選べなかったら止める。** 判定が壊れて全部 jsdom に戻ったとき、
// 「遅いだけで緑」になって誰も気づかない。実測で 216 本あるので、
// 大きく割り込んだら数え方が壊れている
// （`scripts/__tests__/testEnvSplit.test.ts` は 200 でもっと細かく見る）。
if (NODE_TESTS.length < 150) {
    throw new Error(
        `テストの環境の振り分けが壊れている可能性があります（node と判定できたのが ${NODE_TESTS.length} 本）。`
        + "scripts/lib/testEnvClassify.mjs を確認してください。",
    );
}

const shared = {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(ROOT, ".") } },
};

export default defineConfig({
    ...shared,
    test: {
        projects: [
            {
                ...shared,
                test: {
                    name: "node",
                    globals: true,
                    environment: "node",
                    setupFiles: ["./vitest.setup.ts"],
                    include: NODE_TESTS,
                    exclude: [...EXCLUDE, ...SKIP_SLOW],
                },
            },
            // **DOM が要るテストは happy-dom で流す**（2026-09-30・owner 了承）。
            //
            // 実測（全スイート・4コア）: jsdom だけのとき 288.8秒（environment 291秒・
            // tests 277秒）→ happy-dom を基本にして 212.6秒（environment 128秒・tests 203秒）。
            // DOM のテストは約380本あり、1本ごとに建て直す仮想ブラウザの起動が
            // テスト本体より重かった。
            //
            // **happy-dom で動かないテストは、そのファイルの先頭に
            // `// @vitest-environment jsdom` を書いて jsdom で流す**（画像の `srcset`・
            // ラベルの結び付け・履歴の扱いなど、実装の違いが出るもの）。
            // 一覧はここに持たない——ファイル自身が理由とともに名乗る。
            // happy-dom は jsdom より実ブラウザからは遠いので、最後の確かめは
            // verify の Chromium スモーク（`scripts/e2e-smoke.mjs`）が担う
            {
                ...shared,
                test: {
                    name: "dom",
                    globals: true,
                    environment: "happy-dom",
                    setupFiles: ["./vitest.setup.ts"],
                    include: ["**/*.test.{ts,tsx,js,mjs}"],
                    exclude: [...EXCLUDE, ...NODE_TESTS, ...SKIP_SLOW],
                },
            },
        ],
    },
});
