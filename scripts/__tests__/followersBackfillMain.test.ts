import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **`main()` はまるごと無検証だった。** 変異で確認: `if (!apply) continue;`
// を削除（＝ドライランでも書く）→ 緑のまま。`rev` を 1 固定に → 緑のまま。
// 本番データに1回だけ流す破壊的なスクリプトなので、ここは固定する。
const sent = vi.hoisted(() => [] as { name: string; input: Record<string, unknown> }[]);
const responses = vi.hoisted(() => ({ scan: [] as unknown[], get: {} as Record<string, unknown>, putError: null as Error | null }));

class Cmd { input: Record<string, unknown>; constructor(i: Record<string, unknown>) { this.input = i; } }
const lib = {
    ScanCommand: class ScanCommand extends Cmd { },
    GetCommand: class GetCommand extends Cmd { },
    PutCommand: class PutCommand extends Cmd { },
};
const ddb = {
    send: async (cmd: Cmd) => {
        const name = cmd.constructor.name;
        sent.push({ name, input: cmd.input });
        if (name === "ScanCommand") return { Items: responses.scan, ScannedCount: responses.scan.length };
        if (name === "GetCommand") return { Item: responses.get[String((cmd.input.Key as { id?: string }).id)] };
        if (name === "PutCommand" && responses.putError) throw responses.putError;
        return {};
    },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require("../backfill-followers.js");

const T = "44444444-4444-4444-8444-444444444444";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const puts = () => sent.filter((c) => c.name === "PutCommand");
const originalArgv = process.argv;

beforeEach(() => {
    sent.length = 0;
    responses.scan = [{ id: `follow#${T}#${A}`, follow: true, createdAt: "2026-01-01" }];
    responses.get = {};
    responses.putError = null;
    process.env.PHOTOS_TABLE = "photos-test";
    vi.spyOn(console, "log").mockImplementation(() => { /* 静かに */ });
});
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); });

const run = async (apply: boolean) => {
    process.argv = ["node", "backfill-followers.js", ...(apply ? ["--apply"] : [])];
    await main({ ddb, lib });
};

describe("フォロワーの埋め戻し: main()", () => {
    // **数が合わないときは理由を出す。** 本番で「マーカー 2 件 / 対象 0 人」
    // が出たのに、理由がログに無かった
    it("捨てたマーカーがあれば、理由と件数をログに出す", async () => {
        const logs: string[] = [];
        vi.mocked(console.log).mockImplementation(((...a: unknown[]) => { logs.push(a.join(" ")); }) as typeof console.log);
        responses.scan = [
            { id: `follow#${T}#${A}`, follow: true, createdAt: "2026-01-01" },
            { id: "follow#garbage#alsobad", follow: true },
        ];
        await run(false);
        expect(logs.join("\n"), "捨てた理由が出ていない").toMatch(/捨てた: 1 件/);
    });

    it("ドライランでは1行も書かない", async () => {
        await run(false);
        expect(puts(), "ドライランなのに書いている").toHaveLength(0);
        expect(sent.some((c) => c.name === "ScanCommand"), "走査すらしていない").toBe(true);
    });

    it("--apply で followers# を書く", async () => {
        await run(true);
        expect(puts()).toHaveLength(1);
        expect(puts()[0].input.Item).toMatchObject({ id: `followers#${T}`, uid: T, list: [A], rev: 1 });
    });

    // **無条件の Put は、走っている間のサーバー側の書き込みを黙って消す。**
    // しかも書く `rev` は相手と同じ値になるので、以後の CAS でも検知されない
    it("読んだときの rev を条件にして書く", async () => {
        responses.get = { [`followers#${T}`]: { list: [B], rev: 7 } };
        await run(true);
        const input = puts()[0].input as { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown>; Item?: { rev?: number } };
        expect(input.ConditionExpression, "条件を付けずに書いている").toContain("rev = :rev");
        expect(input.ExpressionAttributeValues?.[":rev"]).toBe(7);
        expect(input.Item?.rev).toBe(8);
    });

    // 行が無い（`rev` も無い）ときは、作る側も通す
    it("行がまだ無いときは attribute_not_exists で通す", async () => {
        await run(true);
        expect((puts()[0].input as { ConditionExpression?: string }).ConditionExpression)
            .toContain("attribute_not_exists(id)");
    });

    // **飛ばしたぶんがあれば黙って終わらない。** exit 0 のままだと
    // ログを読まない限り「済んだ」と誤読する
    it("競合したら上書きせずに飛ばし、終了コードで知らせる", async () => {
        responses.putError = Object.assign(new Error("c"), { name: "ConditionalCheckFailedException" });
        process.exitCode = undefined;
        await expect(run(true)).resolves.toBeUndefined();
        expect(process.exitCode, "飛ばしたのに成功として終わっている").toBe(1);
        process.exitCode = undefined;
    });

    it("全部入ったときは 0 で終わる", async () => {
        process.exitCode = undefined;
        await run(true);
        expect(process.exitCode ?? 0).toBe(0);
    });

    it("競合以外の失敗は握らない（静かに終わらせない）", async () => {
        responses.putError = Object.assign(new Error("boom"), { name: "ThrottlingException" });
        await expect(run(true)).rejects.toThrow("boom");
    });

    // **走っている間に入った新しいフォローを消さない**
    it("既にある一覧と併合して書く", async () => {
        responses.get = { [`followers#${T}`]: { list: [B], rev: 1 } };
        await run(true);
        expect((puts()[0].input as { Item?: { list?: string[] } }).Item?.list).toEqual([B, A]);
    });

    it("変わらなければ書かない", async () => {
        responses.get = { [`followers#${T}`]: { list: [A], rev: 1 } };
        await run(true);
        expect(puts(), "同じ内容を書き直している").toHaveLength(0);
    });
});
