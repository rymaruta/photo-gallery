import { describe, it, expect } from "vitest";
import { planDayDate, tripLightCandidates } from "../tripLight";
import type { TripPlan } from "../../hooks/useTripPlans";

/** 旅行プランの当日モード（アプリの `TripLightTests` と同じ決まり） */
const plan = (start: string | undefined, end: string | undefined, days: string[][], dates: (string | undefined)[] = []): TripPlan => ({
    planId: "p", title: "山形", startDate: start, endDate: end,
    days: days.map((ids, i) => ({ date: dates[i], items: ids.map((spotId) => ({ kind: "spot" as const, spotId })) })),
});

describe("旅行プランの日付", () => {
    it("その日の日付が先・無ければ出発日から数える・帰着日を越えない・実在しない日は使わない", () => {
        expect(planDayDate(0, { date: "2026-10-12", items: [] }, "2026-10-10", "2026-10-11")).toBe("2026-10-12");
        expect(planDayDate(1, { items: [] }, "2026-10-10", "2026-10-11")).toBe("2026-10-11");
        expect(planDayDate(2, { items: [] }, "2026-10-10", "2026-10-11")).toBeNull();
        expect(planDayDate(0, { date: "2026-02-30", items: [] }, "2026-10-10")).toBe("2026-10-10");
        expect(planDayDate(0, { items: [] }, undefined)).toBeNull();
        // 月末をまたぐ
        expect(planDayDate(2, { items: [] }, "2026-10-30")).toBe("2026-11-01");
    });
});

describe("今日と明日の候補", () => {
    it("前日は明日（1日目）", () => {
        const c = tripLightCandidates(plan("2026-10-10", "2026-10-11", [["sp_a"], ["sp_b"]]), "2026-10-09");
        expect(c).toEqual([{ ymd: "2026-10-10", isTomorrow: true, dayNumber: 1, spotIds: ["sp_a"] }]);
    });

    it("当日は今日が先・明日が後", () => {
        const c = tripLightCandidates(plan("2026-10-10", "2026-10-11", [["sp_a"], ["sp_b"]]), "2026-10-10");
        expect(c.map((x) => [x.isTomorrow, x.spotIds[0]])).toEqual([[false, "sp_a"], [true, "sp_b"]]);
    });

    it("撮影スポットの無い日は入れない・撮影地（location）は数えない", () => {
        const p: TripPlan = { planId: "p", title: "", startDate: "2026-10-10", endDate: "2026-10-11",
            days: [{ items: [{ kind: "location", slug: "パリ" }] }, { items: [{ kind: "spot", spotId: "sp_b" }] }] };
        expect(tripLightCandidates(p, "2026-10-10").map((x) => x.spotIds)).toEqual([["sp_b"]]);
    });

    it("2日前・帰ったあと・帰着日を越える日は出さない", () => {
        const p = plan("2026-10-10", "2026-10-11", [["sp_a"], ["sp_b"], ["sp_c"]]);
        expect(tripLightCandidates(p, "2026-10-08")).toEqual([]);
        expect(tripLightCandidates(p, "2026-10-12")).toEqual([]);
        expect(tripLightCandidates(p, "2026-10-11").map((x) => x.spotIds)).toEqual([["sp_b"]]);
        expect(tripLightCandidates(p, "bad")).toEqual([]);
    });
});
