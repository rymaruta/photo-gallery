import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 「この写真を見て撮影」（`inspired.ts`）。
 *
 * DynamoDB は**写真の表を Map で模す**（GetItem と、印を立てる条件つきの UpdateItem だけ）。
 * 呼ばれる順番に頼らないので、判定の順序を入れ替えても試験が壊れない。
 * 通知を積む本体（`pushNotification`）は境界として模す——中身（ブロック・プッシュ・
 * 件数の上限）は `notify.test.ts` が見ている。
 */
const table = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const sent = vi.hoisted(() => [] as { name: string; input: Record<string, unknown> }[]);
const failGet = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("../dynamodb", () => ({
    PHOTOS_TABLE: "photos-test",
    ddb: {
        send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            sent.push({ name, input: cmd.input });
            if (name === "PutCommand") {
                const item = cmd.input.Item as Record<string, unknown>;
                // 条件: attribute_not_exists(id)（**式に書いてあるときだけ**効かせる）
                if (String(cmd.input.ConditionExpression ?? "").includes("attribute_not_exists(id)") && table.has(String(item.id))) {
                    throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
                }
                table.set(String(item.id), { ...item });
                return {};
            }
            const id = String((cmd.input.Key as { id: string }).id);
            if (name === "GetCommand") {
                if (failGet.ids.has(id)) throw Object.assign(new Error("boom"), { name: "ProvisionedThroughputExceededException" });
                const it = table.get(id);
                return { Item: it ? { ...it } : undefined };
            }
            if (name === "UpdateCommand") {
                const row = table.get(id);
                // 条件: attribute_exists(id)（写真の行の控え）
                if (!row) {
                    throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
                }
                row.inspiredNotified = (cmd.input.ExpressionAttributeValues as Record<string, unknown>)[":s"];
                return {};
            }
            throw new Error(`想定外の呼び出し: ${name}`);
        }),
    },
}));

const mockPush = vi.hoisted(() => vi.fn(async (owner: string, notif: Record<string, unknown>) => { void owner; void notif; }));
const mockIdentity = vi.hoisted(() => vi.fn(async (uid: string): Promise<{ name?: string; username?: string }> => ({ name: `名前-${uid}`, username: `h_${uid}` })));
vi.mock("../notify", () => ({
    pushNotification: (owner: string, notif: Record<string, unknown>) => mockPush(owner, notif),
    lookupDisplayName: async (uid: string) => `表示名-${uid}`,
    lookupListIdentity: (uid: string) => mockIdentity(uid),
}));

import { sanitizeInspiredBy, isInspiredByClear, readVisibleSource, notifyInspiredOnce, getInspiredSource, summarizeSource, inspiredNotifId } from "../inspired";

const SRC = "aaaaaaaa-1111-4111-8111-111111111111";     // 元の写真（持ち主 alice）
const MINE = "bbbbbbbb-2222-4222-8222-222222222222";    // 付けた写真（持ち主 bob）

/** ブロックの印（`block#<した人>#<された人>`）を立てる */
const block = (blocker: string, blocked: string) => table.set(`block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` });

function seed() {
    table.clear();
    sent.length = 0;
    failGet.ids.clear();
    table.set(SRC, {
        id: SRC, userId: "alice", src: "https://cdn/uploads/alice/a.webp", thumbSrc: "https://cdn/uploads/alice/a-512.webp",
        title: { ja: "朝の湖" }, location: "山中湖", published: true, publicFeed: "1", srcOriginal: "https://cdn/orig.jpg",
    });
    table.set(MINE, {
        id: MINE, userId: "bob", src: "https://cdn/uploads/bob/b.webp", thumbSrc: "https://cdn/uploads/bob/b-512.webp",
        published: true, inspiredBy: SRC,
    });
}

beforeEach(() => {
    seed();
    mockPush.mockClear();
    mockIdentity.mockClear();
});

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (sub: string, id: string): Promise<Res> => (getInspiredSource as any)({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: { id },
});

describe("sanitizeInspiredBy / isInspiredByClear: 値の形", () => {
    it("写真の ID の形だけ通す（前後の空白は落とす）", () => {
        expect(sanitizeInspiredBy(SRC)).toBe(SRC);
        expect(sanitizeInspiredBy(`  ${SRC} `)).toBe(SRC);
    });

    it.each([
        ["# を含む（通知などの文書のキー）", `notifs#alice`],
        ["block の印", `block#alice#bob`],
        ["空白入り", "aaa bbb"],
        ["長すぎる（65文字）", "a".repeat(65)],
        ["空", ""],
        ["数", 123],
        ["配列", [SRC]],
        ["null", null],
        ["パス区切り", "../x"],
    ])("%s は通さない", (_label, v) => {
        expect(sanitizeInspiredBy(v)).toBeUndefined();
    });

    it("外す指定は null と空文字だけ（読めない値で黙って外さない）", () => {
        expect(isInspiredByClear(null)).toBe(true);
        expect(isInspiredByClear("")).toBe(true);
        expect(isInspiredByClear("  ")).toBe(true);
        expect(isInspiredByClear(undefined)).toBe(false);
        expect(isInspiredByClear(0)).toBe(false);
        expect(isInspiredByClear("x#y")).toBe(false);
    });
});

describe("readVisibleSource: 元の写真が公開で見られるか", () => {
    it("公開中の写真は返す", async () => {
        expect((await readVisibleSource(SRC, ["bob"]))?.id).toBe(SRC);
    });

    it.each([
        ["非公開（下書き）", { published: false }],
        ["ストーリー", { story: true }],
        ["フォロワーのみ", { audience: "followers" }],
        ["親しい友達", { audience: "closeFriends" }],
        ["知らない公開範囲（隠す側に倒す）", { audience: "someday" }],
        ["src が無い（写真ではない）", { src: undefined }],
    ])("%s は返さない", async (_label, patch) => {
        table.set(SRC, { ...table.get(SRC)!, ...patch });
        expect(await readVisibleSource(SRC, ["bob"])).toBeNull();
    });

    it("削除された（行が無い）写真は返さない", async () => {
        table.delete(SRC);
        expect(await readVisibleSource(SRC, ["bob"])).toBeNull();
    });

    it("元の作者が相手をブロックしていたら返さない", async () => {
        block("alice", "bob");
        expect(await readVisibleSource(SRC, ["bob"])).toBeNull();
    });

    it("相手が元の作者をブロックしていても返さない（逆向き）", async () => {
        block("bob", "alice");
        expect(await readVisibleSource(SRC, ["bob"])).toBeNull();
    });

    it("並べた人の誰か1人でもブロックの関係なら返さない", async () => {
        block("carol", "alice");
        expect(await readVisibleSource(SRC, ["bob", "carol"])).toBeNull();
        expect(await readVisibleSource(SRC, ["bob"])).not.toBeNull();
    });

    it("持ち主本人はブロックを引かない（自分の写真は付けられる）", async () => {
        const row = await readVisibleSource(SRC, ["alice"]);
        expect(row?.id).toBe(SRC);
        expect(sent.filter((c) => String((c.input.Key as { id: string }).id).startsWith("block#"))).toEqual([]);
    });

    it("形の違う ID は表を引かない", async () => {
        expect(await readVisibleSource("notifs#alice", ["bob"])).toBeNull();
        expect(sent).toEqual([]);
    });

    it("DynamoDB の失敗は投げる（呼び手が「付けない／500」を決める）", async () => {
        failGet.ids.add(SRC);
        await expect(readVisibleSource(SRC, ["bob"])).rejects.toThrow();
    });
});

describe("notifyInspiredOnce: 元の作者への知らせ", () => {
    const photo = () => table.get(MINE) as { id: string; src: string; thumbSrc: string; inspiredNotified?: string };
    const doc = () => table.get(inspiredNotifId(MINE));
    const sourceReads = () => sent.filter((c) => c.name === "GetCommand" && (c.input.Key as { id: string }).id === SRC).length;

    it("元の作者へ inspired を1件積み、印の文書（正）と行の控えを立てる", async () => {
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).toHaveBeenCalledTimes(1);
        const [owner, notif] = mockPush.mock.calls[0];
        expect(owner).toBe("alice");
        expect(notif).toMatchObject({
            type: "inspired", photoId: MINE, photoSrc: "https://cdn/uploads/bob/b-512.webp",
            byName: "表示名-bob", byId: "bob", sourcePhotoId: SRC,
        });
        expect(doc()).toMatchObject({ id: `inspiredNotif#${MINE}`, photoId: MINE, sourceId: SRC, status: "sent" });
        expect(table.get(MINE)!.inspiredNotified).toBe("sent");
        // 印は src を持たない＝写真の一覧には出ない
        expect(doc()!.src).toBeUndefined();
    });

    it("2回目は送らない（行の控えを見て、何も読まない）", async () => {
        await notifyInspiredOnce(photo(), SRC, "bob");
        sent.length = 0;
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(sent, "控えがあるのに読み書きしている").toEqual([]);
    });

    // 🔴 再送の書き直し（`overwriteOwnPhoto` の全置換）が行の控えを消しても、正の文書が止める
    it("行の控えが全置換で消えても、二度目は送らない", async () => {
        await notifyInspiredOnce(photo(), SRC, "bob");
        const row = { ...table.get(MINE)! };
        delete row.inspiredNotified;
        table.set(MINE, row);
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("古い版の印（行に元の写真の ID）がある行には送らない", async () => {
        table.set(MINE, { ...table.get(MINE)!, inspiredNotified: SRC });
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).not.toHaveBeenCalled();
        expect(doc()).toBeUndefined();
    });

    it("元の写真を付け替えても、もう送らない（最初に付いたときだけ）", async () => {
        const other = "cccccccc-3333-4333-8333-333333333333";
        table.set(other, { id: other, userId: "carol", src: "https://cdn/uploads/carol/c.webp", published: true });
        await notifyInspiredOnce(photo(), SRC, "bob");
        const row = { ...table.get(MINE)! };
        delete row.inspiredNotified;   // 控えが無くても文書で止まる
        table.set(MINE, row);
        await notifyInspiredOnce(photo(), other, "bob");
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(mockPush.mock.calls[0][0]).toBe("alice");
    });

    it("同時に2本来ても送るのは1本（文書は無いときだけ書く）", async () => {
        await Promise.all([notifyInspiredOnce(photo(), SRC, "bob"), notifyInspiredOnce(photo(), SRC, "bob")]);
        expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("確かめで読んだ行を渡せば、元の写真を読み直さない", async () => {
        const source = await readVisibleSource(SRC, ["bob"]);
        sent.length = 0;
        await notifyInspiredOnce(photo(), SRC, "bob", source);
        expect(sourceReads()).toBe(0);
        expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("渡された null（見られない）は送らないと決める（読み直さない）", async () => {
        await notifyInspiredOnce(photo(), SRC, "bob", null);
        expect(sourceReads()).toBe(0);
        expect(mockPush).not.toHaveBeenCalled();
        expect(doc()?.status).toBe("skipped");
    });

    it("自分の写真なら送らず、skipped の印を立てる（以後は読まない）", async () => {
        table.set(SRC, { ...table.get(SRC)!, userId: "bob" });
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).not.toHaveBeenCalled();
        expect(doc()?.status).toBe("skipped");
        expect(table.get(MINE)!.inspiredNotified).toBe("skipped");
        sent.length = 0;
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(sent, "送らないと決めた写真を読み直している").toEqual([]);
    });

    it("ブロックの関係なら送らない（どちら向きも）。skipped にするので、外れても送らない", async () => {
        block("alice", "bob");
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(doc()?.status).toBe("skipped");
        table.delete("block#alice#bob");
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush, "ブロックが外れたあとに送っている（決めた仕様は「送らない」）").not.toHaveBeenCalled();

        seed();
        block("bob", "alice");
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).not.toHaveBeenCalled();
        expect(doc()?.status).toBe("skipped");
    });

    it("元の写真が非公開・削除なら送らない", async () => {
        table.set(SRC, { ...table.get(SRC)!, published: false });
        await notifyInspiredOnce(photo(), SRC, "bob");
        seed();
        table.delete(SRC);
        await notifyInspiredOnce(photo(), SRC, "bob");
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("付けた写真が消えていたら、行を作らない", async () => {
        table.delete(MINE);
        await notifyInspiredOnce({ id: MINE, src: "x" }, SRC, "bob");
        expect(table.has(MINE)).toBe(false);
    });

    it("読めなければ投げず、印も立てない（次の機会にもう一度決める）", async () => {
        failGet.ids.add(SRC);
        await expect(notifyInspiredOnce(photo(), SRC, "bob")).resolves.toBeUndefined();
        expect(mockPush).not.toHaveBeenCalled();
        expect(doc()).toBeUndefined();
        expect(table.get(MINE)!.inspiredNotified).toBeUndefined();
    });
});

describe("GET /user/inspired/{id}: 読むときにも確かめる", () => {
    it("元の写真が見られれば要約を返す（全項目は返さない・いまの名前）", async () => {
        const res = await get("carol", MINE);
        expect(res.statusCode).toBe(200);
        expect(res.headers?.["Cache-Control"]).toBe("private, no-store");
        const body = JSON.parse(res.body);
        expect(body.inspiredBy).toEqual({
            id: SRC, title: { ja: "朝の湖" }, src: "https://cdn/uploads/alice/a.webp",
            thumbSrc: "https://cdn/uploads/alice/a-512.webp", location: "山中湖",
            userId: "alice", displayName: "名前-alice", username: "h_alice",
        });
        expect(JSON.stringify(body), "内部の項目を返している").not.toContain("orig.jpg");
    });

    it("付いていなければ null", async () => {
        table.set(MINE, { ...table.get(MINE)!, inspiredBy: undefined });
        expect(JSON.parse((await get("carol", MINE)).body)).toEqual({ inspiredBy: null });
    });

    it.each([
        ["非公開になった", { published: false }],
        ["公開範囲を絞った", { audience: "followers" }],
    ])("元の写真が%s → null", async (_label, patch) => {
        table.set(SRC, { ...table.get(SRC)!, ...patch });
        const res = await get("carol", MINE);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ inspiredBy: null });
    });

    it("元の写真が削除された → null", async () => {
        table.delete(SRC);
        expect(JSON.parse((await get("carol", MINE)).body)).toEqual({ inspiredBy: null });
    });

    it("閲覧者と元の作者がブロックの関係（どちら向きも）→ null", async () => {
        block("alice", "carol");
        expect(JSON.parse((await get("carol", MINE)).body)).toEqual({ inspiredBy: null });
        table.delete("block#alice#carol");
        block("carol", "alice");
        expect(JSON.parse((await get("carol", MINE)).body)).toEqual({ inspiredBy: null });
    });

    it("付けた人と元の作者があとからブロックの関係になった → null（第三者が見ても）", async () => {
        block("alice", "bob");
        expect(JSON.parse((await get("carol", MINE)).body)).toEqual({ inspiredBy: null });
    });

    it("付けた写真が下書きなら本人だけ（他人には 404）", async () => {
        table.set(MINE, { ...table.get(MINE)!, published: false });
        expect((await get("carol", MINE)).statusCode).toBe(404);
        expect(JSON.parse((await get("bob", MINE)).body).inspiredBy?.id).toBe(SRC);
    });

    it("付けた写真が公開範囲を絞った写真で、見せてよい相手でなければ 404", async () => {
        table.set(MINE, { ...table.get(MINE)!, audience: "followers" });
        // フォローの印が無い
        expect((await get("carol", MINE)).statusCode).toBe(404);
        // フォロワーなら読める
        table.set("follow#bob#carol", { id: "follow#bob#carol" });
        expect((await get("carol", MINE)).statusCode).toBe(200);
    });

    it.each([
        ["無い写真", "dddddddd-4444-4444-8444-444444444444"],
        ["写真以外の文書", "notifs#bob"],
    ])("%s は 404", async (_label, id) => {
        expect((await get("carol", id)).statusCode).toBe(404);
    });

    it("ストーリーは 404", async () => {
        table.set(MINE, { ...table.get(MINE)!, story: true });
        expect((await get("carol", MINE)).statusCode).toBe(404);
    });

    it("読めなければ 500（「無い」と言い切らない）", async () => {
        failGet.ids.add(SRC);
        expect((await get("carol", MINE)).statusCode).toBe(500);
    });

    it("読み取りは GetItem だけで、第三者の1表示あたり最大7回", async () => {
        await get("carol", MINE);
        expect(sent.every((c) => c.name === "GetCommand")).toBe(true);
        // 写真1 ＋ 元の写真1 ＋ ブロックの印4（carol↔alice・bob↔alice）。名前は別の関数（1回）
        expect(sent).toHaveLength(6);
        expect(mockIdentity).toHaveBeenCalledTimes(1);
    });

    it("付けた本人が見るときはブロックの印を2回で済ませる", async () => {
        await get("bob", MINE);
        expect(sent).toHaveLength(4);
    });
});

describe("summarizeSource", () => {
    it("小さい画像は 256px → 512px の順で選び、無ければ持たない", () => {
        expect(summarizeSource({ id: "x", src: "s", thumbSm: "t256", thumbSrc: "t512", userId: "u" }, {}).thumbSrc).toBe("t256");
        expect(summarizeSource({ id: "x", src: "s", userId: "u" }, {})).toEqual({ id: "x", src: "s", userId: "u" });
    });

    it("持ち主は userId が無ければ uploadedBy（古い行）", () => {
        expect(summarizeSource({ id: "x", src: "s", uploadedBy: "old" }, {}).userId).toBe("old");
    });
});
