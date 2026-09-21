import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
}));

import { voteStory, storyVoteState, storyHasVote, storyVotesId, VOTES_MAX } from "../storyVotes";

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ev = (sub: string | undefined, id: string | undefined, body?: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: id ? { id } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
});
const bodyOf = (r: Result) => JSON.parse(r.body);
type Cmd = { constructor: { name: string }; input: Record<string, unknown> & { Key?: { id?: string } } };
const calls = () => mockDdbSend.mock.calls.map((c) => c[0] as Cmd);
const transactions = () => calls().filter((c) => c.constructor.name === "TransactWriteCommand");
const wrote = () => calls().some((c) => c.constructor.name !== "GetCommand");

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const VOTE = { kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 };
const STORY = {
    id: "story-1", story: true, userId: "owner", src: "https://cdn/s.jpg", expiresAt: FUTURE,
    texts: [{ text: "朝", x: 0.5, y: 0.5, size: 0.06, font: "sans", color: "white", bg: "none" }, VOTE],
};

/** ストーリーの行と、票の文書を返す世界。`extra` で印（ブロック・フォロー）を足す */
function world(
    story: Record<string, unknown> | undefined,
    votes: Record<string, unknown> | undefined = undefined,
    extra: Record<string, Record<string, unknown>> = {},
) {
    mockDdbSend.mockImplementation((cmd: Cmd) => {
        const id = String(cmd.input.Key?.id ?? "");
        if (cmd.constructor.name === "GetCommand") {
            if (id === "story-1") return Promise.resolve(story ? { Item: story } : {});
            if (id === storyVotesId("story-1")) return Promise.resolve(votes ? { Item: votes } : {});
            if (extra[id]) return Promise.resolve({ Item: extra[id] });
            return Promise.resolve({});   // ブロック・フォローの印を含め、その他は無し
        }
        return Promise.resolve({});
    });
}

/** `TransactWriteItems` が断った形（`CancellationReasons` は `TransactItems` と同じ並び） */
const cancelled = (codes: [string, string]) =>
    Object.assign(new Error("cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: codes.map((Code) => ({ Code })),
    });

beforeEach(() => {
    mockDdbSend.mockReset();
});

// **票を入れる口が無い投票スタンプは、押しても効かない的。** ⑨-3 の
// 作成画面（前のコミット）は `<button>` を置いていない——この口が入って
// 初めて見る側が押せる形にする
describe("voteStory", () => {
    it("未認証は 400", async () => {
        expect((await invoke(voteStory, ev(undefined, "story-1", { choice: "a" }))).statusCode).toBe(400);
    });

    it("壊れた JSON は 400", async () => {
        const r = await invoke(voteStory, {
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            pathParameters: { id: "story-1" }, body: "{broken",
        });
        expect(r.statusCode).toBe(400);
    });

    // 2択の外（"c"・数・欠け）は受けない。**読みにも行かない**
    it("a / b 以外は 400（何も読まない・書かない）", async () => {
        world(STORY);
        for (const choice of ["c", 1, "", undefined, ["a"]]) {
            mockDdbSend.mockClear();
            const r = await invoke(voteStory, ev("u1", "story-1", { choice }));
            expect(r.statusCode, `choice=${JSON.stringify(choice)}`).toBe(400);
            expect(mockDdbSend, `choice=${JSON.stringify(choice)} で DynamoDB を触っている`).not.toHaveBeenCalled();
        }
    });

    it("ストーリーが無ければ 404", async () => {
        world(undefined);
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
        expect(wrote(), "無いのに書いている").toBe(false);
    });

    it("写真の行（story ではない）には入れられない 404", async () => {
        world({ ...STORY, story: undefined });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
    });

    it("自分のストーリーには入れられない 400", async () => {
        world(STORY);
        const r = await invoke(voteStory, ev("owner", "story-1", { choice: "a" }));
        expect(r.statusCode).toBe(400);
        expect(wrote(), "自分の票を書いている").toBe(false);
    });

    it("期限切れは 404", async () => {
        world({ ...STORY, expiresAt: PAST });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
        expect(wrote()).toBe(false);
    });

    // **404 で返す**（「ブロックされています」は相手の操作を教える）
    it("ブロックされていたら 404（実在も教えない）", async () => {
        world(STORY, undefined, { "block#owner#u1": { blockerId: "owner", blockedId: "u1" } });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
        expect(wrote(), "ブロックされているのに書いている").toBe(false);
    });

    // 向きを取り違えない
    it("自分が相手をブロックしていても、票は入れられる", async () => {
        world(STORY, undefined, { "block#u1#owner": { blockerId: "u1", blockedId: "owner" } });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(200);
    });

    it("フォロワー限定は、追っていない人には 404", async () => {
        world({ ...STORY, visibility: "followers" });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
        expect(wrote()).toBe(false);
    });

    it("フォロワー限定でも、追っている人は入れられる", async () => {
        world({ ...STORY, visibility: "followers" }, undefined, { "follow#owner#u1": { t: "x" } });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(200);
    });

    // **「返信を許可」は見ない。** 投票は投稿者が自分で置いたスタンプ
    it("返信を切っていても、票は入れられる", async () => {
        world({ ...STORY, allowReplies: false });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(200);
    });

    // 票の行き先が無い（作成画面は投票を置かないと押す口も出さないが、
    // 直接叩く経路のために）
    it("投票スタンプの無いストーリーには 400（書かない）", async () => {
        world({ ...STORY, texts: [STORY.texts[0]] });
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "a" }));
        expect(r.statusCode).toBe(400);
        expect(wrote(), "行き先が無いのに書いている").toBe(false);
    });

    it("texts が無いストーリーにも 400", async () => {
        world({ ...STORY, texts: undefined });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(400);
    });

    // **行の存在確認と票の追記を1つのトランザクションで。** 別々にすると、
    // 削除と同時に押された回に `storyvotes#<id>` だけが残る（どの削除経路
    // からも辿れない孤児）
    it("票は、ストーリーの行が在ることを同じトランザクションで確かめて書く", async () => {
        world(STORY);
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "b" }));
        expect(r.statusCode).toBe(200);
        const tx = transactions();
        expect(tx, "トランザクションで書いていない").toHaveLength(1);
        const items = tx[0].input.TransactItems as Array<Record<string, { Key: { id: string }; ConditionExpression: string; UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> }>>;
        expect(items).toHaveLength(2);
        expect(items[0].ConditionCheck.Key.id).toBe("story-1");
        expect(items[0].ConditionCheck.ConditionExpression).toBe("attribute_exists(id)");
        const up = items[1].Update;
        expect(up.Key.id).toBe("storyvotes#story-1");
        expect(up.UpdateExpression).toContain("ADD votersB :me");
        expect(up.ExpressionAttributeValues![":me"]).toEqual(new Set(["u1"]));
        expect(up.ExpressionAttributeValues![":max"]).toBe(VOTES_MAX);
    });

    // **1人1票を書き込みの条件で守る**（読んで数えてから書く形だと同時に
    // 投げれば両方通る）。**両方のセット**を見る——片方だけだと a に入れた
    // 人が b にも入れられる
    it("条件式が、両方の選択肢に自分がいないことと上限を見ている", async () => {
        world(STORY);
        await invoke(voteStory, ev("u1", "story-1", { choice: "a" }));
        const items = transactions()[0].input.TransactItems as Array<{ Update?: { ConditionExpression: string } }>;
        const cond = items[1].Update!.ConditionExpression;
        expect(cond).toContain("NOT contains(votersA, :uid)");
        expect(cond).toContain("NOT contains(votersB, :uid)");
        expect(cond).toContain("#total < :max");
    });

    it("入れた人には自分の票と数を返す（強整合で読み直す）", async () => {
        world(STORY, { votersA: new Set(["u1", "u9"]), votersB: new Set(["u2"]), total: 3 });
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "a" }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ success: true, myVote: "a", counts: { a: 2, b: 1 } });
        expect(r.headers?.["Cache-Control"]).toBe("private, no-store");
        const reread = calls().filter((c) => c.constructor.name === "GetCommand" && c.input.Key?.id === "storyvotes#story-1");
        expect(reread.at(-1)?.input.ConsistentRead, "書いた直後の読み直しが強整合でない").toBe(true);
    });

    // 読み直せなくても**票は入っている**。失敗にすると押した人が押し直し、
    // 2票目として断られる（結果は同じだが、画面は失敗と読む）
    it("読み直せなくても 200（自分の票だけ返す）", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                if (id === "storyvotes#story-1") return Promise.reject(new Error("timeout"));
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "b" }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r)).toEqual({ success: true, myVote: "b" });
    });

    // **投票済みは 200 で今の状態。** 応答が失われて SDK が再送した回に
    // ここへ来る——409 にすると「押したのに失敗した」になる
    it("2票目は書かずに、入れてある票を返す（200）", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                if (id === "storyvotes#story-1") return Promise.resolve({ Item: { votersA: new Set(["u9"]), votersB: new Set(["u1"]), total: 2 } });
                return Promise.resolve({});
            }
            return Promise.reject(cancelled(["None", "ConditionalCheckFailed"]));
        });
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "a" }));
        expect(r.statusCode).toBe(200);
        // 押したのは a だが、入れてあるのは b——**b のまま**（変えられない）
        expect(bodyOf(r)).toEqual({ success: true, myVote: "b", counts: { a: 1, b: 1 } });
        expect(transactions(), "2票目でやり直している").toHaveLength(1);
    });

    it("上限に達していれば 429", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                if (id === "storyvotes#story-1") return Promise.resolve({ Item: { votersA: new Set(["u9"]), total: VOTES_MAX } });
                return Promise.resolve({});
            }
            return Promise.reject(cancelled(["None", "ConditionalCheckFailed"]));
        });
        const r = await invoke(voteStory, ev("u1", "story-1", { choice: "a" }));
        expect(r.statusCode).toBe(429);
    });

    // 削除と同時に押された。**孤児は作っていない**（トランザクションごと断られた）
    it("行が消えていたら 404", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve(id === "story-1" ? { Item: STORY } : {});
            }
            return Promise.reject(cancelled(["ConditionalCheckFailed", "None"]));
        });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(404);
    });

    it("トランザクション以外の失敗は 500", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "GetCommand") {
                return Promise.resolve(String(cmd.input.Key?.id) === "story-1" ? { Item: STORY } : {});
            }
            return Promise.reject(new Error("ProvisionedThroughputExceeded"));
        });
        expect((await invoke(voteStory, ev("u1", "story-1", { choice: "a" }))).statusCode).toBe(500);
    });
});

// **数が見えるのは投稿者と、票を入れた人だけ。** 入れる前に見えると
// 多い方に寄る
describe("storyVoteState", () => {
    const ROW = { votersA: new Set(["u1", "u2"]), votersB: new Set(["u3"]), total: 3 };

    it("投稿者は入れていなくても数が見える", async () => {
        world(STORY, ROW);
        expect(await storyVoteState("story-1", "owner", true)).toEqual({ counts: { a: 2, b: 1 } });
    });

    it("票を入れた人には自分の票と数", async () => {
        world(STORY, ROW);
        expect(await storyVoteState("story-1", "u3", false)).toEqual({ myVote: "b", counts: { a: 2, b: 1 } });
    });

    it("まだ入れていない人には、票も数も無い（空）", async () => {
        world(STORY, ROW);
        expect(await storyVoteState("story-1", "u9", false)).toEqual({});
    });

    it("文書がまだ無ければ、投稿者には 0 票", async () => {
        world(STORY, undefined);
        expect(await storyVoteState("story-1", "owner", true)).toEqual({ counts: { a: 0, b: 0 } });
    });

    // モックや古い形で配列が返っても数えられる（DocumentClient は Set で返す）
    it("配列で入っていても数えられる", async () => {
        world(STORY, { votersA: ["u1"], votersB: [] });
        expect(await storyVoteState("story-1", "u1", false)).toEqual({ myVote: "a", counts: { a: 1, b: 0 } });
    });

    it("読めなければ null（呼び側は付けずに返す）", async () => {
        mockDdbSend.mockRejectedValue(new Error("timeout"));
        expect(await storyVoteState("story-1", "owner", true)).toBeNull();
    });
});

describe("storyHasVote", () => {
    it("kind: vote が1つあれば真", () => {
        expect(storyHasVote(STORY.texts)).toBe(true);
    });
    it("文字とスタンプだけなら偽", () => {
        expect(storyHasVote([STORY.texts[0], { kind: "stamp", stamp: "heart", x: 0.5, y: 0.5, size: 0.1 }])).toBe(false);
    });
    it("無い・配列でない・壊れた要素は偽（落ちない）", () => {
        expect(storyHasVote(undefined)).toBe(false);
        expect(storyHasVote("vote")).toBe(false);
        expect(storyHasVote([null, 1, "vote"])).toBe(false);
    });
});
