import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **字の並びは `globals.css` の `@theme` の1か所だけが持つ（2026-10-15・アプリ v2）。**
 *
 * 以前は本文が `Inter`（日本語の字を持たない）のクラスで、`fallback` と
 * ヘッダーの `.site-header__nav` の2か所に同じ並びを写して縛っていた。
 * Inter をやめ、本文・ヘッダー・数字は `--font-sans` / `--font-mono`、
 * 見出しは `--font-serif`（Shippori Mincho B1）を読むだけにした。
 * ここで縛るのは「写しが生まれていないこと」と「並びが壊れていないこと」。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** `@theme` の `--font-<name>` の並び */
function themeStack(name: string): string[] {
    const css = read("app/globals.css");
    const m = new RegExp(`--font-${name}:\\s*([^;]+);`).exec(css);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

const GENERIC = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif"]);

/**
 * `public/offline.html` の宣言（**3つ目の写し**）。
 *
 * あのページは Service Worker が機内モードで出す受け皿で、**アプリの CSS も
 * JS も届かない**（それが存在理由）。だから宣言を共有できず、必ず写しになる。
 *
 * **並びまで同じにはしない。** あちらは単独のページとして独立に書かれていて
 * （`-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif`）、
 * どちらの並びが良いかは字体の好みの判断＝owner の領分。
 * ここで縛るのは**壊れ方が同じ2つ**だけ:
 *   - 総称ファミリで終わらない（ブラウザの既定に落ちる。環境により明朝）
 *   - 日本語の字体を1つも名指ししない
 */
function offlineStack(): string[] {
    const html = read("public/offline.html");
    const m = /font-family:\s*([^;}]+)/.exec(html);
    if (!m) return [];
    return m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, ""));
}

describe("本文の字体", () => {
    it("`--font-sans` を読めている（空振りしていない）", () => {
        expect(themeStack("sans").length).toBeGreaterThan(2);
    });

    it("総称ファミリで終わる（無い端末でブラウザの既定＝環境により明朝に落ちない）", () => {
        expect(GENERIC.has(String(themeStack("sans").at(-1)))).toBe(true);
    });

    it("アプリと同じシステムの字から始まり、日本語の字体を名指ししている", () => {
        expect(themeStack("sans")[0]).toBe("-apple-system");
        expect(themeStack("sans").some((f) => /JP|Hiragino/i.test(f)), "日本語の字体が並びに無い").toBe(true);
    });

    // html/body とヘッダーが並びを写さず変数を読む（写すと、また割れる）
    it("本文とヘッダーは `var(--font-sans)` を読むだけ", () => {
        const css = read("app/globals.css");
        const body = /color-scheme:\s*dark;\s*font-family:\s*([^;]+);/.exec(css);
        expect(body?.[1].trim()).toBe("var(--font-sans)");
        const nav = /\.site-header__nav\s*\{[^}]*font-family:\s*([^;}]+)/.exec(css);
        expect(nav?.[1].trim()).toBe("var(--font-sans)");
    });

    // 日本語の字を持たない Inter を本文に戻さない
    it("Inter を読んでいない", () => {
        expect(read("app/layout.tsx")).not.toMatch(/\bInter\b\s*[,(}]/);
    });

    // owner の好み（2026-10-02）: 数字・眉ラベルは等幅の字ではなく本文の字＋等幅数字
    it("`--font-mono` は本文と同じ字で、等幅数字を足している", () => {
        expect(themeStack("mono")).toEqual(themeStack("sans"));
        expect(read("app/globals.css")).toMatch(/\.font-mono\s*\{\s*font-variant-numeric:\s*tabular-nums;/);
    });
});

/**
 * **見出しの明朝（Shippori Mincho B1 Bold・iOS の `JPFont.display` と同じ字）。**
 * 配線は2か所（`layout.tsx` が変数を立て、`globals.css` の `--font-serif` が先頭で読む）。
 * 片方だけ消えても画面は落ちず、**黙って端末の明朝に落ちる**ので機械で縛る。
 */
describe("見出しの明朝（webfont の配線）", () => {
    const call = () => /Shippori_Mincho_B1\(\{([\s\S]*?)\}\)/.exec(read("app/layout.tsx"));

    it("`layout.tsx` が読み、`--font-mincho` を <body> に立てている", () => {
        const src = read("app/layout.tsx");
        expect(call(), "Shippori_Mincho_B1 を読んでいない").not.toBeNull();
        expect(call()![1]).toContain('variable: "--font-mincho"');
        expect(src).toContain("mincho.variable");
    });

    // 検証サイトで明朝が1か所も当たっていなかった（2026-10-15）。`--font-mincho` は <body> の
    // クラスが立てるので、`:root` で計算されるふつうの `@theme` からは見えず、値ごと無効になる
    it("`--font-serif` は `@theme inline` に置く（:root では --font-mincho が見えない）", () => {
        const css = read("app/globals.css");
        const inline = /@theme inline\s*\{([^}]*)\}/.exec(css);
        expect(inline, "@theme inline が無い").not.toBeNull();
        expect(inline![1]).toMatch(/--font-serif:\s*var\(--font-mincho\)/);
        const plain = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
        expect(plain![1], "ふつうの @theme に --font-serif がある").not.toMatch(/--font-serif:/);
    });

    it("`--font-serif` が変数を先頭で読み、端末の明朝と総称 serif が続く", () => {
        const st = themeStack("serif");
        expect(st[0]).toBe("var(--font-mincho)");
        expect(st).toContain("Hiragino Mincho ProN");
        expect(st.at(-1)).toBe("serif");
    });

    // 手書き2種と同じ理由（下の describe の docstring）
    it("subsets・fallback を渡さず、preload を切り、太さは 700 だけ", () => {
        const body = call()![1];
        expect(body).not.toMatch(/^\s*subsets:/m);
        expect(body).not.toMatch(/^\s*fallback:/m);
        expect(body).toMatch(/preload:\s*false/);
        expect(body).toMatch(/weight:\s*\["700"\]/);
    });
});

/**
 * **機内モードで出るページにも同じ性質を求める。**
 * ここは `app/globals.css` も `next/font` も届かないので、写しが1つ増える。
 */
describe("オフラインの受け皿（public/offline.html）", () => {
    it("宣言を読めている（空振りしていない）", () => {
        expect(offlineStack().length).toBeGreaterThan(2);
    });

    it("総称ファミリで終わる", () => {
        expect(GENERIC.has(String(offlineStack().at(-1))), `最後が総称でない: ${offlineStack().at(-1)}`).toBe(true);
    });

    it("日本語の字体を名指ししている", () => {
        expect(offlineStack().some((f) => /JP|Japanese|Gothic|Hiragino|ゴシック/i.test(f)), "日本語の字体が無い").toBe(true);
    });

    // 今日 `globals.css` に足したのと同じもの。あちらの CSS は届かないので、
    // このページは自分で持つ必要がある（実際に持っている）
    it("暗い配色を宣言している", () => {
        const html = read("public/offline.html").replace(/<!--[\s\S]*?-->/g, "");
        expect(/color-scheme:\s*dark/.test(html), "color-scheme: dark が無い（UA の部品が明色のまま）").toBe(true);
    });
});

/**
 * **手書き2種だけは webfont**（owner の要望 2026-09-22
 * 「広告でよくある手書きのフォントも欲しい」「アオハルマーカー mini /
 * みぎかたあがり のフォントがいい」）。
 *
 * 名指しの2つはそのまま使えない——アオハルマーカーmini は**漢字を持たず**、
 * みぎかたあがり は**漢字が69字だけ**で、文章に混ぜると「かなは手書き・
 * 漢字はゴシック」になる。配布元の規約にも Web フォント可の明記が無い
 * （Web フォントはファイルを閲覧者全員へ配る行為）。だから**見た目が
 * いちばん近く、漢字を持ち、配ってよい**（SIL OFL）2つを使う:
 * `Yusei Magic`（油性マジック）と `Yomogi`（ヨモギ）。
 *
 * **配線は2か所**（`layout.tsx` が変数を立て、`storyText.ts` がそれを使う）。
 * 片方だけ消えても画面は落ちず、**黙って丸ゴシックに落ちる**ので機械で縛る。
 */
describe("ストーリーの手書き（webfont の配線）", () => {
    const layout = () => read("app/layout.tsx");
    const FONTS = [
        { fn: "Yusei_Magic", varName: "--font-marker", local: "marker", key: "marker" },
        { fn: "Yomogi", varName: "--font-scribble", local: "scribble", key: "scribble" },
    ] as const;

    for (const f of FONTS) {
        it(`\`layout.tsx\` が ${f.fn} を読み、\`${f.varName}\` を立てている`, () => {
            const src = layout();
            expect(src, `${f.fn} を読んでいない`).toMatch(new RegExp(`${f.fn}\\(`));
            expect(src, "CSS 変数の名前が違う").toContain(`variable: "${f.varName}"`);
            expect(src, "<body> に変数が付いていない").toContain(`${f.local}.variable`);
        });

        /**
         * **`subsets` を書かない。** next/font の一覧に `japanese` が無く
         * （`font-data.json` は cyrillic/greek-ext/latin/latin-ext だけ）、
         * `latin` と書くと**日本語の字が1つも入らない**まま緑になる。
         */
        it(`${f.fn} に \`subsets\` を渡していない（渡すと日本語が入らない）`, () => {
            const m = new RegExp(`${f.fn}\\(\\{([\\s\\S]*?)\\}\\)`).exec(layout());
            expect(m, `${f.fn} の呼び出しが読めない`).not.toBeNull();
            expect(m![1], "subsets を渡すと日本語のグリフが落ちる").not.toMatch(/^\s*subsets:/m);
            // `subsets` を省くときは `preload: false` が要る（Next が止める）。
            // 全ページに何十本ぶんもの preload を出さない意味もある
            expect(m![1], "preload を切っていない").toMatch(/preload:\s*false/);
        });

        /**
         * ⚠️ **`fallback` を渡さない。** 渡すと next/font はそれを
         * **CSS 変数の中へそのまま焼き込む**ので、`storyText.ts` の
         * `var(--font-marker),"Hiragino…",cursive` が実際にはこう展開される:
         *
         *     "Yusei Magic",Hiragino Maru Gothic ProN,Hiragino Sans,sans-serif,
         *     "Hiragino Maru Gothic ProN","Hiragino Sans",cursive
         *      ^^^^^^^^^^ ここで総称ファミリに当たって並びが終わる
         *
         * 実ブラウザで計算後の値を読んで見つけた（`getComputedStyle`）。
         * 後ろ半分は**永久に使われない**＝末尾を `cursive` にした意味が消える。
         * 受け皿の並びは `storyText.ts` 側の1か所だけが持つ。
         *
         * 渡さないと変数は `"Yusei Magic","Yusei Magic Fallback"` になる。
         * 後者は `src:local(Arial)` の字幅合わせ面で**日本語の字を持たない**
         * ので、日本語は字ごとに次（Hiragino）へ落ちる。
         */
        it(`${f.fn} に \`fallback\` を渡していない（渡すと並びが二重になり cursive に届かない）`, () => {
            const m = new RegExp(`${f.fn}\\(\\{([\\s\\S]*?)\\}\\)`).exec(layout());
            expect(m, `${f.fn} の呼び出しが読めない`).not.toBeNull();
            expect(m![1], "fallback は storyText.ts 側だけが持つ").not.toMatch(/^\s*fallback:/m);
            // ⚠️ `adjustFontFallback: false` は**効かない**（実ビルドで確認。
            // 渡しても `Yusei Magic Fallback` の @font-face は出て変数にも入る）。
            // 効かない指定を置かない
            expect(m![1], "効かない指定（adjustFontFallback）が残っている").not.toMatch(/adjustFontFallback/);
        });

        it(`\`storyText.ts\` の ${f.key} がその変数を先頭で使い、落ちても読める並びが続く`, async () => {
            const { STORY_FONTS } = await import("@/lib/utils/storyText");
            const css = STORY_FONTS[f.key].css;
            expect(css, "変数を使っていない（別名で宣言すると黙って落ちる）").toBe(css);
            expect(css.startsWith(`var(${f.varName})`), "変数が先頭に無い").toBe(true);
            expect(css, "落ちたときの受け皿が無い").toContain("Hiragino Maru Gothic ProN");
            expect(css.split(",").at(-1)!.trim(), "総称ファミリで終わっていない").toBe("cursive");
        });
    }
});

/**
 * **眉ラベルは `eyebrow` の1つだけ**（iOS の `jpEyebrow()`・2026-10-15）。
 * 以前は11か所が手で書き、字間 0.12em / 0.16em / 1.5px と等幅の有無が割れていた。
 */
describe("眉ラベル", () => {
    it("`globals.css` が `eyebrow` を v2 の値（600・11・字間 0.14em・大文字・数字の字）で定義している", () => {
        const m = /@utility eyebrow\s*\{([^}]*)\}/.exec(read("app/globals.css"));
        expect(m, "eyebrow が無い").not.toBeNull();
        expect(m![1]).toMatch(/font-family:\s*var\(--font-mono\)/);
        expect(m![1]).toMatch(/font-size:\s*11px/);
        expect(m![1]).toMatch(/font-weight:\s*600/);
        expect(m![1]).toMatch(/letter-spacing:\s*0\.14em/);
        expect(m![1]).toMatch(/text-transform:\s*uppercase/);
    });

    it("手で書いた眉ラベルが残っていない", async () => {
        const { readdirSync } = await import("node:fs");
        const files = (readdirSync(join(process.cwd(), "app"), { recursive: true }) as string[])
            .filter((f) => f.endsWith(".tsx") && !f.includes("__tests__"))
            .map((f) => join("app", f));
        expect(files.length, "ファイルを読めていない").toBeGreaterThan(50);
        const hand = files.filter((f) => /letterSpacing:\s*"(1\.5px|0\.14em)"|tracking-\[0\.1[26]em\]/.test(read(f)));
        expect(hand, "`eyebrow` を使う").toEqual([]);
    });
});
