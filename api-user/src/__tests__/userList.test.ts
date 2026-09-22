import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 「利用者ごとの、新しい順のリストを1行で持つ」書き込み口。
 *
 * 元は `follow.ts` の中に在り、その関数自身が「規則を2つ書くと静かに
 * ずれる」と書いていた。**いいねの一覧を足すときに写しかけた**ので
 * 切り出して両方から呼ぶ形にした——**共有にした以上、ここで直接見る**
 * （これまでは `follow.test.ts` 越しにしか通っていなかった）。
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { updateUserList, readUserList, UserListError } = await import("../userList");

const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
const putInput = (i: number) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, unknown> }).input;

beforeEach(() => { mockDdbSend.mockReset(); });

describe("updateUserList", () => {
    it("読んで、変えて、rev を1つ進めて書く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { list: ["a"], rev: 4 } })
            .mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 10, (l) => { l.unshift("b"); return l; });
        const put = putInput(1);
        expect(put.Item).toMatchObject({ id: "likes#u1", uid: "u1", list: ["b", "a"], rev: 5 });
        expect(put.ConditionExpression).toBe("rev = :rev");
        expect(put.ExpressionAttributeValues).toEqual({ ":rev": 4 });
    });

    // **この仕組みを入れる前の行には `rev` が無い。** 厳しくすると、
    // 古い行を持つ人の一覧が二度と書けなくなる
    it("rev を持たない古い行も書ける", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [] } }).mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 10, (l) => { l.push("a"); return l; });
        expect(putInput(1).ConditionExpression).toContain("attribute_not_exists(rev)");
    });

    it("行がまだ無くても書ける", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 10, (l) => { l.push("a"); return l; });
        expect(putInput(1).Item).toMatchObject({ list: ["a"], rev: 1 });
    });

    it("変更が無ければ書き込まない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["a"], rev: 1 } });
        await updateUserList("likes#u1", "u1", 10, () => null);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    // **溢れるのは古い方**（末尾）。新しい順に積むので、最近のぶんが残る
    it("上限で切る（落ちるのは古い方）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { list: ["b", "c"], rev: 1 } })
            .mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 2, (l) => { l.unshift("a"); return l; });
        expect(putInput(1).Item).toMatchObject({ list: ["a", "b"] });
    });

    // 競合（同じ行を同時に書いた）。読み直して当て直す
    it("競合したら読み直してやり直す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { list: [], rev: 1 } })
            .mockRejectedValueOnce(condFail())
            .mockResolvedValueOnce({ Item: { list: ["x"], rev: 2 } })   // 相手の書き込みが入った
            .mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 10, (l) => { l.unshift("a"); return l; });
        // **相手のぶんを消していない**——読み直した結果に当てている
        expect(putInput(3).Item).toMatchObject({ list: ["a", "x"], rev: 3 });
    });

    // **黙って飲み込まない。** 諦めたことを呼び出し側が知らないと、
    // マーカーだけ在って一覧が欠けた状態に気づけない
    it("競合し続けたら投げる（UserListError）", async () => {
        for (let i = 0; i < 8; i++) {
            mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockRejectedValueOnce(condFail());
        }
        await expect(updateUserList("likes#u1", "u1", 10, (l) => { l.push("a"); return l; }))
            .rejects.toBeInstanceOf(UserListError);
    });

    it("競合以外の失敗はそのまま投げる（握らない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { list: [], rev: 1 } })
            .mockRejectedValueOnce(Object.assign(new Error("no"), { name: "AccessDeniedException" }));
        await expect(updateUserList("likes#u1", "u1", 10, (l) => { l.push("a"); return l; }))
            .rejects.toThrow("no");
    });

    // 呼ぶ側が破壊的に触っても、次のやり直しに残らないこと
    it("mutate に渡すのは複製（元の行を壊さない）", async () => {
        const stored = ["a"];
        mockDdbSend.mockResolvedValueOnce({ Item: { list: stored, rev: 1 } }).mockResolvedValueOnce({});
        await updateUserList("likes#u1", "u1", 10, (l) => { l.push("b"); return l; });
        expect(stored, "読んだ配列を直に書き換えている").toEqual(["a"]);
    });
});

describe("readUserList", () => {
    it("形の合う値だけ返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["ok", 1, null, "ng#x", "ok2"] } });
        const out = await readUserList("likes#u1", (x) => !x.includes("#"), "likes#u1");
        expect(out).toEqual(["ok", "ok2"]);
    });

    it("行が無ければ空", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        expect(await readUserList("likes#u1", () => true, "likes#u1")).toEqual([]);
    });

    it("list が配列でなければ空（壊れた行で落ちない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: "oops" } });
        expect(await readUserList("likes#u1", () => true, "likes#u1")).toEqual([]);
    });
});
