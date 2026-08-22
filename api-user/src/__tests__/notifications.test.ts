import { describe, it, expect, vi, beforeEach } from "vitest";

// 通知の取得と既読化。**このファイルにはテストが1本も無かった。**
//
// notify.ts（書き込み側）にはテストがあるが、読み側は無検証だった。
// 未読数の不変条件は両側で守らないと意味がない——書き込み側を直しても、
// それより前に溜まった行は `unread > items.length` のまま残る。

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

vi.stubEnv("USERS_TABLE", "users-test");
const { getNotifications, readNotifications } = await import("../notifications");
const { NOTIFS_MAX } = await import("../notify");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ME = "11111111-1111-4111-8111-111111111111";
const ev = (sub: string | undefined = ME) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
});

const notif = (i: number) => ({
    type: "like" as const, photoId: `p${i}`, photoSrc: `https://cdn/p${i}.jpg`,
    byName: "旅人", t: `2026-08-20T00:00:${String(i).padStart(2, "0")}Z`,
});
const list = (n: number) => Array.from({ length: n }, (_, i) => notif(i));

const inputs = () => mockDdbSend.mock.calls.map((c) => c[0].input as Record<string, unknown>);

beforeEach(() => mockDdbSend.mockReset().mockResolvedValue({}));

describe("getNotifications", () => {
    it("保存されている通知と未読数を返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: list(3), unread: 2 } });
        const res = await invoke(getNotifications, ev());
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { items: unknown[]; unread: number };
        expect(body.items).toHaveLength(3);
        expect(body.unread).toBe(2);
        expect(inputs()[0].Key).toEqual({ id: `notifs#${ME}` });
    });

    it("何も無ければ空で返す", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(JSON.parse((await invoke(getNotifications, ev())).body)).toEqual({ items: [], unread: 0 });
    });

    it("返す件数は上限まで", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: list(NOTIFS_MAX + 10), unread: 1 } });
        const body = JSON.parse((await invoke(getNotifications, ev())).body) as { items: unknown[] };
        expect(body.items).toHaveLength(NOTIFS_MAX);
    });

    // 書き込み側の頭打ちを入れる前に溜まった行は `unread > items.length` の
    // まま残っている。生で返すとバッジが「200」なのに開くと50件になる。
    it("未読数は保存件数を超えて返さない（古いデータの取り繕い）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: list(NOTIFS_MAX + 10), unread: 200 } });
        const body = JSON.parse((await invoke(getNotifications, ev())).body) as { unread: number };
        expect(body.unread).toBe(NOTIFS_MAX);
    });

    it("通知が1件も無ければ未読も0（バッジだけ残さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: [], unread: 7 } });
        expect(JSON.parse((await invoke(getNotifications, ev())).body).unread).toBe(0);
    });

    it("負の未読数は0に丸める", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { items: list(3), unread: -5 } });
        expect(JSON.parse((await invoke(getNotifications, ev())).body).unread).toBe(0);
    });

    it("読めなければ 500", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 想定内 */ });
        mockDdbSend.mockImplementationOnce(() => Promise.reject(new Error("ddb down")));
        expect((await invoke(getNotifications, ev())).statusCode).toBe(500);
        logged.mockRestore();
    });
});

describe("認証の無い呼び出し", () => {
    // getUserId は sub 欠落で "" を返す。見ずに進むと "notifs#"（空uid）という
    // 共有の1行を読み書きする。他のハンドラは全部見ているのに、ここだけ緩かった。
    it("sub が無ければ 401（共有の空行を読み書きしない）", async () => {
        expect((await invoke(getNotifications, ev(""))).statusCode).toBe(401);
        expect((await invoke(readNotifications, ev(""))).statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("readNotifications", () => {
    it("未読数を0にする", async () => {
        expect((await invoke(readNotifications, ev())).statusCode).toBe(200);
        const input = inputs()[0];
        expect(input.Key).toEqual({ id: `notifs#${ME}` });
        expect(input.UpdateExpression).toBe("SET unread = :z");
        // 通知が1件も届いていない人の文書を作らない（GSI に載らない行が増える）
        expect(input.ConditionExpression).toBe("attribute_exists(id)");
    });

    it("文書がまだ無くても 200（条件外れは正常）", async () => {
        mockDdbSend.mockImplementationOnce(() => Promise.reject(
            Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }),
        ));
        expect((await invoke(readNotifications, ev())).statusCode).toBe(200);
    });

    it("それ以外の失敗は 500", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 想定内 */ });
        mockDdbSend.mockImplementationOnce(() => Promise.reject(new Error("ddb down")));
        expect((await invoke(readNotifications, ev())).statusCode).toBe(500);
        logged.mockRestore();
    });
});
