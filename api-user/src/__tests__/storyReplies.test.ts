import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLookup = vi.hoisted(() => vi.fn());
const mockDeletedIds = vi.hoisted(() => vi.fn(async () => new Set<string>()));

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: mockLookup,
    deletedUserIds: mockDeletedIds,
    DELETED_USER_NAME: "退会したユーザー",
}));
// ブロックの判定も境界にする（`stories.test.ts` と同じ形）
const mockHidden = vi.hoisted(() => vi.fn(async () => new Set<string>()));
vi.mock("../block", () => ({ hiddenUserIds: (...a: unknown[]) => mockHidden(...(a as [])) }));

const { postStoryReply, getStoryReplies, overBudgetCount, REACTIONS, storyRepliesId, REPLIES_MAX } =
    await import("../storyReplies");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ev = (sub: string | undefined, id: string | undefined, body?: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: id ? { id } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
});
const bodyOf = (r: Result) => JSON.parse(r.body);
const inputs = () => mockDdbSend.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();
const STORY = { id: "story-1", story: true, userId: "owner", src: "https://cdn/s.jpg", expiresAt: FUTURE };

/** ストーリーの行と、既存の返信一覧を返す世界 */
function world(story: Record<string, unknown> | undefined, replies: unknown[] = []) {
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
        const id = String(cmd.input.Key?.id ?? "");
        if (cmd.constructor.name === "GetCommand") {
            if (id === "story-1") return Promise.resolve(story ? { Item: story } : {});
            if (id === storyRepliesId("story-1")) return Promise.resolve({ Item: { items: replies } });
            return Promise.resolve({});   // ブロックの印を含め、その他は無し
        }
        return Promise.resolve({});
    });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
    mockDeletedIds.mockReset().mockResolvedValue(new Set<string>());
    mockHidden.mockReset().mockResolvedValue(new Set<string>());
});

// **ストーリーを見た人が反応する手段が1つも無かった。** 見て、消える。
// 投稿する側に届く手応えが閲覧者数の数字しか無く、返す側にも道が無い。
describe("postStoryReply", () => {
    it("未認証は 400", async () => {
        expect((await invoke(postStoryReply, ev(undefined, "story-1", { text: "いいね" }))).statusCode).toBe(400);
    });

    it("壊れた JSON は 400", async () => {
        const r = await invoke(postStoryReply, {
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            pathParameters: { id: "story-1" }, body: "{broken",
        });
        expect(r.statusCode).toBe(400);
    });

    it("空の返信は 400（何も書かない）", async () => {
        world(STORY);
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "   " }))).statusCode).toBe(400);
        expect(inputs().some((i) => i.UpdateExpression), "断ったのに書いている").toBe(false);
    });

    it("一言を送ると、返信の文書に追記して投稿者に通知する", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { text: "きれい！" }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).reply.text).toBe("きれい！");
        // 表示名はサーバーで引く（申告を保存しない＝なりすまし防止）
        expect(bodyOf(r).reply.name).toBe("旅人A");

        const append = inputs().find((i) => String(i.UpdateExpression ?? "").includes("list_append"));
        expect(append, "追記していない").toBeTruthy();
        expect((append!.Key as { id: string }).id).toBe("storyreplies#story-1");
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush.mock.calls[0][0], "投稿者に届いていない").toBe("owner");
        expect(mockPush.mock.calls[0][1].type).toBe("storyreply");
        expect(mockPush.mock.calls[0][1].photoId).toBe("story-1");
    });

    it("絵文字だけでも送れる（本文を打たずに反応できる道）", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { emoji: REACTIONS[0] }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).reply.emoji).toBe(REACTIONS[0]);
        expect(bodyOf(r).reply.text, "空の本文を持たせている").toBeUndefined();
    });

    // **自由入力にしない。** 一覧に無いものは本文として扱う（上限と
    // 切り詰めが効く側へ倒す）。ここが素通しだと2本目の入口になる
    it("一覧に無い絵文字は、絵文字ではなく本文として扱う", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { emoji: "🤬".repeat(500) }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).reply.emoji, "一覧に無いものを絵文字として通している").toBeUndefined();
        expect((bodyOf(r).reply.text as string).length, "本文の上限が効いていない").toBeLessThanOrEqual(200);
    });

    // `String(...)` に通していたので `{"emoji":{"a":1}}` が
    // 本文 `"[object Object]"` として保存されていた
    it("文字列でない emoji は本文にしない（400）", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { emoji: { a: 1 } }));
        expect(r.statusCode, "オブジェクトを文字にして保存している").toBe(400);
        expect(inputs().some((i) => i.UpdateExpression), "断ったのに書いている").toBe(false);
    });

    it("本文は200文字で切る", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { text: "あ".repeat(300) }));
        expect((bodyOf(r).reply.text as string).length).toBe(200);
    });

    it("自分のストーリーには返信できない", async () => {
        world(STORY);
        const r = await invoke(postStoryReply, ev("owner", "story-1", { text: "自分に" }));
        expect(r.statusCode).toBe(400);
        expect(mockPush, "自分宛ての通知を作っている").not.toHaveBeenCalled();
    });

    // **やり取りの口を持つ以上の最低限。** ここは「誰でも誰の通知にも
    // 文字を送れる」口の出口（1ストーリー10件 × 1日20本）。
    // **404 で返す**——「ブロックされています」と言うと相手の操作を教える
    it("ブロックされていたら送れない（実在も教えない 404）", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name !== "GetCommand") return Promise.resolve({});
            if (id === "story-1") return Promise.resolve({ Item: STORY });
            if (id === "block#owner#u1") return Promise.resolve({ Item: { blockerId: "owner", blockedId: "u1" } });
            return Promise.resolve({});
        });
        const r = await invoke(postStoryReply, ev("u1", "story-1", { text: "しつこい" }));
        expect(r.statusCode).toBe(404);
        expect(inputs().some((i) => String(i.UpdateExpression ?? "").includes("list_append")), "ブロックされているのに書いている").toBe(false);
        expect(mockPush, "ブロックされているのに通知を飛ばしている").not.toHaveBeenCalled();
    });

    // 向きを取り違えない（自分が相手をブロックしていても、送るのは自由）
    it("自分が相手をブロックしていても、返信は送れる", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name !== "GetCommand") return Promise.resolve({});
            if (id === "story-1") return Promise.resolve({ Item: STORY });
            if (id === "block#u1#owner") return Promise.resolve({ Item: { blockerId: "u1", blockedId: "owner" } });
            // **逆向きの印は無い。** ここを素の `{ Item: ... }` で返すと
            // 「相手にブロックされている」と読まれ、何も検証しないテストになる
            if (id.startsWith("block#")) return Promise.resolve({});
            return Promise.resolve({ Item: { items: [] } });
        });
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "こんにちは" }))).statusCode).toBe(200);
    });

    it("ストーリーが無ければ 404", async () => {
        world(undefined);
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(404);
    });

    it("写真（story でない行）には返信できない", async () => {
        world({ id: "story-1", src: "https://cdn/p.jpg", userId: "owner" });
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(404);
    });

    // 行が残っているのは掃除が1時間ごとだから。一覧はとっくに返していない
    it("期限切れには返信できない", async () => {
        world({ ...STORY, expiresAt: PAST });
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(404);
    });

    // 上限200の輪なので、1人で埋めれば他人の返信を全部押し出せる
    it("1人10件まで（他人の返信を押し出させない）", async () => {
        const mine = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, uid: "u1", name: "私", text: "x", t: "t" }));
        world(STORY, mine);
        const r = await invoke(postStoryReply, ev("u1", "story-1", { text: "11件目" }));
        expect(r.statusCode).toBe(429);
    });

    it("他人が10件書いていても、自分は送れる", async () => {
        const others = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, uid: "u2", name: "他人", text: "x", t: "t" }));
        world(STORY, others);
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "私の1件目" }))).statusCode).toBe(200);
    });

    // **読みと書きを条件でつなぐ。** 無条件の list_append だと、同時に
    // 投げれば全部が「既存0件」を読んで全部通り、1人あたりの上限が消える
    it("読んだときの長さを条件にする（同時投稿で上限をすり抜けさせない）", async () => {
        world(STORY, [{ id: "r0", uid: "u2", name: "他人", text: "x", t: "t" }]);
        await invoke(postStoryReply, ev("u1", "story-1", { text: "同時" }));
        const append = inputs().find((i) => String(i.UpdateExpression ?? "").includes("list_append"));
        expect(String(append!.ConditionExpression), "長さを条件にしていない").toContain("size(#items) = :len");
        expect((append!.ExpressionAttributeValues as Record<string, unknown>)[":len"]).toBe(1);
    });

    it("競合したら読み直してやり直す", async () => {
        let first = true;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                // ブロックの印は無い（`block#<owner>#<uid>`）。ここを
                // 素の `{ Item: ... }` で返すと「ブロックされている」と読まれる
                if (id.startsWith("block#")) return Promise.resolve({});
                return Promise.resolve({ Item: { items: [] } });
            }
            if (String(id).startsWith("storyreplies#") && first) {
                first = false;
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "やり直し" }))).statusCode).toBe(200);
    });

    // 投稿者だけがバッジで数を見られるように、行にも数える
    it("ストーリーの行に件数を書く", async () => {
        world(STORY);
        await invoke(postStoryReply, ev("u1", "story-1", { text: "1件目" }));
        const count = inputs().find((i) => String(i.UpdateExpression ?? "").includes("replyCount"));
        expect(count, "件数を書いていない").toBeTruthy();
        expect((count!.ExpressionAttributeValues as Record<string, unknown>)[":n"]).toBe(1);
    });

    // **「返信する」と「ストーリーを消す」が同時に走ったとき。**
    // 削除は `storyreplies#<id>` → 行 の順に消すので、その間に追記が入ると
    // `UpdateCommand` が**文書を作り直す**（キーが無ければ作る）。行の無い
    // 文書は `storyFeed` も `story` も `src` も持たないので、GSI にも Scan にも
    // 一覧にも出ない＝**どの削除経路からも二度と辿れない**（TTL も無い）。
    // 件数の書き込みが `attribute_exists(id)` で落ちることが、その合図になる
    it("書いている間にストーリーが消えていたら、作り直した文書を片付ける", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                // ブロックの印は無い（`block#<owner>#<uid>`）。ここを
                // 素の `{ Item: ... }` で返すと「ブロックされている」と読まれる
                if (id.startsWith("block#")) return Promise.resolve({});
                return Promise.resolve({ Item: { items: [] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) {
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        await invoke(postStoryReply, ev("u1", "story-1", { text: "行き違い" }));
        const del = mockDdbSend.mock.calls.some((c) => {
            const cmd = c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } };
            return cmd.constructor.name === "DeleteCommand" && cmd.input.Key?.id === storyRepliesId("story-1");
        });
        expect(del, "誰も辿れない返信の文書が残る").toBe(true);
    });

    // 逆向き。ただの書き込み失敗では消さない（本文はもう入っている）
    it("件数を書けなかっただけなら、返信は消さない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id.startsWith("block#")) return Promise.resolve({});
                return Promise.resolve(id === "story-1" ? { Item: STORY } : { Item: { items: [] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) return Promise.reject(new Error("throttle"));
            return Promise.resolve({});
        });
        await invoke(postStoryReply, ev("u1", "story-1", { text: "混んでいた" }));
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "書けなかっただけで返信を消している").toBe(false);
    });

    // **一時的な失敗ではやり直す。** 握って先へ進むと、返信は保存されたのに
    // 数だけ据え置きになる。最初の1件でそれが起きると `replyCount` が付かず、
    // `StoryViewer` はその数が 0 ならボタンを出さない＝**所有者はその返信を
    // 読む手段を失う**（返信一覧を開く入口は他に無い）
    const countAttempts = () => mockDdbSend.mock.calls
        .filter((c) => String((c[0] as { input: { UpdateExpression?: string } }).input.UpdateExpression ?? "").includes("replyCount"))
        .length;
    const flakyCount = (failTimes: number, err: Error) => {
        let seen = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id.startsWith("block#")) return Promise.resolve({});
                return Promise.resolve(id === "story-1" ? { Item: STORY } : { Item: { items: [] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) {
                seen++;
                return seen <= failTimes ? Promise.reject(err) : Promise.resolve({});
            }
            return Promise.resolve({});
        });
    };

    it("件数の書き込みが一度こけても、やり直して書く", async () => {
        flakyCount(1, new Error("throttled"));
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(200);
        expect(countAttempts(), "やり直していない（返信はあるのに数が付かない）").toBe(2);
    });

    // **CCF はやり直さない。** あれは「ストーリーの行が消えた」で、
    // 待っても戻らない。孤児になった文書を片付けて終わる
    it("行が消えていた場合はやり直さず、孤児を片付ける", async () => {
        const ccf = Object.assign(new Error("gone"), { name: "ConditionalCheckFailedException" });
        flakyCount(99, ccf);
        await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }));
        expect(countAttempts(), "消えた行にやり直しをかけている").toBe(1);
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "辿れなくなった文書を片付けていない").toBe(true);
    });

    // やり直しに上限がある（一時的な失敗が続いても終わる）
    it("やり直しは上限で止まる", async () => {
        flakyCount(99, new Error("throttled"));
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(200);
        expect(countAttempts(), "やり直しの上限が効いていない").toBe(4);   // 初回 + 3回
    });

    /** 最後に書こうとした件数（`:n`） */
    const lastWritten = () => {
        const calls = mockDdbSend.mock.calls
            .map((c) => c[0] as { input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } })
            .filter((c) => String(c.input.UpdateExpression ?? "").includes("replyCount"));
        return calls.at(-1)?.input.ExpressionAttributeValues?.[":n"];
    };

    // **やり直すときは数を読み直す。** `stored.length` は追記した瞬間で
    // 固定されているので、待っている間に別の人の返信が入っていると、
    // 古い数で**上書きして巻き戻す**（その人の返信がバッジから消える）。
    // 「2回撃った」だけを見ていると、この巻き戻しを通してしまう
    it("やり直しの前に数を読み直す（間に入った返信を巻き戻さない）", async () => {
        let countCalls = 0;
        let repliesReads = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id.startsWith("block#")) return Promise.resolve({});
                if (id === "story-1") return Promise.resolve({ Item: STORY });
                repliesReads++;
                // 1回目（追記の前）は空。やり直しの前に読み直すと、
                // その間に別の人の返信が入って2件になっている
                return Promise.resolve(repliesReads === 1
                    ? { Item: { items: [] } }
                    : { Item: { items: [{ id: "x", uid: "other", name: "B", text: "y", t: "t" }, { id: "y", uid: "u1", name: "A", text: "x", t: "t" }] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) {
                countCalls++;
                return countCalls === 1 ? Promise.reject(new Error("throttled")) : Promise.resolve({});
            }
            return Promise.resolve({});
        });
        await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }));
        expect(lastWritten(), "古い数を撃ち直してバッジを巻き戻している").toBe(2);
    });

    // **通知は件数より先に出す。** 件数のやり直しで枠（既定6秒）を使い切ると
    // `pushNotification` に届かず、所有者は「返信が来たこと」すら知れない
    it("件数を最後まで書けなくても、通知は出す", async () => {
        flakyCount(99, new Error("throttled"));
        await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }));
        expect(mockPush, "件数のやり直しの後ろに通知を置いている").toHaveBeenCalled();
        // 順番まで見る（後ろに置くと、枠を使い切った回に届かない）
        const pushOrder = mockPush.mock.invocationCallOrder[0];
        const lastCount = mockDdbSend.mock.calls
            .map((c, i) => ({ c: c[0] as { input: { UpdateExpression?: string } }, i }))
            .filter((x) => String(x.c.input.UpdateExpression ?? "").includes("replyCount"))
            .at(-1)!;
        const lastCountOrder = mockDdbSend.mock.invocationCallOrder[lastCount.i];
        expect(pushOrder, "通知が件数のやり直しより後ろにある").toBeLessThan(lastCountOrder);
    });

    // **件数の書き込みは通知の有無に依らない。**
    // 通知を件数より前に出すよう並べ替えたとき、**やり直しのループごと
    // `if (ownerId)` の中に入れてしまった**（`ownerId` が無い回は数を
    // 書かない）。40本すべて緑だったので、構造を見る1本を足す。
    // **この状態は今のデータでは作れない**（`createStory` は必ず `userId` を
    // 書く）が、入れ子を戻す変異はここでしか落ちない
    it("宛先が分からなくても、件数は書く", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id.startsWith("block#")) return Promise.resolve({});
                // userId も uploadedBy も持たない行
                return Promise.resolve(id === "story-1"
                    ? { Item: { id: "story-1", story: true, src: "https://cdn/x.jpg", expiresAt: "2099-01-01T00:00:00Z" } }
                    : { Item: { items: [] } });
            }
            return Promise.resolve({});
        });
        await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }));
        expect(lastWritten(), "宛先が無いと件数を書かない構造になっている").toBe(1);
        expect(mockPush, "宛先が無いのに通知を出している").not.toHaveBeenCalled();
    });

    // 件数を書けなくても返信そのものは成功（本文はもう入っている）
    it("件数を書けなくても、返信は成功として返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id.startsWith("block#")) return Promise.resolve({});
                return Promise.resolve(id === "story-1" ? { Item: STORY } : { Item: { items: [] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        expect((await invoke(postStoryReply, ev("u1", "story-1", { text: "x" }))).statusCode).toBe(200);
    });
});

describe("getStoryReplies", () => {
    it("投稿者は読める（新しい順）", async () => {
        world(STORY, [
            { id: "r1", uid: "u1", name: "A", text: "ふるい", t: "2026-01-01T00:00:00.000Z" },
            { id: "r2", uid: "u2", name: "B", text: "あたらしい", t: "2026-01-02T00:00:00.000Z" },
        ]);
        const r = await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).items.map((x: { id: string }) => x.id)).toEqual(["r2", "r1"]);
        expect(bodyOf(r).count).toBe(2);
    });

    // **返信は公開の議論ではない。** 見た人には見せない
    it("投稿者以外は 403", async () => {
        world(STORY, [{ id: "r1", uid: "u1", name: "A", text: "x", t: "t" }]);
        expect((await invoke(getStoryReplies, ev("u1", "story-1"))).statusCode).toBe(403);
    });

    it("未認証は 400", async () => {
        expect((await invoke(getStoryReplies, ev(undefined, "story-1"))).statusCode).toBe(400);
    });

    it("退会した人の名前は伏せる", async () => {
        mockDeletedIds.mockResolvedValue(new Set(["gone"]));
        world(STORY, [{ id: "r1", uid: "gone", name: "むかしの名前", text: "x", t: "t" }]);
        const r = await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(bodyOf(r).items[0].name).toBe("退会したユーザー");
        expect(bodyOf(r).items[0].deleted).toBe(true);
    });

    it("0件なら退会者を引きに行かない", async () => {
        world(STORY, []);
        await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(mockDeletedIds).not.toHaveBeenCalled();
    });

    // **ブロックした相手の返信は出さない（両向き）。**
    // `postStoryReply` が断るのはこれから来るぶんだけで、既に届いたぶんは
    // `{uid, name}` を焼き込んだまま残っていた（通知・閲覧者と同じ型）
    it("ブロックした相手の返信は出さない", async () => {
        mockHidden.mockResolvedValue(new Set(["u2"]));
        world(STORY, [
            { id: "r1", uid: "u1", name: "A", text: "ふつう", t: "2026-01-01T00:00:00.000Z" },
            { id: "r2", uid: "u2", name: "B", text: "ブロックした人", t: "2026-01-02T00:00:00.000Z" },
        ]);
        const r = await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(bodyOf(r).items.map((x: { id: string }) => x.id), "ブロックした相手の返信が残っている").toEqual(["r1"]);
        // **この応答の中では数と中身を食い違わせない**
        expect(bodyOf(r).count).toBe(1);
        expect(mockHidden).toHaveBeenCalledWith("owner");
    });

    // **窓を切る前に落とす。** あとで切ると、ブロックした相手の返信が
    // `REPLIES_MAX` の窓を食って生きている返信が押し出される
    it("窓（REPLIES_MAX）を、ブロックした相手の返信で埋めない", async () => {
        mockHidden.mockResolvedValue(new Set(["spam"]));
        const blocked = Array.from({ length: REPLIES_MAX }, (_, i) => (
            { id: `b${i}`, uid: "spam", name: "B", text: "x", t: `2026-01-02T00:00:${String(i).padStart(2, "0")}.000Z` }
        ));
        world(STORY, [{ id: "keep", uid: "u1", name: "A", text: "生きている", t: "2026-01-01T00:00:00.000Z" }, ...blocked]);
        const r = await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(bodyOf(r).items.map((x: { id: string }) => x.id), "生きている返信が窓から押し出された").toEqual(["keep"]);
    });

    it("ブロックしていなければ何も落とさない", async () => {
        world(STORY, [{ id: "r1", uid: "u1", name: "A", text: "x", t: "t" }]);
        expect(bodyOf(await invoke(getStoryReplies, ev("owner", "story-1"))).count).toBe(1);
    });

    // 見えなくする側が落ちたときに全部消さない（`getStories` と同じ判断）
    it("ブロック一覧を読めなくても、返信は返す", async () => {
        mockHidden.mockRejectedValue(new Error("throttled"));
        world(STORY, [{ id: "r1", uid: "u1", name: "A", text: "x", t: "t" }]);
        expect(bodyOf(await invoke(getStoryReplies, ev("owner", "story-1"))).count,
            "ブロックを読めないだけで返信が消えている").toBe(1);
    });

    it("0件ならブロック一覧も引きに行かない", async () => {
        world(STORY, []);
        await invoke(getStoryReplies, ev("owner", "story-1"));
        expect(mockHidden, "返信が無いのにブロック一覧を読んでいる").not.toHaveBeenCalled();
    });

    // 本人向けの内容なので共有キャッシュに載せない
    it("共有キャッシュに載せない", async () => {
        world(STORY, []);
        const r = await invoke(getStoryReplies, ev("owner", "story-1")) as Result & { headers: Record<string, string> };
        expect(r.headers["Cache-Control"]).toContain("no-store");
    });
});

// 件数だけでは DynamoDB の 400KB を守れない（comments.ts と同じ理由）
describe("overBudgetCount", () => {
    const fat = (i: number) => ({ id: `r${i}`, uid: `u${i}`, name: "あ".repeat(100), text: "あ".repeat(200), t: "2026-01-01T00:00:00.000Z" });

    it("収まるなら落とさない", () => {
        expect(overBudgetCount([fat(1), fat(2)], fat(3))).toBe(0);
    });

    it("溢れるなら古い方から落とす", () => {
        const many = Array.from({ length: 400 }, (_, i) => fat(i));
        const drop = overBudgetCount(many, fat(999));
        expect(drop, "溢れているのに落としていない").toBeGreaterThan(0);
        expect(drop).toBeLessThan(many.length);
    });
});
