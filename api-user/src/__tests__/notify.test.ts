import { describe, it, expect, vi, beforeEach } from "vitest";

// 通知の積み方。いいね・コメント・フォローの全部がここを通る。
//
// 追記は list_append の1回で済ませ、上限を超えたときだけ読み直して切り詰める。
// この「読み直して書き戻す」が競合すると、**通知が表示されないのではなく
// DynamoDB から消える**。comments.ts が同じ形で先に直してあるので、
// 条件付き書き込みの有無をここで固定する。

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

// ブロックの判定は境界としてモックする（実際の判定は `block.test.ts`）
const mockIsBlocked = vi.hoisted(() => vi.fn(async () => false));
// ⚠️ **全置換にしない。** このファイルが新しい読み取りを import した瞬間に、
// 書いていない export が**エラーではなく `undefined`** になって静かに壊れる
// （`notify.ts` が `hiddenUserIds` を読み始めたときに実際そうなった）
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: (...a: unknown[]) => mockIsBlocked(...(a as [])),
    blockMarkerId: (a: string, b: string) => `block#${a}#${b}`,
    hiddenUserIds: async () => new Set<string>(),
}));

vi.stubEnv("USERS_TABLE", "users-test");
const { pushNotification, lookupDisplayName, lookupListIdentity, NOTIFS_MAX, notifsId,
    deletedAmong, resetDeletedUsersCache } = await import("../notify");

type Input = {
    UpdateExpression?: string;
    ConditionExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    Key?: { id?: string };
};
const updates = (): Input[] => mockDdbSend.mock.calls
    .map((c) => c[0])
    .filter((cmd) => cmd?.constructor?.name === "UpdateCommand")
    .map((cmd) => cmd.input as Input);
// 追記（1本目）より後の書き込み。追記自体も `unread` を触るので、
// 切り詰め側を見るときは必ずこちらで絞る。
const afterAppend = (): Input[] => updates().slice(1);

const notif = (t = "2026-08-20T00:00:00Z") => ({
    type: "like" as const, photoId: "p1", photoSrc: "https://cdn/p1.jpg", byName: "旅人", t,
});
const list = (n: number) => Array.from({ length: n }, (_, i) => notif(`2026-08-20T00:00:${String(i).padStart(2, "0")}Z`));

// **中括弧で囲う。** 式のままだと**モック自身を返す**——vitest は
// フックの戻り値が関数だと後片付けとして扱うので、各テストのあとに
// そのモックが**引数なしで呼ばれる**。実装が `mockResolvedValue` の
// うちは無害だが、引数を見るモックに変えた瞬間に落ちる。
beforeEach(() => {
    mockDdbSend.mockReset().mockResolvedValue({});
    mockIsBlocked.mockReset().mockResolvedValue(false);
});

describe("pushNotification: 追記", () => {
    it("上限を超えていなければ追記の1回だけ", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(3), unread: 3 } });
        await pushNotification("owner", notif());
        expect(updates()).toHaveLength(1);
        expect(updates()[0].Key).toEqual({ id: "notifs#owner" });
        expect(updates()[0].UpdateExpression).toContain("list_append");
    });

    it("書き込みが落ちても投げない（本流の操作を巻き添えにしない）", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 想定内 */ });
        mockDdbSend.mockImplementationOnce(() => Promise.reject(new Error("ddb down")));
        await expect(pushNotification("owner", notif())).resolves.toBeUndefined();
        expect(logged).toHaveBeenCalled();   // 握り潰すが、記録は残す
        logged.mockRestore();
    });
});

describe("pushNotification: 切り詰め", () => {
    it("上限を超えたら新しい方から NOTIFS_MAX 件だけ残す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 3 } });
        await pushNotification("owner", notif());

        const trim = updates()[1];
        expect(trim.UpdateExpression).toContain("#items = :trimmed");
        expect((trim.ExpressionAttributeValues?.[":trimmed"] as unknown[])).toHaveLength(NOTIFS_MAX);
    });

    // 無条件に書いていた頃は、ほぼ同時に2件届くと片方が消えていた。
    //   50件のオーナーに A のいいねと B のコメントが同時に届く
    //   → A が51件のスナップショットを持つ
    //   → B が52件を正しく書く
    //   → A の切り詰めが「B を含まない50件」で上書きする
    it("読んだときと同じ長さのままなら書く、という条件を必ず付ける", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 3 } });
        await pushNotification("owner", notif());

        const trim = updates()[1];
        expect(trim.ConditionExpression).toBe("size(#items) = :len");
        expect(trim.ExpressionAttributeValues?.[":len"]).toBe(NOTIFS_MAX + 1);
    });

    // `resolves.toBeUndefined()` だけでは**何も測っていない**。
    // pushNotification は外側の try/catch で全部握り潰すので、
    // 内側の `.catch` を消しても必ず undefined で resolve する
    // （レビューで実際に消されて、14本とも通ることを確認された）。
    // 「想定内の競合として黙って流す」と「例外が外まで漏れた」を
    // 区別できる観測点は console.error しかないので、それを見る。
    it("条件が外れても投げないし、記録も残さない（想定内の競合）", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 記録だけ見る */ });
        const cond = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 3 } })
            .mockImplementationOnce(() => Promise.reject(cond));
        await expect(pushNotification("owner", notif())).resolves.toBeUndefined();
        expect(logged).not.toHaveBeenCalled();
        logged.mockRestore();
    });

    it("条件外れ以外の失敗は外まで伝わり、記録が残る", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 想定内 */ });
        mockDdbSend
            .mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 3 } })
            .mockImplementationOnce(() => Promise.reject(new Error("ddb down")));
        await expect(pushNotification("owner", notif())).resolves.toBeUndefined();
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });

    // 切り詰めは `items` だけを触る。
    //
    // 一度ここで `unread` も NOTIFS_MAX に丸めていたが、それが
    // 「消したはずのバッジが復活する」の原因だった。条件を足して守るのでは
    // なく、書き込みごと消してある——`unread` の生の値を読むのは
    // getNotifications だけで、そこが保存件数で丸めるため、ここで丸めても
    // 利用者に見える結果は変わらない（notifications.test.ts で固定）。
    it("切り詰めは未読数を書き換えない（既読を未読に戻さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 200 } });
        await pushNotification("owner", notif());

        expect(afterAppend()).toHaveLength(1);
        expect(afterAppend()[0].UpdateExpression).not.toContain("unread");
    });
});

describe("lookupDisplayName", () => {
    it("テーブルの表示名を返す（クライアント申告を信用しない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { displayName: "本当の名前" } });
        expect(await lookupDisplayName("u1")).toBe("本当の名前");
    });

    it("未設定なら既定名", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: {} });
        expect(await lookupDisplayName("u1")).toBe("名前未設定さん");
    });

    it("読めなくても既定名で続ける", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("ddb down"));
        expect(await lookupDisplayName("u1")).toBe("名前未設定さん");
    });
});

describe("lookupListIdentity（一覧の名前と @ユーザー名）", () => {
    it("名前と @ユーザー名を1回の読みで返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { displayName: " 旅人B ", username: "tabibito_b" } });
        expect(await lookupListIdentity("u1")).toEqual({ name: "旅人B", username: "tabibito_b" });
        expect(mockDdbSend, "人数ぶんの往復を倍にしている").toHaveBeenCalledTimes(1);
        const input = mockDdbSend.mock.calls[0][0].input as { TableName: string; ExpressionAttributeNames: Record<string, string> };
        expect(input.TableName).toBe("users-test");
        expect(Object.values(input.ExpressionAttributeNames)).toEqual(expect.arrayContaining(["displayName", "username"]));
    });

    // 空の「@」や空の名前を画面に出させない
    it("設定していない・空・型違いの項目は鍵ごと付けない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { displayName: "  ", username: 42 } });
        expect(await lookupListIdentity("u1")).toEqual({});
    });

    it("読めなくても投げない（一覧は返す）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("ddb down"));
        expect(await lookupListIdentity("u1")).toEqual({});
    });

    // 🔴 墓石には旧ハンドルが残る（予約のやり直し用）。退会者の集合から漏れた
    // 回に、解放済み＝別人が取り直せるハンドルを付けて出さない
    it("墓石（退会した人の行）からは何も返さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { deletedAt: "2026-09-01T00:00:00Z", username: "old_handle" } });
        expect(await lookupListIdentity("u1")).toEqual({});
    });
});

describe("notifsId", () => {
    it("uid から文書IDを作る", () => {
        expect(notifsId("u1")).toBe("notifs#u1");
    });
});


// 退会した人の判定（`deletedAmong`）。コメント・通知・フォロー・ブロック・
// ストーリーの閲覧者と返信の一覧が、**一覧に出てくる ID だけ**を渡して引く。
//
// 以前は users テーブルを丸ごと Scan していた（`deletedUserIds`）が、500件 × 10ページで
// 打ち切り、しかも `Limit` は絞り込みの**前**に数えるので、**行が 5000 を超えると
// 打ち切った先の退会者が伏せられず、未認証のコメント一覧に実名が出た**。
describe("deletedAmong（一覧に出てくる人のうち、退会した人）", () => {
    type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
    const cmds = () => mockDdbSend.mock.calls.map((c) => c[0] as Cmd);
    const batches = () => cmds().filter((c) => c.constructor.name === "BatchGetCommand");
    const keysOf = (c: Cmd) =>
        (c.input.RequestItems as Record<string, { Keys: { userId: string }[] }>)["users-test"].Keys.map((k) => k.userId);
    const TOMB = "2026-09-01T00:00:00.000Z";

    /** users テーブルの代わり。BatchGet には持っている行だけを返す（無い行は返さない＝本物と同じ） */
    const table = (rows: Map<string, Record<string, unknown>>) => (cmd: Cmd) => {
        if (cmd.constructor.name === "BatchGetCommand") {
            return Promise.resolve({ Responses: { "users-test": keysOf(cmd).filter((id) => rows.has(id)).map((id) => rows.get(id)) } });
        }
        if (cmd.constructor.name === "ScanCommand") {
            // 前の作り（500件 × 10ページで打ち切り）を呼んだら、それと同じ答えを返す
            const all = [...rows.values()];
            const from = Number((cmd.input.ExclusiveStartKey as { i?: number } | undefined)?.i ?? 0);
            const page = all.slice(from, from + Number(cmd.input.Limit ?? all.length));
            const next = from + page.length;
            return Promise.resolve({
                Items: page.filter((r) => typeof r.deletedAt === "string"),
                ...(next < all.length ? { LastEvaluatedKey: { i: next } } : {}),
            });
        }
        return Promise.resolve({});
    };

    beforeEach(() => { resetDeletedUsersCache(); });

    it("渡した ID だけを users テーブルから引く（表は走査しない）", async () => {
        mockDdbSend.mockImplementation(table(new Map([
            ["gone1", { userId: "gone1", deletedAt: TOMB }],
            ["alive", { userId: "alive" }],
        ])));
        const ids = await deletedAmong(["gone1", "alive"]);
        expect([...ids]).toEqual(["gone1"]);
        expect(cmds().filter((c) => c.constructor.name === "ScanCommand"), "表を走査している").toHaveLength(0);
        expect(batches()).toHaveLength(1);
        // **どのテーブルを見ているかまで固定する**（墓石は USERS_TABLE にしか無い）
        expect(Object.keys(batches()[0].input.RequestItems as object)).toEqual(["users-test"]);
        expect(keysOf(batches()[0]).sort()).toEqual(["alive", "gone1"]);
        // 判定に要るのは deletedAt だけ（名前やハンドルまで読まない）
        const req = (batches()[0].input.RequestItems as Record<string, { ProjectionExpression: string; ExpressionAttributeNames: Record<string, string> }>)["users-test"];
        expect(Object.values(req.ExpressionAttributeNames).sort()).toEqual(["deletedAt", "userId"]);
    });

    // **この PR が直す穴。** 行が 6000 あり、退会者が 5000 行より先にいる表
    it("users テーブルの行が 5000 を超えても、先にいる退会者を伏せる", async () => {
        const rows = new Map<string, Record<string, unknown>>();
        for (let i = 0; i < 6000; i++) rows.set(`u${i}`, { userId: `u${i}` });
        rows.set("u5999", { userId: "u5999", deletedAt: TOMB });
        mockDdbSend.mockImplementation(table(rows));

        const ids = await deletedAmong(["u1", "u5999", "u42"]);
        expect([...ids]).toEqual(["u5999"]);
        // 読んだのは一覧に出た3人ぶんだけ（6000行ではない）
        expect(batches().flatMap(keysOf)).toHaveLength(3);
    });

    it("100件ずつに分けて引く（BatchGetItem の上限）・重複は1回", async () => {
        mockDdbSend.mockImplementation(table(new Map()));
        const many = Array.from({ length: 250 }, (_, i) => `u${i}`);
        await deletedAmong([...many, ...many.slice(0, 50)]);
        expect(batches().map((b) => keysOf(b).length).sort((a, b) => a - b)).toEqual([50, 100, 100]);
        expect(new Set(batches().flatMap(keysOf)).size).toBe(250);
    });

    it("行が無い人は退会扱いにしない（PostConfirmation の取りこぼしで行の無い生きた人がいる）", async () => {
        mockDdbSend.mockImplementation(table(new Map()));
        expect([...(await deletedAmong(["nobody"]))]).toEqual([]);
    });

    it("空・型違いの ID は引かない", async () => {
        mockDdbSend.mockImplementation(table(new Map()));
        await deletedAmong(["", undefined, 3, null, "x".repeat(300)]);
        expect(batches()).toHaveLength(0);
    });

    it("2回目はコンテナ内の控えを使う（公開APIを増幅させない）・新しい人だけ引く", async () => {
        mockDdbSend.mockImplementation(table(new Map([["gone1", { userId: "gone1", deletedAt: TOMB }]])));
        await deletedAmong(["gone1", "alive"]);
        const again = await deletedAmong(["gone1", "alive", "new"]);
        expect([...again]).toEqual(["gone1"]);
        expect(batches()).toHaveLength(2);
        expect(keysOf(batches()[1])).toEqual(["new"]);
    });

    it("控えは60秒で切れる（退会が伏せに効くまでの遅れは最大60秒）", async () => {
        const rows = new Map<string, Record<string, unknown>>([["u", { userId: "u" }]]);
        mockDdbSend.mockImplementation(table(rows));
        const now = vi.spyOn(Date, "now");
        try {
            now.mockReturnValue(1_000_000);
            expect([...(await deletedAmong(["u"]))]).toEqual([]);
            rows.set("u", { userId: "u", deletedAt: TOMB });   // ここで退会
            now.mockReturnValue(1_000_000 + 59_000);
            expect([...(await deletedAmong(["u"]))], "控えの内は前の判定").toEqual([]);
            now.mockReturnValue(1_000_000 + 61_000);
            expect([...(await deletedAmong(["u"]))]).toEqual(["u"]);
        } finally {
            now.mockRestore();
        }
    });

    it("未処理（UnprocessedKeys）で返った分は拾い直す", async () => {
        let first = true;
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const keys = keysOf(cmd);
            if (first) {
                first = false;
                return Promise.resolve({
                    Responses: { "users-test": [{ userId: "a" }] },
                    UnprocessedKeys: { "users-test": { Keys: keys.filter((k) => k !== "a").map((userId) => ({ userId })) } },
                });
            }
            return Promise.resolve({ Responses: { "users-test": keys.map((userId) => ({ userId, deletedAt: TOMB })) } });
        });
        expect([...(await deletedAmong(["a", "b"]))]).toEqual(["b"]);
        expect(keysOf(batches()[1])).toEqual(["b"]);
    });

    // 🔴 **読めなかったら伏せる側に倒す**（前は空集合＝伏せない側）。
    // 「生きている人が一瞬『退会したユーザー』に見える」は次の読み込みで戻るが、
    // 「退会した人の実名が未認証の口に出る」は取り消せない
    it("読めなかった ID は退会扱いで伏せる（投げない・控えない・ログに出す）", async () => {
        mockDdbSend.mockRejectedValue(new Error("throttled"));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            await expect(deletedAmong(["alive", "gone1"])).resolves.toEqual(new Set(["alive", "gone1"]));
            // 見張り: 件数つきで CloudWatch に出る
            expect(err).toHaveBeenCalledWith(expect.stringContaining("読めなかった 2 件"));
        } finally {
            err.mockRestore();
        }
        // 失敗は控えない——次の呼び出しで引き直し、生きている人は戻る
        mockDdbSend.mockReset().mockImplementation(table(new Map([["gone1", { userId: "gone1", deletedAt: TOMB }]])));
        expect([...(await deletedAmong(["alive", "gone1"]))]).toEqual(["gone1"]);
    });

    it("拾い直しても未処理のまま残った ID だけを伏せる（読めた分はそのまま使う）", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => Promise.resolve({
            Responses: { "users-test": keysOf(cmd).includes("alive") ? [{ userId: "alive" }] : [] },
            UnprocessedKeys: { "users-test": { Keys: [{ userId: "stuck" }] } },
        }));
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect([...(await deletedAmong(["alive", "stuck"]))]).toEqual(["stuck"]);
            // 初回＋拾い直し3回で止める（青天井に回さない）
            expect(batches()).toHaveLength(4);
        } finally {
            err.mockRestore();
        }
    });
});


// **塞ぐのはここ1か所。** 通知を作るのは like / comment / follow /
// storyreply の4経路で、どれも `byId`（起こした本人）を入れている。
// 口ごとに配線すると、次に経路が増えたときに必ず1つ漏れる——実際、
// ブロックを入れた回はストーリーの返信しか塞いでおらず、**より強い口
// （公開・500字のコメント）が開いたままだった**。
describe("pushNotification: ブロックした相手からは積まない", () => {
    it("ブロックしていたら積まない", async () => {
        mockIsBlocked.mockResolvedValue(true);
        await pushNotification("owner", { ...notif(), byId: "them" });
        expect(mockDdbSend, "ブロックした相手の通知が積まれている").not.toHaveBeenCalled();
    });

    it("ブロックしていなければ今までどおり積む", async () => {
        await pushNotification("owner", { ...notif(), byId: "them" });
        expect(updates().length).toBeGreaterThan(0);
    });

    // 判定は「通知の持ち主 → 起こした本人」の向き。逆に引くと、
    // **自分がブロックした相手からの通知だけが届く**という逆の壊れ方になる
    it("向きは「受け取る人 → 起こした人」", async () => {
        await pushNotification("owner", { ...notif(), byId: "them" });
        expect(mockIsBlocked).toHaveBeenCalledWith("owner", "them");
    });

    // **確かめられないなら届けない。** 元から「失敗しても本体は成功」の作りで、
    // 呼び出し側はどこも戻り値を見ていない
    it("判定に失敗したら積まない", async () => {
        mockIsBlocked.mockRejectedValue(new Error("boom"));
        await pushNotification("owner", { ...notif(), byId: "them" });
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // `byId` を持たない古い形の通知（あれば）は素通しする
    it("byId が無ければ判定に行かない", async () => {
        await pushNotification("owner", notif());
        expect(mockIsBlocked).not.toHaveBeenCalled();
        expect(updates().length).toBeGreaterThan(0);
    });
});
