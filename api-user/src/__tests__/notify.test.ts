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
const { pushNotification, lookupDisplayName, NOTIFS_MAX, notifsId } = await import("../notify");

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

beforeEach(() => mockDdbSend.mockReset().mockResolvedValue({}));

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
