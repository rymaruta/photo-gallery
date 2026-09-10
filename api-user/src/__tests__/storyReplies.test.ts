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

const { postStoryReply, getStoryReplies, overBudgetCount, REACTIONS, storyRepliesId } =
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
            return Promise.resolve({});
        }
        return Promise.resolve({});
    });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockPush.mockReset().mockResolvedValue(undefined);
    mockLookup.mockReset().mockResolvedValue("旅人A");
    mockDeletedIds.mockReset().mockResolvedValue(new Set<string>());
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
                return Promise.resolve(id === "story-1" ? { Item: STORY } : { Item: { items: [] } });
            }
            if (String(cmd.input.UpdateExpression ?? "").includes("replyCount")) return Promise.reject(new Error("throttle"));
            return Promise.resolve({});
        });
        await invoke(postStoryReply, ev("u1", "story-1", { text: "混んでいた" }));
        const del = mockDdbSend.mock.calls.some((c) => (c[0] as { constructor: { name: string } }).constructor.name === "DeleteCommand");
        expect(del, "書けなかっただけで返信を消している").toBe(false);
    });

    // 件数を書けなくても返信そのものは成功（本文はもう入っている）
    it("件数を書けなくても、返信は成功として返す", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string }; UpdateExpression?: string } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
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
