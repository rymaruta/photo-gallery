import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// **変換確定の Enter は、ページには普通の Enter として届く**（Chromium で実測）。
// `e.key === "Enter"` だけを見る入力欄は、日本語で打つ人が必ず踏む:
//   曲検索は未確定の読み（「きょう」）で外部APIを叩き、
//   YouTube 欄は打っている途中で `PUT /photos/{id}` を投げてエラーを出し、
//   コメント欄は未確定の読みのまま公開コメントを投稿していた。
//
// **これは足し忘れが起きる形**（入力欄を1つ増やすたびに要る）なので、
// 機械的に確かめる。
//
// **最初の版には穴が4つあった**（レビューが変異で実証。いずれも素通り）:
//   1. `onKeyDown={...}` を `[^}]*` で切っていたので、ハンドラの中に `}` が
//      あると検出できない（複数行の分岐を書いた瞬間に外れる）
//   2. ハンドラを外に出す（`onKeyDown={onSongKey}`）と検出できない
//      ——このリポジトリの `FilterBar` が実際にその書き方
//   3. 同じファイルに入力欄が2つあって片方だけ外しても通る
//      （実際、写真ページの曲検索を外してもフルスイートが全緑だった）
//   4. `guardsComposition` がコメントを剥がしていないので、コメントに
//      `compositionstart` と書いてあるだけで通る
//
// なので **数で見る**: そのファイルにある Enter の判定の数だけ、
// 変換中を見る仕掛けがあること。走査は `app/` と `lib/` の両方。
//
// 逆に、ボタンやチップの Enter（入力欄ではない）には要らない——
// そこまで縛ると「変換していないのに押せない」を作る。
// 入力欄が1つも無いファイルは対象外にすることで、そこを外している。
const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });
}

/**
 * コメントを剥がしたコード（両方の判定で同じものを見る）。
 *
 * **`accept="image/[アスタリスク]"` をブロックコメントの開始と読んでは
 * いけない。** 素朴にブロックコメントを消すと、`app/user/profile/page.tsx`
 * の `accept` の値が開始タグになり、次の JSX コメントの終わりまでの
 * **93行（4,327文字）が走査から消える**——その中には @名と表示名の
 * 入力欄があった（レビューが実測）。開始の直前が行頭・空白・`{` の
 * ときだけコメントとして扱う。
 *
 * （この説明に本物の記号を書くと、この JSDoc 自身がそこで閉じる。
 * 実際に一度そうなって構文エラーになった。）
 *
 * 行コメントは行末のものも剥がす（`code; // isImeKey` と書けば通る、を塞ぐ）。
 * `https://` を巻き込まないよう、直前が `:` でないものだけ。
 */
const codeOf = (rel: string) =>
    readFileSync(join(ROOT, rel), "utf8")
        .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Enter を見ている回数（ハンドラが外に出ていても数えられる） */
const enterChecks = (code: string) => (code.match(/key\s*===\s*"Enter"/g) ?? []).length;

/** 変換中を見る仕掛けの数（共有の関数か、自前の composition 制御） */
const guards = (code: string) =>
    (code.match(/isImeKey\(/g) ?? []).length
    + (code.match(/onCompositionStart|compositionstart/g) ?? []).length;

/**
 * 数え上げから外す Enter と、その理由。
 *
 * **理由を書けるものだけ外す。** 数が合わないからと黙って外すと、
 * この走査は何も守らなくなる。
 */
const EXEMPT: Record<string, { skip: number; why: string }> = {
    // 修飾キー付きの送信は IME が消費しない。ガードを付けると、変換の
    // 要らない語を打ち終えた直後に**送信が黙って死ぬ**（実測して外した）
    "app/components/CommentSection.tsx": { skip: 1, why: "Ctrl/Cmd+Enter は IME が消費しない" },
    // タグのチップ（role="switch"）を Enter で押す判定。入力欄ではない
    "app/components/FilterBar.tsx": { skip: 1, why: "チップのキー操作（入力欄ではない）" },
};

describe("Enter を見る入力欄は、変換中を必ず見る", () => {
    const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]
        .map((f) => f.slice(ROOT.length + 1))
        // 入力欄を持たないファイルは対象外（ボタンやチップの Enter は縛らない）
        .filter((f) => /<(input|textarea)\b/.test(codeOf(f)));

    it("走査の対象が空になっていない（見張りが空振りしていない）", () => {
        expect(files.length, "入力欄を持つファイルが見つからない").toBeGreaterThan(3);
        expect(files.filter((f) => enterChecks(codeOf(f)) > 0).length,
            "Enter を見ている入力欄が1つも見つからない").toBeGreaterThan(0);
    });

    it("Enter の判定の数だけ、変換中を見る仕掛けがある", () => {
        const bad = files
            .map((f) => ({ f, need: enterChecks(codeOf(f)) - (EXEMPT[f]?.skip ?? 0), have: guards(codeOf(f)) }))
            .filter(({ need, have }) => have < need)
            .map(({ f, need, have }) => `${f}（要 ${need} / ガード ${have}）`);
        expect(bad, "変換確定の Enter で動いてしまう入力欄がある").toEqual([]);
    });

    // **外した理由が古くなっていないか。** 外したまま実体が消えると、
    // 次に同じファイルへ入力欄を足したときに1つぶん見逃す
    it.each(Object.entries(EXEMPT))("%s の除外がまだ要る", (f, { skip }) => {
        expect(files, "除外したファイルが対象から消えている（この行はもう要らない）").toContain(f);
        expect(enterChecks(codeOf(f)),
            "除外した数より Enter の判定が少ない（除外が古い）").toBeGreaterThanOrEqual(skip);
    });
});

// **この走査そのものが目を潰していた。**
// `accept="image/*"` をコメントの開始と読み、プロフィールの93行
// （@名と表示名の入力欄を含む）が見えていなかった。
describe("走査がコードを読み落としていない", () => {
    it("accept=\"image/*\" のあとも見えている", () => {
        const code = codeOf("app/user/profile/page.tsx");
        expect(code, "accept=\"image/*\" 以降が丸ごと消えている")
            .toContain("onCompositionStart");
        expect(code).toContain("placeholder=\"travel_photo\"");
    });

    it("本物のコメントは剥がす", () => {
        const code = codeOf("app/user/profile/page.tsx");
        expect(code).not.toContain("変換中は書き換えない");
    });
});
