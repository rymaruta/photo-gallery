import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * **重いテスト（`*.slow.test.ts`）は、verify でだけ流す。**
 *
 * `vitest.config.ts` は `RUN_SLOW_TESTS=1` が無いと `*.slow.test.*` を外す
 * （`npm test`＝本番反映の Actions では流さない）。その代わり
 * `scripts/verify-local.sh` が必ず付けて流す。**verify が付け忘れると、
 * 重いテストはどこでも流れなくなる**——黙って確かめる力が落ちるので見張る。
 */
const ROOT = join(__dirname, "..", "..");

function slowFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", "out", ".git"].includes(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...slowFiles(p));
        else if (/\.slow\.test\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
}

describe("重いテスト（*.slow.test.ts）", () => {
    it("verify は重いテストを RUN_SLOW_TESTS=1 で、ほかのテストと別に流す", () => {
        const sh = readFileSync(join(ROOT, "scripts", "verify-local.sh"), "utf8");
        // 字下げされた関門（`if` の中）も見る
        const gates = sh.split("\n").filter((l) => /^\s*gate "/.test(l));
        // **関門の外で立てない。** `export RUN_SLOW_TESTS=1` などと書くと、
        // 関門の行に出ないまま全部のテストに効いてしまう
        const outside = sh.split("\n").filter((l) => /RUN_SLOW_TESTS/.test(l) && !/^\s*#/.test(l) && !/^\s*gate "/.test(l));
        expect(outside, "関門の外で RUN_SLOW_TESTS を立てている").toEqual([]);
        const slow = gates.find((l) => /RUN_SLOW_TESTS=1/.test(l));
        expect(slow, "重いテストがどこでも流れなくなる").toMatch(/RUN_SLOW_TESTS=1\s+npx vitest run \.slow\.test\./);
        // **ほかのテストと並べない。** 全部を RUN_SLOW_TESTS=1 で一度に流すと、
        // `photo-index.json` を空にするテストと、それを読むテストが並列に走る
        const all = gates.filter((l) => /npx vitest run/.test(l));
        expect(all.filter((l) => /RUN_SLOW_TESTS=1/.test(l) && !/\.slow\.test\./.test(l)), "重いテストをほかと一緒に流している").toEqual([]);
        expect(all.some((l) => /^gate "単体テスト"\s+npx vitest run$/.test(l.trim())), "ふつうのテストの関門が無い").toBe(true);
    });

    it("vitest の設定は、RUN_SLOW_TESTS が無いときだけ外す", () => {
        const cfg = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
        expect(cfg).toMatch(/process\.env\.RUN_SLOW_TESTS === "1" \? \[\] : \[SLOW\]/);
        // node と jsdom の両方の組で外す（片方だけだと、その組では流れる）
        expect(cfg.match(/\.\.\.SKIP_SLOW/g)?.length).toBe(2);
    });

    it("重いテストのファイルが実在する（仕組みが空回りしていない）", () => {
        const files = slowFiles(ROOT).map((p) => p.slice(ROOT.length + 1));
        expect(files).toEqual(expect.arrayContaining([
            "scripts/__tests__/photoIndexParity.slow.test.ts",
            "scripts/__tests__/verifyInvalidateGuard.slow.test.ts",
        ]));
    });
});
