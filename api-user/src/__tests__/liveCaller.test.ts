import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 退会した本人の書く口を塞ぐ共通の確かめ（`liveCaller.ts`）。
 * 口ごとに入っていることは `liveCallerGuard.test.ts` が見る。ここは判定そのもの。
 */
const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test" }));
vi.stubEnv("USERS_TABLE", "users-test");

const { assertLiveCaller, readLiveCaller, goneIfDeleted } = await import("../liveCaller");

type Input = { TableName: string; Key: { userId: string }; ProjectionExpression: string; ExpressionAttributeNames: Record<string, string> };
const lastInput = () => (mockSend.mock.calls.at(-1)![0] as { input: Input }).input;
const projected = (i: Input) => i.ProjectionExpression.split(",").map((s) => s.trim()).map((s) => i.ExpressionAttributeNames[s]);

beforeEach(() => { mockSend.mockReset(); });

describe("assertLiveCaller", () => {
    it("墓石（deletedAt が文字列）なら 410", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1", deletedAt: "2026-10-18T00:00:00.000Z" } });
        const r = await assertLiveCaller("u1");
        expect(r?.statusCode).toBe(410);
        expect(JSON.parse(String(r?.body)).error).toBe("このアカウントは削除されています");
    });

    it("生きている行なら null（通す）", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1" } });
        expect(await assertLiveCaller("u1")).toBeNull();
    });

    it("行が無い人は通す（PostConfirmation の取りこぼし。墓石ではない）", async () => {
        mockSend.mockResolvedValue({});
        expect(await assertLiveCaller("u1")).toBeNull();
    });

    it("読めなければ 500（生きている扱いで通さない）", async () => {
        mockSend.mockRejectedValue(new Error("throttled"));
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const r = await assertLiveCaller("u1");
        err.mockRestore();
        expect(r?.statusCode).toBe(500);
    });

    it("本人の行を1回だけ、deletedAt を射影に入れて読む", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1" } });
        await assertLiveCaller("u1");
        expect(mockSend).toHaveBeenCalledTimes(1);
        const i = lastInput();
        expect(i.TableName).toBe("users-test");
        expect(i.Key).toEqual({ userId: "u1" });
        expect(projected(i)).toContain("deletedAt");
    });
});

describe("readLiveCaller（同じ読みで欲しい属性も引く）", () => {
    it("extra を射影に足し、行を返す", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1", displayName: "名前" } });
        const r = await readLiveCaller("u1", ["displayName"]);
        expect(r).toEqual({ row: { userId: "u1", displayName: "名前" } });
        expect(projected(lastInput()).sort()).toEqual(["deletedAt", "displayName", "userId"]);
    });

    it("extra に deletedAt を重ねても射影は1つ", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1" } });
        await readLiveCaller("u1", ["deletedAt", "userId"]);
        expect(projected(lastInput()).sort()).toEqual(["deletedAt", "userId"]);
    });

    it("墓石なら行ではなく 410 を返す", async () => {
        mockSend.mockResolvedValue({ Item: { userId: "u1", displayName: "名前", deletedAt: "2026-10-18T00:00:00.000Z" } });
        const r = await readLiveCaller("u1", ["displayName"]);
        expect("gone" in r && r.gone.statusCode).toBe(410);
    });
});

describe("goneIfDeleted（読み済みの行で判定）", () => {
    it("墓石だけ 410", () => {
        expect(goneIfDeleted({ deletedAt: "x" })?.statusCode).toBe(410);
        expect(goneIfDeleted({ userId: "u1" })).toBeNull();
        expect(goneIfDeleted(undefined)).toBeNull();
        // 型違いの deletedAt は墓石ではない（`isDeletedProfile` と同じ線）
        expect(goneIfDeleted({ deletedAt: 1 })).toBeNull();
    });
});
