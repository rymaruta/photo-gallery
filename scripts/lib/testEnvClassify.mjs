/**
 * テストを **jsdom が要るもの** と **node で足りるもの** に振り分ける。
 *
 * なぜ要るか（2026-09-22 の実測・4コア）:
 *
 *     テストファイル 498本 / 6,724件 / 所要 271.75秒
 *       environment  393.27秒  ← jsdom の起動（並列なので所要を超える）
 *       import        83.09秒
 *       setup         29.78秒
 *       tests        215.56秒  ← 実際にテストしている時間
 *
 * **準備が実働の1.8倍。** `vitest.config.ts` が `environment: "jsdom"` を
 * 全体に掛けているので、DOM を一度も触らないテストまで毎回 jsdom を建てている。
 * `scripts/__tests__` の30本で比べた実測では **jsdom 11.55秒 / node 3.84秒**。
 *
 * ── 振り分け方 ──────────────────────────────────────────
 *
 * **テストファイル1枚の grep では足りない。** import した先が読み込み時に
 * DOM を触ることがあるので、**リポジトリ内の import を辿って**その全部を見る。
 * 1枚でも DOM の印を持っていたら jsdom に倒す。
 *
 * **判定は「安全側に倒す」向きにしか間違えない。**
 *   - DOM が要るのに node と読んだ → テストが**落ちる**（黙って緑にはならない）
 *   - DOM が要らないのに jsdom と読んだ → 遅いだけで、結果は変わらない
 *
 * `environmentMatchGlobs` は Vitest 4 で消えている。**`@vitest-environment` の
 * コメントは残っている**（4.1.4 は、ファイル全体から最初の
 * `@vitest-environment <名前>` を拾う・`cli-api` の `detectCodeBlock`）。
 * ——以前ここに「docblock も消えている」と書いていたが誤り（2026-09-30 訂正）。
 * 組の振り分け（node か DOM か）はこの判定を config が使い、DOM の組の中で
 * happy-dom で動かないファイルだけが、そのコメントで jsdom を名乗る。
 * ここの札 `"jsdom"` は「DOM が要る」の意味（実際の環境は `vitest.config.ts`）。
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|out|coverage|__ztmp|\.git)(\/|$)/;
const TEST_RE = /\.test\.(ts|tsx|js|mjs)$/;

/** 読み込むだけで DOM が要るパッケージ */
const DOM_PKG = /^(?:react$|react\/|react-dom|@testing-library\/|next$|next\/|leaflet|react-leaflet|framer-motion|@vitejs\/)/;

/**
 * DOM を使っている印。**語として**出てくるものだけ拾う（`\b`）。
 * 広すぎるぶんには構わない——上の「安全側」の向きで、遅くなるだけだから。
 */
const DOM_TOKEN = new RegExp(
    "\\b(?:window|document|navigator|localStorage|sessionStorage|caches|matchMedia"
    + "|HTMLElement|HTMLImageElement|HTMLInputElement|SVGElement|CustomEvent|DOMParser"
    + "|IntersectionObserver|ResizeObserver|MutationObserver|requestAnimationFrame"
    + "|getComputedStyle|createObjectURL|FileReader|DragEvent|PointerEvent|KeyboardEvent"
    + "|TouchEvent|MouseEvent|createElement|getElementById|querySelector|addEventListener"
    + "|jsdom|screen|render|fireEvent|act)\\b",
);

const IMPORT_RE = /(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|vi\.mock\s*\(\s*["']([^"']+)["']/g;

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

/**
 * **コメントと（引用符の）文字列を落としてから印を探す。**
 *
 * これを省くと、**コメントに `localStorage` と書いてあるだけの Lambda**
 * （`api-user/src/uploadPolicy.ts:17`——Cognito のトークンの話を説明している）
 * が DOM 扱いになり、それを import する `api-user/src/__tests__` の
 * **19本がまるごと jsdom に落ちる**。実測で **62本**がこの形だった。
 * `api-user/src/photoUpdate.ts:227` の `"Two document paths overlap"`
 * （DynamoDB のエラー文）も同じ。
 *
 * 行コメントの判定は `api-user/src/__tests__/importCycle.test.ts` と同じ形
 * （引用符に挟まれていない `//` だけを落とす）。あちらは import の辺を
 * 偽造されないため、こちらは環境の判定を誤らないため——**同じ罠**。
 *
 * **テンプレート literal（バッククォート）は落とさない。** 中の `${...}` は
 * 本物のコードで、`${document.title}` のような DOM 参照が隠れうる。
 */
export function stripCommentsAndStrings(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
    return noBlock
        .split("\n")
        .map((line) => {
            let out = "";
            let quote = null;   // 開いている引用符（" ' `）
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (quote) {
                    if (c === "\\") { if (quote === "`") out += c + (line[i + 1] ?? ""); i++; continue; }
                    if (c === quote) { if (quote === "`") out += c; quote = null; continue; }
                    // ` の中身は本物のコードを含みうるので通す。" と ' は落とす
                    if (quote === "`") out += c;
                    continue;
                }
                if (c === '"' || c === "'" || c === "`") { quote = c; if (c === "`") out += c; continue; }
                if (c === "/" && line[i + 1] === "/") break;
                out += c;
            }
            return out;
        })
        .join("\n");
}

export function createClassifier(root) {
    const cache = new Map();
    const read = (p) => {
        if (!cache.has(p)) {
            try { cache.set(p, fs.readFileSync(p, "utf8")); } catch { cache.set(p, ""); }
        }
        return cache.get(p);
    };

    const specsOf = (src) => {
        const out = [];
        for (const m of src.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
        return out.filter(Boolean);
    };

    /** リポジトリ内のファイルだけ解決する（パッケージは null） */
    const resolveLocal = (spec, from) => {
        let base;
        if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
        else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
        else return null;
        for (const e of EXTS) {
            const c = base + e;
            try { if (fs.statSync(c).isFile()) return c; } catch { /* 無い */ }
        }
        return null;
    };

    /** その1枚が持つ DOM の印（無ければ null） */
    const markOf = (file) => {
        if (file.endsWith(".tsx")) return "tsx";
        const src = read(file);
        for (const s of specsOf(src)) if (DOM_PKG.test(s)) return `pkg:${s}`;
        // **印はコメント・文字列を落としてから探す**（上の説明を参照）。
        // import の抽出は元のまま——落とした側から import は読めない。
        const m = stripCommentsAndStrings(src).match(DOM_TOKEN);
        return m ? `token:${m[0]}` : null;
    };

    /** テスト1本を判定する。`{ env, why }` を返す */
    const classify = (testFile) => {
        const seen = new Set();
        const stack = [testFile];
        while (stack.length) {
            const f = stack.pop();
            if (seen.has(f)) continue;
            seen.add(f);
            const mark = markOf(f);
            if (mark) return { env: "jsdom", why: `${path.relative(root, f)} → ${mark}` };
            for (const s of specsOf(read(f))) {
                const local = resolveLocal(s, f);
                if (local && !seen.has(local)) stack.push(local);
            }
        }
        return { env: "node", why: "" };
    };

    return { classify, markOf };
}

/** リポジトリ内のテストファイルを全部集める（相対パス・昇順） */
export function findTestFiles(root) {
    const out = [];
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (SKIP_DIR.test(path.relative(root, p))) continue;
            if (e.isDirectory()) walk(p);
            else if (TEST_RE.test(e.name)) out.push(path.relative(root, p));
        }
    };
    walk(root);
    return out.sort();
}

/** node で回せるテストの一覧（相対パス・昇順） */
export function nodeEnvTestFiles(root) {
    const { classify } = createClassifier(root);
    return findTestFiles(root).filter((f) => classify(path.join(root, f)).env === "node");
}

/**
 * パスを**そのパスだけに当たるグロブ**に変える。
 *
 * vitest の `include` / `exclude` はグロブなので、**パスをそのまま渡すと
 * 特殊文字が模様として読まれる**。このリポジトリには
 * `app/photo/[id]/__tests__/**` が15本あり、`[id]` は
 * 「i か d のどれか1文字」という文字クラスになる。
 *
 * **実測（picomatch・vitest が使うグロブ）**:
 *
 *     生のパス  app/photo/[id]/__tests__/foo.test.ts
 *       → 自分自身            当たる（literal への落とし戻しがある）
 *       → app/photo/i/...     **当たる**   ← これが困る
 *       → app/photo/d/...     **当たる**
 *     逃がしたもの  app/photo/\[id\]/__tests__/foo.test.ts
 *       → 自分自身            当たる
 *       → app/photo/i/...     当たらない
 *
 * つまり壊れ方は「本人に当たらない」ではなく「**余計なものにも当たる**」。
 * jsdom 側の `exclude` にこれが入ると、**無関係の実在ファイルが
 * どちらの project からも外れて、黙って走らなくなる**。
 *
 * 今はたまたま `[id]` 配下が全部 jsdom 側（`.tsx` か DOM 持ち）なので
 * 表に出ていないが、**あそこに DOM を使わない `.ts` のテストが1本増えた日**に
 * 効いてくる。見張りは `scripts/__tests__/testEnvSplit.test.ts`。
 */
export function escapeGlob(p) {
    return p.replace(/[\\[\]{}()!*?+@]/g, "\\$&");
}

/**
 * `vitest.config.ts` がそのまま `include` / `exclude` に渡す形の一覧。
 * **逃がしたあとの姿をここで作る**——config と見張り
 * （`scripts/__tests__/testEnvSplit.test.ts`）が同じ1本を見るため。
 * どちらかが自前で `escapeGlob` を掛け直すと、見張りが本物を見なくなる。
 */
export function nodeEnvTestGlobs(root) {
    return nodeEnvTestFiles(root).map(escapeGlob);
}
