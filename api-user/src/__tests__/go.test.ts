import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { goPhoto } = await import("../go");

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

// goPhoto の呼び出し順:
// 1. Get 写真 2. Put マーカー 3. Update goCount 4. Get golist 5. Put golist
// (6. Get displayName 7. Update notifs — 他人の写真のときのみ)
describe("goPhoto の通知", () => {
    it("他人の写真に「行く」で投稿者に通知が積まれる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", src: "https://c/p.jpg", thumbSrc: "https://c/p_thumb.webp", userId: "owner", location: "京都" } })
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { goCount: 1 } })
            .mockResolvedValueOnce({ Item: undefined }) // golist なし
            .mockResolvedValueOnce({}) // Put golist
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } }) // displayName
            .mockResolvedValueOnce({}); // pushNotification
        const res = await invoke(goPhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ going: true, goCount: 1 });
        const notif = mockDdbSend.mock.calls[6][0] as { input: { Key: { id: string }; ExpressionAttributeValues: Record<string, unknown> } };
        expect(notif.input.Key.id).toBe("notifs#owner");
        const item = (notif.input.ExpressionAttributeValues[":new"] as Array<Record<string, unknown>>)[0];
        expect(item.type).toBe("go");
        expect(item.byName).toBe("旅子");
        expect(item.photoSrc).toBe("https://c/p_thumb.webp"); // サムネ優先
        expect(item.atLocation).toBe("京都");
    });

    it("自分の写真への「行く」は通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", src: "https://c/p.jpg", userId: "u1" } })
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { goCount: 2 } })
            .mockResolvedValueOnce({ Item: undefined })
            .mockResolvedValueOnce({}); // Put golist
        const res = await invoke(goPhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(5); // 通知の書き込みなし
    });

    it("「行く」済み（マーカー既存）は冪等で通知されない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", src: "https://c/p.jpg", userId: "owner" } })
            .mockRejectedValueOnce(condFail()) // マーカー既存
            .mockResolvedValueOnce({ Item: { goCount: 3, movedCount: 1 } }); // readCounters
        const res = await invoke(goPhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ going: true, goCount: 3, moved: 1 });
        expect(mockDdbSend).toHaveBeenCalledTimes(3);
    });
});
