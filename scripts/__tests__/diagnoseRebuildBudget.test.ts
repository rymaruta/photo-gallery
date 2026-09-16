import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rebuildBudgetLines } = require("../diagnose-aws.js") as {
    rebuildBudgetLines: (x: {
        used: number | null; max: number | null; month: string; readable: boolean; maxFrom: string;
    }) => string[];
};

/**
 * **使い切ると、削除・非公開の掃除まで止まる。**
 *
 * 静的書き出しなので、写真を消しても配ってある HTML は再ビルドするまで残る。
 * その再ビルドを頼む口には月ごとの上限（既定200本）があり、尽きると
 * `requestSiteRebuild` は**その月いっぱい false を返す**——新しい写真の
 * 個別ページが生まれないだけでなく、**消したはずの写真のページが残り続ける**。
 *
 * そして**そのとき出るのは CloudWatch の1行だけ**。画面にも診断にも
 * 何も出ないので、owner は「残り何本か」を知る手段を持っていなかった。
 * 台帳が3回記録している型（圧縮・応答ヘッダー・エッジの関数）の4つ目。
 */
const at = (x: Partial<Parameters<typeof rebuildBudgetLines>[0]> = {}) =>
    rebuildBudgetLines({ used: 0, max: 200, month: "2026-09", readable: true, maxFrom: "既定値", ...x }).join("\n");

describe("今月の再ビルドの予算", () => {
    it("余裕があるときは、使用・上限・残りを出す", () => {
        const s = at({ used: 5 });
        expect(s).toContain("今月の使用: 5 本");
        expect(s).toContain("上限: 200 本");
        expect(s).toContain("残り: 195 本");
        expect(s).toContain("✅");
    });

    // 🔴 いちばん言わなければいけない状態
    it("使い切っていたら、掃除も止まっていると名指しで言う", () => {
        const s = at({ used: 200 });
        expect(s, "「✅ 余裕があります」と出している").not.toContain("✅");
        expect(s).toContain("!!");
        expect(s, "掃除が止まることを言っていない").toMatch(/削除・非公開の掃除も止まって/);
        expect(s, "直し方を出していない").toContain("REBUILD_MONTHLY_MAX");
    });

    it("上限を超えていても（戻し損ねた回）同じことを言う", () => {
        expect(at({ used: 250 })).toMatch(/削除・非公開の掃除も止まって/);
    });

    // 尽きてから気づくと、その月は打つ手が無い（枠の上げ方も月の切り替えも遅い）
    it("残りが1割を切ったら、尽きる前に警告する", () => {
        const s = at({ used: 181 });   // 残り19 ≦ max(10, 20)
        expect(s).toContain("!!");
        expect(s).toMatch(/残りが1割を切って/);
        expect(s).not.toContain("✅");
    });

    it("1割より残っていれば警告しない", () => {
        expect(at({ used: 150 })).toContain("✅");   // 残り50
    });

    // 上限が小さい環境で「1割」が 0 にならないこと（20本なら残り10で警告）
    it("上限が小さくても、最低10本は手前で警告する", () => {
        expect(at({ used: 10, max: 20 })).toMatch(/残りが1割を切って/);
        expect(at({ used: 5, max: 20 })).toContain("✅");
    });

    // **読めなかったら「大丈夫」と言わない**（診断は「問題なし」に見えるときが
    // いちばん危ない。`cdnLines` と同じ判断）
    it("使用量を読めなかったら ✅ を出さない", () => {
        const s = at({ readable: false });
        expect(s).not.toContain("✅");
        expect(s).toContain("!!");
        expect(s, "確かめ方を出していない").toContain("CloudWatch");
    });

    it("上限を読めなかったら ✅ を出さない", () => {
        const s = at({ max: null });
        expect(s).not.toContain("✅");
        expect(s).toContain("!!");
        expect(s, "既定値を伝えていない").toContain("200");
    });

    // まだ1本も使っていない月は、項目そのものが無い（`used` が null）
    it("まだ1本も使っていない月でも落ちない", () => {
        const s = at({ used: null });
        expect(s).toContain("今月の使用: 0 本");
        expect(s).toContain("残り: 200 本");
        expect(s).toContain("✅");
    });

    it("どの月を見たかを必ず出す（月が変われば別の予算）", () => {
        expect(at({ month: "2026-10" })).toContain("2026-10");
    });
});
