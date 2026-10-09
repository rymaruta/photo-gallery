import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectEarlyUsers, keepPosters, planGrant, CUTOFF_MS } = require("../grant-early-user.js") as {
    selectEarlyUsers: (users: unknown[], cutoffMs?: number) => string[];
    keepPosters: (userIds: string[] | undefined, counts: Record<string, number> | undefined) => string[];
    planGrant: (row: unknown, nowIso: string) =>
        { write: true; rev: number; item: Record<string, unknown> } | { write: false; reason: string };
    CUTOFF_MS: number;
};
const { isLiveProfileRow } = require("../backfill-badges.js") as { isLiveProfileRow: (row: unknown) => boolean };

const AT0 = "2026-01-01T00:00:00.000Z";
const NOW = "2026-11-01T00:00:00.000Z";

describe("grant-early-user: 誰に付けるか", () => {
    it("締め切りは 2026-10-31 23:59:59（日本時間）", () => {
        expect(new Date(CUTOFF_MS).toISOString()).toBe("2026-10-31T14:59:59.000Z");
    });

    it("締め切りちょうどまでは付け、1秒でも過ぎたら付けない", () => {
        const users = [
            { sub: "on-time", createdAt: new Date("2026-10-31T14:59:59.000Z"), status: "CONFIRMED", enabled: true },
            { sub: "late", createdAt: new Date("2026-10-31T15:00:00.000Z"), status: "CONFIRMED", enabled: true },
            { sub: "jst-31st-night", createdAt: "2026-10-31T23:30:00+09:00", status: "CONFIRMED", enabled: true },
            { sub: "jst-nov-1st", createdAt: "2026-11-01T00:00:00+09:00", status: "CONFIRMED", enabled: true },
        ];
        expect(selectEarlyUsers(users)).toEqual(["jst-31st-night", "on-time"]);
    });

    it("登録の途中で離脱した人・無効にした人・sub の無い人・日付の読めない人は付けない", () => {
        const users = [
            { sub: "ok", createdAt: AT0, status: "CONFIRMED", enabled: true },
            { sub: "unconfirmed", createdAt: AT0, status: "UNCONFIRMED", enabled: true },
            { sub: "disabled", createdAt: AT0, status: "CONFIRMED", enabled: false },
            { createdAt: AT0, status: "CONFIRMED" },
            { sub: "no-date", createdAt: "?", status: "CONFIRMED" },
            null,
        ];
        expect(selectEarlyUsers(users)).toEqual(["ok"]);
    });

    it("登録の早い順に並べる（ログの先頭に古い人）", () => {
        const users = [
            { sub: "b", createdAt: "2026-05-01T00:00:00Z", status: "CONFIRMED" },
            { sub: "a", createdAt: "2026-01-01T00:00:00Z", status: "FORCE_CHANGE_PASSWORD" },
        ];
        expect(selectEarlyUsers(users)).toEqual(["a", "b"]);
    });

    it("写真を1枚でも投稿したことがある人だけ残す（0枚・数が分からない人は付けない）", () => {
        expect(keepPosters(["a", "b", "c", "d"], { a: 1, b: 0, d: 12 })).toEqual(["a", "d"]);
        expect(keepPosters(undefined, { a: 1 })).toEqual([]);
        expect(keepPosters(["a"], undefined)).toEqual([]);
    });
});

describe("grant-early-user: 行への書き方", () => {
    it("他のメダルを残して earlyUser を足し、rev を上げる", () => {
        const plan = planGrant({ userId: "u1", rev: 3, badges: { first: { tier: 1, at: AT0 } }, bio: "x" }, NOW);
        expect(plan.write).toBe(true);
        if (!plan.write) return;
        expect(plan.rev).toBe(3);
        expect(plan.item).toEqual({
            userId: "u1", bio: "x", rev: 4,
            badges: { first: { tier: 1, at: AT0 }, earlyUser: { tier: 1, at: NOW } },
        });
    });

    it("既に付いている人は触らない（付けた日を書き換えない）", () => {
        expect(planGrant({ userId: "u1", badges: { earlyUser: { tier: 1, at: AT0 } } }, NOW))
            .toEqual({ write: false, reason: "既に付いている" });
    });

    it("行が無い・退会済みには書かない", () => {
        expect(planGrant(undefined, NOW)).toEqual({ write: false, reason: "プロフィールの行が無い" });
        expect(planGrant({ userId: "u1", deletedAt: AT0 }, NOW)).toEqual({ write: false, reason: "退会済み" });
    });

    it("rev の無い古い行は rev 0 として扱う", () => {
        const plan = planGrant({ userId: "u1" }, NOW);
        expect(plan.write && plan.rev).toBe(0);
        expect(plan.write && plan.item.rev).toBe(1);
    });
});

describe("backfill-badges: 対象の行", () => {
    it("プロフィールの行だけ（予約の行・墓石・壊れた行は除く）", () => {
        expect(isLiveProfileRow({ userId: "u1" })).toBe(true);
        expect(isLiveProfileRow({ userId: "username#taro", ownerId: "u1" })).toBe(false);
        expect(isLiveProfileRow({ userId: "u1", deletedAt: AT0 })).toBe(false);
        expect(isLiveProfileRow({ userId: "" })).toBe(false);
        expect(isLiveProfileRow(null)).toBe(false);
    });
});

describe("どちらの台本も既定は読むだけ", () => {
    it("--apply が無ければ書かない（本文に apply の分岐がある）", async () => {
        const { readFileSync } = await import("node:fs");
        for (const f of ["grant-early-user.js", "backfill-badges.js"]) {
            const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
            expect(src, f).toContain('process.argv.includes("--apply")');
            // 書き込みは APPLY の分岐の後ろにしか無い
            const firstPut = src.indexOf("new PutCommand(");
            const applyGuard = src.indexOf("if (!APPLY)");
            expect(applyGuard, f).toBeGreaterThan(0);
            expect(firstPut, f).toBeGreaterThan(applyGuard);
        }
    });
});
