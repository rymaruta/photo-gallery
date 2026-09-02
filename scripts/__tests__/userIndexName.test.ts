import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **索引名を3か所に書いている。**
//
// `api-user/src/dynamodb.ts` が正。`api/src/ddb-photos.ts` は別サービスなので
// import できず、`scripts/provision-env.js` は実際に索引を張る側（CommonJS）。
// やむを得ず複製しているので、ずれを止める（この台帳の型2「複製した規則は
// 静かにずれる」）。
//
// **ずれると症状が出ない。** 存在しない索引を Query すると
// `ValidationException` になるが、投稿一覧のような読み取りは try/catch や
// 空配列に落ちるので、画面には「写真が0枚」としか出ない。
//
// このファイルは一度 9e3c491 で消したが、**消しすぎだった**——消えたのは
// `userProfile.ts` の複製（改名の写しと一緒に撤去した）だけで、残る3つは
// 今も生きている。`api/src/ddb-photos.ts` は元からどのテストにも
// 守られていなかったので、戻すついでに加えた。
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function indexName(file: string, re: RegExp): string {
    const m = re.exec(read(file).replace(/^\s*\/\/.*$/gm, ""));
    expect(m, `${file} から索引名を読めない`).not.toBeNull();
    return m![1];
}

describe("ユーザーの索引名が1つに揃っている", () => {
    const canonical = () => indexName("api-user/src/dynamodb.ts",
        /export const USER_INDEX = "([^"]+)"/);

    it("dynamodb.ts から読める", () => {
        expect(canonical(), "空振りしている").toMatch(/\S/);
    });

    it("管理API（api/src/ddb-photos.ts）の複製と同じ", () => {
        const copy = indexName("api/src/ddb-photos.ts", /const USER_INDEX = "([^"]+)"/);
        expect(copy, "管理API が存在しない索引を引く（投稿一覧が空に見える）")
            .toBe(canonical());
    });

    // 本番に実在する索引名（`provision-env.js` が張る）とも合っていること。
    //
    // **`toContain` では見ていなかった。** 消す前の版はファイル全体に
    // 名前が含まれるかを見ており、同じファイルのコメント2か所（5行目と
    // 92行目）に索引名が書いてあるので、**実際に張る `IndexName:` を
    // 別名に変えても緑だった**（今回、変異させて実測した）。
    // 張る値そのものを読む。
    it("環境を作るスクリプトが張る索引名とも同じ", () => {
        const src = read("scripts/provision-env.js").replace(/^\s*\*.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
        const names = [...src.matchAll(/IndexName:\s*"([^"]+)"/g)].map((m) => m[1]);
        expect(names, "GSI を1つも張っていない").not.toHaveLength(0);
        expect(names, "張る索引名に、コードが引く名前が無い").toContain(canonical());
    });
});
