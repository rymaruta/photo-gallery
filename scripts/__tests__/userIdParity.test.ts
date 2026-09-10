import { describe, it, expect } from "vitest";
import { isUserId } from "../../api-user/src/userId";

// **同じ「Cognito の sub の形か」を、2か所が別の規則で書いている。**
//
//   api-user/src/userId.ts         isUserId     素の16進（版も variant も見ない）
//   scripts/backfill-followers.js  USER_ID_RE   版 1-5・variant 8-b まで見る
//
// 今は実害が無い（sub は UUIDv4 なので両方通る）。危ないのは**ずれる向き**:
//
//   - スクリプトの方が厳しい（今の形）＝ API が受け付けたゴミを埋め戻しが
//     捨てる。捨てた件数と理由は出るので気づける
//   - **スクリプトの方が緩い**＝ API が弾いた形の行を、埋め戻しが
//     `followers#` に書き込む。誰も掃除しないゴミが増える
//
// **後者を作らせない**のがこのテストの仕事。
//
// **一度、原理的に落ちないテストを書いた。** 版と variant の2文字だけを
// 16進で総当たりしていたので、生成した256通りは**全部 `isUserId` を通る**
// ——包含の判定は右辺が常に false で、スクリプトをどう緩めても緑だった
// （レビューが実証。`USER_ID_RE = /./` でも緑）。**総当たりの軸が、
// 判定に効く軸と違っていた。**
//
// 作り直したこちらは、正しい UUID の**各位置**を 16進以外も含む文字で
// 置き換えた corpus を回す。長さ・区切り・大文字・空白も混ぜる。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { USER_ID_RE, parseMarker } = require("../backfill-followers.js");

const scriptAccepts = (v: string): boolean => USER_ID_RE.test(v);

const VALID = "0123abcd-4567-489a-8bcd-0123456789ab";

/** 各位置に差し込む文字。16進の外（`g` `z` `Z` `-` `_` ` `）を必ず含める */
const SUBSTS = ["0", "9", "a", "f", "A", "F", "g", "z", "Z", "-", "_", " ", "#", "/"];

/**
 * corpus。**判定に効く軸を全部動かす**——1文字置換（長さは同じ）・
 * 1文字削除・1文字挿入・大文字化・前後の空白。
 */
function corpus(): string[] {
    const out = new Set<string>([VALID, VALID.toUpperCase(), "", " ", "-"]);
    for (let i = 0; i < VALID.length; i++) {
        for (const c of SUBSTS) {
            out.add(VALID.slice(0, i) + c + VALID.slice(i + 1));   // 置換
            out.add(VALID.slice(0, i) + c + VALID.slice(i));       // 挿入
        }
        out.add(VALID.slice(0, i) + VALID.slice(i + 1));           // 削除
    }
    out.add(` ${VALID}`);
    out.add(`${VALID} `);
    out.add(`\t${VALID}`);
    out.add(`${VALID}\n`);
    out.add(`follow#${VALID}`);
    return [...out];
}

describe("userId の形を見る規則（API とスクリプト）", () => {
    // corpus が「効く軸」を実際に動かしていることを、先に確かめる。
    // ここが崩れると、また原理的に落ちないテストになる
    it("corpus は、API が弾く文字列を十分に含む", () => {
        const all = corpus();
        const rejected = all.filter((v) => !isUserId(v));
        expect(all.length, "corpus が痩せている").toBeGreaterThan(500);
        expect(rejected.length, "API が全部通す＝包含の判定が空回りする").toBeGreaterThan(300);
    });

    it("スクリプトが通すものは、API も必ず通す", () => {
        const leaked = corpus().filter((v) => scriptAccepts(v) && !isUserId(v));
        expect(leaked, "埋め戻しが、API の弾く形を書き込む").toEqual([]);
    });

    // **定数ではなく、行を書き込む経路を見る。**
    // `USER_ID_RE` だけ見ていると、`parseMarker` の中に別の正規表現を
    // 置いて参照をやめる変更が素通りする（レビューが実証）
    it("マーカーの分解も、API が弾く相手を通さない", () => {
        const leaked = corpus().filter((v) => {
            const m = parseMarker({ follow: true, id: `follow#${v}#${VALID}`, createdAt: "" });
            return !m.skip && !isUserId(v);
        });
        expect(leaked, "埋め戻しが、API の弾く相手を一覧に入れる").toEqual([]);
    });

    it("フォローする側も同じ（`follow#<target>#<follower>` の後ろ）", () => {
        const leaked = corpus().filter((v) => {
            const m = parseMarker({ follow: true, id: `follow#${VALID}#${v}`, createdAt: "" });
            return !m.skip && !isUserId(v);
        });
        expect(leaked, "埋め戻しが、API の弾く人を follower にする").toEqual([]);
    });

    it("実際の sub の形（UUIDv4）は両方が通し、分解も通る", () => {
        const v4 = "22222222-2222-4222-8222-222222222222";
        expect(isUserId(v4), "API が本物の sub を弾いている").toBe(true);
        expect(scriptAccepts(v4), "埋め戻しが本物の sub を捨てている").toBe(true);
        const m = parseMarker({ follow: true, id: `follow#${v4}#${VALID}`, createdAt: "x" });
        expect(m.skip, "本物の sub のマーカーを捨てている").toBeUndefined();
        expect(m.target).toBe(v4);
    });

    // ずれている向きを事実として書き留める（片方だけ直した日に、
    // このテストが「意図が変わった」と教える）
    it("いまは、スクリプトの方が厳しい", () => {
        const v0 = "0123abcd-4567-089a-0bcd-0123456789ab";   // 版0・variant 0
        expect(isUserId(v0), "API は素の16進なので通す").toBe(true);
        expect(scriptAccepts(v0), "スクリプトは版と variant を見るので弾く").toBe(false);
    });
});
