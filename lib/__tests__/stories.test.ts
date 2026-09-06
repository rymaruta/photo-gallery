import { describe, it, expect, vi } from "vitest";
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
        ], null);
        expect(groups).toHaveLength(2);
        const a = groups.find(g => g.userId === "user-a")!;
        expect(a.items.map(i => i.id)).toEqual(["s1", "s2"]);
    });

    // **期限は端末の時計で判定しない。** サーバーが `expiresAt > :now` で
    // 絞ってから返すので、ここで重ねて見ると「端末の時計が進んでいる人だけ
    // ストーリーが消える」になる（実測: +1.5h で2件、+12h で1件、+23.5h で0件。
    // 取得は成功しているのでエラーも出ず、投稿した直後の自分のぶんも消える）
    it("端末の時計が1日進んでいても、サーバーが返したものは出す", () => {
        const ahead = Date.parse("2026-07-05T12:00:00Z");   // 24時間 進んだ端末
        const spy = vi.spyOn(Date, "now").mockReturnValue(ahead);
        try {
            const groups = groupStories([
                story({ id: "s1", expiresAt: "2026-07-05T10:00:00Z" }),
                story({ id: "s2", userId: "user-b", expiresAt: "2026-07-05T11:00:00Z" }),
            ], null);
            expect(groups.flatMap((g) => g.items.map((i) => i.id)), "端末の時計で消している").toEqual(["s1", "s2"]);
        } finally { spy.mockRestore(); }
    });

    it("読めない expiresAt は壊れたレコードとして除外する（形は見る）", () => {
        const groups = groupStories([
            story({ id: "ok" }),
            story({ id: "broken", expiresAt: "きのう" }),
            story({ id: "missing", expiresAt: undefined as unknown as string }),
        ], null);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(["ok"]);
    });

    it("src や userId のない壊れたレコードは除外される", () => {
        const groups = groupStories([
            story({ id: "ok" }),
            story({ id: "no-src", src: "" }),
            { id: "junk" } as Story,
        ], null);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map(i => i.id)).toEqual(["ok"]);
    });

    it("自分のグループが先頭に来る", () => {
        const groups = groupStories([
            story({ id: "other", userId: "user-b", createdAt: "2026-07-04T11:30:00Z" }),
            story({ id: "mine", userId: "user-me", createdAt: "2026-07-04T09:00:00Z" }),
        ], "user-me");
        expect(groups[0].userId).toBe("user-me");
    });

    it("それ以外のグループは最新投稿が新しい順", () => {
        const groups = groupStories([
            story({ id: "old", userId: "user-old", createdAt: "2026-07-04T08:00:00Z" }),
            story({ id: "new", userId: "user-new", createdAt: "2026-07-04T11:00:00Z" }),
        ], null);
        expect(groups.map(g => g.userId)).toEqual(["user-new", "user-old"]);
    });

    it("displayName はグループ内の最初に見つかったものを使う", () => {
        const groups = groupStories([
            story({ id: "s1", displayName: undefined }),
            story({ id: "s2", displayName: "旅人", createdAt: "2026-07-04T11:00:00Z" }),
        ], null);
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
        const group = groupStories([story({ id: "s1" }), story({ id: "s2", createdAt: "2026-07-04T11:00:00Z" })], null)[0];
        expect(hasUnseen(group, new Set(["s1"]))).toBe(true);
        expect(hasUnseen(group, new Set(["s1", "s2"]))).toBe(false);
    });
});

// **1件に `createdAt` が無いだけで、全員ぶんのストーリーが消えていた。**
//
// `valid` の判定が `src` / `userId` / `expiresAt` しか見ておらず、
// そのあとの `items.sort((a,b) => a.createdAt.localeCompare(...))` が
// 無防備だった——`TypeError` になり、`StoriesBar` の catch が拾って
// バーが「読み込めませんでした」だけになる。
// **サーバー側の同じ並べ替え**（`api-user/src/stories.ts`）は
// `String(a.createdAt ?? "")` で守っており、クライアントだけ素のままだった。
describe("createdAt が読めない行", () => {
    const ok = (id: string, userId: string, createdAt: string) => ({
        id, userId, src: `https://cdn/${id}.jpg`, createdAt,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    it.each([
        ["欠落", undefined],
        ["数値", 1234567890],
        ["null", null],
    ])("%s でも、他のストーリーは残る", (_name, bad) => {
        const broken = { ...ok("s2", "u1", "x"), createdAt: bad } as unknown as Parameters<typeof groupStories>[0][number];
        const groups = groupStories([ok("s1", "u1", "2026-09-01T00:00:00Z"), broken], null);
        expect(groups, "全員ぶんが消えている").toHaveLength(1);
        expect(groups[0].items.map((i) => i.id)).toEqual(["s1"]);
    });

    it("投稿者が2人いても、壊れた側だけ落ちる", () => {
        const broken = { ...ok("s9", "u2", "x"), createdAt: undefined } as unknown as Parameters<typeof groupStories>[0][number];
        const groups = groupStories([ok("s1", "u1", "2026-09-01T00:00:00Z"), broken], null);
        expect(groups.map((g) => g.userId)).toEqual(["u1"]);
    });

    // 正常系: 全部読めるなら1件も落とさない
    it("読める行はそのまま並ぶ", () => {
        const groups = groupStories([
            ok("s1", "u1", "2026-09-01T00:00:00Z"),
            ok("s2", "u1", "2026-09-02T00:00:00Z"),
        ], null);
        expect(groups[0].items.map((i) => i.id)).toEqual(["s1", "s2"]);
    });
});
