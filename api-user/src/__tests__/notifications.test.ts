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
const { resetDeletedUsersCache } = await import("../notify");
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

// **中括弧で囲う。** `() => mockDdbSend.mockReset().mockResolvedValue({})` は
// **モック自身を返す**——vitest はフックの戻り値が関数だと後片付けとして
// 扱うので、各テストのあとに `mockDdbSend()` が**引数なしで呼ばれて**いた。
// 実装が `mockResolvedValue` のうちは無害だったが、引数を見るモックに
// 変えた瞬間に落ちる（実際そうなった）。
beforeEach(() => { mockDdbSend.mockReset().mockResolvedValue({}); });

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

// **退会した人の名前が、他人のベルに残っていた。**
//
// 通知には作られた時点の表示名（`byName`）と ID（`byId`）が焼き込まれる。
// 退会が消すのは**自分宛て**の `notifs#<uid>` だけなので、
// 「A が B の写真にいいね → A が退会」で B のベルには A の表示名が残り、
// `/users/<A の sub>` へのリンクも生きたままだった。
// コメント側（`getComments`）は同じ理由で同じ判定を入れてある。
describe("退会した人の名前は出さない", () => {
    const GONE = "22222222-2222-4222-8222-222222222222";
    const ALIVE = "33333333-3333-4333-8333-333333333333";

    /**
     * notifs の Get → 退会者の Scan、の順に返す。
     * **退会者の一覧は60秒キャッシュされる**ので毎回落とす
     * （落とさないと、前のテストが入れた空集合を読んで伏せられない）
     */
    const world = (items: unknown[], deleted: string[]) => {
        resetDeletedUsersCache();
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "ScanCommand") {
                return Promise.resolve({ Items: deleted.map((userId) => ({ userId })) });
            }
            return Promise.resolve({ Item: { id: "notifs#x", items, unread: items.length } });
        });
    };

    it("退会者の表示名を伏せ、印を付ける", async () => {
        world([{ ...notif(0), byId: GONE, byName: "消えた人" }], [GONE]);
        const res = await invoke(getNotifications, ev());
        const body = JSON.parse(res.body) as { items: Array<Record<string, unknown>> };
        expect(body.items[0].byName, "退会した人の表示名が残っている").not.toBe("消えた人");
        expect(body.items[0].deleted).toBe(true);
    });

    it("在籍している人はそのまま", async () => {
        world([{ ...notif(0), byId: ALIVE, byName: "旅人" }], [GONE]);
        const body = JSON.parse((await invoke(getNotifications, ev())).body) as { items: Array<Record<string, unknown>> };
        expect(body.items[0].byName).toBe("旅人");
        expect(body.items[0].deleted).toBeUndefined();
    });

    it("通知が無ければ退会者を引きに行かない（無駄な走査をしない）", async () => {
        world([], []);
        await invoke(getNotifications, ev());
        const scans = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "ScanCommand");
        expect(scans, "通知が無いのに退会者を走査している").toHaveLength(0);
    });

    it("未読数は変わらない（伏せても件数は同じ）", async () => {
        world([{ ...notif(0), byId: GONE, byName: "消えた人" }, { ...notif(1), byId: ALIVE }], [GONE]);
        const body = JSON.parse((await invoke(getNotifications, ev())).body) as { items: unknown[]; unread: number };
        expect(body.items).toHaveLength(2);
        expect(body.unread).toBe(2);
    });
});
