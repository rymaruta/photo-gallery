import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

import { listMyPhotos } from "../ddb-photos";
import { getMyPhotos } from "../userPhotos";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (getMyPhotos as any)(event);
const event = (sub: string) => ({ requestContext: { authorizer: { jwt: { claims: { sub } } } } });

beforeEach(() => mockDdbSend.mockReset());

describe("listMyPhotos", () => {
    it("USER_INDEX を userId で引き、published フィルタを付けない（下書きも返す）", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Items: [
                { id: "d1", src: "s1", published: false },
                { id: "p1", src: "s2", published: true },
            ],
            LastEvaluatedKey: undefined,
        });
        const photos = await listMyPhotos("u1");
        expect(photos.map((p) => p.id)).toEqual(["d1", "p1"]);
        const input = (mockDdbSend.mock.calls[0][0] as { input: Record<string, unknown> }).input;
        expect(input.IndexName).toBe("userId-createdAt-index");
        expect(input.KeyConditionExpression).toContain("userId = :uid");
        expect((input.ExpressionAttributeValues as Record<string, unknown>)[":uid"]).toBe("u1");
        // 下書きが漏れないよう published での絞り込みは行わない
        expect(JSON.stringify(input)).not.toContain("published");
        expect(input.ScanIndexForward).toBe(false); // 新しい順
    });

    it("ページネーション（LastEvaluatedKey）を辿って全件返す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "a", src: "s" }], LastEvaluatedKey: { id: "a" } })
            .mockResolvedValueOnce({ Items: [{ id: "b", src: "s" }], LastEvaluatedKey: undefined });
        const photos = await listMyPhotos("u1");
        expect(photos.map((p) => p.id)).toEqual(["a", "b"]);
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });
});

describe("getMyPhotos handler", () => {
    it("自分の写真一覧（下書き含む）を 200 で返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [{ id: "d1", src: "s", published: false }], LastEvaluatedKey: undefined });
        const res = await invoke(event("u1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([{ id: "d1", src: "s", published: false }]);
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event("u1"));
        expect(res.statusCode).toBe(500);
    });
});
