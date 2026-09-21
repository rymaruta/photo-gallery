import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { registerDevice, unregisterDevice, deviceTokens, forgetTokens, devicesId, isDeviceToken, DEVICES_MAX } =
    await import("../devices");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);

function ev(sub: string | undefined, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
});

describe("端末トークンの形", () => {
    it("16進の長い文字列だけを受ける", () => {
        expect(isDeviceToken(TOKEN)).toBe(true);
        // **短すぎ・記号入り・空は弾く。** 何でも保存すると、送るたびに
        // APNs から 400 が返る宛先が溜まる
        expect(isDeviceToken("zzzz")).toBe(false);
        expect(isDeviceToken(`${TOKEN}../../etc`)).toBe(false);
        expect(isDeviceToken("")).toBe(false);
        expect(isDeviceToken(undefined)).toBe(false);
    });
});

describe("登録", () => {
    it("未ログインは 401", async () => {
        const res = await invoke(registerDevice, ev(undefined, { token: TOKEN }));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("不正なトークンは 400（保存しない）", async () => {
        const res = await invoke(registerDevice, ev("u1", { token: "nope" }));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("Set に ADD で足す（同じ端末を二度登録しても増えない形）", async () => {
        // 1回目: ADD、2回目: 上限確認のための Get
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: { tokens: new Set([TOKEN]) } });
        const res = await invoke(registerDevice, ev("u1", { token: TOKEN }));

        expect(res.statusCode).toBe(200);
        const update = mockDdbSend.mock.calls[0][0].input;
        expect(update.Key).toEqual({ id: devicesId("u1") });
        expect(update.UpdateExpression).toContain("ADD #tokens :token");
        expect(update.ExpressionAttributeValues[":token"]).toEqual(new Set([TOKEN]));
    });

    it("上限を超えたら外すが、いま登録した1台は必ず残す", async () => {
        const many = Array.from({ length: DEVICES_MAX + 2 }, (_, i) => `${i}`.padStart(64, "c"));
        mockDdbSend
            .mockResolvedValueOnce({})                                        // ADD
            .mockResolvedValueOnce({ Item: { tokens: new Set([...many, TOKEN]) } }) // 数える
            .mockResolvedValueOnce({});                                       // DELETE
        await invoke(registerDevice, ev("u1", { token: TOKEN }));

        const del = mockDdbSend.mock.calls[2][0].input;
        expect(del.UpdateExpression).toContain("DELETE #tokens");
        const dropped: Set<string> = del.ExpressionAttributeValues[":dead"];
        expect(dropped.has(TOKEN)).toBe(false);
    });
});

describe("解除", () => {
    it("外す（DELETE で Set から抜く）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(unregisterDevice, ev("u1", { token: TOKEN }));

        expect(res.statusCode).toBe(200);
        const del = mockDdbSend.mock.calls[0][0].input;
        expect(del.ExpressionAttributeValues[":dead"]).toEqual(new Set([TOKEN]));
    });

    /// **ログアウトの後始末なので、止めない。**
    it("知らないトークンでも 200（ログアウトを止めない）", async () => {
        const res = await invoke(unregisterDevice, ev("u1", { token: "" }));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("読み出し", () => {
    it("Set を配列にして返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { tokens: new Set([TOKEN, OTHER]) } });
        expect((await deviceTokens("u1")).sort()).toEqual([TOKEN, OTHER].sort());
    });

    /// **引けなければ空**（通知が飛ばないだけで、本体は止めない）。
    it("引けなくても投げない", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        expect(await deviceTokens("u1")).toEqual([]);
    });

    it("無効なトークンだけを外す（形が違うものは送らない）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        await forgetTokens("u1", [TOKEN, "nope"]);
        const del = mockDdbSend.mock.calls[0][0].input;
        expect(del.ExpressionAttributeValues[":dead"]).toEqual(new Set([TOKEN]));
    });

    it("外すものが無ければ書きに行かない", async () => {
        await forgetTokens("u1", ["nope"]);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});
