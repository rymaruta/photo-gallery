import { describe, it, expect } from "vitest";
import { isUserId } from "../../api-user/src/userId";

// **同じ「Cognito の sub の形か」を、2か所が別の規則で書いている。**
//
//   api-user/src/userId.ts   isUserId    素の16進（版も variant も見ない）
//   scripts/backfill-followers.js  USER_ID_RE  版 1-5・variant 8-b まで見る
//
// 今のところ実害は無い（Cognito の sub は UUIDv4 なので両方通る）。
// 危ないのは**ずれる向き**で、
//
//   - スクリプトの方が厳しい（今の形）＝ API が受け付けたゴミを埋め戻しが
//     捨てる。捨てた件数と理由は出るので、気づける
//   - **スクリプトの方が緩い**＝ API が弾いた形の行を、埋め戻しが
//     `followers#` に書き込む。誰も掃除しないゴミが増える
//
// **後者を作らせない**のがこのテストの仕事。文字どおりの一致は求めない
// （わざと違う規則にしてある）が、包含関係は機械で縛る。
// `mediaHostsParity` / `cdnInvalidateParity` は「完全一致」で縛る形だが、
// ここは同じ手が使えない——だから振る舞いで見る。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { USER_ID_RE } = require("../backfill-followers.js");

const scriptAccepts = (v: string): boolean => USER_ID_RE.test(v);

/** 16進1文字ずつを混ぜた UUID 風の文字列を作る */
function uuidLike(version: string, variant: string): string {
    return `0123abcd-4567-${version}89a-${variant}bcd-0123456789ab`;
}

const HEX = "0123456789abcdef".split("");

describe("userId の形を見る規則（API とスクリプト）", () => {
    it("スクリプトが通すものは、API も必ず通す", () => {
        // 版 × variant の全16×16通りを総当たりする。
        // **片方だけ緩めた変更を、ここで止める**
        const leaked: string[] = [];
        for (const version of HEX) {
            for (const variant of HEX) {
                const v = uuidLike(version, variant);
                if (scriptAccepts(v) && !isUserId(v)) leaked.push(v);
            }
        }
        expect(leaked, "埋め戻しが、APIの弾く形を書き込む").toEqual([]);
    });

    it("実際の sub の形（UUIDv4）は両方が通す", () => {
        const v4 = "22222222-2222-4222-8222-222222222222";
        expect(isUserId(v4), "API が本物の sub を弾いている").toBe(true);
        expect(scriptAccepts(v4), "埋め戻しが本物の sub を捨てている").toBe(true);
    });

    // **両方が弾くこと。** 片方が通すと、どちらかの穴になる
    it("UUID でない文字列は両方が弾く", () => {
        for (const bad of [
            "", "me", "not-a-uuid",
            "22222222-2222-4222-8222-22222222222",     // 1文字短い
            "22222222-2222-4222-8222-2222222222222",   // 1文字長い
            "22222222_2222_4222_8222_222222222222",    // 区切りが違う
            "gggggggg-2222-4222-8222-222222222222",    // 16進でない
            " 22222222-2222-4222-8222-222222222222",   // 前後の空白
            "follow#22222222-2222-4222-8222-222222222222",
        ]) {
            expect(isUserId(bad), `API が通している: ${JSON.stringify(bad)}`).toBe(false);
            expect(scriptAccepts(bad), `埋め戻しが通している: ${JSON.stringify(bad)}`).toBe(false);
        }
    });

    // ずれている向きを、事実として書き留めておく（片方だけ直した日に
    // このテストが「意図が変わった」と教える）
    it("いまは、スクリプトの方が厳しい", () => {
        const v0 = uuidLike("0", "0");   // 版0・variant 0
        expect(isUserId(v0), "API は素の16進なので通す").toBe(true);
        expect(scriptAccepts(v0), "スクリプトは版と variant を見るので弾く").toBe(false);
    });
});
