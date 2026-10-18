import { describe, it, expect, vi, beforeEach } from "vitest";

// 退会の確かめ（`liveCaller.ts`）は生きている本人として通す。ここで見たいのは口の中身で、
// 墓石の 410 は `liveCaller.test.ts`・`liveCallerGuard.test.ts` が見る
vi.mock("../liveCaller", async (orig) => ({
    ...(await orig<typeof import("../liveCaller")>()),
    assertLiveCaller: async () => null,
    readLiveCaller: async () => ({ row: undefined }),
}));

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
     * notifs の Get → 退会者の BatchGet（通知に出る `byId` だけ）、の順に返す。
     * **退会者の判定は60秒キャッシュされる**ので毎回落とす
     * （落とさないと、前のテストが入れた判定を読んで伏せられない）
     */
    const world = (items: unknown[], deleted: string[]) => {
        resetDeletedUsersCache();
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "BatchGetCommand") {
                const req = (cmd.input.RequestItems as Record<string, { Keys: { userId: string }[] }>)["users-test"];
                return Promise.resolve({ Responses: { "users-test": req.Keys.map(({ userId }) =>
                    (deleted.includes(userId) ? { userId, deletedAt: "2026-09-01T00:00:00.000Z" } : { userId })) } });
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

    it("通知が無ければ退会者を引きに行かない（無駄な読み取りをしない）", async () => {
        world([], []);
        await invoke(getNotifications, ev());
        const reads = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => ["ScanCommand", "BatchGetCommand"].includes((cmd as { constructor: { name: string } })?.constructor?.name));
        expect(reads, "通知が無いのに退会者を引いている").toHaveLength(0);
    });

    // **引くのは通知に出てくる人だけ**（テーブル全体を走査しない）。重複は1回、
    // `byId` を持たない通知（メダル）は引かない
    it("退会者は通知の byId だけを引く（重複は落とす・表は走査しない）", async () => {
        world([{ ...notif(0), byId: GONE }, { ...notif(1), byId: GONE }, { ...notif(2), byId: ALIVE },
            { ...notif(3), type: "badge", byId: undefined }], [GONE]);
        await invoke(getNotifications, ev());
        const cmds = mockDdbSend.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> });
        expect(cmds.filter((c) => c.constructor.name === "ScanCommand"), "表を走査している").toHaveLength(0);
        const batch = cmds.filter((c) => c.constructor.name === "BatchGetCommand");
        expect(batch).toHaveLength(1);
        const keys = (batch[0].input.RequestItems as Record<string, { Keys: { userId: string }[] }>)["users-test"].Keys;
        expect(keys.map((k) => k.userId).sort()).toEqual([GONE, ALIVE].sort());
    });

    // 🔴 通知は作られた時点の名前（`byName`）を写して持つので、**判定が読めなかった人も伏せる**
    // （ここは本物の `deletedAmong` を通す）
    it("退会の判定が読めなかったら伏せる（実名を漏らさない側）", async () => {
        world([{ ...notif(0), byId: ALIVE, byName: "旅人" }], []);
        const base = mockDdbSend.getMockImplementation()!;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) =>
            (cmd.constructor.name === "BatchGetCommand" ? Promise.reject(new Error("throttled")) : base(cmd)));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const body = JSON.parse((await invoke(getNotifications, ev())).body) as { items: Array<Record<string, unknown>> };
            expect(body.items[0].byName).toBe("退会したユーザー");
            expect(body.items[0].deleted).toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    it("未読数は変わらない（伏せても件数は同じ）", async () => {
        world([{ ...notif(0), byId: GONE, byName: "消えた人" }, { ...notif(1), byId: ALIVE }], [GONE]);
        const body = JSON.parse((await invoke(getNotifications, ev())).body) as { items: unknown[]; unread: number };
        expect(body.items).toHaveLength(2);
        expect(body.unread).toBe(2);
    });
});

// **ブロックした相手の通知が、ベルに残り続けていた。**
//
// `pushNotification` が断るのは「これから来るぶん」だけ。通知は作られた時点の
// 表示名と ID を焼き込んで持つので、ブロックしても**それまでに届いたぶんは
// 名前もプロフィールへのリンクも生きたまま**残っていた（50件の輪から
// 押し出されるまで）。フォローは両向きに切り、ストーリーも両向きに隠すのに、
// ここだけ「見せない相手」を通していた。
describe("ブロックした相手の通知は出さない", () => {
    const BLOCKED = "44444444-4444-4444-8444-444444444444";
    const BLOCKER = "55555555-5555-4555-8555-555555555555";
    const OTHER = "66666666-6666-4666-8666-666666666666";

    /**
     * notifs の Get → ブロックの2行（`blocks#` / `blockedby#`）→ 退会者の BatchGet。
     * `mine` は自分がブロックした人、`theirs` は自分をブロックした人。
     */
    const world = (items: unknown[], mine: string[], theirs: string[], unread = items.length) => {
        resetDeletedUsersCache();
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "BatchGetCommand") return Promise.resolve({ Responses: { "users-test": [] } });
            const key = (cmd.input.Key as { id?: string } | undefined)?.id ?? "";
            if (key === `blocks#${ME}`) return Promise.resolve({ Item: { id: key, blockedIds: mine } });
            if (key === `blockedby#${ME}`) return Promise.resolve({ Item: { id: key, blockerIds: theirs } });
            return Promise.resolve({ Item: { id: `notifs#${ME}`, items, unread } });
        });
    };
    const bodyOf = async () =>
        JSON.parse((await invoke(getNotifications, ev())).body) as { items: Array<Record<string, unknown>>; unread: number };

    it("自分がブロックした人からの通知は落とす", async () => {
        world([{ ...notif(0), byId: BLOCKED, byName: "迷惑な人" }, { ...notif(1), byId: OTHER, byName: "旅人" }], [BLOCKED], []);
        const body = await bodyOf();
        expect(body.items.map((n) => n.byId), "ブロックした相手の通知が残っている").toEqual([OTHER]);
    });

    // **和集合で見る。** 片向きだけだと、相手が自分をブロックした側が残る
    it("自分をブロックした人からの通知も落とす", async () => {
        world([{ ...notif(0), byId: BLOCKER, byName: "向こうが切った人" }, { ...notif(1), byId: OTHER }], [], [BLOCKER]);
        const body = await bodyOf();
        expect(body.items.map((n) => n.byId)).toEqual([OTHER]);
    });

    // **未読数も落としたぶんに合わせる。** 合わせないと「1件未読」なのに
    // 開いても何も無い（バッジだけ残る）
    it("未読数は落としたあとの件数まで下げる", async () => {
        world([{ ...notif(0), byId: BLOCKED }, { ...notif(1), byId: BLOCKED }, { ...notif(2), byId: OTHER }], [BLOCKED], [], 3);
        const body = await bodyOf();
        expect(body.items).toHaveLength(1);
        expect(body.unread, "見えない通知ぶんのバッジが残っている").toBe(1);
    });

    // **未読は「先頭 stored 件」＝位置の意味を持つ数**（追記は先頭に足す）。
    // 全体の長さで丸めるだけだと、**落ちたのが先頭側だったこと**を見ていない。
    // 上のテストは `unread = 全件` なので「全体の長さで丸める」式でも答えが
    // 一致してしまい、**2つの式を区別できなかった**（レビュー指摘）。
    //
    // これがいちばん起きる形——人がブロックを押すのは「その人から立て続けに
    // 通知が来た直後」なので、未読がまるごとブロック相手のものになる。
    it("未読が全部ブロック相手のものなら、バッジは0になる", async () => {
        world(
            [{ ...notif(0), byId: BLOCKED }, { ...notif(1), byId: BLOCKED },
             { ...notif(2), byId: OTHER }, { ...notif(3), byId: OTHER }, { ...notif(4), byId: OTHER }],
            [BLOCKED], [], 2,
        );
        const body = await bodyOf();
        expect(body.items).toHaveLength(3);
        expect(body.unread, "既に読んだぶんがバッジに残っている（先頭を見ていない）").toBe(0);
    });

    // 逆向き: 未読が**生きている相手**のものなら減らさない
    it("未読がブロックしていない相手のものなら、そのまま残す", async () => {
        world(
            [{ ...notif(0), byId: OTHER }, { ...notif(1), byId: OTHER }, { ...notif(2), byId: BLOCKED }],
            [BLOCKED], [], 2,
        );
        const body = await bodyOf();
        expect(body.items).toHaveLength(2);
        expect(body.unread, "生きている未読まで削っている").toBe(2);
    });

    // 正常系: 誰もブロックしていなければ素通し
    it("ブロックしていなければ何も落とさない", async () => {
        world([{ ...notif(0), byId: OTHER }, { ...notif(1), byId: BLOCKED }], [], []);
        const body = await bodyOf();
        expect(body.items).toHaveLength(2);
        expect(body.unread).toBe(2);
    });

    // **見えなくする側が落ちたときに全部消さない**（`getStories` と同じ判断）
    it("ブロック一覧を読めなくても、通知は返す", async () => {
        resetDeletedUsersCache();
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "BatchGetCommand") return Promise.resolve({ Responses: { "users-test": [] } });
            const key = (cmd.input.Key as { id?: string } | undefined)?.id ?? "";
            if (key.startsWith("blocks#") || key.startsWith("blockedby#")) return Promise.reject(new Error("throttled"));
            return Promise.resolve({ Item: { id: `notifs#${ME}`, items: [{ ...notif(0), byId: OTHER }], unread: 1 } });
        });
        const body = await bodyOf();
        expect(body.items, "ブロックを読めないだけで通知が消えている").toHaveLength(1);
        // **実際に読みに行ったことも見る。** これが無いと、配線ごと外した
        // 変異でもモックの reject 枝に到達せず緑になる（レビュー指摘）
        const read = mockDdbSend.mock.calls
            .map((c) => (c[0].input as { Key?: { id?: string } })?.Key?.id ?? "");
        expect(read, "ブロック一覧を引きに行っていない").toContain(`blocks#${ME}`);
    });

    it("通知が無ければブロック一覧も引きに行かない（無駄な読み取りをしない）", async () => {
        world([], [], []);
        await invoke(getNotifications, ev());
        const keys = mockDdbSend.mock.calls
            .map((c) => (c[0].input as { Key?: { id?: string } })?.Key?.id ?? "")
            .filter((k) => k.startsWith("blocks#") || k.startsWith("blockedby#"));
        expect(keys, "通知が無いのにブロック一覧を読んでいる").toHaveLength(0);
    });
});
