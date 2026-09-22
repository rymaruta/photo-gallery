import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "verify-local.sh");
const src = readFileSync(SCRIPT, "utf8");

/**
 * **`npm run verify` は、`app/data/*.json` を偽の中身のまま残さないこと。**
 *
 * この関門は途中で**わざと**データを書き換える:
 *
 *   - `synthesize_derivatives` … `photos.json` に派生（AVIF/WebP）を足す
 *   - `photoIndexParity.test.ts` … `photo-index.json` を**空にして** `tsc` を
 *     走らせ、`finally` で戻す。**その戻しは SIGKILL では走らない**
 *
 * どちらも**追跡されているファイル**なので、戻し損ねると偽の中身が
 * 作業ツリーに残る。`photos.json` を控えている理由がそのまま
 * `photo-index.json` にも当てはまる。
 *
 * 空の索引で建てるとどうなるか（2026-09-22 実測）:
 *
 *     `npx next build`                 → **rc=0（緑）**
 *     out/location/パリ.html の
 *       href="/photo/…"                → **0本**（本来9本）
 *       href="/?photo=…"               → **10本**
 *
 * `lib/routes.ts` の `ROUTES.PHOTO()` が索引に無い id を「静的ページが
 * まだ無い写真」と読んで控えの URL に落とすため。**ビルドは緑のまま、
 * 内部リンクが全部差し替わる。**
 *
 * （この関門自身はそれを緑とは読まない——単体テストがビルドより先で、
 * `photoIndexParity.test.ts` が3件落ちる。ここが守るのは作業ツリー。）
 */
describe("verify-local.sh のデータ退避", () => {
    // **名指しにしない。** `photos.json` だけを控えていたのが元の穴で、
    // 名前で並べると4つ目が足された日にまた1つ漏れる
    it("`app/data/*.json` を丸ごと控える（ファイル名を並べない）", () => {
        expect(src).toContain('for f in "$ROOT"/app/data/*.json');
        expect(src).toMatch(/restore_data\(\)/);
        // 退避も復元も、EXIT の後始末から呼ばれている。
        // **`[^}]*` では見られない**——`cleanup()` の中に `{ … }` が在るので、
        // 最初の `}` で切れて本文を読み切れない（実測で落ちた）
        const cleanup = src.slice(src.indexOf("cleanup() {"), src.indexOf("trap cleanup EXIT"));
        expect(cleanup, "後始末が restore_data を呼んでいない").toContain("restore_data");
        expect(src).toContain("trap cleanup EXIT");
    });

    /**
     * **glob が実際に全部を覆っていること。**
     *
     * `app/data/` に `.json` 以外の追跡ファイルが足されたら、この glob は
     * それを取りこぼす。そのとき落ちて「広げろ」と言う側にする
     * （`imageOriginSites.test.ts` の「一覧の項目が実在することも見る」と同じ構え）。
     */
    it("`app/data/` の追跡ファイルは全部 .json（glob の外に出ていない）", () => {
        // ⚠️ **`-c safe.directory=*` を必ず付ける。**
        // CI のテストは Playwright の**コンテナの中**で走るので、
        // 作業ツリーの所有者が git の実行ユーザーと違い、素の `git` は
        // `fatal: detected dubious ownership` で 128 を返す。
        // **手元では通り、CI でだけ落ちる**——実際に Deploy Site run 416 が
        // これで止まり、本番反映が1回失敗した（2026-09-22）。
        const tracked = execFileSync("git", ["-c", "safe.directory=*", "ls-files", "app/data"], { cwd: ROOT, encoding: "utf8" })
            .split("\n").map((l) => l.trim()).filter(Boolean);
        expect(tracked.length, "app/data に追跡ファイルが無い（この見張りが空回りしている）").toBeGreaterThan(0);
        const notJson = tracked.filter((f) => !f.endsWith(".json"));
        expect(notJson, `glob（app/data/*.json）の外にある: ${notJson.join(", ")}`).toEqual([]);
    });

    /**
     * **本物のスクリプトから関数を取り出して動かす。**
     *
     * 手で写した版を試すと、写し間違いをテストしてしまう。`verify-local.sh`
     * はトップレベルで走る（source できない）ので、**その場で定義を切り出す**。
     */
    it("書き換えられた `app/data/*.json` が、後始末で元に戻る", () => {
        const fns = src.slice(src.indexOf("backup_data() {"), src.indexOf("cleanup() {"));
        expect(fns, "関数の切り出しに失敗している").toContain("restore_data");

        const dir = mkdtempSync(join(tmpdir(), "verify-data-"));
        try {
            mkdirSync(join(dir, "app", "data"), { recursive: true });
            mkdirSync(join(dir, "work"));
            const data = join(dir, "app", "data");
            writeFileSync(join(data, "photos.json"), '[{"id":"a"}]');
            writeFileSync(join(data, "photo-index.json"), '{"photoIds":["a"],"userIds":["u"]}');
            writeFileSync(join(data, "profiles.json"), '{"u":{}}');

            const harness = `
set -e
ROOT="${dir}"
WORK="${dir}/work"
${fns}
backup_data
# ここで関門が壊す（派生を足す／索引を空にする／SIGKILL で戻し損ねる）
echo '[]' > "$ROOT/app/data/photos.json"
echo '{"photoIds":[],"userIds":[]}' > "$ROOT/app/data/photo-index.json"
rm -f "$ROOT/app/data/profiles.json"
restore_data
`;
            execFileSync("bash", ["-c", harness], { stdio: "pipe" });

            expect(readFileSync(join(data, "photos.json"), "utf8")).toBe('[{"id":"a"}]');
            expect(readFileSync(join(data, "photo-index.json"), "utf8"))
                .toBe('{"photoIds":["a"],"userIds":["u"]}');
            // **消されたファイルも戻る**（控えから書き直すので）
            expect(readdirSync(data).sort()).toEqual(["photo-index.json", "photos.json", "profiles.json"]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
