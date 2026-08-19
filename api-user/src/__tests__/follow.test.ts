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

const { followUser, unfollowUser, getFollowStats, getMyFollowing } = await import("../follow");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, uid: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: uid ? { uid } : undefined,
    };
}
function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
});

describe("followUser", () => {
    it("自分をフォローは 400", async () => {
        expect((await invoke(followUser, ev("u1", "u1"))).statusCode).toBe(400);
    });

    it("認証なしは 400", async () => {
        expect((await invoke(followUser, ev(undefined, "u2"))).statusCode).toBe(400);
    });

    it("初回フォロー: マーカー作成 + カウンタ + following追加 + 通知", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                              // Put marker
            .mockResolvedValueOnce({})                              // bump target.followers
            .mockResolvedValueOnce({})                              // bump me.following
            .mockResolvedValueOnce({ Item: { list: [] } })         // readFollowing
            .mockResolvedValueOnce({})                              // Put following list
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } }); // readStats
        const res = await invoke(followUser, ev("u1", "u2"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(true);
        // マーカー id と uid（GSIを汚さない）
        const put = mockDdbSend.mock.calls[0][0] as { input: { Item: { id: string; uid: string; userId?: string } } };
        expect(put.input.Item.id).toBe("follow#u2#u1");
        expect(put.input.Item.uid).toBe("u1");
        expect(put.input.Item.userId).toBeUndefined();
        expect(mockPush).toHaveBeenCalledOnce();
        expect(mockPush.mock.calls[0][0]).toBe("u2");
        expect(mockPush.mock.calls[0][1].type).toBe("follow");
        expect(mockPush.mock.calls[0][1].targetUserId).toBe("u1");
    });

    it("既にフォロー済みは冪等（カウンタ・通知なし）", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())                     // Put marker → 既存
            .mockResolvedValueOnce({ Item: { followers: 3, following: 0 } }); // readStats
        const res = await invoke(followUser, ev("u1", "u2"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).followers).toBe(3);
        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe("unfollowUser", () => {
    it("解除: マーカー削除 + カウンタ減算 + following除去", async () => {
        mockDdbSend
            .mockResolvedValueOnce({})                              // Delete marker
            .mockResolvedValueOnce({})                              // bump target.followers -1
            .mockResolvedValueOnce({})                              // bump me.following -1
            .mockResolvedValueOnce({ Item: { list: ["u2", "u3"] } })// readFollowing
            .mockResolvedValueOnce({})                              // Put following list
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } }); // readStats
        const res = await invoke(unfollowUser, ev("u1", "u2"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);
    });

    it("フォローしていなければ冪等", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        const res = await invoke(unfollowUser, ev("u1", "u2"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);
    });
});

describe("getFollowStats / getMyFollowing", () => {
    it("公開の数を返す（未設定・負値は0）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: 5, following: 2 } });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, "u2"))).body)).toEqual({ followers: 5, following: 2 });
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, "u3"))).body)).toEqual({ followers: 0, following: 0 });
    });

    it("自分の following userId 一覧を返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["a", "b"] } });
        expect(JSON.parse((await invoke(getMyFollowing, ev("u1", undefined))).body)).toEqual({ userIds: ["a", "b"] });
    });
});

// following# の一覧は以前「読む → 変える → 無条件で Put」だった。
// 短時間に2人フォローすると両方が同じリストを読み、片方の書き込みが
// もう片方を丸ごと上げ書きして一覧からフォローが消える。しかも
// follow# マーカーは残るため、再フォローしても早期 return で直らない。
describe("フォロー一覧の同時更新", () => {
    /** followUser の DDB 呼び出しを順に組み立てる（マーカー→カウンタ×2→一覧） */
    function setupFollow(listResponses: unknown[], putResults: ("ok" | "conflict")[]) {
        let listCall = 0;
        let putCall = 0;
        mockDdbSend.mockImplementation((cmd: { input?: Record<string, unknown> }) => {
            const input = cmd.input ?? {};
            const key = input.Key as { id?: string } | undefined;
            // following# の読み取り
            if (key?.id?.startsWith("following#")) {
                return Promise.resolve(listResponses[listCall++] ?? {});
            }
            // following# への書き込み
            const item = input.Item as { id?: string } | undefined;
            if (item?.id?.startsWith("following#")) {
                const outcome = putResults[putCall++] ?? "ok";
                return outcome === "conflict" ? Promise.reject(condFail()) : Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }

    it("書き込みが競合したら読み直して、既存のフォローを残したまま追加する", async () => {
        setupFollow(
            [
                { Item: { list: [], rev: 0 } },        // 1回目: 空に見えた
                { Item: { list: ["b"], rev: 1 } },     // 競合後の読み直し: 他が b を入れていた
            ],
            ["conflict", "ok"],
        );

        const res = await invoke(followUser, ev("me", "c"));
        expect(res.statusCode).toBe(200);

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string; list?: string[] } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        // 最後の書き込みには両方入っている（b を消していない）
        expect(puts[puts.length - 1]!.list).toEqual(["c", "b"]);
    });

    it("書き込みにはリビジョンの条件が付く（無条件の上書きをしない）", async () => {
        setupFollow([{ Item: { list: ["b"], rev: 3 } }], ["ok"]);
        await invoke(followUser, ev("me", "c"));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("rev = :rev");
        expect((put.ExpressionAttributeValues as Record<string, unknown>)[":rev"]).toBe(3);
        expect((put.Item as { rev: number }).rev).toBe(4);
    });

    it("rev を持たない既存データも書き込める（後方互換）", async () => {
        setupFollow([{ Item: { list: ["b"] } }], ["ok"]);
        await invoke(followUser, ev("me", "c"));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("attribute_not_exists(rev)");
    });

    it("既にフォロー済みなら一覧を書き換えない", async () => {
        setupFollow([{ Item: { list: ["c"], rev: 2 } }], ["ok"]);
        await invoke(followUser, ev("me", "c"));

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        expect(puts).toHaveLength(0);
    });
});
