import { describe, it, expect } from "vitest";
import { isUserId } from "../../api-user/src/userId";

// **同じ「Cognito の sub の形か」を、2か所が別の規則で書いていた。**
//
//   api-user/src/userId.ts         isUserId     素の16進（版も variant も見ない）
//   scripts/backfill-followers.js  USER_ID_RE   版 1-5・variant 8-b まで見る
//
// 「スクリプトの方が厳しい」を安全側として記録していた（緩いと、API が
// 弾く行を書き込むため）。**安全ではなかった。**
//
// 2026-09-13 の本番の実測（`repair-follow-graph` のドライラン）:
//
//     follow#… 2 行 / following#… 2 行 / followers#… 0 行
//     有効なフォロー 2 件 / 壊れたマーカー 0 件
//     規則のずれで保留したマーカー 2 件
//
// **本番のフォロー2件は本物**（読む側を通り、画面にも出ていた）。
// なのに埋め戻しだけが「Cognito の sub の形でないゴミ」として捨てていて、
// **`followers#` が一度も作られなかった**——「フォロー一覧は観れるのに
// フォロワー一覧が見れない」の正体。厳しい側が捨てたものは**気づけるが
// 直せない**。実データが「sub は必ずしも RFC 4122 v4 の形ではない」と
// 示した以上、書く側が読む側より厳しい理由は無い。
//
// **いまは1つ**（`scripts/lib/userId.js`）。このテストの仕事は2つ:
//
//   1. 書き写しに戻らせない——`api-user/src/userId.ts` の正規表現**そのもの**を
//      読んで突き合わせる
//   2. 振る舞いでも一致を見る——定数が同じでも、判定を通る経路
//      （`parseMarker`）に別の規則を差し込めば意味が無い（レビューが実証した形）
//
// **一度、原理的に落ちないテストを書いた。** 版と variant の2文字だけを
// 16進で総当たりしていたので、生成した256通りは**全部 `isUserId` を通る**
// ——包含の判定は右辺が常に false で、スクリプトをどう緩めても緑だった。
// **総当たりの軸が、判定に効く軸と違っていた。**
//
// 作り直したこちらは、正しい UUID の**各位置**を 16進以外も含む文字で
// 置き換えた corpus を回す。長さ・区切り・大文字・空白も混ぜる。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { USER_ID_RE, parseMarker } = require("../backfill-followers.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiRuleSource } = require("../lib/userId.js");

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
    it("corpus は、包含の判定が空回りしない程度に太い", () => {
        const all = corpus();
        expect(all.length, "corpus が痩せている").toBeGreaterThan(500);
        // 後件（API が弾く形を含むか）
        expect(all.filter((v) => !isUserId(v)).length,
            "API が全部通す＝包含の判定が空回りする").toBeGreaterThan(300);
        // **前件（スクリプトが通す形を含むか）も見る。**
        // 空回りを防ぐのに本当に要るのはこちら——`scriptAccepts(v)` が
        // どの corpus でも false なら、`leaked` は常に空になる。
        // 前の版は後件しか測っておらず、**測る側を間違えていた**
        expect(all.filter(scriptAccepts).length,
            "スクリプトが1つも通さない＝包含の判定が空回りする").toBeGreaterThan(50);
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

    // **こちらが本命。** 上の「スクリプトが通すものは API も通す」だけだと、
    // 厳しくする方向（本物を捨てる方向）が素通りする——本番で実際に
    // 起きたのはそちらだった
    it("API が通すものは、スクリプトも必ず通す", () => {
        const dropped = corpus().filter((v) => isUserId(v) && !scriptAccepts(v));
        expect(dropped, "埋め戻しが、API の通す本物のフォローを捨てる").toEqual([]);
    });

    it("マーカーの分解も、API が通す相手を捨てない", () => {
        const dropped = corpus().filter((v) => {
            const m = parseMarker({ follow: true, id: `follow#${v}#${VALID}`, createdAt: "" });
            return isUserId(v) && !!m.skip;
        });
        expect(dropped, "埋め戻しが、API の通す相手のマーカーを捨てる").toEqual([]);
    });

    // 版0・variant 0 ＝ RFC 4122 の v4 ではないが、**本番の sub に実在する形**。
    // ここが落ちたら、また本物のフォローを捨てている
    it("RFC 4122 の版/variant でない sub も、両方が通す", () => {
        const v0 = "0123abcd-4567-089a-0bcd-0123456789ab";
        expect(isUserId(v0), "API が本物の sub を弾いている").toBe(true);
        expect(scriptAccepts(v0), "埋め戻しが本物の sub を捨てている").toBe(true);
        const m = parseMarker({ follow: true, id: `follow#${v0}#${VALID}`, createdAt: "" });
        expect(m.skip, "本物の sub のマーカーを捨てている").toBeUndefined();
    });

    // **書き写しに戻らせない。** 振る舞いの突き合わせ（上の2本）は corpus の
    // 太さに依存するが、これは定義そのものを見る
    it("スクリプトの規則は、api-user/src/userId.ts の正規表現と同一", () => {
        const api = apiRuleSource();
        expect(api, "api-user/src/userId.ts から正規表現を読めなかった").toBeTruthy();
        expect(String(USER_ID_RE), "規則が2か所に分かれている").toBe(api);
    });
});
