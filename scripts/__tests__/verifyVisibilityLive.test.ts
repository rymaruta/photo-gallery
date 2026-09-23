import { describe, it, expect } from "vitest";
// `.mjs` の判定関数だけを読む（通信は入っていないので手元で動く）
import { evaluate } from "../verify-visibility-live.mjs";

/**
 * 本番に聞く道具の**判定部分**。
 *
 * 通信は手元からできない（開発環境は `journey-photo.com` にも API Gateway
 * にも出られない）。だから**判定だけを切り離して、ここで動かす**
 * ——切り離していないと「用意したが一度も走っていない」道具になる。
 * `verify-local.sh` が「関門なのに中身を描いていなかった」のと同じ形を
 * 作らないため。
 */
describe("本番の公開範囲チェックの判定", () => {
    const ok = {
        one: { status: 404, body: '{"error":"写真が見つかりません"}' },
        list: { status: 200, body: JSON.stringify([{ id: "pub1" }, { id: "pub2" }]) },
    };

    it("404 ＋ 一覧に混ざっていなければ、問題なし", () => {
        expect(evaluate(ok.one, ok.list, "secret1")).toEqual([]);
    });

    it("🔴 個別取得が 200 なら落とす", () => {
        const one = { status: 200, body: JSON.stringify({ id: "secret1", src: "https://cdn/s.jpg" }) };
        const problems = evaluate(one, ok.list, "secret1");
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join()).toContain("個別取得");
    });

    it("🔴 403 も落とす（在ることが漏れる）", () => {
        expect(evaluate({ status: 403, body: "" }, ok.list, "secret1")).toContain("個別取得が 403（404 のはず）");
    });

    it("🔴 一覧にその写真が混ざっていたら落とす", () => {
        const list = { status: 200, body: JSON.stringify([{ id: "pub1" }, { id: "secret1" }]) };
        expect(evaluate(ok.one, list, "secret1").join()).toContain("一覧に、絞ったはずの写真");
    });

    it("🔴 id を知らなくても、audience 付きが混ざっていれば落とす", () => {
        const list = { status: 200, body: JSON.stringify([{ id: "x", audience: "followers" }]) };
        expect(evaluate(ok.one, list, "secret1").join()).toContain("audience 付きが 1 枚");
    });

    it("一覧が壊れていたら、黙って通さない", () => {
        expect(evaluate(ok.one, { status: 200, body: "<html>" }, "s").length).toBeGreaterThan(0);
        expect(evaluate(ok.one, { status: 200, body: '{"a":1}' }, "s").length).toBeGreaterThan(0);
        expect(evaluate(ok.one, { status: 502, body: "" }, "s").length).toBeGreaterThan(0);
    });
});
