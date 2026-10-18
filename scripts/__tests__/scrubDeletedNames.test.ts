import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 退会した人の名前の写しを伏せる台本（`scripts/scrub-deleted-names.js`・札 #295）。
 *
 * **本番データを書き換える側**なので、`main()` の挙動まで固定する:
 *   - 読むだけでは1行も書かない
 *   - `--apply` で退会者の写しだけ伏せる（同じ文書の生きている人の要素には書かない）
 *   - 生きている人しか居ない行には書き込みを1本も出さない
 *   - 読んでから書くまでに番地がずれた・墓石が戻された回は書かない
 *
 * 偽の DynamoDB は**条件と SET を実際に評価する**（台本が出す形
 * `#i[3].#n = :m`・`#v.#k0.#n = :m`・`#i[3].#u = :u0`・`attribute_exists(#v.#k0)`・
 * `attribute_type(deletedAt, :s)` だけを解く）。式の文字列を眺めるだけのテストだと、
 * 番地を取り違えても緑になる。
 */

type Item = Record<string, unknown>;
class Cmd { input: Record<string, unknown>; constructor(i: Record<string, unknown>) { this.input = i; } }
const lib = {
    ScanCommand: class ScanCommand extends Cmd { },
    TransactWriteCommand: class TransactWriteCommand extends Cmd { },
};

const PHOTOS = "test-photos";
const USERS = "test-users";

/** 偽の表。`photos` は id → 行、`users` は userId → 行 */
let photos: Map<string, Item>;
let users: Map<string, Item>;
let sent: { name: string; input: Record<string, unknown> }[];
/** 書き込みの直前に表をいじる（読んでから書くまでの間の、別の書き込み） */
let beforeWrite: (() => void) | null;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Seg = string | number;
/** `#i[3].#n` / `#v.#k0.#n` を属性の道に直す */
function parsePath(expr: string, names: Record<string, string>): Seg[] {
    const out: Seg[] = [];
    for (const part of expr.trim().split(".")) {
        const m = /^(#\w+)((?:\[\d+\])*)$/.exec(part);
        if (!m) throw new Error(`解けない道: ${expr}`);
        if (!(m[1] in names)) throw new Error(`名前が無い: ${m[1]}`);
        out.push(names[m[1]]);
        for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
    }
    return out;
}
function getPath(item: Item, path: Seg[]): unknown {
    let cur: unknown = item;
    for (const s of path) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string | number, unknown>)[s];
    }
    return cur;
}
function setPath(item: Item, path: Seg[], value: unknown): void {
    let cur: unknown = item;
    for (const s of path.slice(0, -1)) {
        const next = (cur as Record<string | number, unknown>)[s];
        // DynamoDB も道の途中が無ければ ValidationException
        if (next === null || typeof next !== "object") throw Object.assign(new Error("道の途中が無い"), { name: "ValidationException" });
        cur = next;
    }
    (cur as Record<string | number, unknown>)[path[path.length - 1]] = value;
}
function evalCond(item: Item | undefined, expr: string, names: Record<string, string>, values: Record<string, unknown>): boolean {
    return expr.split(" AND ").every((c) => {
        c = c.trim();
        let m = /^attribute_exists\((.+)\)$/.exec(c);
        if (m) return item !== undefined && getPath(item, parsePath(m[1], names)) !== undefined;
        m = /^attribute_type\((\w+), (:\w+)\)$/.exec(c);
        if (m) return item !== undefined && values[m[2]] === "S" && typeof item[m[1]] === "string";
        m = /^(.+) = (:\w+)$/.exec(c);
        if (m) return item !== undefined && getPath(item, parsePath(m[1], names)) === values[m[2]];
        throw new Error(`解けない条件: ${c}`);
    });
}

const ddb = {
    send: async (cmd: Cmd) => {
        const name = cmd.constructor.name;
        sent.push({ name, input: clone(cmd.input) });
        if (name === "ScanCommand") {
            const table = cmd.input.TableName === USERS ? users : photos;
            const all = [...table.values()].map(clone);
            const rows = cmd.input.TableName === USERS
                ? all.filter((u) => typeof u.deletedAt === "string")
                : all.filter((r) => /^(comments|storyreplies|notifs)#/.test(String(r.id)) || r.viewers !== undefined);
            return { Items: rows, ScannedCount: all.length, ConsumedCapacity: { CapacityUnits: 1 } };
        }
        if (name === "TransactWriteCommand") {
            beforeWrite?.();
            const tx = cmd.input.TransactItems as Record<string, Record<string, unknown>>[];
            // まず全部の条件を見る（1つでも外れたら何も書かない＝トランザクション）
            for (const t of tx) {
                const op = (t.ConditionCheck ?? t.Update) as {
                    TableName: string; Key: Record<string, string>; ConditionExpression: string;
                    ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown>;
                };
                const row = op.TableName === USERS ? users.get(op.Key.userId) : photos.get(op.Key.id);
                if (!evalCond(row, op.ConditionExpression, op.ExpressionAttributeNames ?? {}, op.ExpressionAttributeValues ?? {})) {
                    throw Object.assign(new Error("canceled"), { name: "TransactionCanceledException" });
                }
            }
            for (const t of tx) {
                if (!t.Update) continue;
                const op = t.Update as {
                    TableName: string; Key: { id: string }; UpdateExpression: string;
                    ExpressionAttributeNames: Record<string, string>; ExpressionAttributeValues: Record<string, unknown>;
                };
                expect(op.TableName).toBe(PHOTOS);
                const row = photos.get(op.Key.id)!;
                const body = op.UpdateExpression.replace(/^SET /, "");
                for (const a of body.split(", ")) {
                    const [lhs, rhs] = a.split(" = ");
                    setPath(row, parsePath(lhs, op.ExpressionAttributeNames), op.ExpressionAttributeValues[rhs.trim()]);
                }
            }
            return {};
        }
        throw new Error(`想定外の呼び出し: ${name}`);
    },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const scrub = require("../scrub-deleted-names.js");
const { main, findScrubs, DELETED_USER_NAME, MAX_ENTRIES_PER_WRITE } = scrub;

const GONE = "gone-1111";
const GONE2 = "gone-2222";
const ALIVE = "alive-3333";
const ALIVE2 = "alive-4444";

const writes = () => sent.filter((c) => c.name === "TransactWriteCommand");
const originalArgv = process.argv;

function seed() {
    users = new Map<string, Item>([
        [GONE, { userId: GONE, deletedAt: "2026-01-01T00:00:00Z", ttl: 1798761600, username: "gone_handle" }],
        [GONE2, { userId: GONE2, deletedAt: "2026-02-01T00:00:00Z", ttl: 1801440000 }],
        [ALIVE, { userId: ALIVE, displayName: "生きている人", username: "alive" }],
        [ALIVE2, { userId: ALIVE2, displayName: "もう一人" }],
        // ハンドルの予約の行（deletedAt を持たない）
        ["username#alive", { userId: "username#alive", ownerId: ALIVE }],
    ]);
    photos = new Map<string, Item>([
        ["comments#p1", { id: "comments#p1", photoId: "p1", items: [
            { id: "c1", uid: ALIVE, name: "生きている人", text: "a", t: "1" },
            { id: "c2", uid: GONE, name: "退会前の実名", text: "b", t: "2" },
            { id: "c3", uid: ALIVE2, name: "もう一人", text: "c", t: "3" },
            { id: "c4", uid: GONE, name: "退会前の実名", text: "d", t: "4" },
        ] }],
        // 生きている人しか居ない文書
        ["comments#p2", { id: "comments#p2", items: [{ id: "c5", uid: ALIVE, name: "生きている人", text: "x", t: "5" }] }],
        ["notifs#" + ALIVE, { id: "notifs#" + ALIVE, uid: ALIVE, unread: 2, items: [
            { type: "like", photoId: "p9", photoSrc: "s", byName: "退会前の実名", byId: GONE, t: "9" },
            { type: "badge", photoId: "", photoSrc: "", byName: "朝の光（銀）", key: "k", tier: 2, t: "8" },
            { type: "follow", photoId: "", photoSrc: "", byName: "もう一人", byId: ALIVE2, t: "7" },
        ] }],
        ["storyreplies#s1", { id: "storyreplies#s1", items: [
            { id: "r1", uid: GONE2, name: "二人目の実名", emoji: "❤️", t: "1" },
            { id: "r2", uid: ALIVE, name: "生きている人", text: "hi", t: "2" },
        ] }],
        ["s1", { id: "s1", story: true, userId: ALIVE, viewers: {
            [GONE]: { displayName: "退会前の実名", at: "1" },
            [ALIVE2]: { displayName: "もう一人", at: "2" },
        } }],
        // 写しを持たない行（写真）
        ["p1", { id: "p1", userId: ALIVE, displayName: "生きている人", src: "x" }],
    ]);
}

beforeEach(() => {
    sent = [];
    beforeWrite = null;
    seed();
    process.env.PHOTOS_TABLE = PHOTOS;
    process.env.USERS_TABLE = USERS;
    process.argv = ["node", "scrub-deleted-names.js"];
    vi.spyOn(console, "log").mockImplementation(() => { });
    vi.spyOn(console, "error").mockImplementation(() => { });
});
afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

const logs = () => (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");

describe("伏せの文字列", () => {
    it("api-user/src/notify.ts の DELETED_USER_NAME と同じ", () => {
        const src = readFileSync(join(__dirname, "..", "..", "api-user", "src", "notify.ts"), "utf8");
        const m = /export const DELETED_USER_NAME = "([^"]+)"/.exec(src);
        expect(m?.[1]).toBe(DELETED_USER_NAME);
    });
});

describe("読むだけ（既定）", () => {
    it("1行も書かない。件数と量は出す", async () => {
        const before = clone([...photos.entries()]);
        await main({ ddb, lib });
        expect(writes(), "読むだけの回に書き込みを出している").toHaveLength(0);
        expect([...photos.entries()]).toEqual(before);
        const out = logs();
        expect(out).toMatch(/墓石（退会者） 2 人/);
        expect(out).toMatch(/コメント\s+comments#…\s+1 行 \/ 2 件/);
        expect(out).toMatch(/ストーリー返信\s+storyreplies#…\s+1 行 \/ 1 件/);
        expect(out).toMatch(/通知\s+notifs#…\s+1 行 \/ 1 件/);
        expect(out).toMatch(/閲覧者\s+viewers\s+1 行 \/ 1 件/);
        expect(out).toMatch(/書き込み: トランザクション 4 回/);
        expect(out).toMatch(/1行も書いていません/);
    });
});

describe("--apply", () => {
    beforeEach(() => { process.argv = ["node", "scrub-deleted-names.js", "--apply"]; });

    it("退会者の写しだけ伏せ、生きている人の要素は1文字も変えない", async () => {
        await main({ ddb, lib });
        const c = photos.get("comments#p1")!.items as Item[];
        expect(c[1]).toMatchObject({ uid: GONE, name: DELETED_USER_NAME, deleted: true, text: "b" });
        expect(c[3]).toMatchObject({ uid: GONE, name: DELETED_USER_NAME, deleted: true });
        expect(c[0]).toEqual({ id: "c1", uid: ALIVE, name: "生きている人", text: "a", t: "1" });
        expect(c[2]).toEqual({ id: "c3", uid: ALIVE2, name: "もう一人", text: "c", t: "3" });

        const n = photos.get("notifs#" + ALIVE)!.items as Item[];
        expect(n[0]).toMatchObject({ byId: GONE, byName: DELETED_USER_NAME, deleted: true });
        // メダルの通知（byId を持たない）と生きている人の通知はそのまま
        expect(n[1]).toEqual({ type: "badge", photoId: "", photoSrc: "", byName: "朝の光（銀）", key: "k", tier: 2, t: "8" });
        expect(n[2]).toEqual({ type: "follow", photoId: "", photoSrc: "", byName: "もう一人", byId: ALIVE2, t: "7" });

        const r = photos.get("storyreplies#s1")!.items as Item[];
        expect(r[0]).toMatchObject({ uid: GONE2, name: DELETED_USER_NAME, deleted: true, emoji: "❤️" });
        expect(r[1]).toEqual({ id: "r2", uid: ALIVE, name: "生きている人", text: "hi", t: "2" });

        const v = photos.get("s1")!.viewers as Record<string, Item>;
        expect(v[GONE]).toEqual({ displayName: DELETED_USER_NAME, deleted: true, at: "1" });
        expect(v[ALIVE2]).toEqual({ displayName: "もう一人", at: "2" });

        expect(process.exitCode).toBeUndefined();
    });

    it("生きている人しか居ない行・写しを持たない行には書き込みを出さない", async () => {
        await main({ ddb, lib });
        const keys = writes().flatMap((w) => (w.input.TransactItems as Record<string, { Key: { id?: string } }>[])
            .filter((t) => t.Update).map((t) => t.Update.Key.id));
        expect(keys.sort()).toEqual(["comments#p1", "notifs#" + ALIVE, "s1", "storyreplies#s1"].sort());
        expect(photos.get("comments#p2")).toEqual({ id: "comments#p2", items: [{ id: "c5", uid: ALIVE, name: "生きている人", text: "x", t: "5" }] });
        // users テーブルには書かない（確かめるだけ）
        for (const w of writes()) {
            for (const t of w.input.TransactItems as Record<string, { TableName: string; Key: { userId?: string } }>[]) {
                if (t.ConditionCheck) expect([GONE, GONE2]).toContain(t.ConditionCheck.Key.userId);
                if (t.Update) expect(t.Update.TableName).toBe(PHOTOS);
            }
        }
    });

    it("もう一度流しても何も書かない（伏せ済みは数えない）", async () => {
        await main({ ddb, lib });
        sent = [];
        await main({ ddb, lib });
        expect(writes()).toHaveLength(0);
    });

    it("読んでから書くまでに通知が先頭へ積まれて番地がずれたら、生きている人の要素は書かずに飛ばす", async () => {
        beforeWrite = () => {
            const row = photos.get("notifs#" + ALIVE)!;
            const items = row.items as Item[];
            // 先頭に生きている人の通知が1件積まれた（番地 0 が別人になる）
            if (items[0].byId === GONE) items.unshift({ type: "like", photoId: "p8", photoSrc: "s", byName: "もう一人", byId: ALIVE2, t: "10" });
        };
        await main({ ddb, lib });
        const n = photos.get("notifs#" + ALIVE)!.items as Item[];
        expect(n[0], "ずれた番地の生きている人の通知を書き換えた").toEqual({ type: "like", photoId: "p8", photoSrc: "s", byName: "もう一人", byId: ALIVE2, t: "10" });
        expect(n[1].byName, "飛ばした回はまだ伏せていない（もう一度流すと入る）").toBe("退会前の実名");
        expect(process.exitCode).toBe(1);

        // もう一度流すと読み直して入る
        beforeWrite = null;
        process.exitCode = undefined;
        await main({ ddb, lib });
        const n2 = photos.get("notifs#" + ALIVE)!.items as Item[];
        expect(n2[1]).toMatchObject({ byId: GONE, byName: DELETED_USER_NAME, deleted: true });
        expect(n2[0].byName).toBe("もう一人");
    });

    it("読んだあとに墓石が戻された（restore-account）人の写しは書かない", async () => {
        beforeWrite = () => { users.set(GONE, { userId: GONE, displayName: "戻った人" }); };
        await main({ ddb, lib });
        const c = photos.get("comments#p1")!.items as Item[];
        expect(c[1].name).toBe("退会前の実名");
        // 墓石の在る二人目は入る
        expect((photos.get("storyreplies#s1")!.items as Item[])[0].name).toBe(DELETED_USER_NAME);
        expect(process.exitCode).toBe(1);
    });

    it("写しの多い文書は分けて書く（式とトランザクションの上限を超えない）", async () => {
        const many = Array.from({ length: MAX_ENTRIES_PER_WRITE * 2 + 5 }, (_, i) => (
            { id: `m${i}`, uid: i % 2 === 0 ? GONE : ALIVE, name: i % 2 === 0 ? "退会前の実名" : "生きている人", text: "t", t: String(i) }));
        photos = new Map([["comments#big", { id: "comments#big", items: many }]]);
        await main({ ddb, lib });
        const items = photos.get("comments#big")!.items as Item[];
        items.forEach((it, i) => {
            if (i % 2 === 0) expect(it.name).toBe(DELETED_USER_NAME);
            else expect(it).toEqual(many[i]);
        });
        for (const w of writes()) {
            const tx = w.input.TransactItems as Record<string, { UpdateExpression?: string }>[];
            expect(tx.length).toBeLessThanOrEqual(100);
            const upd = tx.find((t) => t.Update)!.Update.UpdateExpression!;
            expect(Buffer.byteLength(upd, "utf8")).toBeLessThan(4096);
        }
    });
});

describe("findScrubs", () => {
    it("退会者の集合に無い uid は拾わない（墓石の無い人は生きている扱い）", () => {
        const item = { id: "comments#x", items: [{ uid: ALIVE, name: "a" }, { uid: GONE, name: "b" }] };
        expect(findScrubs(item, new Set([GONE]))).toEqual([{ index: 1, uid: GONE }]);
        expect(findScrubs(item, new Set())).toEqual([]);
    });
    it("対象外の行（写真・フォローの行）は拾わない", () => {
        expect(findScrubs({ id: "p1", userId: GONE, displayName: "x" }, new Set([GONE]))).toEqual([]);
        expect(findScrubs({ id: `followers#${ALIVE}`, list: [GONE] }, new Set([GONE]))).toEqual([]);
    });
});
