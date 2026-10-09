import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mergeProBadges } from "../../api-user/src/proBadges";

// 本番に残った Sandbox（TestFlight・審査）の Pro のメダルを外す台本の、1人ぶんの計画（純関数）

const require = createRequire(import.meta.url);
const { isProBadgeKey, planUser } = require("../purge-sandbox-pro-badges.js") as {
    isProBadgeKey: (k: string) => boolean;
    planUser: (lib: { mergeProBadges: typeof mergeProBadges }, row: Record<string, unknown>, nowMs: number) =>
        | { action: "remove"; removed: string[]; item: Record<string, unknown>; rev: number }
        | { action: "review"; excess: string[] }
        | { action: "none" };
};
const lib = { mergeProBadges };

const AT = "2026-10-10T04:00:00.000Z";
const NOW = Date.parse("2026-10-11T00:00:00Z");
const MONTHLY = "com.journeyphoto.JourneyPhoto.pro.monthly";

describe("purge-sandbox-pro-badges", () => {
    it("Pro のメダルの鍵だけを拾う", () => {
        expect(["supporter", "supporterYear", "proAutumn2026", "proWinter2031"].every(isProBadgeKey)).toBe(true);
        expect(["first", "proAutumn", "supporterX", "prefecture"].some(isProBadgeKey)).toBe(false);
    });

    it("Sandbox の人: Pro のメダルだけ外し、ほかのメダル・番号はそのまま。名前の横に出していたら外す・rev を上げる", () => {
        const row = {
            userId: "u1", rev: 3, displayBadge: "supporterYear",
            supporter: { environment: "Sandbox", number: 1, months: 24, active: true, periods: [], linked: [] },
            badges: { first: { tier: 1, at: AT }, supporter: { tier: 1, at: AT }, supporterYear: { tier: 2, at: AT }, proAutumn2026: { tier: 1, at: AT, year: 2026 } },
        };
        const plan = planUser(lib, row, NOW);
        expect(plan.action).toBe("remove");
        if (plan.action !== "remove") return;
        expect(plan.removed).toEqual(["supporter", "supporterYear", "proAutumn2026"]);
        expect(plan.rev).toBe(3);
        expect(plan.item).toEqual({
            userId: "u1", rev: 4, supporter: row.supporter, badges: { first: { tier: 1, at: AT } },
        });
    });

    it("Sandbox の人で Pro のメダルしか無ければ badges ごと消す（名前の横のメダルが写真のものなら残す）", () => {
        const plan = planUser(lib, {
            userId: "u1", displayBadge: "first",
            supporter: { environment: "Sandbox", months: 1, active: false, periods: [], linked: [] },
            badges: { supporter: { tier: 1, at: AT } },
        }, NOW);
        expect(plan).toMatchObject({ action: "remove", rev: 0, item: { userId: "u1", rev: 1, displayBadge: "first" } });
        expect((plan as { item: Record<string, unknown> }).item.badges).toBeUndefined();
    });

    it("本物（Production）の人は外さない。本物の記録から付く分を超えるものだけ要確認に出す", () => {
        const start = Date.parse("2026-10-10T03:00:00Z");
        const supporter = {
            environment: "Production", number: 3, months: 0, active: true, linked: ["o1"],
            periods: [{ id: "p1", start: new Date(start).toISOString(), end: new Date(start + 31 * 86_400_000).toISOString(), product: MONTHLY }],
        };
        const ok = planUser(lib, { userId: "u2", supporter, badges: { supporter: { tier: 1, at: AT }, proAutumn2026: { tier: 1, at: AT, year: 2026 } } }, NOW);
        expect(ok).toEqual({ action: "none" });
        // Sandbox の頃に付いた続けた年（2段）が残っている
        const migrated = planUser(lib, {
            userId: "u3", supporter, badges: { supporter: { tier: 1, at: AT }, supporterYear: { tier: 2, at: AT } },
        }, NOW);
        expect(migrated).toEqual({ action: "review", excess: ["supporterYear"] });
    });

    it("Pro のメダルが無い人・supporter の無い人は何もしない", () => {
        expect(planUser(lib, { userId: "u4", badges: { first: { tier: 1, at: AT } } }, NOW)).toEqual({ action: "none" });
        expect(planUser(lib, { userId: "u5", badges: { supporter: { tier: 1, at: AT } } }, NOW)).toEqual({ action: "none" });
    });
});
