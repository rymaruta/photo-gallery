import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { blockUser, unblockUser, listBlocks, isBlocked, hiddenUserIds, BLOCKS_MAX, blockMarkerId, blocksId, blockedById }
    = await import("../block");

// **UUID の形で書く。** 実装は相手のIDの形を見る（見ないと、任意の文字列で
// 誰も掃除しない行を作れる）ので、"me" / "them" のままだと 400 で弾かれ、
// **判定より手前で止まって何も検証しないテスト**になる
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const ev = (sub: string | undefined, id?: string) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: id ? { id } : undefined,
});
const bodyOf = (r: Result) => JSON.parse(r.body);
const cmds = () => mockDdbSend.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> });
const keyOf = (c: { input: Record<string, unknown> }) => String((c.input.Key as { id?: string })?.id ?? (c.input.Item as { id?: string })?.id ?? "");

/** 行の世界。id → Item */
function world(rows: Record<string, Record<string, unknown>> = {}) {
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
        if (cmd.constructor.name === "GetCommand") {
            const item = rows[String(cmd.input.Key?.id ?? "")];
            return Promise.resolve(item ? { Item: item } : {});
        }
        return Promise.resolve({});
    });
}

// **`beforeEach(() => mock.mockReset())` と書かない。**
// `mockReset()` は**モック自身を返す**（連ねて書けるように）ので、
// アロー関数の暗黙の return でそれが `beforeEach` の戻り値になり、
// **vitest は「後片付けの関数」だと思って引数なしで呼ぶ**
// （スタックに `callCleanupHooks` が出る）。この差し替えの中で
// `cmd.constructor` を読むと、その呼び出しだけ `undefined` で落ちる
// ——「1つ前のテストが原因」に見えるので、たどり着くのに時間がかかった。
// 中括弧で包んで何も返さない。
beforeEach(() => { mockDdbSend.mockReset(); });

// **やり取りの口を持つ以上の最低限。** ストーリーへの返信を足した時点で、
// ログインしていれば誰でも誰の通知にも文字を送れるようになった
// （1ストーリー10件 × 1日20本）。止める手段は**リポジトリ全体に無かった**。
describe("blockUser", () => {
    it("印と、両側の一覧に書く", async () => {
        world();
        const r = await invoke(blockUser, ev(ME, THEM));
        expect(r.statusCode).toBe(200);
        const keys = cmds().map(keyOf);
        expect(keys, "判定に使う印を立てていない").toContain(blockMarkerId(ME, THEM));
        expect(keys, "自分の一覧に無い（画面から解除できない）").toContain(blocksId(ME));
        // **相手側にも書く。** 隠すのは両向きで、相手は自分の `blocks#` に
        // 何も持っていない（B が A のストーリーを見ないようにするために要る）
        expect(keys, "相手側の一覧に無い（片向きしか隠せない）").toContain(blockedById(THEM));
    });

    // **印が先。** 判定に使うのは印なので、途中で切れても
    // 「効いていないのに一覧には出る」を作らない
    it("印を一覧より先に立てる", async () => {
        world();
        await invoke(blockUser, ev(ME, THEM));
        const order = cmds().filter((c) => c.constructor.name !== "GetCommand").map(keyOf);
        expect(order[0], "一覧を先に書いている").toBe(blockMarkerId(ME, THEM));
    });

    it("自分はブロックできない", async () => {
        world();
        expect((await invoke(blockUser, ev(ME, ME))).statusCode).toBe(400);
        expect(mockDdbSend, "断ったのに書いている").not.toHaveBeenCalled();
    });

    it("未認証は 400", async () => {
        expect((await invoke(blockUser, ev(undefined, THEM))).statusCode).toBe(400);
    });

    // **上限は入れる前に見る**（`following` の2000人切り捨てを作らない）
    it("上限を超えたら断る", async () => {
        world({ [blocksId(ME)]: { blockedIds: Array.from({ length: BLOCKS_MAX }, (_, i) => `u${i}`) } });
        const r = await invoke(blockUser, ev(ME, THEM));
        expect(r.statusCode).toBe(403);
        expect(cmds().some((c) => c.constructor.name === "PutCommand"), "上限なのに印を立てている").toBe(false);
    });

    it("既にブロックしている相手なら、上限に達していても通す（押し直し）", async () => {
        const list = Array.from({ length: BLOCKS_MAX }, (_, i) => `u${i}`);
        list[0] = THEM;
        world({ [blocksId(ME)]: { blockedIds: list } });
        expect((await invoke(blockUser, ev(ME, THEM))).statusCode).toBe(200);
    });

    it("同じ相手を二度ブロックしても、一覧が二重にならない", async () => {
        world({ [blocksId(ME)]: { blockedIds: [THEM] } });
        await invoke(blockUser, ev(ME, THEM));
        const write = cmds().find((c) => keyOf(c) === blocksId(ME) && c.constructor.name === "UpdateCommand");
        expect(write, "既に入っているのに書き直している").toBeUndefined();
    });
});

describe("unblockUser", () => {
    it("両側の一覧から外し、印を最後に消す", async () => {
        world({
            [blocksId(ME)]: { blockedIds: [THEM, OTHER] },
            [blockedById(THEM)]: { blockerIds: [ME] },
        });
        const r = await invoke(unblockUser, ev(ME, THEM));
        expect(r.statusCode).toBe(200);
        const writes = cmds().filter((c) => c.constructor.name !== "GetCommand");
        const next = writes.find((c) => keyOf(c) === blocksId(ME));
        expect((next!.input.ExpressionAttributeValues as Record<string, unknown>)[":next"]).toEqual([OTHER]);
        expect(writes.some((c) => keyOf(c) === blockedById(THEM)), "相手側に残る（片向きだけ解けない）").toBe(true);
        // **自分の一覧を最後に外す。** 先に空にすると、途中で落ちた回に
        // 「ブロックは効いたまま、画面の一覧からは消える」＝解除ボタンが
        // 出ないので押し直せない（直す手がかりを最初に壊すことになる）
        expect(keyOf(writes[writes.length - 1]), "自分の一覧を先に壊している").toBe(blocksId(ME));
    });
});

describe("isBlocked", () => {
    it("印があれば true", async () => {
        world({ [blockMarkerId("a", "b")]: { blockerId: "a", blockedId: "b" } });
        expect(await isBlocked("a", "b")).toBe(true);
    });

    it("無ければ false", async () => {
        world();
        expect(await isBlocked("a", "b")).toBe(false);
    });

    // **向きがある。** a が b をブロックしても、b は a をブロックしていない
    it("向きを取り違えない", async () => {
        world({ [blockMarkerId("a", "b")]: { blockerId: "a", blockedId: "b" } });
        expect(await isBlocked("b", "a"), "向きが逆でも true を返している").toBe(false);
    });

    // **一覧ではなく印を引く。** 一覧が上限で切り捨てられても判定が狂わない
    it("引くのは印1つだけ（一覧を読まない）", async () => {
        world();
        await isBlocked("a", "b");
        expect(cmds()).toHaveLength(1);
        expect(keyOf(cmds()[0])).toBe(blockMarkerId("a", "b"));
    });

    it("自分自身は常に false（読みにも行かない）", async () => {
        world();
        expect(await isBlocked("a", "a")).toBe(false);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("hiddenUserIds", () => {
    // **両向き。** 自分がブロックした人と、自分をブロックした人の両方
    it("両側の一覧を合わせて返す", async () => {
        world({
            [blocksId(ME)]: { blockedIds: ["a", "b"] },
            [blockedById(ME)]: { blockerIds: ["b", "c"] },
        });
        expect([...await hiddenUserIds(ME)].sort()).toEqual(["a", "b", "c"]);
    });

    it("どちらも無ければ空", async () => {
        world();
        expect((await hiddenUserIds(ME)).size).toBe(0);
    });

    // 壊れた行で落ちない（配列でない・文字列でない要素）
    it("壊れた一覧は落として続ける", async () => {
        world({
            [blocksId(ME)]: { blockedIds: "not-an-array" },
            [blockedById(ME)]: { blockerIds: ["ok", 42, null] },
        });
        expect([...await hiddenUserIds(ME)]).toEqual(["ok"]);
    });
});

describe("listBlocks", () => {
    it("自分がブロックした人を返す", async () => {
        world({ [blocksId(ME)]: { blockedIds: ["a", "b"] } });
        const r = await invoke(listBlocks, ev(ME));
        expect(bodyOf(r).blockedIds).toEqual(["a", "b"]);
        // 本人向け。共有キャッシュに載せない
        expect(r.headers?.["Cache-Control"]).toContain("no-store");
    });

    it("未認証は 401", async () => {
        expect((await invoke(listBlocks, ev(undefined))).statusCode).toBe(401);
    });
});


// レビューが再現した4件。どれも「押し直せば直る」に見えて直らない形。
describe("ブロック: 途中で落ちたときの倒れ方", () => {
    it("でたらめなIDは断る（誰も掃除しない行を作らせない）", async () => {
        world();
        expect((await invoke(blockUser, ev(ME, "not-a-uuid"))).statusCode).toBe(400);
        expect(mockDdbSend, "形も見ずに行を作っている").not.toHaveBeenCalled();
    });

    it("解除もでたらめなIDを断る", async () => {
        world();
        expect((await invoke(unblockUser, ev(ME, "not-a-uuid"))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // 外す側は「もともと入っていない」回でも書きに行き、行が無ければ
    // **空配列の行を新しく作っていた**（掃除する人はいない）
    it("ブロックしていない相手の解除で、空の行を作らない", async () => {
        world();
        await invoke(unblockUser, ev(ME, THEM));
        const writes = cmds().filter((c) => c.constructor.name === "UpdateCommand");
        expect(writes.map(keyOf), "空の一覧の行を作っている").toEqual([]);
    });

    // **一覧が片側だけ欠けると、隠すのが片向きだけになる**
    // （相手には自分のストーリーが見え続ける）
    it("一覧の書き込みが競合したら、読み直してやり直す", async () => {
        let failed = false;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({});
            if (cmd.constructor.name === "UpdateCommand" && keyOf(cmd as never) === blocksId(ME) && !failed) {
                failed = true;
                return Promise.reject(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        const r = await invoke(blockUser, ev(ME, THEM));
        expect(r.statusCode, "競合しただけで諦めている").toBe(200);
        const writes = cmds().filter((c) => c.constructor.name === "UpdateCommand").map(keyOf);
        expect(writes.filter((k) => k === blocksId(ME)).length, "やり直していない").toBe(2);
    });
});
