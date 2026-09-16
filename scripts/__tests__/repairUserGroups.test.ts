import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { planRepair, USER_GROUP } = require("../repair-user-groups.js") as {
    planRepair: (a: { groups: string[]; confirmed: string[]; inGroup: string[]; admins?: string[] }) => { createGroup: boolean; add: string[] };
    USER_GROUP: string;
};

/**
 * **登録済みなのに `user` グループに入っていない人を入れ直す**道具の判断。
 * 入れる相手を間違えると「admin に一般権限を混ぜる」「入っている人を二重に
 * 叩く」「未確認の人を通す」になるので、決め方だけ純関数で直接見る。
 */
describe("repair-user-groups の判断", () => {
    it("入れるグループは user", () => { expect(USER_GROUP).toBe("user"); });

    it("user グループが無ければ作る", () => {
        expect(planRepair({ groups: ["admin"], confirmed: [], inGroup: [] }).createGroup).toBe(true);
        expect(planRepair({ groups: ["admin", "user"], confirmed: [], inGroup: [] }).createGroup).toBe(false);
    });

    it("確認済みで、まだ入っていない人だけ入れる", () => {
        const p = planRepair({ groups: ["user"], confirmed: ["a", "b", "c"], inGroup: ["a"] });
        expect(p.add).toEqual(["b", "c"]);
    });

    // **admin は user に入れない。** 権限の判定は排他（admin なら general は false）
    // なので混ぜる理由が無いし、混ぜると診断が「抜けている」と数え続ける
    it("admin の人は入れない", () => {
        const p = planRepair({ groups: ["admin", "user"], confirmed: ["owner", "x"], inGroup: [], admins: ["owner"] });
        expect(p.add).toEqual(["x"]);
    });

    it("全員入っていれば何もしない", () => {
        const p = planRepair({ groups: ["user"], confirmed: ["a"], inGroup: ["a"] });
        expect(p.createGroup).toBe(false);
        expect(p.add).toEqual([]);
    });
});
