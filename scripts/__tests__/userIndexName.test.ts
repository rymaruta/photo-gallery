import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **索引名を2か所に書いている。**
//
// `api-user/src/dynamodb.ts` が正だが、`userProfile.ts` は生の
// `DynamoDBClient` を使っていて、あちらを import すると DocumentClient の
// 生成まで引き込む（読み込むだけで env と実クライアントが要る）。
// やむを得ず複製しているので、ずれを止める（この台帳の型2）。
//
// **ずれると症状が出ない。** 存在しない索引を Query すると
// `ValidationException` になり、改名の写しは try/catch で握られるので
// **黙って何もしない**——「改名しました」と出て、写真の名前だけ古いまま
// 残る。直したはずの形にそのまま戻る。
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function indexName(file: string, re: RegExp): string {
    const m = re.exec(read(file).replace(/^\s*\/\/.*$/gm, ""));
    expect(m, `${file} から索引名を読めない`).not.toBeNull();
    return m![1];
}

describe("ユーザーの索引名が1つに揃っている", () => {
    it("dynamodb.ts と userProfile.ts で同じ", () => {
        const canonical = indexName("api-user/src/dynamodb.ts",
            /export const USER_INDEX = "([^"]+)"/);
        const copy = indexName("api-user/src/userProfile.ts",
            /const USER_INDEX = "([^"]+)"/);
        expect(canonical, "空振りしている").toMatch(/\S/);
        expect(copy, "改名の写しが存在しない索引を引く（黙って何もしなくなる）").toBe(canonical);
    });

    // 本番に実在する索引名（`provision-env.js` が作る）とも合っていること
    it("環境を作るスクリプトが張る索引名とも同じ", () => {
        const canonical = indexName("api-user/src/dynamodb.ts",
            /export const USER_INDEX = "([^"]+)"/);
        expect(read("scripts/provision-env.js")).toContain(canonical);
    });
});
