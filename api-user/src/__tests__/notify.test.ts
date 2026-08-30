import { describe, it, expect, vi, beforeEach } from "vitest";

// 通知の積み方。いいね・コメント・フォローの全部がここを通る。
//
// 追記は list_append の1回で済ませ、上限を超えたときだけ読み直して切り詰める。
// この「読み直して書き戻す」が競合すると、**通知が表示されないのではなく
// DynamoDB から消える**。comments.ts が同じ形で先に直してあるので、
// 条件付き書き込みの有無をここで固定する。

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

vi.stubEnv("USERS_TABLE", "users-test");
const { pushNotification, lookupDisplayName, NOTIFS_MAX, notifsId,
    deletedUserIds, resetDeletedUsersCache } = await import("../notify");

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
beforeEach(() => { mockDdbSend.mockReset().mockResolvedValue({}); });

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

describe("notifsId", () => {
    it("uid から文書IDを作る", () => {
        expect(notifsId("u1")).toBe("notifs#u1");
    });
});


// コメント一覧は**未認証で叩ける公開API**なので、投稿者ごとに引くと
// 1リクエストが人数ぶんの読み取りに増幅する（200件に100人いれば100回）。
// 墓石は小さな行しかないので、まとめて1回引いてコンテナ内で使い回す。
describe("deletedUserIds（退会した人の集合）", () => {
    const scans = () => mockDdbSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
        .filter((c) => c.constructor.name === "ScanCommand");

    beforeEach(() => { resetDeletedUsersCache(); });

    it("墓石だけを引く（生きている行は読まない）", async () => {
        mockDdbSend.mockResolvedValue({ Items: [{ userId: "gone1" }, { userId: "gone2" }] });
        const ids = await deletedUserIds();

        expect([...ids].sort()).toEqual(["gone1", "gone2"]);
        // **どのテーブルを見ているかまで固定する。** 墓石は USERS_TABLE にしか
        // 無いので、PHOTOS_TABLE に向けても集合は常に空になるだけ——誰も伏せられず、
        // fail-open なのでログにも出ない。式だけ見ていると、この変異が緑で通る。
        expect(scans()[0].input.TableName).toBe("users-test");
        expect(scans()[0].input.FilterExpression).toContain("attribute_exists(deletedAt)");
        // 要るのは userId だけ（名前やハンドルまで読まない）
        expect(scans()[0].input.ProjectionExpression).toBe("userId");
    });

    it("2回目はコンテナ内の控えを使う（公開APIを増幅させない）", async () => {
        mockDdbSend.mockResolvedValue({ Items: [{ userId: "gone1" }] });
        await deletedUserIds();
        await deletedUserIds();
        expect(scans()).toHaveLength(1);
    });

    // 未認証で叩ける経路から呼ばれる。青天井にすると、コールドなコンテナの
    // たびにユーザーテーブル全体を直列で読み切る（FilterExpression は読んだ
    // あとに効き、ProjectionExpression は消費する読み取りを減らさない）。
    // 遅いだけの場合は fail-open では拾えず、Lambda のタイムアウトに当たって
    // 「誰も伏せない」ではなく「コメントが読めない」になる。
    it("1ページの件数に上限を置く", async () => {
        mockDdbSend.mockResolvedValue({ Items: [] });
        await deletedUserIds();
        expect(scans()[0].input.Limit).toBe(500);
    });

    it("ページ数にも上限を置く（打ち切ったら warn を出す）", async () => {
        // 12ページぶんだけ続きがあるテーブル。**無限に続く形にしない**——
        // 上限を外す変異を入れたときにテストが固まって、落ちる代わりに
        // タイムアウト待ちになる。
        let page = 0;
        mockDdbSend.mockImplementation(() => Promise.resolve({
            Items: [{ userId: `u${page}` }],
            ...(++page < 12 ? { LastEvaluatedKey: { userId: `u${page}` } } : {}),
        }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await deletedUserIds();
            expect(scans()).toHaveLength(10);
            // 打ち切った先にいる退会者は伏せられない。黙って落とさない
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("打ち切りました"));
        } finally {
            warn.mockRestore();
        }
    });

    it("最後まで辿る（1ページで打ち切らない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ userId: "a" }], LastEvaluatedKey: { userId: "a" } })
            .mockResolvedValueOnce({ Items: [{ userId: "b" }] });
        expect([...(await deletedUserIds())].sort()).toEqual(["a", "b"]);
    });

    // 一時的な失敗で、生きている人の名前まで一斉に「退会したユーザー」に
    // 化ける方が悪い。投げずに空集合を返す（＝誰も伏せない）。
    it("引けなかったら空集合（投げない・控えもしない）", async () => {
        mockDdbSend.mockRejectedValue(new Error("throttled"));
        await expect(deletedUserIds()).resolves.toEqual(new Set());

        // 失敗はキャッシュしない——次の呼び出しでやり直す
        mockDdbSend.mockReset().mockResolvedValue({ Items: [{ userId: "gone1" }] });
        expect([...(await deletedUserIds())]).toEqual(["gone1"]);
    });
});
