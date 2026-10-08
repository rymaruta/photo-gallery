/**
 * テストの環境の振り分け（`scripts/lib/testEnvClassify.mjs` と
 * `vitest.config.ts` の2つの project）の見張り。
 *
 * ここが壊れたときに起きることが**静かで痛い**ので置いている:
 *   - DOM が要るテストを node に倒す → 落ちる（これは気づける）
 *   - **グロブの逃がしを忘れる → 実在するテストがどちらの project にも
 *     入らず、黙って走らなくなる**（緑のまま守備範囲が減る）
 *   - 判定が壊れて全部 jsdom に戻る → 遅くなるだけで誰も気づかない
 */
import { describe, it, expect } from "vitest";
import path from "path";
import { createRequire } from "node:module";
import {
    createClassifier,
    escapeGlob,
    findTestFiles,
    nodeEnvTestFiles,
    nodeEnvTestGlobs,
    stripCommentsAndStrings,
} from "../lib/testEnvClassify.mjs";

const ROOT = path.resolve(__dirname, "..", "..");

// vitest が使っているグロブの実装そのもの（tinyglobby → picomatch）。
// 直接の依存ではないので、消えたらこのテストが落ちて気づける。
const picomatch = createRequire(import.meta.url)("picomatch") as
    (glob: string) => (s: string) => boolean;

describe("コメントと文字列を落としてから印を探す", () => {
    it("行コメントの中の語は印にならない", () => {
        expect(stripCommentsAndStrings("const a = 1; // localStorage の話")).toBe("const a = 1; ");
    });

    it("ブロックコメントの中の語は印にならない", () => {
        expect(stripCommentsAndStrings("/* document paths overlap */ const b = 2;")).toBe(" const b = 2;");
    });

    it("引用符の中の語は印にならない", () => {
        expect(stripCommentsAndStrings('const s = "localStorage";')).toBe("const s = ;");
    });

    it("テンプレート literal の中は通す（`${...}` が本物のコードだから）", () => {
        const src = "const t = `x/${" + "document" + ".title}`;";
        expect(stripCommentsAndStrings(src)).toContain("document");
    });

    it("文字列の中の `//` をコメントと読まない", () => {
        const src = "const u = `https://example.test/` + " + "window" + ".name;";
        expect(stripCommentsAndStrings(src)).toContain("window");
    });
});

describe("振り分け", () => {
    const all = findTestFiles(ROOT);
    const node = nodeEnvTestFiles(ROOT);
    const nodeSet = new Set(node);

    it("テストを1本も取りこぼさない（node と jsdom で全部を覆う）", () => {
        expect(all.length).toBeGreaterThan(400);
        expect(node.every((f) => all.includes(f))).toBe(true);
    });

    it("`.tsx` のテストは必ず jsdom に倒す", () => {
        expect(all.filter((f) => f.endsWith(".tsx") && nodeSet.has(f))).toEqual([]);
    });

    it("`@testing-library` を読むテストは jsdom に倒す", () => {
        const { classify } = createClassifier(ROOT);
        const target = "lib/hooks/__tests__/useGallery.test.ts";
        expect(all).toContain(target);
        expect(classify(path.join(ROOT, target)).env).toBe("jsdom");
    });

    // 🕒 リポジトリの全テストファイルを読み直して振り分ける（ファイル数に比例する）。
    // CI のランナーが混んでいると 5 秒の既定を超えて落ちた（#285 で同じ理由の1本に 30_000、
    // 2026-10-08 に下の2本も同じく落ちた）。判定の中身は緩めず、待ち時間だけを明示する
    it("import を辿る（テスト本体が綺麗でも、読む先が DOM なら jsdom）", () => {
        // `lib/utils/scrollLock.ts` は `window` を触る。それを読むテストは
        // 自分が綺麗でも jsdom でなければならない。
        const { markOf, classify } = createClassifier(ROOT);
        expect(markOf(path.join(ROOT, "lib/utils/scrollLock.ts"))).toMatch(/^token:/);
        for (const f of all) {
            if (nodeSet.has(f)) {
                expect(classify(path.join(ROOT, f)).why).toBe("");
            }
        }
    }, 30_000);

    it("node に倒せたのが少なすぎたら、判定が壊れている", () => {
        // 2026-09-22 の実測は 215 本。
        // **線を 200 に置いてあるのは、コメント・文字列を落とす処理を
        // 外すと 161 本まで落ちるから**（`api-user/src/uploadPolicy.ts` の
        // コメントに `localStorage` と書いてあるだけで19本が jsdom へ行く）。
        // ここが 150 だとその後退を見逃す。
        expect(node.length).toBeGreaterThanOrEqual(200);
    });
});

describe("グロブの逃がし", () => {
    it("`[id]` を含むパスは、逃がさないと別のパスにも当たる", () => {
        const p = "app/photo/[id]/__tests__/foo.test.ts";
        const other = "app/photo/i/__tests__/foo.test.ts";
        expect(picomatch(p)(other)).toBe(true);          // 生のままだと余計なものに当たる
        expect(picomatch(escapeGlob(p))(other)).toBe(false);
        expect(picomatch(escapeGlob(p))(p)).toBe(true);  // 本人には当たる
    });

    // 🕒 リポジトリの全テストファイルを読み直して振り分ける（ファイル数に比例する）。
    // CI のランナーが混んでいると 5 秒の既定を超えて落ちた（#285 で同じ理由の1本に 30_000、
    // 2026-10-08 に下の2本も同じく落ちた）。判定の中身は緩めず、待ち時間だけを明示する
    it("config が渡すグロブに、逃がし忘れた特殊文字が無い", () => {
        // **`vitest.config.ts` が実際に渡すもの**を見る（ここで自前に
        // `escapeGlob` を掛け直すと、逃がし忘れを見逃す）。
        // いまのリポジトリには特殊文字を含む node 側のテストが無いので
        // これは仕掛け線——`app/photo/[id]/__tests__/*.test.ts` に
        // DOM を使わないテストが1本増えた日に効く（一時ファイルを置いて
        // 実際に落ちることを確かめてある）。
        const unescaped = /(^|[^\\])[[\]{}()!*?+@]/;
        expect(nodeEnvTestGlobs(ROOT).filter((g) => unescaped.test(g))).toEqual([]);
    }, 30_000);

    it("config が渡すグロブは、文字クラスに化けた姿に当たらない", () => {
        const files = nodeEnvTestFiles(ROOT);
        const globs = nodeEnvTestGlobs(ROOT);
        expect(globs.length).toBe(files.length);
        for (let i = 0; i < files.length; i++) {
            const match = picomatch(globs[i]);
            expect(match(files[i])).toBe(true);
            // `[id]` が「i か d のどれか1文字」と読まれたときの姿
            const decoy = files[i].replace(/\[([^\]/]+)\]/g, (_m: string, inner: string) => inner[0]);
            if (decoy !== files[i]) expect(match(decoy)).toBe(false);
        }
    // 2026-10-04 判断: テストのファイル数（約 600）ぶん picomatch を組み立てるので、
    // CI の混んだ時に既定の 5 秒を超えて本番のデプロイを止めた（run 37164408595）。
    // 中身は正しく遅いだけなので、上限だけ延ばす。
    }, 30_000);
});
