import { describe, it, expect } from "vitest";
import { groupStories, timeAgo, hasUnseen, type Story } from "../stories";

const NOW = Date.parse("2026-07-04T12:00:00Z");

function story(overrides: Partial<Story>): Story {
    return {
        id: "s1",
        src: "https://cdn.example.com/a.jpg",
        userId: "user-a",
        createdAt: "2026-07-04T10:00:00Z",
        expiresAt: "2026-07-05T10:00:00Z",
        ...overrides,
    };
}

describe("groupStories", () => {
    it("ユーザーごとにグループ化し、グループ内は投稿順に並ぶ", () => {
        const groups = groupStories([
            story({ id: "s2", createdAt: "2026-07-04T11:00:00Z" }),
            story({ id: "s1", createdAt: "2026-07-04T10:00:00Z" }),
            story({ id: "s3", userId: "user-b", displayName: "B子" }),
        ], null, NOW);
        expect(groups).toHaveLength(2);
        const a = groups.find(g => g.userId === "user-a")!;
        expect(a.items.map(i => i.id)).toEqual(["s1", "s2"]);
    });

    it("期限切れのストーリーは除外される", () => {
        const groups = groupStories([
            story({ id: "expired", expiresAt: "2026-07-04T11:59:00Z" }),
            story({ id: "alive", expiresAt: "2026-07-04T12:01:00Z" }),
        ], null, NOW);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(["alive"]);
    });

    it("src や userId のない壊れたレコードは除外される", () => {
        const groups = groupStories([
            story({ id: "ok" }),
            story({ id: "no-src", src: "" }),
            { id: "junk" } as Story,
        ], null, NOW);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(["ok"]);
    });

    it("自分のグループが先頭に来る", () => {
        const groups = groupStories([
            story({ id: "other", userId: "user-b", createdAt: "2026-07-04T11:30:00Z" }),
            story({ id: "mine", userId: "user-me", createdAt: "2026-07-04T09:00:00Z" }),
        ], "user-me", NOW);
        expect(groups[0].userId).toBe("user-me");
    });

    it("それ以外のグループは最新投稿が新しい順", () => {
        const groups = groupStories([
            story({ id: "old", userId: "user-old", createdAt: "2026-07-04T08:00:00Z" }),
            story({ id: "new", userId: "user-new", createdAt: "2026-07-04T11:00:00Z" }),
        ], null, NOW);
        expect(groups.map(g => g.userId)).toEqual(["user-new", "user-old"]);
    });

    it("displayName はグループ内の最初に見つかったものを使う", () => {
        const groups = groupStories([
            story({ id: "s1", displayName: undefined }),
            story({ id: "s2", displayName: "旅人", createdAt: "2026-07-04T11:00:00Z" }),
        ], null, NOW);
        expect(groups[0].displayName).toBe("旅人");
    });
});

describe("timeAgo", () => {
    it("1分未満は「たった今」", () => {
        expect(timeAgo("2026-07-04T11:59:40Z", "ja", NOW)).toBe("たった今");
        expect(timeAgo("2026-07-04T11:59:40Z", "en", NOW)).toBe("now");
    });

    it("分・時間・日の表示", () => {
        expect(timeAgo("2026-07-04T11:30:00Z", "ja", NOW)).toBe("30分前");
        expect(timeAgo("2026-07-04T09:00:00Z", "ja", NOW)).toBe("3時間前");
        expect(timeAgo("2026-07-02T12:00:00Z", "en", NOW)).toBe("2d");
    });

    it("不正な日付は空文字", () => {
        expect(timeAgo("invalid", "ja", NOW)).toBe("");
    });
});

describe("hasUnseen", () => {
    it("未読があれば true、全部既読なら false", () => {
        const group = groupStories([story({ id: "s1" }), story({ id: "s2", createdAt: "2026-07-04T11:00:00Z" })], null, NOW)[0];
        expect(hasUnseen(group, new Set(["s1"]))).toBe(true);
        expect(hasUnseen(group, new Set(["s1", "s2"]))).toBe(false);
    });
});
