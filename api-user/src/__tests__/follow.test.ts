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

vi.stubEnv("USERS_TABLE", "users-test");
const { followUser, unfollowUser, getFollowStats, getMyFollowing } = await import("../follow");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

// Cognito の sub は UUID。でたらめな文字列は弾かれるようになったので、
// テストでも実際の形に合わせる。
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

function ev(sub: string | undefined, uid: string | undefined) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: uid ? { uid } : undefined,
    };
}
function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

/**
 * followUser は最初に「相手が実在するか」を USERS_TABLE に聞く。
 * その応答を先頭に積んでから、テスト固有の応答を続ける。
 */
function queueUserExists() {
    mockDdbSend.mockResolvedValueOnce({ Item: { userId: OTHER } });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
});

describe("followUser", () => {
    it("自分をフォローは 400", async () => {
        expect((await invoke(followUser, ev(ME, ME))).statusCode).toBe(400);
    });

    it("認証なしは 400", async () => {
        expect((await invoke(followUser, ev(undefined, OTHER))).statusCode).toBe(400);
    });

    // 形も存在も見ていなかったので、でたらめなIDを投げるだけで
    // マーカー・カウンタ・通知文書の3つが作られた。このテーブルは
    // 公開一覧やストーリー掃除が端から端まで読むので、ゴミが増えるほど
    // 全員の表示が遅くなる。しかも通知文書は退会処理でも消えない。
    it("ユーザーIDの形でない相手は 400（何も書かない）", async () => {
        const res = await invoke(followUser, ev(ME, "not-a-uuid"));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("実在しない相手は 404（何も書かない）", async () => {
        mockDdbSend.mockResolvedValueOnce({}); // USERS_TABLE に行が無い
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // 確認の1回だけ
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("実在確認に失敗したときは通す（実在する相手を弾かない）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("ddb down"));
        mockDdbSend
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { list: [] } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } });
        expect((await invoke(followUser, ev(ME, OTHER))).statusCode).toBe(200);
    });

    it("初回フォロー: マーカー作成 + カウンタ + following追加 + 通知", async () => {
        queueUserExists();
        mockDdbSend
            .mockResolvedValueOnce({})                              // Put marker
            .mockResolvedValueOnce({})                              // bump target.followers
            .mockResolvedValueOnce({})                              // bump me.following
            .mockResolvedValueOnce({ Item: { list: [] } })         // readFollowing
            .mockResolvedValueOnce({})                              // Put following list
            .mockResolvedValueOnce({ Item: { followers: 1, following: 0 } }); // readStats
        const res = await invoke(followUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(true);
        // マーカー id と uid（GSIを汚さない）
        // 先頭は「相手が実在するか」の確認なので、マーカーはその次
        const put = mockDdbSend.mock.calls[1][0] as { input: { Item: { id: string; uid: string; userId?: string } } };
        expect(put.input.Item.id).toBe(`follow#${OTHER}#${ME}`);
        expect(put.input.Item.uid).toBe(ME);
        expect(put.input.Item.userId).toBeUndefined();
        expect(mockPush).toHaveBeenCalledOnce();
        expect(mockPush.mock.calls[0][0]).toBe(OTHER);
        expect(mockPush.mock.calls[0][1].type).toBe("follow");
        expect(mockPush.mock.calls[0][1].targetUserId).toBe(ME);
    });

    it("既にフォロー済みは冪等（カウンタ・通知なし）", async () => {
        queueUserExists();
        mockDdbSend
            .mockRejectedValueOnce(condFail())                     // Put marker → 既存
            .mockResolvedValueOnce({ Item: { followers: 3, following: 0 } }); // readStats
        const res = await invoke(followUser, ev(ME, OTHER));
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
        const res = await invoke(unfollowUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);
    });

    it("フォローしていなければ冪等", async () => {
        mockDdbSend
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { followers: 0, following: 0 } });
        const res = await invoke(unfollowUser, ev(ME, OTHER));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).following).toBe(false);
    });
});

describe("getFollowStats / getMyFollowing", () => {
    it("公開の数を返す（未設定・負値は0）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { followers: 5, following: 2 } });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, OTHER))).body)).toEqual({ followers: 5, following: 2 });
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        expect(JSON.parse((await invoke(getFollowStats, ev(undefined, "u3"))).body)).toEqual({ followers: 0, following: 0 });
    });

    it("自分の following userId 一覧を返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["a", "b"] } });
        expect(JSON.parse((await invoke(getMyFollowing, ev(ME, undefined))).body)).toEqual({ userIds: ["a", "b"] });
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
            // 相手が実在するかの確認（USERS_TABLE）
            if (input.TableName === "users-test") return Promise.resolve({ Item: { userId: THIRD } });
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
                { Item: { list: [OTHER], rev: 1 } },     // 競合後の読み直し: 他が b を入れていた
            ],
            ["conflict", "ok"],
        );

        const res = await invoke(followUser, ev(ME, THIRD));
        expect(res.statusCode).toBe(200);

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string; list?: string[] } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        // 最後の書き込みには両方入っている（b を消していない）
        expect(puts[puts.length - 1]!.list).toEqual([THIRD, OTHER]);
    });

    it("書き込みにはリビジョンの条件が付く（無条件の上書きをしない）", async () => {
        setupFollow([{ Item: { list: [OTHER], rev: 3 } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("rev = :rev");
        expect((put.ExpressionAttributeValues as Record<string, unknown>)[":rev"]).toBe(3);
        expect((put.Item as { rev: number }).rev).toBe(4);
    });

    it("一覧の更新を諦めたら失敗を返し、マーカーも取り消す", async () => {
        // 以前はログを1行出して 200 を返していた。マーカーは残るので
        // 「フォロー済み扱いなのに一覧に出ない」状態が固定され、
        // 押し直しても「既にフォロー済み」で早期 return して直らない
        // （その人の写真がフィードに二度と出てこない）。
        setupFollow(
            Array.from({ length: 5 }, () => ({ Item: { list: [], rev: 0 } })),
            ["conflict", "conflict", "conflict", "conflict"],
        );

        const res = await invoke(followUser, ev(ME, THIRD));
        expect(res.statusCode).toBe(500);

        // 押し直せるように follow# マーカーを消している
        const deletedIds = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Key?: { id?: string } } }).input?.Key?.id)
            .filter(Boolean);
        expect(deletedIds).toContain(`follow#${THIRD}#${ME}`);
    });

    it("rev を持たない既存データも書き込める（後方互換）", async () => {
        setupFollow([{ Item: { list: [OTHER] } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const put = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input!)
            .find((i) => (i.Item as { id?: string } | undefined)?.id?.startsWith("following#"))!;
        expect(put.ConditionExpression).toContain("attribute_not_exists(rev)");
    });

    it("既にフォロー済みなら一覧を書き換えない", async () => {
        setupFollow([{ Item: { list: [THIRD], rev: 2 } }], ["ok"]);
        await invoke(followUser, ev(ME, THIRD));

        const puts = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { Item?: { id?: string } } }).input?.Item)
            .filter((i) => i?.id?.startsWith("following#"));
        expect(puts).toHaveLength(0);
    });
});
