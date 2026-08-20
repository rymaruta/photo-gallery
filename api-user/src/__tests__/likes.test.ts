import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { getLikeCount, getMyLike, likePhoto, unlikePhoto } = await import("../likes");

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

// 「自分がいいね済みか」をサーバーに聞く口。
// これが無かった頃、フロントは端末のお気に入り（localStorage）だけで
// 判断していた。未ログインで押した状態のままログインすると、次の一押しが
// DELETE になって取り消し扱いになり、投稿者にいいねも通知も届かない。
// 別の端末では逆に、いいね済みの写真が未いいねに見える。
describe("getMyLike", () => {
    it("マーカーがあれば liked=true", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "like#p1#u1" } });
        const res = await invoke(getMyLike, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true });
        expect((mockDdbSend.mock.calls[0][0] as { input: { Key: { id: string } } }).input.Key.id)
            .toBe("like#p1#u1");
    });

    it("マーカーが無ければ liked=false", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(getMyLike, ev("u1", "p1"))).body)).toEqual({ liked: false });
    });

    it("共有キャッシュには載せない（他人の状態が配られるため）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(getMyLike, ev("u1", "p1")) as unknown as {
            headers: Record<string, string>;
        };
        expect(res.headers["Cache-Control"]).toContain("no-store");
        expect(res.headers["Cache-Control"]).not.toContain("public");
    });

    it("認証・id なしは 400", async () => {
        expect((await invoke(getMyLike, ev(undefined, "p1"))).statusCode).toBe(400);
        expect((await invoke(getMyLike, ev("u1", undefined))).statusCode).toBe(400);
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

    it("いいねの条件式は「写真であること」まで確かめる", async () => {
        // attribute_exists(src) が無かった頃は、同じテーブルに同居している
        // 通知（notifs#<相手のsub>）やコメント（comments#<写真ID>）の文書にも
        // likes 属性を書き込めた。ID を当てられるかどうかの確認にも使えた。
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Attributes: { likes: 1 } });
        await invoke(likePhoto, ev("u1", "p1"));
        const update = mockDdbSend.mock.calls[1][0] as { input: { ConditionExpression: string } };
        expect(update.input.ConditionExpression).toContain("attribute_exists(src)");
        expect(update.input.ConditionExpression).toContain("attribute_not_exists(story)");
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

    it("初回いいねで投稿者に通知が積まれる（byName は Users テーブルから）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "owner", src: "https://c/p.jpg", thumbSrc: "https://c/p_thumb.webp", location: "北海道" } }) // Update ALL_NEW
            .mockResolvedValueOnce({ Item: { displayName: "旅子" } }) // lookupDisplayName
            .mockResolvedValueOnce({}); // pushNotification
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(4);
        const notif = mockDdbSend.mock.calls[3][0] as { input: { Key: { id: string }; ExpressionAttributeValues: Record<string, unknown> } };
        expect(notif.input.Key.id).toBe("notifs#owner");
        const item = (notif.input.ExpressionAttributeValues[":new"] as Array<Record<string, unknown>>)[0];
        expect(item.type).toBe("like");
        expect(item.byName).toBe("旅子");
        expect(item.photoSrc).toBe("https://c/p_thumb.webp"); // サムネ優先
        expect(item.atLocation).toBe("北海道");
    });

    it("自分の写真へのいいねは通知しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "u1", src: "https://c/p.jpg" } }); // 自分が投稿者
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // 通知の書き込みなし
    });

    it("いいね済み（連打）では通知されない", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail()) // マーカー既存
            .mockResolvedValueOnce({ Item: { likes: 7 } });
        await invoke(likePhoto, ev("u1", "p1"));
        expect(mockDdbSend).toHaveBeenCalledTimes(2); // 通知の書き込みなし
    });

    it("通知の書き込み失敗はいいね自体を失敗させない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({}) // Put marker
            .mockResolvedValueOnce({ Attributes: { likes: 1, userId: "owner", src: "https://c/p.jpg" } })
            .mockRejectedValueOnce(new Error("users table down")) // lookupDisplayName 失敗 → 既定名
            .mockRejectedValueOnce(new Error("notify down")); // pushNotification 失敗 → 握りつぶす
        const res = await invoke(likePhoto, ev("u1", "p1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true, likes: 1 });
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
