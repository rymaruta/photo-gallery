import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

import { listMyPhotos, countUserPhotos } from "../ddb-photos";
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

    it("ストーリーは下書き一覧に出さない", async () => {
        // ストーリーも src / userId / published:false を持つので、
        // 除外しないと「下書き」として並び、そこから「公開する」を押せた。
        // 公開すると永久の写真ページになり、24時間後の期限切れ掃除が
        // 実体だけ消して壊れたページが残った。
        mockDdbSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
        await listMyPhotos("u1");
        const input = (mockDdbSend.mock.calls[0][0] as { input: Record<string, unknown> }).input;
        expect(String(input.FilterExpression)).toContain("attribute_not_exists(story)");
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

    // E-5（12f7fe7）は sub 空ガードをここに足したが、jsonError の import を
    // 落としていて、このブランチに入ると ReferenceError → 500 だった。
    // ルートの tsc は api-user を exclude していて型検査も素通り
    // （調査ラウンド2の指摘）。ブランチを実際に踏むテストで固定する。
    it("sub が無ければ 401（DynamoDB を触らない）", async () => {
        const res = await invoke(event(""));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event("u1"));
        expect(res.statusCode).toBe(500);
    });
});

// 100枚制限の判定に使う件数。
// 以前は Query 1回の Count をそのまま返していた。DynamoDB は1MB読んだ時点で
// 打ち切るので写真が増えるほど少なく数え、上限が効かなくなる。
// さらにストーリーまで数えていたので、上限の意味もぶれていた。
describe("countUserPhotos", () => {
    it("ページを辿って全部足す（1回のCountで打ち切らない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Count: 60, LastEvaluatedKey: { id: "x" } })
            .mockResolvedValueOnce({ Count: 45 });
        expect(await countUserPhotos("u1")).toBe(105);
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    it("写真だけを数える（ストーリーは含めない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Count: 3 });
        await countUserPhotos("u1");
        const input = (mockDdbSend.mock.calls[0][0] as { input: Record<string, unknown> }).input;
        expect(input.FilterExpression).toContain("attribute_exists(src)");
        expect(input.FilterExpression).toContain("attribute_not_exists(story)");
        expect(input.Select).toBe("COUNT");
    });

    it("0件でも落ちない", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(await countUserPhotos("u1")).toBe(0);
    });
});
