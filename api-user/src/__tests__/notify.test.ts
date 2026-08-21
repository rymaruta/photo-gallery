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

    it("条件が外れても投げない（次の通知が切り詰める）", async () => {
        const cond = Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        mockDdbSend
            .mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 3 } })
            .mockRejectedValueOnce(cond);
        await expect(pushNotification("owner", notif())).resolves.toBeUndefined();
    });

    // 未読数は「前回開いてからの件数」なので保存件数と同じではないが、
    // 保存件数を超えることはあり得ない。捨てた分まで数え続けると、
    // 開かずに溜めた人のバッジが「200」なのに中身は50件、になる。
    it("未読数が保存件数を超えていたら上限で頭打ちにする", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 200 } });
        await pushNotification("owner", notif());

        const trim = updates()[1];
        expect(trim.UpdateExpression).toContain("unread = :cap");
        expect(trim.ExpressionAttributeValues?.[":cap"]).toBe(NOTIFS_MAX);
    });

    it("未読数が上限以下なら触らない（既読を未読に戻さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Attributes: { items: list(NOTIFS_MAX + 1), unread: 2 } });
        await pushNotification("owner", notif());

        const trim = updates()[1];
        expect(trim.UpdateExpression).not.toContain("unread");
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
