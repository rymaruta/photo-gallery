import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { userGroupLines } = require("../diagnose-aws.js") as {
    userGroupLines: (a: { groups: string[]; confirmed: string[]; inGroup: string[]; poolId: string }) => string[];
};

/**
 * **「新規登録した人が投稿できない」を切り分ける行。**
 *
 * 投稿系のページは `cognito:groups` に `user` があるかで通る。グループを入れる
 * のは PostConfirmation トリガーだが、**そこは失敗しても握って先へ進む**
 * （登録そのものを失敗させない方が軽い、という意図的な判断）。結果として
 * 「ログインできるのに投稿だけ永久に開けない」人ができる。
 *
 * 診断がいちばん危ないのは**「0件」と言うとき**なので、組み立てを直接見る。
 */
const POOL = "ap-northeast-1_XXXX";

describe("Cognito のグループの診断", () => {
    it("グループが1つも無いときは、そう言い切る", () => {
        const out = userGroupLines({ groups: [], confirmed: [], inGroup: [], poolId: POOL }).join("\n");
        expect(out).toContain("**1つも無い**");
        expect(out).toContain("`user` グループがありません");
        expect(out, "直し方が出ていない").toContain(`create-group --user-pool-id ${POOL} --group-name user`);
    });

    it("user だけ無いときも同じ扱い（admin があっても投稿はできない）", () => {
        const out = userGroupLines({ groups: ["admin"], confirmed: ["a"], inGroup: [], poolId: POOL }).join("\n");
        expect(out).toContain("`user` グループがありません");
    });

    it("全員入っていれば「原因は別」と言う", () => {
        const out = userGroupLines({ groups: ["user"], confirmed: ["a", "b"], inGroup: ["a", "b"], poolId: POOL }).join("\n");
        expect(out).toContain("確認済みの利用者: 2人");
        expect(out).toContain("✅ 全員がグループに入っています");
        expect(out, "誰も落ちていないのに落ちていると言っている").not.toContain("❌");
    });

    // **ここが本題。** 抜けている人を数え落とすと「問題なし」に見える
    it("抜けている人を名指しし、その人を入れるコマンドを出す", () => {
        const out = userGroupLines({ groups: ["user"], confirmed: ["a", "b", "c"], inGroup: ["a"], poolId: POOL }).join("\n");
        expect(out).toContain("グループに入っていない人: 2人");
        expect(out).toContain("admin-add-user-to-group");
        expect(out).toContain("--username b");
        expect(out).toContain("--username c");
        expect(out, "入っている人まで並べている").not.toContain("--username a");
    });

    it("多いときは10人で切り、残りの数を出す（黙って捨てない）", () => {
        const confirmed = Array.from({ length: 14 }, (_, i) => `u${i}`);
        const out = userGroupLines({ groups: ["user"], confirmed, inGroup: [], poolId: POOL }).join("\n");
        expect(out).toContain("グループに入っていない人: 14人");
        expect(out).toContain("…ほか 4人");
        expect(out.match(/--username /g) ?? []).toHaveLength(10);
    });

    // 判定そのものが効いているか（空を渡して通らないこと）
    it("検出器の自己確認: 入っている人だけなら ❌ を出さない", () => {
        const out = userGroupLines({ groups: ["user", "admin"], confirmed: ["x"], inGroup: ["x", "y"], poolId: POOL }).join("\n");
        expect(out).not.toContain("❌");
    });
});
