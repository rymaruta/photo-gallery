import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 **デプロイ後の配信チェックが、ページを一度も見ていなかった。**
 *
 * 見ていたのは `_next/static/**.js` と `.css` ——**拡張子の付いたキーそのもの**
 * なので、このサイトで一番外れたら困る2つを一度も通らない:
 *
 *   - `/photo/<id>` → `photo/<id>.html` の**エッジの書き換え**
 *     （既定ビヘイビアの viewer-request。`diagnose-aws.js` が
 *      「一番外れたら困る設定」「コードはこのリポジトリに無い」と書いている）
 *   - **百分率エンコードされた日本語のパス**（撮影地ページ14枚は全部が非ASCII、
 *     5枚はサイトマップに載っている）
 *
 * 外れると**トップ以外の全ページが 404** になるのに、デプロイは「成功」と出る。
 *
 * ここで固定するのは**何を見に行くか**（`pageCheckTargets`）。
 * 実際の fetch は CI ランナーの IP 次第で落ちるので、判定は
 * アドバイザリのまま（デプロイは止めない）。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pageCheckTargets, runnerLooksReachable } = require("../deploy-static-site.js") as {
    pageCheckTargets: (keys: string[]) => Array<{ key: string; url: string }>;
    runnerLooksReachable: (badCount: number, total: number) => boolean;
};

const ALL = [
    "index.html",
    "privacy.html",
    "photo/abc-123.html",
    "tag/finland.html",
    "location/パリ.html",
    "location/東京.html",
    "users/u1.html",
];

describe("デプロイ後に見に行くページ", () => {
    it("トップ・拡張子なしの入れ子・非ASCII の3つを選ぶ", () => {
        const t = pageCheckTargets(ALL);
        expect(t.map((x) => x.url)).toEqual(["/", "/photo/abc-123", "/location/%E3%83%91%E3%83%AA"]);
    });

    // 🔴 **これが無いと、エンコードの経路を一度も通らない。**
    it("非ASCII の行き先が必ず1つ入る（エンコードされている）", () => {
        const t = pageCheckTargets(ALL);
        expect(t.some((x) => x.url.includes("%")), "日本語のパスを見に行っていない").toBe(true);
    });

    // 🔴 **これが無いと、エッジの書き換えを一度も通らない。**
    it("拡張子なしの入れ子が必ず1つ入る（トップ以外）", () => {
        const t = pageCheckTargets(ALL);
        expect(t.some((x) => x.url !== "/" && x.url.includes("/", 1) && !x.url.endsWith(".html")),
            "書き換えを通すページを見に行っていない").toBe(true);
    });

    it("区切りはエンコードしない（`/` が `%2F` にならない）", () => {
        const t = pageCheckTargets(["location/フランス-ヴェルサイユ.html"]);
        expect(t[0].url.startsWith("/location/")).toBe(true);
        expect(t[0].url).not.toContain("%2F");
    });

    it("写真ページが無ければ、他の入れ子で代用する", () => {
        const t = pageCheckTargets(["index.html", "tag/finland.html", "location/パリ.html"]);
        expect(t.map((x) => x.url)).toEqual(["/", "/tag/finland", "/location/%E3%83%91%E3%83%AA"]);
    });

    it("撮影地が無ければ、他の非ASCII で代用する", () => {
        const t = pageCheckTargets(["index.html", "photo/a.html", "tag/風景.html"]);
        expect(t.map((x) => x.url)).toEqual(["/", "/photo/a", "/tag/%E9%A2%A8%E6%99%AF"]);
    });

    it("同じ行き先を2回見に行かない", () => {
        const t = pageCheckTargets(["index.html", "index.html", "photo/a.html", "photo/a.html"]);
        expect(t.map((x) => x.url)).toEqual(["/", "/photo/a"]);
    });

    it("HTML が無ければ何も見に行かない（空回りで警告を出さない）", () => {
        expect(pageCheckTargets(["_next/static/x.js", "robots.txt"])).toEqual([]);
    });

    /**
     * **配線はソースを読むしかない**（`main()` は export していない）。
     *
     * ⚠️ **コメントを落とす処理は通さない。** 素朴な
     * `\/\*[\s\S]*?\*\/` は、このファイルの `` `/${dir}/*` `` や
     * `"/*" だと写真まで…` という**文字列の中の `/*`** を
     * ブロックコメントの開始と読んで、**900行中338行を消す**
     * （レビューが実測）。消えた範囲にこの配線が入ると、正しいのに
     * 「呼ばれていない」で落ちる。素のまま、正確な綴りで見る。
     */
    it("デプロイの本体から呼ばれている（ランナーの到達性を渡している）", () => {
        const src = readFileSync(join(__dirname, "..", "deploy-static-site.js"), "utf8");
        expect(src, "verifyPages が呼ばれていない").toMatch(/await verifyPages\(htmlFiles,\s*runnerReachable\)/);
        expect(src, "アセットの結果を受けていない（ページだけ落ちた回を見分けられない）")
            .toMatch(/const runnerReachable = await verifyAssets\(/);
    });
});

/**
 * 🔴 **ページの失敗を「エッジの書き換えが外れた」と読んでよい条件。**
 *
 * 以前ここは「呼び出し側の綴り」しか見ていなかった。`verifyAssets` から
 * `return true` / `return false` を**両方消しても9件とも緑**で、その状態では
 * 戻り値が常に `undefined` ＝このコミットの目的である 🔴 分岐が二度と
 * 発火しない（レビューが実測）。**判定そのものを純関数にして直接見る。**
 */
describe("ランナーが配信ドメインに届いているか", () => {
    it("1件も見ていないときは「届いている」（見ていないを落ちた扱いにしない）", () => {
        expect(runnerLooksReachable(0, 0)).toBe(true);
    });

    // 🔴 **1件のフレークで、いちばん強い警告を消さない。**
    it("1件だけ落ちても届いている扱い", () => {
        expect(runnerLooksReachable(1, 100)).toBe(true);
        expect(runnerLooksReachable(0, 100)).toBe(true);
    });

    it("過半が落ちていれば届いていない扱い（WAF の一律403）", () => {
        expect(runnerLooksReachable(100, 100)).toBe(false);
        expect(runnerLooksReachable(50, 100)).toBe(false);
    });

    // 境界（`badCount * 2 < total`）をそのまま固定する
    it("ちょうど半分は「届いていない」側", () => {
        expect(runnerLooksReachable(2, 4)).toBe(false);
        expect(runnerLooksReachable(1, 4)).toBe(true);
    });
});
