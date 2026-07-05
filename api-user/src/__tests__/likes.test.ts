import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { getLikeCount, likePhoto, unlikePhoto } = await import("../likes");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, id: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
    };
}

function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

beforeEach(() => mockDdbSend.mockReset());

describe("getLikeCount", () => {
    it("id なしは 400", async () => {
        expect((await invoke(getLikeCount, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("写真の likes を返す（未設定・負値は 0）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { likes: 5 } });
        expect(JSON.parse((await invoke(getLikeCount, ev(undefined, "p1"))).body)).toEqual({ likes: 5 });

        mockDdbSend.mockResolvedValueOnce({ Item: {} });
        expect(JSON.parse((await invoke(getLikeCount, ev(undefined, "p2"))).body)).toEqual({ likes: 0 });
    });
});

describe("likePhoto", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(likePhoto, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(likePhoto, ev("u1", undefined))).statusCode).toBe(400);
    });

    it("初回いいね: マーカー作成 + カウンタ+1、新しい数を返す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 3 } }); // Update +1
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 3 });
        // マーカー id が like#p1#u1
        const put = mockDdbSend.mock.calls[0][0] as { input: { Item: { id: string; uid: string; userId?: string } } };
        expect(put.input.Item.id).toBe("like#p1#u1");
        expect(put.input.Item.uid).toBe("u1");
        expect(put.input.Item.userId).toBeUndefined(); // GSI を汚さない
    });

    it("いいね済み（マーカー重複）は冪等に現在数を返す（カウンタ増やさない）", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // Put marker → 既存
            .mockResolvedValueOnce({ Item: { likes: 7 } }); // readLikeCount
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 7 });
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // Update されない
    });

    it("写真が存在しない場合はマーカーを巻き戻して 404", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockRejectedValueOnce(condFail()) // Update → attribute_exists 失敗
            .mockResolvedValueOnce({}); // Delete marker（巻き戻し）
        const res = await invoke(likePhoto, ev("u1", "ghost"));
        expect(res.statusCode).toBe(404);
        const del = mockDdbSend.mock.calls[2][0] as { input: { Key: { id: string } } };
        expect(del.input.Key.id).toBe("like#ghost#u1");
    });
});

describe("unlikePhoto", () => {
    it("いいね解除: マーカー削除 + カウンタ-1", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Delete marker
            .mockResolvedValueOnce({ Attributes: { likes: 2 } }); // Update -1
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 2 });
    });

    it("未いいね（マーカーなし）は冪等に現在数を返す", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // Delete marker → 無い
            .mockResolvedValueOnce({ Item: { likes: 4 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 4 });
    });

    it("カウンタが既に0でも 0 未満にならない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Delete marker
            .mockRejectedValueOnce(condFail()) // Update likes>0 失敗
            .mockResolvedValueOnce({ Item: { likes: 0 } });
        const res = await invoke(unlikePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 0 });
    });
});
