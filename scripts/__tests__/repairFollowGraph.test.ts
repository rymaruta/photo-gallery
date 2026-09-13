import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * フォロー関係の修復。**本番データを消す側**なので、純関数だけでなく
 * `main()` の挙動（ドライランで1行も書かない／条件付きで書く／
 * 触ってよい行だけ触る）まで固定する。`followersBackfillMain.test.ts` と
 * 同じ差し込み口の形。
 */
const sent = vi.hoisted(() => [] as { name: string; input: Record<string, unknown> }[]);
const responses = vi.hoisted(() => ({ scan: [] as unknown[], error: null as Error | null }));

class Cmd { input: Record<string, unknown>; constructor(i: Record<string, unknown>) { this.input = i; } }
const lib = {
    ScanCommand: class ScanCommand extends Cmd { },
    PutCommand: class PutCommand extends Cmd { },
    UpdateCommand: class UpdateCommand extends Cmd { },
    DeleteCommand: class DeleteCommand extends Cmd { },
};
const ddb = {
    send: async (cmd: Cmd) => {
        const name = cmd.constructor.name;
        sent.push({ name, input: cmd.input });
        if (name === "ScanCommand") return { Items: responses.scan, ScannedCount: responses.scan.length };
        if (name !== "ScanCommand" && responses.error) throw responses.error;
        return {};
    },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main, rowKind, buildTruth, pruneList, statsFix } = require("../repair-follow-graph.js");

const T = "44444444-4444-4444-8444-444444444444";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const writes = () => sent.filter((c) => c.name !== "ScanCommand");
const originalArgv = process.argv;

beforeEach(() => {
    sent.length = 0;
    responses.scan = [];
    responses.error = null;
    process.env.PHOTOS_TABLE = "test-photos";
    process.argv = ["node", "repair-follow-graph.js"];
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
});
afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe("行の種別", () => {
    it.each([
        [`follow#${T}#${A}`, "follow"],
        [`followstats#${T}`, "followstats"],
        [`following#${T}`, "following"],
        [`followers#${T}`, "followers"],
        [`follownotify#${T}#${A}`, "follownotify"],
        // **`#` の前で決める。** `startsWith("follow")` で分けると
        // `followstats#` が「マーカー」になり、数の行を消しに行く
        ["photo-123", null],
        [undefined, null],
    ])("%s → %s", (id, kind) => {
        expect(rowKind(id)).toBe(kind);
    });
});

describe("正しい姿をマーカーから組む", () => {
    it("両向きに数える", () => {
        const t = buildTruth([
            { id: `follow#${T}#${A}`, follow: true },
            { id: `follow#${T}#${B}`, follow: true },
            { id: `follow#${A}#${B}`, follow: true },
        ]);
        expect([...t.followers.get(T)].sort()).toEqual([A, B].sort());
        expect([...t.following.get(B)].sort()).toEqual([T, A].sort());
        expect(t.brokenMarkerIds).toEqual([]);
    });

    // **本番の sub は RFC 4122 の v4 とは限らない。** ここを厳しく見ていた
    // せいで、本物のフォロー2件が「ゴミ」として捨てられ、`followers#` が
    // 一度も作られていなかった（2026-09-13 実測）。消さず、正しい姿に数える
    it("版/variant が v4 でない sub のマーカーも、本物として扱う", () => {
        const V0 = "0123abcd-4567-089a-0bcd-0123456789ab";   // 版0・variant 0
        const t = buildTruth([{ id: `follow#${T}#${V0}`, follow: true }]);
        expect(t.brokenMarkerIds, "本物のマーカーを消そうとしている").toEqual([]);
        expect([...t.followers.get(T)]).toEqual([V0]);
        expect([...t.following.get(V0)]).toEqual([T]);
    });

    it("IDの形が違うマーカーは「壊れている」に数える", () => {
        const t = buildTruth([{ id: `follow#not-a-uuid#${A}`, follow: true }]);
        expect(t.brokenMarkerIds).toEqual([`follow#not-a-uuid#${A}`]);
        expect(t.followers.size).toBe(0);
    });

    // **`follow: true` を持たない `follow#` の行は消さない。**
    // 別用途で同じ接頭辞を使った行を巻き添えにすると取り返しがつかない
    it("マーカーだと名乗っていない行は、壊れていても消さない", () => {
        const t = buildTruth([{ id: "follow#not-a-uuid#x" }]);
        expect(t.brokenMarkerIds).toEqual([]);
    });

    // 数の行・通知の印はマーカーではない
    it("follow で始まる別の行を拾わない", () => {
        const t = buildTruth([
            { id: `followstats#${T}`, followers: 3 },
            { id: `follownotify#${T}#${A}`, follow: true },
            { id: `following#${T}`, list: [A] },
        ]);
        expect(t.followers.size).toBe(0);
        expect(t.brokenMarkerIds).toEqual([]);
    });
});

describe("並びの掃除", () => {
    it("マーカーの無い ID を外し、順序は保つ", () => {
        expect(pruneList([A, B, T], new Set([T, A]))).toEqual([A, T]);
    });
    it("形の壊れた ID も外す", () => {
        expect(pruneList(["not-a-uuid", A], new Set([A, "not-a-uuid"]))).toEqual([A]);
    });
    // 厳しい規則で外すと、API が通して画面にも出ている ID を一覧から消す
    it("版/variant が v4 でない ID も残す", () => {
        const V0 = "0123abcd-4567-089a-0bcd-0123456789ab";
        expect(pruneList([V0], new Set([V0]))).toBeNull();
    });
    // **変わらないなら書かない**（無駄な `rev` 上げは競合の窓を増やす）
    it("変わらなければ null", () => {
        expect(pruneList([A], new Set([A]))).toBeNull();
        expect(pruneList(undefined, new Set())).toBeNull();
    });
});

describe("数の突き合わせ", () => {
    it("合っていれば null", () => {
        expect(statsFix({ followers: 2, following: 1 }, 2, 1)).toBeNull();
    });
    it("欠けている属性は 0 として比べる", () => {
        expect(statsFix({}, 0, 0)).toBeNull();
        expect(statsFix({}, 1, 0)).toEqual({ followers: 1, following: 0 });
    });
    it("食い違えば実測値を返す", () => {
        expect(statsFix({ followers: 5, following: 0 }, 0, 0)).toEqual({ followers: 0, following: 0 });
    });
});

describe("main()", () => {
    // 本番で実際に出た形: 壊れたマーカーが数だけ膨らませ、
    // 一覧は空（読む側が弾く）。押しても何も出ない状態になる
    const 本番で出た形 = () => [
        { id: `follow#not-a-uuid#${A}`, follow: true },
        { id: `followstats#${A}`, followers: 0, following: 1 },
        { id: `following#${A}`, list: ["not-a-uuid"], rev: 3 },
    ];

    it("ドライランでは1行も書かない", async () => {
        responses.scan = 本番で出た形();
        await main({ ddb, lib });
        expect(writes()).toEqual([]);
    });

    it("--apply で、壊れたマーカー・並び・数の3つを直す", async () => {
        process.argv = ["node", "repair-follow-graph.js", "--apply"];
        responses.scan = 本番で出た形();
        await main({ ddb, lib });

        const del = writes().filter((c) => c.name === "DeleteCommand");
        expect(del).toHaveLength(1);
        expect(del[0].input.Key).toEqual({ id: `follow#not-a-uuid#${A}` });

        const put = writes().filter((c) => c.name === "PutCommand");
        expect(put).toHaveLength(1);
        expect(put[0].input.Item).toMatchObject({ id: `following#${A}`, list: [], rev: 4 });
        // 走っている間の書き込みを消さない
        expect(put[0].input.ConditionExpression).toBe("rev = :rev");

        const upd = writes().filter((c) => c.name === "UpdateCommand");
        expect(upd).toHaveLength(1);
        expect(upd[0].input.Key).toEqual({ id: `followstats#${A}` });
        expect(upd[0].input.ExpressionAttributeValues).toMatchObject({ ":nf": 0, ":ng": 0, ":cf": 0, ":cg": 1 });
        // **読んだときの値のままなら書く。** 無条件だと、走っている間に
        // 増えた1件を消す（数が減って二度と戻らない）
        expect(upd[0].input.ConditionExpression).toContain("#fr = :cf");
        expect(upd[0].input.ConditionExpression).toContain("#fg = :cg");
    });

    // **行が無い人ぶんの数の行を作らない。** マーカーから「0人」と分かっても、
    // `readStats` は行が無ければ 0 を返すので書く必要が無い
    it("followstats# の行が無い人には書かない", async () => {
        process.argv = ["node", "repair-follow-graph.js", "--apply"];
        responses.scan = [{ id: `follow#${T}#${A}`, follow: true }];
        await main({ ddb, lib });
        expect(writes()).toEqual([]);
    });

    it("正しい並びと数はそのままにする", async () => {
        process.argv = ["node", "repair-follow-graph.js", "--apply"];
        responses.scan = [
            { id: `follow#${T}#${A}`, follow: true },
            { id: `followstats#${A}`, followers: 0, following: 1 },
            { id: `followstats#${T}`, followers: 1, following: 0 },
            { id: `following#${A}`, list: [T], rev: 2 },
            { id: `followers#${T}`, list: [A], rev: 1 },
        ];
        await main({ ddb, lib });
        expect(writes()).toEqual([]);
    });

    // 競合は「済んだ」と読ませない
    it("競合したら 0 で終わらない", async () => {
        process.argv = ["node", "repair-follow-graph.js", "--apply"];
        responses.scan = [
            { id: `followstats#${A}`, followers: 9, following: 0 },
        ];
        responses.error = Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });
        await main({ ddb, lib });
        expect(process.exitCode).toBe(1);
    });

    // Scan は写真の行を持って帰らない（本番は写真が大半）
    it("follow で始まる行だけ走査する", async () => {
        await main({ ddb, lib });
        const scan = sent.find((c) => c.name === "ScanCommand");
        expect(scan?.input.FilterExpression).toBe("begins_with(id, :p)");
        expect(scan?.input.ExpressionAttributeValues).toEqual({ ":p": "follow" });
    });
});
