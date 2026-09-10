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

/** `serverless.yml` から、トークンを配ってある関数名を集める */
function wiredFns(): string[] {
    const out: string[] = [];
    for (const dir of ["api", "api-user"]) {
        const yml = readFileSync(join(ROOT, dir, "serverless.yml"), "utf8");
        const fnSection = yml.split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z#])/)[0];
        for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
            const m = /^\n?  (\w+):/.exec(part);
            if (m && part.includes("REBUILD_DISPATCH_TOKEN")) out.push(m[1]);
        }
    }
    return out;
}

describe("診断が見る「トークンを配ってあるべき関数」", () => {
    const src = readFileSync(join(ROOT, "scripts", "diagnose-aws.js"), "utf8");

    // **手で並べない。** 並べると、配線を増やしたときに診断だけが古くなる
    it("一覧を手で書いていない（serverless.yml から読む）", () => {
        expect(src, "手で並べた一覧に戻っている")
            .not.toMatch(/const REBUILD_FNS = \[\s*"/);
        expect(src).toContain("rebuildFnsFromServerless()");
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
