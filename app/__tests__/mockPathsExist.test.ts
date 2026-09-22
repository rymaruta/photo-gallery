import { describe, it, expect } from "vitest";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

/**
 * **`vi.mock` の行き先が実在するか。**
 *
 * 🔴 **vitest は、存在しないパスを `vi.mock` しても黙る。**
 * 実測（2026-09-21・変異で確認）: `vi.mock("../user/profile/BlockedUsers")`
 * を、そのファイルを別の場所へ移したあとも残しておいたが、**10件 全緑**の
 * ままだった。
 *
 * そのせいで、`/user/settings` への移設で**死んだ mock が10ファイルに
 * 残っていた**ことに誰も気づかなかった。害は2つ:
 *
 *   1. **効いていない mock を「効いている」と思い込む。** 本物が読み込まれ、
 *      ネットワークや重い依存がテストに入り込む
 *   2. 移設のたびに残骸が増え、**どれが生きているか分からなくなる**
 *
 * ここで見るのは**相対パスの `vi.mock` だけ**。パッケージ名（`next/link`）
 * とエイリアス（`@/…`）は解決の規則が別なので対象外——`@/` は
 * `tsconfig` の `paths` を読む必要があり、規則を写すと**その写しが
 * ずれたときに黙る**という同じ穴を作る。
 */

const ROOT = resolve(__dirname, "..", "..");
/** 走査する場所。テストが居るのはこの4つ */
const DIRS = ["app", "lib", "scripts", "api-user"];
/** 解決を試す拡張子（`vi.mock` はパスを拡張子なしで書く） */
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

function testFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) testFiles(p, out);
        else if (/\.test\.(ts|tsx)$/.test(p)) out.push(p);
    }
    return out;
}

/** 行コメント・ブロックコメントを落とす（説明文の中の `vi.mock(` を拾わない） */
const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** `vi.mock("…")` / `vi.doMock('…')` の第1引数を集める */
export function mockTargets(src: string): string[] {
    const out: string[] = [];
    for (const m of strip(src).matchAll(/\bvi\.(?:mock|doMock)\(\s*(["'])([^"']+)\1/g)) {
        out.push(m[2]);
    }
    return out;
}

/** 相対パスか（`./` `../` 始まり） */
export const isRelative = (spec: string): boolean => spec.startsWith("./") || spec.startsWith("../");

describe("vi.mock の行き先は実在する", () => {
    // **自分自身は外す。** 下の「検出器の自己確認」が `vi.mock("../BlockedUsers")`
    // のような**文字列**を持っているので、走査が自分を読むとそれを拾う
    // （`routeConstants.test.ts` が同じ理由で自分を外している）
    const SELF = relative(ROOT, __filename).split("\\").join("/");
    const files = DIRS.flatMap((d) => testFiles(join(ROOT, d)))
        .filter((f) => relative(ROOT, f).split("\\").join("/") !== SELF);

    it("相対パスの vi.mock が、全部いま解決できる", () => {
        const dead: string[] = [];
        for (const f of files) {
            for (const spec of mockTargets(readFileSync(f, "utf8"))) {
                if (!isRelative(spec)) continue;
                const base = resolve(dirname(f), spec);
                if (!EXTS.some((e) => existsSync(base + e))) {
                    dead.push(`${relative(ROOT, f)}  →  ${spec}`);
                }
            }
        }
        expect(dead, `行き先の無い vi.mock（vitest は黙って素通りする）:\n${dead.join("\n")}`).toEqual([]);
    });

    // 空回りしていないこと（走査が何も拾えていないと、上は必ず通る）
    it("走査が実際に vi.mock を拾えている", () => {
        const specs = files.flatMap((f) => mockTargets(readFileSync(f, "utf8")));
        expect(files.length, "テストファイルを1つも見つけられていない").toBeGreaterThan(100);
        expect(specs.filter(isRelative).length, "相対パスの vi.mock を1つも拾えていない").toBeGreaterThan(20);
    });

    // **検出器の自己確認。** いま0件なので、壊れた検出器と正しい検出器が
    // 同じ答えを返す（`routeConstants.test.ts` と同じ立場）
    describe("検出器の自己確認", () => {
        it("`vi.mock` の第1引数を拾う", () => {
            expect(mockTargets('vi.mock("../BlockedUsers", () => ({}));')).toEqual(["../BlockedUsers"]);
            expect(mockTargets("vi.doMock('./x');")).toEqual(["./x"]);
            expect(mockTargets('vi.mock(\n    "../../lib/utils/api",\n    () => ({}),\n);')).toEqual(["../../lib/utils/api"]);
        });

        it("コメントの中の `vi.mock` では発火しない", () => {
            expect(mockTargets('// 以前は vi.mock("../old") と書いていた')).toEqual([]);
            expect(mockTargets('/* vi.mock("../old") */')).toEqual([]);
        });

        it("パッケージ名とエイリアスは相対パスと見なさない", () => {
            expect(isRelative("next/link")).toBe(false);
            expect(isRelative("@/lib/utils/log")).toBe(false);
            expect(isRelative("../x")).toBe(true);
            expect(isRelative("./x")).toBe(true);
        });
    });
});
