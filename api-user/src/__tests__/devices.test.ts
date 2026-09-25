import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { registerDevice, unregisterDevice, deviceTokens, forgetTokens, devicesId, deviceOwnerId,
    isDeviceToken, normalizeDeviceToken, DEVICES_MAX } = await import("../devices");

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

/**
 * **鍵と種類で選ぶ。呼び出しの添字で拾わない。**
 * 添字で拾っていたら、持ち主の逆引きを1本足した時点で2件壊れた
 * （CLAUDE.md の「間に読み取りが1つ増えるだけで全部のテストが壊れる」）。
 */
type Cmd = { constructor: { name: string }; input: Record<string, unknown> & { Key?: { id?: string } } };
const cmds = () => mockDdbSend.mock.calls.map((c) => c[0] as Cmd);
const onKey = (id: string) => cmds().filter((c) => c.input.Key?.id === id);
const withExpr = (id: string, needle: string) =>
    onKey(id).find((c) => String(c.input.UpdateExpression ?? "").includes(needle));

/** 持ち主の逆引き（`ALL_OLD`）が返す世界。それ以外は `extra` で足す */
function serve(previousOwner: string | undefined, extra: (cmd: Cmd) => unknown = () => ({})) {
    mockDdbSend.mockImplementation((cmd: Cmd) => {
        if (cmd.input.Key?.id?.startsWith("devicetoken#")) {
            return Promise.resolve(previousOwner ? { Attributes: { uid: previousOwner } } : {});
        }
        return Promise.resolve(extra(cmd) ?? {});
    });
}

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
        serve(undefined, (c) => (c.constructor.name === "GetCommand" ? { Item: { tokens: new Set([TOKEN]) } } : {}));
        const res = await invoke(registerDevice, ev("u1", { token: TOKEN }));

        expect(res.statusCode).toBe(200);
        const update = withExpr(devicesId("u1"), "ADD #tokens :token")!;
        expect(update, "自分の行に ADD していない").toBeTruthy();
        expect((update.input.ExpressionAttributeValues as Record<string, unknown>)[":token"]).toEqual(new Set([TOKEN]));
    });

    it("上限を超えたら外すが、いま登録した1台は必ず残す", async () => {
        const many = Array.from({ length: DEVICES_MAX + 2 }, (_, i) => `${i}`.padStart(64, "c"));
        serve(undefined, (c) => (c.constructor.name === "GetCommand"
            ? { Item: { tokens: new Set([...many, TOKEN]) } } : {}));
        await invoke(registerDevice, ev("u1", { token: TOKEN }));

        const del = withExpr(devicesId("u1"), "DELETE #tokens")!;
        expect(del, "溢れたのに外していない").toBeTruthy();
        const dropped = (del.input.ExpressionAttributeValues as Record<string, Set<string>>)[":dead"];
        expect(dropped.has(TOKEN), "いま登録した1台を外している").toBe(false);
    });

    // 数えるのは `ADD` の直後。結果整合の読みだと切り詰めが飛ぶ／削り過ぎる
    it("数える読みは強整合", async () => {
        serve(undefined, (c) => (c.constructor.name === "GetCommand" ? { Item: { tokens: new Set([TOKEN]) } } : {}));
        await invoke(registerDevice, ev("u1", { token: TOKEN }));
        const get = cmds().find((c) => c.constructor.name === "GetCommand" && c.input.Key?.id === devicesId("u1"))!;
        expect(get.input.ConsistentRead).toBe(true);
    });
});

/**
 * 🔴 **同じ端末を別の人が使ったとき、前の人宛ての通知が届かないこと。**
 *
 * 解除は端末側からしか呼べないので、強制ログアウト・クラッシュ・アプリ削除・
 * 通信断では `devices#前の人` にトークンが残る。APNs はそのトークンを有効な
 * ものとして 200 を返すので、**410 では絶対に消えない**。
 */
describe("持ち主の付け替え", () => {
    it("前の持ち主から外してから、自分に足す", async () => {
        serve("u-old");
        await invoke(registerDevice, ev("u1", { token: TOKEN }));

        // 逆引きを自分に書き換えている
        const own = withExpr(deviceOwnerId(TOKEN), "SET uid = :uid")!;
        expect(own, "持ち主の行を書いていない").toBeTruthy();
        expect((own.input.ExpressionAttributeValues as Record<string, unknown>)[":uid"]).toBe("u1");
        expect(own.input.ReturnValues, "古い持ち主を読み取っていない").toBe("ALL_OLD");

        // 前の持ち主の集合から落としている
        const del = withExpr(devicesId("u-old"), "DELETE #tokens")!;
        expect(del, "前の持ち主に残したまま").toBeTruthy();
        expect((del.input.ExpressionAttributeValues as Record<string, Set<string>>)[":dead"].has(TOKEN)).toBe(true);

        // **順番**: 外すのが先（あとにすると、外す前に相手へ飛ぶ窓が残る）
        const ids = cmds().map((c) => c.input.Key?.id);
        expect(ids.indexOf(devicesId("u-old"))).toBeLessThan(ids.lastIndexOf(devicesId("u1")));
    });

    it("同じ人が登録し直したときは、何も外さない", async () => {
        serve("u1");
        await invoke(registerDevice, ev("u1", { token: TOKEN }));
        expect(withExpr(devicesId("u1"), "DELETE #tokens"), "自分から外している").toBeUndefined();
    });

    it("初めての端末なら、外す相手が居ない", async () => {
        serve(undefined);
        await invoke(registerDevice, ev("u1", { token: TOKEN }));
        expect(cmds().some((c) => String(c.input.UpdateExpression ?? "").includes("DELETE #tokens"))).toBe(false);
    });

    // **失敗しても登録は続ける**（止めると通知が1つも届かない）
    it("付け替えが転んでも 200 で、自分への登録は済ませる", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) =>
            cmd.input.Key?.id?.startsWith("devicetoken#")
                ? Promise.reject(new Error("throttled"))
                : Promise.resolve({}));
        const res = await invoke(registerDevice, ev("u1", { token: TOKEN }));
        expect(res.statusCode).toBe(200);
        expect(withExpr(devicesId("u1"), "ADD #tokens :token"), "登録を飛ばしている").toBeTruthy();
    });

    // 16進なので大文字小文字は同じ端末。Set では別メンバーになる
    it("大文字で来ても小文字に畳んで扱う", async () => {
        expect(normalizeDeviceToken(" " + TOKEN.toUpperCase() + " ")).toBe(TOKEN);
        serve(undefined);
        await invoke(registerDevice, ev("u1", { token: TOKEN.toUpperCase() }));
        const own = cmds().find((c) => c.input.Key?.id?.startsWith("devicetoken#"))!;
        expect(own.input.Key?.id).toBe(deviceOwnerId(TOKEN));
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
