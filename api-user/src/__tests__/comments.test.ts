import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLookup = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: mockLookup,
}));

const { getComments, postComment, deleteComment } = await import("../comments");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, params: Record<string, string> | undefined, body?: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: params,
        body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
});

describe("getComments", () => {
    it("id なしは 400", async () => {
        expect((await invoke(getComments, ev(undefined, undefined))).statusCode).toBe(400);
    });

    it("新しい順（末尾追記の逆順）で返し、件数も返す", async () => {
        const items = [
            { id: "c1", uid: "u1", name: "A", text: "古い", t: "2026-01-01" },
            { id: "c2", uid: "u2", name: "B", text: "新しい", t: "2026-01-02" },
        ];
        mockDdbSend.mockResolvedValueOnce({ Item: { items } });
        const res = await invoke(getComments, ev(undefined, { id: "p1" }));
        expect(res.statusCode).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.count).toBe(2);
        expect(data.items[0].id).toBe("c2"); // 新しいのが先頭
    });

    it("コメントが無ければ空配列", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const data = JSON.parse((await invoke(getComments, ev(undefined, { id: "p1" }))).body);
        expect(data).toEqual({ items: [], count: 0 });
    });
});

describe("postComment", () => {
    it("認証・id なしは 400", async () => {
        expect((await invoke(postComment, ev(undefined, { id: "p1" }, { text: "hi" }))).statusCode).toBe(400);
    });

    it("空テキストは 400", async () => {
        expect((await invoke(postComment, ev("u1", { id: "p1" }, { text: "   " }))).statusCode).toBe(400);
    });

    it("写真が無ければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined }); // photo get
        expect((await invoke(postComment, ev("u1", { id: "ghost" }, { text: "hi" }))).statusCode).toBe(404);
    });

    it("投稿: 追記 + commentCount+1 + 名前はサーバー解決、オーナーに通知", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", thumbSrc: "https://cdn/p1_thumb.webp", userId: "owner", location: "北海道" } }) // photo
            .mockResolvedValueOnce({}) // append
            .mockResolvedValueOnce({}); // count +1
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "  すてき  " }));
        expect(res.statusCode).toBe(200);
        const c = JSON.parse(res.body).comment;
        expect(c.text).toBe("すてき"); // trim
        expect(c.name).toBe("旅人A"); // lookupDisplayName
        expect(c.uid).toBe("u1");
        expect(mockPush).toHaveBeenCalledOnce();
        expect(mockPush.mock.calls[0][0]).toBe("owner");
        expect(mockPush.mock.calls[0][1].type).toBe("comment");
        expect(mockPush.mock.calls[0][1].photoSrc).toBe("https://cdn/p1_thumb.webp");
    });

    it("自分の写真には通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "u1" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "self" }));
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("500文字を超えるテキストは切り詰められる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "x".repeat(800) }));
        expect(JSON.parse(res.body).comment.text.length).toBe(500);
    });

    // 追記だけだと DynamoDB のアイテム上限(400KB)に達し、以後そのフォトには
    // 誰も二度とコメントできなくなる（縮む経路が無い）。上限で切り詰める。
    it("200件を超えたら古い方を捨てて200件に切り詰める", async () => {
        const stored = Array.from({ length: 201 }, (_, i) => ({
            id: `c${i}`, uid: "u", name: "n", text: "t", t: "2026-01-01",
        }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } }) // photo
            .mockResolvedValueOnce({ Attributes: { items: stored } })                        // append
            .mockResolvedValueOnce({})                                                        // trim
            .mockResolvedValueOnce({});                                                       // count +1

        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));

        const trim = mockDdbSend.mock.calls[2][0].input;
        expect(trim.UpdateExpression).toContain(":trimmed");
        expect(trim.ExpressionAttributeValues[":trimmed"]).toHaveLength(200);
        // 残るのは新しい方（末尾追記なので後ろが新しい）
        expect(trim.ExpressionAttributeValues[":trimmed"][0].id).toBe("c1");
        expect(trim.ExpressionAttributeValues[":trimmed"][199].id).toBe("c200");
    });

    it("切り詰めは「読んだときと同じ長さのまま」を条件にする", async () => {
        // 無条件に書き戻していた頃は、読んでから書くまでに入った投稿が
        // まるごと消えた（投稿者には200が返り画面にも出ているのに、あとで消える）。
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}` }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        const trim = mockDdbSend.mock.calls[2][0].input;
        expect(trim.ConditionExpression).toBe("size(#items) = :len");
        expect(trim.ExpressionAttributeValues[":len"]).toBe(201);
    });

    it("切り詰めが競合しても投稿自体は成功する（次の投稿が詰める）", async () => {
        const stored = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}` }));
        const conflict = Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockRejectedValueOnce(conflict)
            .mockResolvedValueOnce({});
        const res = await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        expect(res.statusCode).toBe(200);
    });

    it("200件以下なら切り詰めの書き込みをしない", async () => {
        const stored = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
        mockDdbSend
            .mockResolvedValueOnce({ Item: { src: "https://cdn/p1.jpg", userId: "owner" } })
            .mockResolvedValueOnce({ Attributes: { items: stored } })
            .mockResolvedValueOnce({});
        await invoke(postComment, ev("u1", { id: "p1" }, { text: "hi" }));
        // photo get / append / commentCount+1 の3回だけ
        expect(mockDdbSend).toHaveBeenCalledTimes(3);
    });
});

describe("deleteComment", () => {
    const existing = [{ id: "c1", uid: "author", name: "A", text: "hi", t: "2026-01-01" }];

    it("投稿者本人は削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } }) // photo
            .mockResolvedValueOnce({ Item: { items: existing } }) // read comments
            .mockResolvedValueOnce({}) // put
            .mockResolvedValueOnce({}); // count -1
        const res = await invoke(deleteComment, ev("author", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(200);
    });

    it("写真オーナーは他人のコメントを削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        const res = await invoke(deleteComment, ev("owner", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(200);
    });

    it("第三者は 403", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } });
        const res = await invoke(deleteComment, ev("stranger", { id: "p1", commentId: "c1" }));
        expect(res.statusCode).toBe(403);
    });

    it("存在しないコメントは 404", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { userId: "owner" } })
            .mockResolvedValueOnce({ Item: { items: existing } });
        const res = await invoke(deleteComment, ev("author", { id: "p1", commentId: "nope" }));
        expect(res.statusCode).toBe(404);
    });
});
