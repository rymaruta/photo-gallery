import { describe, it, expect, vi, beforeEach } from "vitest";
import { marshall } from "@aws-sdk/util-dynamodb";

// 退会でプロフィール行を消すだけだった頃、**消したはずのアカウントが
// 復活しえた**。API Gateway の JWT オーソライザは署名と exp しか見ないので、
// Cognito のユーザーを消しても既に配ったトークンは期限まで通る。別の端末に
// 残っていたタブが GET /user/profile を叩くと「行が無い人」に見え、
// createProfileIfMissing（PostConfirmation の取りこぼしを救う仕組み）が
// 行を作り直す。作られた行は follow.ts の実在判定を通すので、
// **消えた ID がフォローできる**状態になり、誰も掃除しない。

const mockSend = vi.hoisted(() => vi.fn());
const commands = vi.hoisted(() => [] as { type: string; input: Record<string, unknown> }[]);

vi.mock("@aws-sdk/client-dynamodb", () => {
    const make = (type: string) => class {
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) { this.input = input; commands.push({ type, input }); }
    };
    return {
        DynamoDBClient: class { send = mockSend; },
        GetItemCommand: make("Get"),
        PutItemCommand: make("Put"),
        DeleteItemCommand: make("Delete"),
    };
});

const { getMyProfile, updateMyProfile, getPublicProfile, isDeletedProfile } = await import("../userProfile");

type Result = { statusCode: number; body: string };
const authed = (handler: unknown, body?: unknown): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handler as any)({
        requestContext: { authorizer: { jwt: { claims: { sub: "gone" } } } },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

const TOMBSTONE = {
    Item: marshall({ userId: "gone", deletedAt: "2026-08-27T00:00:00.000Z", ttl: 1788000000 }),
};

beforeEach(() => {
    commands.length = 0;
    mockSend.mockReset();
});

describe("退会済みの印（墓石）", () => {
    it("GET /user/profile は 410。行を作り直さない", async () => {
        mockSend.mockResolvedValueOnce(TOMBSTONE);
        const res = await authed(getMyProfile);

        expect(res.statusCode).toBe(410);
        // createProfileIfMissing が走っていない（走ると退会が取り消される）
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("PUT /user/profile も 410。保存で生き返らせない", async () => {
        mockSend.mockResolvedValueOnce(TOMBSTONE);
        const res = await authed(updateMyProfile, { displayName: "復活" });

        expect(res.statusCode).toBe(410);
        expect(commands.filter((c) => c.type === "Put")).toHaveLength(0);
    });

    it("公開プロフィールは「未設定の人」と同じ見え方（中身を返さない）", async () => {
        mockSend.mockResolvedValueOnce({
            Item: marshall({ userId: "gone", deletedAt: "2026-08-27T00:00:00.000Z", displayName: "旅人", bio: "こんにちは" }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (getPublicProfile as any)({ pathParameters: { userId: "gone" } }) as Result;

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ userId: "gone" });
    });

    it("行が無いだけの人は今までどおり作り直す（PostConfirmation の取りこぼし救済）", async () => {
        mockSend
            .mockResolvedValueOnce({})    // getProfile: 行なし
            .mockResolvedValueOnce({});   // createProfileIfMissing の Put
        const res = await authed(getMyProfile);

        expect(res.statusCode).toBe(200);
        const puts = commands.filter((c) => c.type === "Put");
        expect(puts).toHaveLength(1);
        expect(puts[0].input.ConditionExpression).toContain("attribute_not_exists(userId)");
    });

    it("isDeletedProfile は deletedAt の有無だけで決める", () => {
        expect(isDeletedProfile({ userId: "u", deletedAt: "2026-01-01T00:00:00.000Z" })).toBe(true);
        expect(isDeletedProfile({ userId: "u" })).toBe(false);
        expect(isDeletedProfile(null)).toBe(false);
        // 型が違うものを「消えている」と読まない
        expect(isDeletedProfile({ userId: "u", deletedAt: 1 })).toBe(false);
    });
});
