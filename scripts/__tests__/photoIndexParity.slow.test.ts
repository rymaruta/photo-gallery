import { describe, it, expect } from "vitest";

// **重いテスト（`*.slow.test.ts`）。** `npm test`（本番反映の Actions でも流れる）
// からは外し、`npm run verify` でだけ流す（`vitest.config.ts` の `RUN_SLOW_TESTS`）。
// 別のプログラムを起動するので1本で約30秒かかり、全スイートでいちばん重かった。
// verify は別の枝へ入れる前に必ず通す決まり（CLAUDE.md）なので、確かめる力は落ちない。

/**
 * **写真が1枚も無い環境でも、サイトがビルドできること。**
 *
 * `lib/routes.ts` は `new Set(PHOTO_INDEX.photoIds)` で索引を読む。型を
 * 書かないと、索引が**空配列のとき** TypeScript が `Set<never>` と推論し、
 * `.has(id: string)` が型エラーになる——**`npm run build` が落ちる**。
 *
 * 実際に落ちた（staging の run 375）。staging の DynamoDB は空
 * （本番の写真はコピーしない方針）なので、ビルド時の同期で索引が空になり、
 * **staging のデプロイが必ず落ちる**状態だった。
 * **手元のコミット済み `photo-index.json` は写真を持っているので再現しない**
 * ——空の索引を置いて初めて出る。`vitest` は型を見ないので、
 * ここでは**実際に `tsc` を走らせて**確かめる。
 */
describe("写真が1枚も無くてもビルドできる", () => {
    it("索引が空でも型が通る", async () => {
        const { execFileSync } = await import("node:child_process");
        const { readFileSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const root = join(__dirname, "..", "..");
        const idx = join(root, "app", "data", "photo-index.json");
        const before = readFileSync(idx, "utf8");
        try {
            writeFileSync(idx, JSON.stringify({ photoIds: [], userIds: [] }));
            // 落ちれば例外になる（`tsc` は型エラーで終了コード 2）
            execFileSync("npx", ["tsc", "--noEmit"], { cwd: root, stdio: "pipe" });
        } finally {
            // **控えから必ず戻す。** 戻し損ねると、以降のテストが空の索引で走る
            writeFileSync(idx, before);
        }
        expect(readFileSync(idx, "utf8"), "索引を戻し損ねている").toBe(before);
    }, 180_000);
});
