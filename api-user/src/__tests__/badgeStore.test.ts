import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// メダルの数え直し・保存・通知（`badgeStore.ts`）。
//
// - 上がった段があるときだけ、rev を見て置き直す（`updateMyProfile` の全置換に消されない）
// - 行が無い・墓石には書かない
// - **書けてから**知らせる（書けなかった段を「手に入れました」と言わない）
// - 本流から呼ぶ版（`refreshBadgesQuietly`）は投げない・待ちすぎない

const send = vi.hoisted(() => vi.fn());
const listMyPhotos = vi.hoisted(() => vi.fn());
const readUserList = vi.hoisted(() => vi.fn());
const pushNotification = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../ddb-photos", () => ({ listMyPhotos }));
vi.mock("../userList", () => ({ readUserList }));
vi.mock("../notify", () => ({ pushNotification }));

import { refreshBadges, refreshBadgesQuietly, getMyBadges, QUIET_LIMIT_MS } from "../badgeStore";

const NOW = new Date("2026-10-09T00:00:00.000Z");
const AT0 = "2026-01-01T00:00:00.000Z";
const photo = (over: Record<string, unknown> = {}) => ({ id: `p${Math.random()}`, src: "https://x/a.jpg", userId: "u1", ...over });
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
const puts = () => send.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "PutCommand");

beforeEach(() => {
    send.mockReset();
    listMyPhotos.mockReset().mockResolvedValue([]);
    readUserList.mockReset().mockResolvedValue([]);
    pushNotification.mockReset().mockResolvedValue(undefined);
});

describe("refreshBadges", () => {
    it("上がった段を rev つきで保存し、書けてから通知する", async () => {
        listMyPhotos.mockResolvedValue([photo({ location: "東京" })]);
        send
            .mockResolvedValueOnce({ Item: { userId: "u1", displayName: "旅人", rev: 4 } })
            .mockResolvedValueOnce({});
        const r = await refreshBadges("u1", () => NOW);
        expect(r.badges).toEqual({ first: { tier: 1, at: NOW.toISOString() } });
        expect(r.progress.first).toEqual({ count: 1, tier: 1, next: null });
        expect(r.progress.prefectures).toEqual({ count: 1, tier: 0, next: 10 });

        const [put] = puts();
        expect(put.input.Item).toEqual({ userId: "u1", displayName: "旅人", rev: 5, badges: { first: { tier: 1, at: NOW.toISOString() } } });
        expect(put.input.ConditionExpression).toContain("rev = :rev");
        expect(put.input.ConditionExpression).toContain("attribute_not_exists(deletedAt)");
        expect(put.input.ExpressionAttributeValues).toEqual({ ":rev": 4 });

        expect(pushNotification).toHaveBeenCalledTimes(1);
        expect(pushNotification.mock.calls[0][0]).toBe("u1");
        expect(pushNotification.mock.calls[0][1]).toMatchObject({
            type: "badge", key: "first", tier: 1, byName: "はじめての一枚", photoId: "", photoSrc: "",
        });
        expect(pushNotification.mock.calls[0][1]).not.toHaveProperty("byId");
    });

    it("「行きたい」の一覧は本人の行（spots#<uid>）から読む", async () => {
        send.mockResolvedValueOnce({ Item: { userId: "u1" } });
        await refreshBadges("u1", () => NOW);
        expect(readUserList.mock.calls[0][0]).toBe("spots#u1");
        expect(listMyPhotos).toHaveBeenCalledWith("u1");
    });

    it("上がった段が無ければ書かない・知らせない", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockResolvedValueOnce({ Item: { userId: "u1", badges: { first: { tier: 1, at: AT0 } } } });
        const r = await refreshBadges("u1", () => NOW);
        expect(r.badges).toEqual({ first: { tier: 1, at: AT0 } });
        expect(puts()).toEqual([]);
        expect(pushNotification).not.toHaveBeenCalled();
    });

    it("行が無い人には書かない（数えた結果は返す）", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockResolvedValueOnce({});
        const r = await refreshBadges("u1", () => NOW);
        expect(r.badges.first?.tier).toBe(1);
        expect(puts()).toEqual([]);
        expect(pushNotification).not.toHaveBeenCalled();
    });

    it("墓石（退会済み）には書かず、何も渡さない", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockResolvedValueOnce({ Item: { userId: "u1", deletedAt: AT0 } });
        const r = await refreshBadges("u1", () => NOW);
        expect(r.badges).toEqual({});
        expect(puts()).toEqual([]);
    });

    it("競合したら読み直して重ね直す（読み直した行の項目を残す）", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send
            .mockResolvedValueOnce({ Item: { userId: "u1", rev: 1 } })
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { userId: "u1", rev: 2, bio: "新しい自己紹介" } })
            .mockResolvedValueOnce({});
        await refreshBadges("u1", () => NOW);
        const all = puts();
        expect(all).toHaveLength(2);
        expect(all[1].input.Item).toMatchObject({ bio: "新しい自己紹介", rev: 3 });
        expect(pushNotification).toHaveBeenCalledTimes(1);
    });

    it("rev の無い古い行も通す（rev を持たない・rev = 0 を許す条件）", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockResolvedValueOnce({ Item: { userId: "u1" } }).mockResolvedValueOnce({});
        await refreshBadges("u1", () => NOW);
        expect(puts()[0].input.ConditionExpression).toContain("attribute_not_exists(rev)");
        expect(puts()[0].input.Item.rev).toBe(1);
    });

    it("競合が続いたら諦める（知らせない）", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockImplementation((cmd: { constructor: { name: string } }) =>
            cmd.constructor.name === "PutCommand" ? Promise.reject(condFail()) : Promise.resolve({ Item: { userId: "u1", rev: 1 } }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const r = await refreshBadges("u1", () => NOW);
        expect(r.badges.first?.tier).toBe(1);
        expect(pushNotification).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("競合以外の失敗は投げる", async () => {
        listMyPhotos.mockResolvedValue([photo()]);
        send.mockResolvedValueOnce({ Item: { userId: "u1" } }).mockRejectedValueOnce(new Error("throttled"));
        await expect(refreshBadges("u1", () => NOW)).rejects.toThrow("throttled");
        expect(pushNotification).not.toHaveBeenCalled();
    });

    it("段が上がるたびに1通（2つ同時なら2通）", async () => {
        listMyPhotos.mockResolvedValue([
            photo({ location: "パリ, フランス" }), photo({ location: "スペイン" }), photo({ location: "日本" }),
        ]);
        send.mockResolvedValueOnce({ Item: { userId: "u1" } }).mockResolvedValueOnce({});
        await refreshBadges("u1", () => NOW);
        const sent = pushNotification.mock.calls.map((c) => [c[1].key, c[1].tier]);
        expect(sent).toEqual([["first", 1], ["countries", 1]]);
    });
});

describe("refreshBadgesQuietly（本流から呼ぶ版）", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("失敗しても投げない", async () => {
        listMyPhotos.mockRejectedValue(new Error("ddb down"));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(refreshBadgesQuietly("u1", "test")).resolves.toBeUndefined();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it("上限を越えたら待たずに先へ進む", async () => {
        vi.useFakeTimers();
        listMyPhotos.mockReturnValue(new Promise(() => {}));   // 返ってこない
        let done = false;
        const p = refreshBadgesQuietly("u1", "test").then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(QUIET_LIMIT_MS - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        await p;
        expect(done).toBe(true);
    });

    it("userId が空なら何もしない", async () => {
        await refreshBadgesQuietly("", "test");
        expect(listMyPhotos).not.toHaveBeenCalled();
    });
});

describe("GET /user/badges", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (sub?: string) => (getMyBadges as any)({
        requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } } },
    }) as Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;

    it("{ badges, progress } を返す（本人だけの答え・共有キャッシュに載せない）", async () => {
        send.mockResolvedValueOnce({ Item: { userId: "u1", badges: { earlyUser: { tier: 1, at: AT0 } } } });
        const res = await call("u1");
        expect(res.statusCode).toBe(200);
        expect(res.headers["Cache-Control"]).toBe("private, no-store");
        const body = JSON.parse(res.body);
        expect(body.badges).toEqual({ earlyUser: { tier: 1, at: AT0 } });
        expect(Object.keys(body.progress).sort()).toEqual(
            ["books", "countries", "earlyUser", "first", "morning", "night", "prefectures", "seasons", "wish"]);
        expect(body.progress.earlyUser).toEqual({ count: 1, tier: 1, next: null });
        expect(body.progress.wish).toEqual({ count: 0, tier: 0, next: 3 });
    });

    it("認証が無ければ 401", async () => {
        expect((await call()).statusCode).toBe(401);
    });

    it("読めなければ 500", async () => {
        listMyPhotos.mockRejectedValue(new Error("down"));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await call("u1")).statusCode).toBe(500);
        err.mockRestore();
    });
});
