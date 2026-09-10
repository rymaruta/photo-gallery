import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **診断の数え方を自分で狭くして「0件」と報告する**のは、この台帳が
// 一度戒めた形（そのときも同じスクリプト）。今回は
// `REBUILD_FNS` に5つだけ手で並べていて、実際に配線されている8つのうち
// **3つを見落としていた**——トークンを登録して5つにだけ届いた状態でも
// `!!` が消え、「済んだ」と読めてしまう。`savePhoto` は公開時に再ビルドを
// 頼む当のものなので、そこが黙って外れるのがいちばん困る。
const ROOT = join(__dirname, "..", "..");

// **本物を呼ぶ。** 一度ここに同じ読み取りを写して検証していたが、
// それでは**写しが正しいこと**しか確かめられない——本体の
// `part.includes("REBUILD_DISPATCH_TOKEN")` を壊しても3本とも緑だった
// （実測）。壊れると `!!` が1つも出ず、トークンが無いことに気づけなくなる。
// **「複製した規則は静かにずれる」を防ぐために書いたテストの中で、
// まさにそれをやっていた。**
// `requireEnv` は `main()` の中なので、require の副作用は無い。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rebuildFnsFromServerless, reportFunctions, REBUILD_FNS } = require("../diagnose-aws.js");
const wiredFns = (): string[] => rebuildFnsFromServerless();

describe("診断が見る「トークンを配ってあるべき関数」", () => {
    const src = readFileSync(join(ROOT, "scripts", "diagnose-aws.js"), "utf8");

    // **手で並べない。** 並べると、配線を増やしたときに診断だけが古くなる
    it("一覧を手で書いていない（serverless.yml から読む）", () => {
        expect(src, "手で並べた一覧に戻っている")
            .not.toMatch(/const REBUILD_FNS = \[\s*"/);
        expect(src).toContain("rebuildFnsFromServerless()");
    });

    // **0件を静かに素通ししない。** 読み取りが壊れると `wantToken` が
    // 全関数 false になり、`!!` が1つも出ない＝「全部揃っている」と
    // 同じ絵になる
    it("読み取りが壊れたら 0件になる（＝壊れたことが分かる形）", () => {
        expect(wiredFns().length, "1つも読めていない").toBeGreaterThan(5);
    });

    // **ソースの綴りではなく、出た行を見る。**
    //
    // ここは以前 `expect(src).toContain("再ビルドのトークンを持つ関数")` と
    // 書いていた。文字列が在るかしか見ていないので、**数え方を
    // `REBUILD_FNS.length`（＝全部揃っていると嘘をつく）に変えても
    // 509件すべて緑**だった（レビューが変異で実証）。分母を出した目的は
    // 「0件が『問題なし』なのか『見ていない』なのかを読めるように」なので、
    // 嘘の数が出せる状態では目的を果たしていない。
    const fn = (name: string, hasToken: boolean) => ({
        FunctionName: `photo-gallery-user-api-prod-${name}`,
        Role: "arn:aws:iam::1:role/shared",
        Environment: { Variables: hasToken ? { REBUILD_DISPATCH_TOKEN: "x" } : {} },
    });

    it("トークンを持つ関数の数を、実際に数えて出す", () => {
        const wired = wiredFns();
        const lines = reportFunctions([fn(wired[0], true), fn(wired[1], false)]).join("\n");
        expect(lines, "数えずに分母をそのまま出している（全部揃っていると嘘をつく）")
            .toContain(`再ビルドのトークンを持つ関数 1/${REBUILD_FNS.length}`);
        // トークンが無い方には理由付きの `!!` が出る
        expect(lines).toContain("再ビルドのトークンが無い");
    });

    it("1つも持っていなければ 0 と出す", () => {
        const wired = wiredFns();
        const lines = reportFunctions([fn(wired[0], false)]).join("\n");
        expect(lines).toContain(`再ビルドのトークンを持つ関数 0/${REBUILD_FNS.length}`);
    });

    // **配る対象が0件のときは、それ自体を `!!` で言う。**
    // ここも `expect(src).toContain("REBUILD_FNS.length === 0")` だったので、
    // 条件を `false &&` で殺しても緑だった
    it("配る対象を1つも読み取れなければ、診断が壊れていると言う", () => {
        // 実際の一覧は8件なので、この分岐が生きていることは
        // 「8件のときは出ない」で確かめる（出ていたら常時 `!!` になる）
        expect(REBUILD_FNS.length, "一覧が空になっている").toBeGreaterThan(5);
        expect(reportFunctions([fn(wiredFns()[0], true)]).join("\n"))
            .not.toContain("1つも読み取れなかった");
        expect(src, "0件を知らせる分岐が無い")
            .toMatch(/if \(REBUILD_FNS\.length === 0\)/);
    });

    // 読み取りの実装がここと同じ結果を出すこと（両方が同じ規則で読む）
    it("配線されている関数を全部拾う", () => {
        const wired = wiredFns();
        expect(wired.length, "1つも拾えていない（正規表現が壊れている）").toBeGreaterThan(5);
        // 契約（rebuildTokenScope.test.ts）と同じ集合であること
        const contract = readFileSync(join(ROOT, "scripts", "__tests__", "rebuildTokenScope.test.ts"), "utf8");
        for (const fn of wired) {
            expect(contract, `${fn} が契約の一覧に無い`).toContain(`"${fn}"`);
        }
    });

    // **`savePhoto` は落とせない。** 公開したときに静的ページを作って
    // もらう当のもので、トークンが無いと最大7日 世に出ない
    it("savePhoto と presignedUrl / discardUpload を含む", () => {
        const wired = wiredFns();
        for (const fn of ["savePhoto", "presignedUrl", "discardUpload", "updatePhoto", "deletePhoto"]) {
            expect(wired, `${fn} を診断が見ていない`).toContain(fn);
        }
    });
});
