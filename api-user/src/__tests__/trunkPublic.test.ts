import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 人のトランク（`GET /users/{uid}/trunk`）と、見せる設定・わたしの乗車券（`PUT /user/trunk/settings`）。
 * 2026-10-18 owner「トランクはマイページに載せたい。他の人のトランクの中身とか見れたら楽しい」。
 *
 * DynamoDB は `trunk.test.ts` と同じ「中身を持つ作り物」。読んだ命令の種類も数える（Scan・Query をしない）。
 */
type Item = Record<string, unknown>;
const store = vi.hoisted(() => new Map<string, Item>());
const keyOf = (table: string, key: Record<string, unknown>) => `${table}|${String(key.id ?? key.userId)}`;
const fakeSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: fakeSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
const mockListMyPhotos = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({ listMyPhotos: mockListMyPhotos }));
vi.stubEnv("USERS_TABLE", "users-test");

function condHolds(k: string, input: { ConditionExpression?: string; ExpressionAttributeValues?: Item }): boolean {
    const cur = store.get(k);
    const want = input.ExpressionAttributeValues?.[":rev"];
    const cond = input.ConditionExpression ?? "";
    if (!cond) return true;
    return cond.includes("attribute_not_exists(rev)")
        ? !cur || cur.rev === undefined || cur.rev === want
        : cur?.rev === want;
}

async function send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item };
    if (cmd.constructor.name === "GetCommand") {
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (cmd.constructor.name === "TransactWriteCommand") {
        const items = (cmd.input as { TransactItems: { Put?: typeof input; ConditionCheck?: typeof input }[] }).TransactItems;
        const keyed = items.map((t) => {
            const op = (t.Put ?? t.ConditionCheck)! as typeof input & { ConditionExpression?: string; ExpressionAttributeValues?: Item };
            return { op, put: !!t.Put, k: keyOf(op.TableName, (t.Put ? op.Item : op.Key)!) };
        });
        if (keyed.some(({ k, op }) => !condHolds(k, op))) {
            throw Object.assign(new Error("tx"), { name: "TransactionCanceledException" });
        }
        for (const { k, op, put } of keyed) if (put) store.set(k, structuredClone(op.Item!));
        return {};
    }
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}

const T = await import("../trunk");
const { handler, trunkId, grantLabel } = T;

// 人の id は Cognito の sub の形（`isUserId`）
const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

const label = (id: string, over: Record<string, unknown> = {}) => ({
    i: id, k: "p", n: "京都", c: "日本", d: 42, a: 1_790_000_000, ...over,
});

function setProfile(uid: string, p: Item) { store.set(`users-test|${uid}`, { userId: uid, ...p }); }
function setTrunk(uid: string, t: Item) { store.set(`photos-test|${trunkId(uid)}`, { id: trunkId(uid), uid, rev: 1, ...t }); }
function setPhoto(id: string, p: Item) { store.set(`photos-test|${id}`, { id, src: `https://cdn.example.com/${id}.webp`, published: true, ...p }); }
function block(blocker: string, blocked: string) { store.set(`photos-test|block#${blocker}#${blocked}`, { id: `block#${blocker}#${blocked}` }); }
const trunkRow = (uid: string) => store.get(`photos-test|${trunkId(uid)}`) as Item | undefined;

type Res = { statusCode: number; body: string };
async function call(routeKey: string, opts: { uid?: string; body?: unknown; sub?: string } = {}) {
    const ev = {
        routeKey,
        pathParameters: opts.uid ? { uid: opts.uid } : undefined,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? VIEWER } } }, http: { method: routeKey.split(" ")[0] } },
    };
    const res = (await (handler as unknown as (e: unknown) => Promise<Res>)(ev));
    return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown>, raw: res.body };
}
const their = (uid = OWNER, sub = VIEWER) => call("GET /users/{uid}/trunk", { uid, sub });

/** 見せてよい人のトランク一式（Pro・サポーター・メダル・乗車券・部品・硬貨・手持ち） */
function fullOwner() {
    setProfile(OWNER, {
        displayName: "丸田",
        supporter: { active: true, number: 7, since: "2026-01-02T00:00:00.000Z", months: 9, transactionId: "tx-secret" },
        badges: { first: { tier: 1, at: "2026-01-01T00:00:00.000Z" }, bogus: { tier: 1, at: "2026-01-01T00:00:00.000Z" } },
    });
    setPhoto("photo-ticket", { userId: OWNER });
    setTrunk(OWNER, {
        model: "starchart", lastFreeModel: "canvas",
        pocket: [label("pocket-photo-1")],
        stuck: [label("stuck-photo-1", { p: [500, 250, -55], f: 1, s: 0 }), label("stuck-photo-2", { n: "", c: undefined })],
        receiveLabels: false, coins: 12, parts: ["pin.1", "lining.2"], fragments: 3,
        equipped: { pins: ["pin.1"], lining: "lining.2" },
        rerolls: { month: "2026-10", used: 2 },
        pendingReroll: { labelId: "pocket-photo-1", seeds: [1, 2, 3], at: "2026-10-18T00:00:00.000Z" },
        showTrunk: true,
        ticket: { photoId: "photo-ticket", note: "また会いましょう", origin: "", destination: "京都", face: 3, showsFrom: true },
        posts: 42,
    });
}

beforeEach(() => {
    store.clear();
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
});

describe("人のトランク（GET /users/{uid}/trunk）", () => {
    it("見せてよい物だけを返す（型・貼ったラベル・付けた部品・古び方の数・メダル・会員証・乗車券）", async () => {
        fullOwner();
        const r = await their();
        expect(r.status).toBe(200);
        expect(Object.keys(r.json).sort()).toEqual(["equipped", "inside", "model", "posts", "stuck", "userId"]);
        expect(r.json.userId).toBe(OWNER);
        expect(r.json.model).toBe("starchart");
        expect(r.json.posts).toBe(42);
        const stuck = r.json.stuck as Record<string, unknown>[];
        expect(stuck).toHaveLength(2);
        expect(stuck[0]).toMatchObject({
            kind: "place", place: { name: "京都", country: "日本" }, season: "spring", seed: 42, foil: true,
            pos: { x: 0.5, y: 0.25, rot: -5.5 }, where: { location: "京都" },
        });
        // 日付だけ（時刻は出さない）
        expect(stuck[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // 土地の名前が空なら手がかりは無い
        expect(stuck[1].where).toBeNull();
        expect(r.json.equipped).toMatchObject({ pins: ["pin.1"], lining: "lining.2", handle: null });
        const inside = r.json.inside as Record<string, unknown>;
        expect(Object.keys(inside).sort()).toEqual(["badges", "card", "ticket"]);
        // メダルは公開プロフィールと同じ整え方（知らない鍵は落とす）
        expect(inside.badges).toEqual({ first: { tier: 1, at: "2026-01-01T00:00:00.000Z" } });
        expect(inside.card).toEqual({ pro: true });
        expect(inside.ticket).toEqual({
            photoId: "photo-ticket", note: "また会いましょう", origin: "", destination: "京都", face: 3, showsFrom: true,
        });
    });

    it("返さない欄が本当に無い（硬貨・手持ち・数・部品箱・かけら・番号・始めた年月・写真の id・受け取った乗車券）", async () => {
        fullOwner();
        const r = await their();
        for (const k of ["coins", "pocket", "limit", "isPro", "rerolls", "pendingReroll", "receiveLabels", "parts",
            "fragments", "effectiveModel", "showTrunk", "ticket", "labels", "count", "newLabels", "encounters", "received"]) {
            expect(r.json, k).not.toHaveProperty(k);
        }
        // サポーター証の番号・始めた年月・月数・取引は、どこにも出さない
        expect(r.raw).not.toContain("tx-secret");
        expect(r.raw).not.toContain("2026-01-02");
        expect(r.raw).not.toMatch(/"number"|"since"|"months"/);
        // ラベルの写真の id（＝写真の id）は出さない。手持ちのラベルも出さない
        expect(r.raw).not.toContain("stuck-photo-1");
        expect(r.raw).not.toContain("pocket-photo-1");
        const ids = (r.json.stuck as { id: string }[]).map((l) => l.id);
        expect(ids.every((id) => /^t[0-9a-f]{12}$/.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect((r.json.stuck as Item[]).every((l) => !("photoId" in l) && !("groupId" in l))).toBe(true);
        // 硬貨の数 12・手持ちの数・かけら 3 が値として紛れていない（数は返さない）
        expect(r.raw).not.toMatch(/"coins"|"fragments"|"pocket"/);
    });

    it("読みは GetItem だけ（Scan・Query をしない・人の写真の一覧も台帳の行も読まない）", async () => {
        fullOwner();
        await their();
        const names = fakeSend.mock.calls.map((c) => c[0].constructor.name);
        expect(names.every((n) => n === "GetCommand")).toBe(true);
        // プロフィール・トランク・ブロックの印2つ・乗車券の写真
        expect(names).toHaveLength(5);
        expect(mockListMyPhotos).not.toHaveBeenCalled();
        const keys = fakeSend.mock.calls.map((c) => String((c[0].input as { Key: Item }).Key.id ?? ""));
        expect(keys.some((k) => k.startsWith("trunkledger#"))).toBe(false);
        // 書かない
        expect(trunkRow(OWNER)?.rev).toBe(1);
    });

    it("見せない設定（showTrunk: false）は 404。本人が読めば見える（人からの見え方を確かめられる）", async () => {
        fullOwner();
        setTrunk(OWNER, { ...trunkRow(OWNER), showTrunk: false });
        const r = await their();
        expect(r.status).toBe(404);
        expect(r.json).toEqual({ error: "見つかりません", code: "notFound" });
        const self = await their(OWNER, OWNER);
        expect(self.status).toBe(200);
        expect(self.json.model).toBe("starchart");
        expect(self.json).not.toHaveProperty("coins");
    });

    it("ブロックした人・ブロックされた人には 404（どちら向きでも・見せない設定と同じ答え）", async () => {
        fullOwner();
        block(VIEWER, OWNER);
        const a = await their();
        store.delete(`photos-test|block#${VIEWER}#${OWNER}`);
        block(OWNER, VIEWER);
        const b = await their();
        expect([a.status, b.status]).toEqual([404, 404]);
        expect(a.raw).toBe(b.raw);
        store.delete(`photos-test|block#${OWNER}#${VIEWER}`);
        expect((await their()).status).toBe(200);
    });

    it("退会した人（墓石・プロフィールが無い）は 404", async () => {
        fullOwner();
        setProfile(OWNER, { deletedAt: "2026-10-18T00:00:00.000Z" });
        expect((await their()).status).toBe(404);
        store.delete(`users-test|${OWNER}`);
        expect((await their()).status).toBe(404);
    });

    it("トランクの行がまだ無い人は 404（区別しない）・人の id の形でなければ 404", async () => {
        setProfile(OWNER, {});
        const none = await their();
        expect(none.status).toBe(404);
        const bad = await their("trunk#x");
        expect(bad.status).toBe(404);
        expect(none.raw).toBe(bad.raw);
        expect(trunkRow(OWNER)).toBeUndefined();
    });

    it("乗車券: 置いたあとで非公開・削除・公開範囲を絞った・ほかの人の写真なら出さない", async () => {
        fullOwner();
        const ticketOf = async () => ((await their()).json.inside as Item).ticket;
        setPhoto("photo-ticket", { userId: OWNER, published: false });
        expect(await ticketOf()).toBeNull();
        setPhoto("photo-ticket", { userId: OWNER, audience: "followers" });
        expect(await ticketOf()).toBeNull();
        setPhoto("photo-ticket", { userId: VIEWER });
        expect(await ticketOf()).toBeNull();
        store.delete("photos-test|photo-ticket");
        expect(await ticketOf()).toBeNull();
        setPhoto("photo-ticket", { userId: OWNER });
        expect(await ticketOf()).not.toBeNull();
    });

    it("Pro をやめた人: 型は最後の無料の型・特別な券面はマルス券（0）・会員証は pro: false で残る", async () => {
        fullOwner();
        setProfile(OWNER, { supporter: { active: false, number: 7, since: "2026-01-02T00:00:00.000Z" } });
        const r = await their();
        expect(r.json.model).toBe("canvas");
        expect(((r.json.inside as Item).ticket as Item).face).toBe(0);
        expect((r.json.inside as Item).card).toEqual({ pro: false });
        // サポーター番号を持たない人は会員証そのものが無い
        setProfile(OWNER, {});
        const free = await their();
        expect((free.json.inside as Item).card).toBeNull();
        expect((free.json.inside as Item).badges).toEqual({});
    });

    it("古び方の数の控えが無い行は posts を出さない", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [label("x")] });
        const r = await their();
        expect(r.status).toBe(200);
        expect(r.json).not.toHaveProperty("posts");
    });
});

describe("古び方の数の控え（posts）", () => {
    const pub = (id: string) => ({ id, src: `https://cdn.example.com/${id}.webp`, userId: OWNER, published: true });

    it("本人が GET /user/trunk を開くと控えを書く。数が同じなら書かない・行が無ければ作らない", async () => {
        setProfile(OWNER, {});
        mockListMyPhotos.mockResolvedValue([pub("a"), pub("b")]);
        await call("GET /user/trunk", { sub: OWNER });
        expect(trunkRow(OWNER)).toBeUndefined();
        setTrunk(OWNER, { stuck: [] });
        expect((await call("GET /user/trunk", { sub: OWNER })).json.posts).toBe(2);
        expect(trunkRow(OWNER)?.posts).toBe(2);
        const rev = trunkRow(OWNER)?.rev;
        await call("GET /user/trunk", { sub: OWNER });
        expect(trunkRow(OWNER)?.rev).toBe(rev);
        expect((await their()).json.posts).toBe(2);
    });

    it("投稿して配ったとき（grantLabel）にも控えを書く（この投稿を足した数）", async () => {
        setProfile(OWNER, {});
        mockListMyPhotos.mockResolvedValue([pub("a")]);
        await grantLabel(OWNER, pub("b") as never);
        expect(trunkRow(OWNER)?.posts).toBe(2);
    });
});

describe("見せる設定と乗車券（PUT /user/trunk/settings）", () => {
    const put = (body: unknown) => call("PUT /user/trunk/settings", { body, sub: OWNER });

    it("showTrunk の既定は true。false にすると人の口が 404、戻すと見える（rev 条件で書く）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [] });
        expect((await call("GET /user/trunk", { sub: OWNER })).json.showTrunk).toBe(true);
        const before = trunkRow(OWNER)?.rev as number;
        const off = await put({ showTrunk: false });
        expect(off.status).toBe(200);
        expect(off.json.showTrunk).toBe(false);
        expect(trunkRow(OWNER)?.showTrunk).toBe(false);
        expect(trunkRow(OWNER)?.rev).toBe(before + 1);
        expect((await their()).status).toBe(404);
        await put({ showTrunk: true });
        expect((await their()).status).toBe(200);
        // 同じ値なら書かない
        const rev = trunkRow(OWNER)?.rev;
        await put({ showTrunk: true });
        expect(trunkRow(OWNER)?.rev).toBe(rev);
    });

    it("真偽でない・知っている項目が1つも無いなら 400。受け取りの設定は今までどおり・一緒に送れる", async () => {
        setProfile(OWNER, {});
        expect((await put({ showTrunk: "no" })).status).toBe(400);
        expect((await put({})).status).toBe(400);
        expect((await put({ other: 1 })).status).toBe(400);
        const both = await put({ receiveLabels: false, showTrunk: false });
        expect([both.json.receiveLabels, both.json.showTrunk]).toEqual([false, false]);
        // 片方だけ送ると、もう片方は変えない
        const one = await put({ receiveLabels: true });
        expect([one.json.receiveLabels, one.json.showTrunk]).toEqual([true, false]);
    });

    it("乗車券は本人の公開写真だけ置ける（下書き・ほかの人の写真・無い写真は 409）。null で外す", async () => {
        setProfile(OWNER, {});
        setPhoto("mine", { userId: OWNER });
        setPhoto("draft", { userId: OWNER, published: false });
        setPhoto("theirs", { userId: VIEWER });
        for (const id of ["draft", "theirs", "nothing"]) {
            const r = await put({ ticket: { photoId: id } });
            expect([id, r.status, r.json.code]).toEqual([id, 409, "ticketNotPublic"]);
        }
        const ok = await put({ ticket: { photoId: "mine", note: "  こんにちは\n ", destination: "京都", face: 1 } });
        expect(ok.status).toBe(200);
        expect(ok.json.ticket).toEqual({ photoId: "mine", note: "こんにちは", origin: "", destination: "京都", face: 1, showsFrom: true });
        expect(trunkRow(OWNER)?.ticket).toEqual(ok.json.ticket);
        const off = await put({ ticket: null });
        expect(off.json.ticket).toBeNull();
        expect(trunkRow(OWNER)).not.toHaveProperty("ticket");
    });

    it("乗車券の形が違えば 400（字の上限は iOS と同じ: ひとこと20字・区間6字。切り詰めない）", async () => {
        setProfile(OWNER, {});
        setPhoto("mine", { userId: OWNER });
        for (const ticket of [
            "mine", [], { photoId: "a#b" }, { photoId: "mine", note: "あ".repeat(21) },
            { photoId: "mine", origin: "1234567" }, { photoId: "mine", face: 256 }, { photoId: "mine", face: 1.5 },
            { photoId: "mine", showsFrom: "yes" }, { photoId: "mine", note: 3 },
        ]) {
            const r = await put({ ticket });
            expect([JSON.stringify(ticket), r.status]).toEqual([JSON.stringify(ticket), 400]);
        }
        expect((await put({ ticket: { photoId: "mine", note: "あ".repeat(20), origin: "123456" } })).status).toBe(200);
    });
});
