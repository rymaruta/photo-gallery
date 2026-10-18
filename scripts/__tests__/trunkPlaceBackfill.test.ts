import { describe, it, expect, vi } from "vitest";

/**
 * 本番にもう在るトランクのラベルに「地名を人に見せてよい」印（`o: 1`）を足す台本（`backfill-trunk-place-ok.js`）。
 * 判定は Lambda と同じ `api-user/src/trunkPlace.ts` を使う（ここでも本物を渡す）
 */
vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("USERS_TABLE", "users-test");
const lib = await import("../../api-user/src/trunkPlace");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { planRow, photoIdsOf, estimate, run } = require("../backfill-trunk-place-ok.js");

const U = "11111111-1111-4111-8111-111111111111";
const pub = (id: string, over: Record<string, unknown> = {}) => ({
    id, userId: U, src: `https://cdn.example.com/${id}.webp`, published: true, location: "京都, Kyoto", ...over,
});
const lab = (i: string, over: Record<string, unknown> = {}) => ({ i, k: "p", n: "京都", l: "Kyoto", c: "日本", d: 1, a: 1, ...over });

describe("印を足す台本（planRow）", () => {
    it("誰にでも見える公開・撮影地が同じ写真のラベルにだけ印を付ける", () => {
        const row = {
            id: `trunk#${U}`, uid: U, rev: 2,
            pocket: [lab("a"), lab("b"), lab("c"), lab("d"), lab("e")],
            stuck: [lab("f", { o: 1 }), { id: "old-long-form", place: { name: "京都" } }],
        };
        const photos = new Map<string, Record<string, unknown> | undefined>([
            ["a", pub("a")],
            ["b", pub("b", { audience: "followers" })],
            ["c", pub("c", { published: false })],
            ["d", pub("d", { location: "大阪" })],
            ["e", undefined],
            ["f", pub("f", { userId: "someone-else" })],
        ]);
        const plan = planRow(lib, row, photos);
        expect(plan.pocket.map((l: Record<string, unknown>) => l.o ?? null)).toEqual([1, null, null, null, null]);
        // 前に付いていても、今の写真で確かめられなければ外す
        expect(plan.stuck[0].o).toBeUndefined();
        // 長い鍵の古い形は触らない（印が無いまま＝伏せたまま）
        expect(plan.stuck[1]).toEqual({ id: "old-long-form", place: { name: "京都" } });
        expect([plan.added, plan.removed, plan.labels, plan.write]).toEqual([1, 1, 6, true]);
    });

    it("変わらなければ書かない・写真の id は重ねて読まない", () => {
        const row = { id: `trunk#${U}`, uid: U, pocket: [lab("a", { o: 1 })], stuck: [lab("a", { o: 1 })] };
        expect(planRow(lib, row, new Map([["a", pub("a")]])).write).toBe(false);
        expect(photoIdsOf(row)).toEqual(["a"]);
    });

    it("見積もり: Scan は 4KB ごとに 0.5 単位", () => {
        expect(estimate({ tableBytes: 8192 * 10, itemCount: 100 })).toMatchObject({ scanUnits: 10, itemCount: 100 });
    });
});

describe("台本の本体（run）", () => {
    class Cmd { constructor(readonly input: Record<string, unknown>) {} }
    class ScanCommand extends Cmd {}
    class GetCommand extends Cmd {}
    class PutCommand extends Cmd {}
    const cmds = { ScanCommand, GetCommand, PutCommand };

    function world() {
        const store = new Map<string, Record<string, unknown>>();
        store.set(`trunk#${U}`, { id: `trunk#${U}`, uid: U, rev: 1, pocket: [lab("a")], stuck: [] });
        store.set("a", pub("a"));
        const sent: { kind: string; input: Record<string, unknown> }[] = [];
        let onPut: (() => void) | null = null;
        let onGet: ((id: string, n: number) => void) | null = null;
        const getsOf = new Map<string, number>();
        const send = async (cmd: Cmd) => {
            sent.push({ kind: cmd.constructor.name, input: cmd.input });
            if (cmd instanceof GetCommand && onGet) {
                const id = String((cmd.input.Key as { id: string }).id);
                getsOf.set(id, (getsOf.get(id) ?? 0) + 1);
                onGet(id, getsOf.get(id)!);
            }
            if (cmd instanceof ScanCommand) return { Items: [...store.values()].filter((r) => String(r.id).startsWith("trunk#")).map((r) => structuredClone(r)), ScannedCount: store.size };
            if (cmd instanceof GetCommand) {
                const v = store.get(String((cmd.input.Key as { id: string }).id));
                return { Item: v ? structuredClone(v) : undefined };
            }
            if (cmd instanceof PutCommand) {
                if (onPut) { const f = onPut; onPut = null; f(); }
                const item = cmd.input.Item as Record<string, unknown>;
                const cur = store.get(String(item.id));
                if (cur?.rev !== (cmd.input.ExpressionAttributeValues as { ":rev": number })[":rev"]) {
                    throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
                }
                store.set(String(item.id), structuredClone(item));
                return {};
            }
            throw new Error("想定外");
        };
        const go = (argv: string[]) => run({
            send, describe: async () => ({ TableSizeBytes: 1024, ItemCount: 2 }), lib, argv, PHOTOS_TABLE: "photos-test", cmds,
            log: () => undefined, logError: () => undefined,
        });
        return { store, sent, go, setOnPut: (f: () => void) => { onPut = f; }, setOnGet: (f: (id: string, n: number) => void) => { onGet = f; } };
    }

    it("既定（--apply なし）は書かない。数えるだけ", async () => {
        const w = world();
        const tally = await w.go(["node", "x"]);
        expect(tally.toWrite).toBe(1);
        expect(tally.added).toBe(1);
        expect(w.sent.some((c) => c.kind === "PutCommand")).toBe(false);
        expect((w.store.get(`trunk#${U}`)!.pocket as Record<string, unknown>[])[0].o).toBeUndefined();
    });

    it("--estimate は Scan もしない", async () => {
        const w = world();
        await w.go(["node", "x", "--estimate"]);
        expect(w.sent).toHaveLength(0);
    });

    it("--apply で書く。写真は強い読み", async () => {
        const w = world();
        await w.go(["node", "x", "--apply"]);
        expect((w.store.get(`trunk#${U}`)!.pocket as Record<string, unknown>[])[0].o).toBe(1);
        expect(w.store.get(`trunk#${U}`)!.rev).toBe(2);
        const gets = w.sent.filter((c) => c.kind === "GetCommand");
        expect(gets.every((g) => g.input.ConsistentRead === true)).toBe(true);
    });

    it("書いたあとに、印を付けた写真だけ強い読みで読み直し、外すべきなら外す", async () => {
        const w = world();
        // 書く直前に写真が絞られた（rev は進まない＝Put は通る）
        w.setOnPut(() => { w.store.set("a", pub("a", { audience: "followers" })); });
        const tally = await w.go(["node", "x", "--apply"]);
        expect((w.store.get(`trunk#${U}`)!.pocket as Record<string, unknown>[])[0].o).toBeUndefined();
        expect(w.store.get(`trunk#${U}`)!.rev).toBe(3);
        expect(tally.rechecked).toBe(1);
        const gets = w.sent.filter((c) => c.kind === "GetCommand" && (c.input.Key as { id: string }).id === "a");
        expect(gets).toHaveLength(2);
        expect(gets.every((g) => g.input.ConsistentRead === true)).toBe(true);
    });

    it("書いたあとの確かめの読みが落ちたら、確かめの失敗として数える（書いた行の数・失敗の数と混ぜない）", async () => {
        const w = world();
        w.setOnGet((id, n) => { if (id === "a" && n === 2) throw Object.assign(new Error("boom"), { name: "InternalServerError" }); });
        const tally = await w.go(["node", "x", "--apply"]);
        expect([tally.written, tally.failed, tally.recheckFailed]).toEqual([1, 0, 1]);
        // 確かめの読みも数える（写真の読みは2回）
        expect(tally.gets).toBe(2);
    });

    it("書いたあとの確かめの Put が競合したら、行を読み直して1回やり直す", async () => {
        const w = world();
        // 1回目（印を書く）の直前に写真が絞られる・2回目（外す）の直前にアプリが先に書く（onPut は1回ごとに掛け直す）
        w.setOnPut(() => {
            w.store.set("a", pub("a", { audience: "followers" }));
            w.setOnPut(() => { w.store.set(`trunk#${U}`, { ...w.store.get(`trunk#${U}`)!, rev: 7, coins: 3 }); });
        });
        const tally = await w.go(["node", "x", "--apply"]);
        const row = w.store.get(`trunk#${U}`)!;
        expect((row.pocket as Record<string, unknown>[])[0].o).toBeUndefined();
        expect(row.rev).toBe(8);
        expect(row.coins).toBe(3);
        expect([tally.rechecked, tally.recheckFailed]).toEqual([1, 0]);
    });

    it("書いたあとの確かめで、公開のままなら書き足さない", async () => {
        const w = world();
        await w.go(["node", "x", "--apply"]);
        expect(w.sent.filter((c) => c.kind === "PutCommand")).toHaveLength(1);
        expect((w.store.get(`trunk#${U}`)!.pocket as Record<string, unknown>[])[0].o).toBe(1);
    });

    it("競合したら、行も写真も強い読みで読み直す（あいだに絞られた写真には付けない）", async () => {
        const w = world();
        w.setOnPut(() => {
            // アプリが先に書いた: rev が進み、写真も絞られた
            w.store.set(`trunk#${U}`, { ...w.store.get(`trunk#${U}`)!, rev: 5 });
            w.store.set("a", pub("a", { audience: "followers" }));
        });
        const tally = await w.go(["node", "x", "--apply"]);
        expect((w.store.get(`trunk#${U}`)!.pocket as Record<string, unknown>[])[0].o).toBeUndefined();
        expect(tally.failed).toBe(0);
        // 写真は2回読んだ（cache を捨てて読み直した）
        expect(w.sent.filter((c) => c.kind === "GetCommand" && (c.input.Key as { id: string }).id === "a")).toHaveLength(2);
    });
});
