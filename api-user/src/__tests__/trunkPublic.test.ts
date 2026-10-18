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
        stuck: [label("stuck-photo-1", { p: [500, 250, -55], f: 1, s: 0, o: 1 }), label("stuck-photo-2", { n: "", c: undefined })],
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
        // id は返答の中の番号（貼った古い順）。写真の id からは計算できない
        expect(ids).toEqual(["s1", "s0"]);
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

    // 2026-10-18（journey.photo-ios #296・プロフィール担当）: Pro の章を公開プロフィールから隠している人は、
    // 中身（inside）でも Pro のメダルと会員証を出さない。自分を読んだときも人からの見え方なので落とす
    it("Pro の章を隠している人: Pro のメダルを落とし、会員証は null。ほかのメダル・券面はそのまま（自分を読んでも同じ）", async () => {
        fullOwner();
        const AT = "2026-01-01T00:00:00.000Z";
        setProfile(OWNER, {
            supporter: { active: true, number: 7, since: "2026-01-02T00:00:00.000Z", months: 9 },
            badges: { first: { tier: 1, at: AT }, supporter: { tier: 1, at: AT }, supporterYear: { tier: 1, at: AT }, proAutumn2026: { tier: 1, at: AT } },
            proBadgesHidden: true,
        });
        for (const sub of [VIEWER, OWNER]) {
            fakeSend.mockClear();
            const r = await their(OWNER, sub);
            expect(r.status).toBe(200);
            const inside = r.json.inside as Item;
            expect(inside.badges).toEqual({ first: { tier: 1, at: AT } });
            expect(inside.card).toBeNull();
            // 乗車券の券面（いま Pro か）は公開プロフィールの passFace と同じく残す
            expect((inside.ticket as Item).face).toBe(3);
            // 射影に proBadgesHidden が入っている（無いと本物の DynamoDB では常に「出す」に倒れる）
            const get = fakeSend.mock.calls.map((c) => (c[0] as { input: Item }).input)
                .find((i) => i.TableName === "users-test" && (i.Key as Item)?.userId === OWNER);
            expect(String(get?.ProjectionExpression)).toContain("proBadgesHidden");
        }
        // 隠していなければ今までどおり
        setProfile(OWNER, {
            supporter: { active: true, number: 7, since: "2026-01-02T00:00:00.000Z", months: 9 },
            badges: { first: { tier: 1, at: AT }, proAutumn2026: { tier: 1, at: AT } },
        });
        const shown = await their();
        expect(Object.keys((shown.json.inside as Item).badges as Item).sort()).toEqual(["first", "proAutumn2026"]);
        expect((shown.json.inside as Item).card).toEqual({ pro: true });
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

describe("確かめた物だけ見せる: 地名を見せてよい印 placeOk（2026-10-18 coordinator 判断）", () => {
    const { revokeLabelQuietly, refreshLabelPlaceQuietly, grantLabelForPhotoQuietly } = T;
    const OLD = "2026-01-01T00:00:00.000Z";   // 24時間を過ぎている（取り消されない）
    const NEW = "2026-10-18T00:00:00.000Z";   // 機能を出した日より後
    const row = (id: string, over: Item = {}) => ({
        id, userId: OWNER, src: `https://cdn.example.com/${id}.webp`, published: true, location: "京都, Kyoto",
        createdAt: OLD, firstPublishedAt: OLD, ...over,
    });
    const okLabel = (id: string, over: Record<string, unknown> = {}) => label(id, { l: "Kyoto", o: 1, ...over });
    const theirStuck = async () => (await their()).json.stuck as Item[];
    const ownStuck = async () => (await call("GET /user/trunk", { sub: OWNER })).json.stuck as Item[];
    const expectHidden = async () => {
        const r = await their();
        const [l] = r.json.stuck as Item[];
        // 伏せたラベルは地名・日付・季節・時刻・節目を落とし、伏せた印そのものも出さない（地名がもともと空のラベルと同じ形）
        expect(l.place).toEqual({ name: "" });
        expect(l.where).toBeNull();
        for (const k of ["at", "season", "timeslot", "milestone", "placeHidden"]) expect(l, k).not.toHaveProperty(k);
        expect(r.raw).not.toContain("京都");
        expect(r.raw).not.toContain("Kyoto");
        expect(r.raw).not.toContain("日本");
        return l;
    };
    const expectShown = async () => {
        const [l] = await theirStuck();
        expect(l.place).toEqual({ name: "京都", latin: "Kyoto", country: "日本" });
        expect(l.where).toEqual({ location: "京都" });
        expect(l.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    };
    /** 手持ちに届いたラベルを貼る（人の口に出るのは貼ったものだけ） */
    const stickAll = async () => {
        const t = trunkRow(OWNER)!;
        setTrunk(OWNER, { ...t, stuck: [...((t.pocket as Item[]) ?? []), ...((t.stuck as Item[]) ?? [])], pocket: [] });
    };

    it("印の無いラベル（本番にもう在るラベル）は、人には地名を伏せる。kind・seed は残す。自分には全部見える", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [label("ph1", { l: "Kyoto", m: "firstCountry", k: "m" })], pocket: [] });
        const l = await expectHidden();
        expect(l).toMatchObject({ kind: "milestone", seed: 42 });
        const [own] = await ownStuck();
        expect(own.place).toEqual({ name: "京都", latin: "Kyoto", country: "日本" });
        expect(own).not.toHaveProperty("placeOk");
    });

    it("誰にでも見える公開の写真から配ったラベルにだけ印が付き、人に地名が出る", async () => {
        setProfile(OWNER, {});
        // 印を付けたあとに写真を読み直して確かめるので、写真の行も置く
        setPhoto("ph1", row("ph1", { createdAt: NEW }));
        await grantLabel(OWNER, row("ph1", { createdAt: NEW }) as never);
        await stickAll();
        await expectShown();
        expect(((await ownStuck())[0]).placeOk).toBe(true);
    });

    it("【1】絞った写真（closeFriends・フォロワー限定）から配ったラベルは印が無い＝地名は人に出ない", async () => {
        for (const audience of ["closeFriends", "followers"]) {
            store.clear();
            setProfile(OWNER, {});
            await grantLabel(OWNER, row("ph1", { createdAt: NEW, audience }) as never);
            await stickAll();
            await expectHidden();
        }
    });

    it("【1】下書き → 公開（絞った範囲で初公開）・再送でも、絞った写真なら印は付かない", async () => {
        setProfile(OWNER, {});
        setPhoto("ph1", row("ph1", { createdAt: NEW, audience: "followers" }));
        await grantLabelForPhotoQuietly(OWNER, "ph1", "test");
        await stickAll();
        await expectHidden();
        // 絞ったままの再送
        await grantLabel(OWNER, row("ph1", { createdAt: NEW, audience: "followers" }) as never);
        await expectHidden();
        // 全員に向けた再送で付く・また絞った再送で外れる
        setPhoto("ph1", row("ph1", { createdAt: NEW }));
        await grantLabel(OWNER, row("ph1", { createdAt: NEW }) as never);
        await expectShown();
        await grantLabel(OWNER, row("ph1", { createdAt: NEW, audience: "closeFriends" }) as never);
        await expectHidden();
    });

    it("24時間を過ぎて非公開・削除: 取り消さず印を外す（自分には地名が見える）", async () => {
        for (const photo of [row("ph1", { published: false }), row("ph1")]) {
            store.clear();
            setProfile(OWNER, {});
            setTrunk(OWNER, { stuck: [okLabel("ph1")], pocket: [] });
            await expectShown();
            await revokeLabelQuietly(OWNER, photo, "test");
            await expectHidden();
            expect(((await ownStuck())[0]).place).toMatchObject({ name: "京都" });
        }
    });

    it("24時間以内の非公開は今までどおり取り消す（ラベルが消える）", async () => {
        setProfile(OWNER, {});
        const now = new Date().toISOString();
        setTrunk(OWNER, { stuck: [okLabel("ph1", { a: Math.floor(Date.now() / 1000) }), okLabel("keep")], pocket: [] });
        await revokeLabelQuietly(OWNER, row("ph1", { createdAt: now, firstPublishedAt: now }), "test");
        expect(await theirStuck()).toHaveLength(1);
        expect(JSON.stringify(trunkRow(OWNER)?.stuck)).not.toContain("ph1");
    });

    it("【2】束の兄弟が絞った写真だけになったら、取り消さなくても印を外す（絞った写真は「公開で残る」に数えない）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp", audience: "followers" }));
        await revokeLabelQuietly(OWNER, row("ph1", { groupId: "grp" }), "test");
        await expectHidden();
    });

    it("束の兄弟が誰にでも見える公開で同じ撮影地に残っていれば、印を残す（撮影地が違えば外す）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        await revokeLabelQuietly(OWNER, row("ph1", { groupId: "grp" }), "test");
        await expectShown();
        setPhoto("ph9", row("ph9", { groupId: "grp", location: "大阪" }));
        await revokeLabelQuietly(OWNER, row("ph1", { groupId: "grp" }), "test");
        await expectHidden();
    });

    it("写真の編集で付け直す: 絞る → 外す・全員に戻す → 付ける・撮影地を変える → 外す・撮影地を戻す → 付ける", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [okLabel("ph1")], pocket: [] });
        const step = async (before: Item, after: Item) => {
            setPhoto("ph1", after);
            await refreshLabelPlaceQuietly(OWNER, "ph1", before, "test");
        };
        await step(row("ph1"), row("ph1", { audience: "followers" }));
        await expectHidden();
        await step(row("ph1", { audience: "followers" }), row("ph1"));
        await expectShown();
        await step(row("ph1"), row("ph1", { location: "大阪" }));
        await expectHidden();
        // 新しい撮影地で公開のままでも伏せたまま（ラベルの地名は配ったときのもの）
        await step(row("ph1", { location: "大阪" }), row("ph1", { location: "大阪", title: "x" }));
        await expectHidden();
        await step(row("ph1", { location: "大阪" }), row("ph1"));
        await expectShown();
        await step(row("ph1"), row("ph1", { location: undefined }));
        await expectHidden();
    });

    it("公開・撮影地が変わらない編集では trunk を読まない（写真を1回読むだけ）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [okLabel("ph1")], pocket: [] });
        setPhoto("ph1", row("ph1", { title: "新しい題" }));
        fakeSend.mockClear();
        await refreshLabelPlaceQuietly(OWNER, "ph1", row("ph1"), "test");
        const keys = fakeSend.mock.calls.map((c) => String((c[0].input as { Key?: Item }).Key?.id ?? ""));
        expect(keys).toEqual(["ph1"]);
    });

    it("【見直し1】配る前に写真が絞られていた（編集が先に終わった）: 書いたあとに読み直して印を外す", async () => {
        setProfile(OWNER, {});
        setPhoto("ph1", row("ph1", { createdAt: NEW, audience: "followers" }));
        // savePhoto が持っている写真はまだ公開の姿（絞る編集はそのあとに終わった）
        const out = await grantLabel(OWNER, row("ph1", { createdAt: NEW }) as never);
        expect(out.label).not.toHaveProperty("placeOk");
        await stickAll();
        await expectHidden();
    });

    it("【見直し1】付け直しの読みと書きのあいだに絞られた: 書いたあとに読み直して印を外す", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [label("ph1", { l: "Kyoto" })], pocket: [] });
        setPhoto("ph1", row("ph1"));
        let raced = false;
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const out = await send(cmd as never);
            if (cmd.constructor.name === "TransactWriteCommand" && !raced) {
                raced = true;
                setPhoto("ph1", row("ph1", { audience: "closeFriends" }));
            }
            return out;
        });
        await refreshLabelPlaceQuietly(OWNER, "ph1", row("ph1", { published: false }), "test");
        expect(raced).toBe(true);
        await expectHidden();
    });

    it("【見直し2】本人の GET /user/trunk で外し損ねた印を外す（付けはしない）", async () => {
        setProfile(OWNER, {});
        const fresh = Math.floor(Date.now() / 1000);
        setTrunk(OWNER, {
            stuck: [okLabel("restricted"), okLabel("gone"), okLabel("justposted", { a: fresh }), okLabel("moved"), label("noOk", { l: "Kyoto" })],
            pocket: [],
        });
        mockListMyPhotos.mockResolvedValue([
            row("restricted", { audience: "followers" }), row("moved", { location: "大阪" }), row("noOk"),
        ]);
        // 強い読みで読み直す先（索引と同じ姿。いま上げたばかりの写真は索引にまだ無いが、行は在る）
        setPhoto("restricted", row("restricted", { audience: "followers" }));
        setPhoto("moved", row("moved", { location: "大阪" }));
        setPhoto("justposted", row("justposted"));
        const own = await ownStuck();
        const ok = (id: string) => (own.find((l) => l.id === id) ?? {}).placeOk === true;
        expect(["restricted", "gone", "justposted", "moved", "noOk"].map(ok)).toEqual([false, false, true, false, false]);
        const stored = (trunkRow(OWNER)!.stuck as Item[]).map((l) => [l.i, l.o ?? null]);
        expect(stored).toEqual([["restricted", null], ["gone", null], ["justposted", 1], ["moved", null], ["noOk", null]]);
        // 正しい印は外さない・同じなら書かない
        const rev = trunkRow(OWNER)!.rev;
        await ownStuck();
        expect(trunkRow(OWNER)!.rev).toBe(rev);
    });

    it("【見直し2-2】索引が古い姿（下書き・絞った）でも、強い読みで公開なら印を外さない。候補が無ければ写真を読まない", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [okLabel("a"), okLabel("b"), okLabel("c")], pocket: [] });
        // 索引は直前の姿（下書き → 公開・closeFriends → 全員の直後）
        mockListMyPhotos.mockResolvedValue([row("a", { published: false }), row("b", { audience: "closeFriends" }), row("c")]);
        setPhoto("a", row("a"));
        setPhoto("b", row("b"));
        setPhoto("c", row("c"));
        fakeSend.mockClear();
        const own = await ownStuck();
        expect(own.map((l) => l.placeOk)).toEqual([true, true, true]);
        // 読み直したのは候補の2枚だけ・強い読み
        const photoGets = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand"
            && ["a", "b", "c"].includes(String((c.input as { Key: Item }).Key.id)));
        expect(photoGets.map((c) => (c.input as { Key: Item }).Key.id).sort()).toEqual(["a", "b"]);
        expect(photoGets.every((c) => (c.input as { ConsistentRead?: boolean }).ConsistentRead === true)).toBe(true);
        // 配って1時間以内でも、強い読みで絞られていれば外す
        setTrunk(OWNER, { ...trunkRow(OWNER), stuck: [okLabel("a", { a: Math.floor(Date.now() / 1000) })] });
        setPhoto("a", row("a", { audience: "followers" }));
        mockListMyPhotos.mockResolvedValue([row("a", { audience: "followers" })]);
        expect((await ownStuck())[0].placeOk).toBeUndefined();
    });

    it("【見直し2-3】GET の外し: 束は兄弟のどれかが公開で同じ撮影地なら残す（索引で見えても、強い読みで見えても）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g }), okLabel("ph2", { g: T.groupKey("grp2") })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([
            row("ph1", { groupId: "grp", audience: "followers" }), row("ph9", { groupId: "grp" }),
            row("ph2", { groupId: "grp2", audience: "followers" }), row("ph8", { groupId: "grp2", published: false }),
        ]);
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers" }));
        setPhoto("ph2", row("ph2", { groupId: "grp2", audience: "followers" }));
        // grp2 の兄弟は索引では下書きだが、強い読みでは公開
        setPhoto("ph8", row("ph8", { groupId: "grp2" }));
        const own = await ownStuck();
        expect(own.map((l) => l.placeOk)).toEqual([true, true]);
        // 兄弟も強い読みで公開でなければ外す
        setPhoto("ph8", row("ph8", { groupId: "grp2", published: false }));
        expect((await ownStuck()).map((l) => l.placeOk)).toEqual([true, undefined]);
    });

    it("【見直し3】束の兄弟は印を「残す」根拠にだけなり、「付ける」根拠にならない（付けて外す2回書きをしない）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [label("ph1", { l: "Kyoto", g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers" }));
        await refreshLabelPlaceQuietly(OWNER, "ph1", row("ph1", { groupId: "grp" }), "test");
        await expectHidden();
        // 付けもしない＝書かない（rev はそのまま）
        expect(trunkRow(OWNER)!.rev).toBe(1);
        expect(T.placeOkNext({ id: "x", photoId: "x", kind: "place", place: { name: "京都", latin: "Kyoto", country: "日本" }, seed: 1, at: NEW },
            undefined, OWNER, new Set([JSON.stringify(["京都", "Kyoto", "日本"])]))).toBe(false);
    });

    it("【見直し5】確かめ（confirmPlaceOk）は強い読みで、印を外すだけ（付けない）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [label("ph1", { l: "Kyoto" })], pocket: [] });
        setPhoto("ph1", row("ph1"));
        fakeSend.mockClear();
        expect(await T.confirmPlaceOk(OWNER, "ph1", (l) => l.id === "ph1")).toBe(true);
        expect((trunkRow(OWNER)!.stuck as Item[])[0].o).toBeUndefined();
        const get = fakeSend.mock.calls.map((c) => c[0]).find((c) => c.constructor.name === "GetCommand"
            && (c.input as { Key: Item }).Key.id === "ph1");
        expect((get!.input as { ConsistentRead?: boolean }).ConsistentRead).toBe(true);
    });

    it("【見直し1】配ったあとの確かめが落ちても、配りの答えはそのまま（error にしない）", async () => {
        setProfile(OWNER, {});
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let wrote = false;
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "TransactWriteCommand") wrote = true;
            if (wrote && cmd.constructor.name === "GetCommand" && (cmd.input as { Key: Item }).Key.id === "ph1") throw new Error("boom");
            return send(cmd as never);
        });
        const out = await T.grantLabelQuietly(OWNER, row("ph1", { createdAt: NEW }) as never, "test");
        expect(out.labelSkipped).toBeUndefined();
        expect(out.label?.id).toBe("ph1");
        // 確かめられなかったときは応答の1枚の印もそのまま（行と食い違わせない。外し損ねは GET の外しが拾う）
        expect(out.label?.placeOk).toBe(true);
        expect(((trunkRow(OWNER)!.pocket as Item[])[0]).o).toBe(1);
        err.mockRestore();
    });

    /**
     * 確かめの写真の読みを止めておく（偽の時計で待ちの切れ目を進めてから放す）。放したあとの裏の確かめが
     * 終わるまで待ってから終える（共有の作り物の表に、ほかのテストの最中に書かないように）
     */
    function holdConfirmRead(photoId: string) {
        let wrote = false;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        let held = 0;
        let done!: () => void;
        const finished = new Promise<void>((r) => { done = r; });
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "TransactWriteCommand") {
                const out = await send(cmd as never);
                if (held > 0) done();
                wrote = true;
                return out;
            }
            if (wrote && held === 0 && cmd.constructor.name === "GetCommand" && (cmd.input as { Key: Item }).Key.id === photoId
                && (cmd.input as { ConsistentRead?: boolean }).ConsistentRead) {
                held++;
                await gate;
            }
            return send(cmd as never);
        });
        return { release, finished };
    }

    it("【見直し1】配ったあとの確かめが待ちの切れ目に掛かったら、確かめを待たずに配りの答えを返す（timeout にしない）", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
            setProfile(OWNER, {});
            const hold = holdConfirmRead("ph1");
            const pending = T.grantLabelQuietly(OWNER, row("ph1", { createdAt: NEW }) as never, "test");
            await vi.advanceTimersByTimeAsync(T.TRUNK_QUIET_LIMIT_MS + 100);
            const out = await pending;
            expect(out.labelSkipped).toBeUndefined();
            expect(out.label?.id).toBe("ph1");
            // 裏の確かめを放して、終わるまで待つ（写真の行が無い＝外す書き込みが1回走る）
            hold.release();
            await hold.finished;
        } finally {
            vi.useRealTimers();
        }
        expect(((trunkRow(OWNER)!.pocket as Item[])[0]).o).toBeUndefined();
    });

    it("【見直し5】下書き → 公開（grantLabelForPhotoQuietly）でも、確かめが切れ目に掛かったら配りの答えを返す", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        try {
            setProfile(OWNER, {});
            setPhoto("ph1", row("ph1", { createdAt: NEW }));
            const hold = holdConfirmRead("ph1");
            const pending = grantLabelForPhotoQuietly(OWNER, "ph1", "test");
            await vi.advanceTimersByTimeAsync(T.TRUNK_QUIET_LIMIT_MS + 100);
            const out = await pending;
            expect(out.labelSkipped).toBeUndefined();
            expect(out.label?.id).toBe("ph1");
            hold.release();
            // 写真は公開のまま＝確かめは何も書かない。読みが返るまで回す
            await vi.advanceTimersByTimeAsync(10);
        } finally {
            vi.useRealTimers();
        }
        expect(((trunkRow(OWNER)!.pocket as Item[])[0]).o).toBe(1);
    });

    it("【見直し1】本人の GET の外しの読みが落ちても、画面は 500 にしない（外さない）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [okLabel("a"), okLabel("b")], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("a", { audience: "followers" }), row("b", { audience: "followers" })]);
        setPhoto("b", row("b", { audience: "followers" }));
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand" && (cmd.input as { Key: Item }).Key.id === "a") throw new Error("boom");
            return send(cmd as never);
        });
        const r = await call("GET /user/trunk", { sub: OWNER });
        expect(r.status).toBe(200);
        // 読めなかった a は外さない・読めた b は外す（1枚の失敗でほかの外しを止めない）
        expect((r.json.stuck as Item[]).map((l) => l.placeOk)).toEqual([true, undefined]);
        expect((trunkRow(OWNER)!.stuck as Item[]).map((l) => l.o ?? null)).toEqual([1, null]);
        err.mockRestore();
    });

    it("【見直し1】本人の GET の外しは、1回に読む写真を上限まで（並べて読む）。残りは次の GET で外す", async () => {
        setProfile(OWNER, {});
        const n = T.STALE_READ_MAX + 5;
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        setTrunk(OWNER, { stuck: ids.map((id) => okLabel(id)), pocket: [] });
        mockListMyPhotos.mockResolvedValue(ids.map((id) => row(id, { audience: "followers" })));
        for (const id of ids) setPhoto(id, row(id, { audience: "followers" }));
        fakeSend.mockClear();
        await ownStuck();
        const reads = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand"
            && ids.includes(String((c.input as { Key: Item }).Key.id)));
        expect(reads).toHaveLength(T.STALE_READ_MAX);
        const left = () => (trunkRow(OWNER)!.stuck as Item[]).filter((l) => l.o === 1).length;
        expect(left()).toBe(5);
        await ownStuck();
        expect(left()).toBe(0);
    });

    it("【見直し4-1】上限（25枚）より大きい束も、GET の外しで外れる（読めた分に残す根拠が無ければ外す）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("big");
        const ids = Array.from({ length: T.STALE_READ_MAX + 5 }, (_, i) => `b${i}`);
        setTrunk(OWNER, { stuck: [okLabel("b0", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue(ids.map((id) => row(id, { groupId: "big", audience: "followers" })));
        for (const id of ids) setPhoto(id, row(id, { groupId: "big", audience: "followers" }));
        fakeSend.mockClear();
        expect((await ownStuck())[0].placeOk).toBeUndefined();
        const reads = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand"
            && ids.includes(String((c.input as { Key: Item }).Key.id)));
        expect(reads.length).toBe(T.STALE_READ_MAX);
        // 読めた分の兄弟が公開で同じ撮影地なら残す
        setTrunk(OWNER, { ...trunkRow(OWNER), stuck: [okLabel("b0", { g })] });
        setPhoto("b3", row("b3", { groupId: "big" }));
        expect((await ownStuck())[0].placeOk).toBe(true);
    });

    it("【見直し4-2】再送（配りに相乗り）でも束の兄弟を残す根拠にする: 絞った写真の再送でも、兄弟が公開で同じ撮影地なら印を残す", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }));
        // 再送の経路（requireNew）
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test", { requireNew: true });
        await expectShown();
        // 兄弟も絞られていれば外す
        setPhoto("ph9", row("ph9", { groupId: "grp", audience: "followers" }));
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test", { requireNew: true });
        await expectHidden();
    });

    /** 写真の id ごとの GetItem（強い読みかどうか） */
    const photoGets = (ids: string[]) => fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand"
        && ids.includes(String((c.input as { Key: Item }).Key.id))).map((c) => c.input as { Key: Item; ConsistentRead?: boolean });

    it("【仕上げ】dealSibAdds: 兄弟は印を「付ける」根拠にならない（印の無い配り済み＋絞った写真の再送＋兄弟は公開でも付かない）", () => {
        const at = new Date(NEW);
        const doc = T.parseTrunk({ stuck: [label("ph1", { l: "Kyoto", g: T.groupKey("grp") })], pocket: [] });
        const again = { ...T.buildLabel(row("ph1", { groupId: "grp", audience: "followers" }) as never, [], at), id: "ph1", photoId: "ph1" };
        const places = new Set([JSON.stringify(["京都", "Kyoto", "日本"])]);
        const r = T.dealInto(doc, again, 30, "fp", at, { siblingPlaces: places });
        const after = r.doc ?? doc;
        expect(after.stuck[0].placeOk).toBeUndefined();
    });

    it("【仕上げ】sibWeak・sibNoCap: 再送の兄弟は強い読みで、上限（25枚）まで", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        const sibs = Array.from({ length: T.STALE_READ_MAX + 5 }, (_, i) => `s${i}`);
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), ...sibs.map((id) => row(id, { groupId: "grp" }))]);
        for (const id of sibs) setPhoto(id, row(id, { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }));
        fakeSend.mockClear();
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test", { requireNew: true });
        const reads = photoGets(sibs);
        expect(reads).toHaveLength(T.STALE_READ_MAX);
        expect(reads.every((r) => r.ConsistentRead === true)).toBe(true);
        await expectShown();
    });

    it("【仕上げ】resendAll: 再送でない配り（savePhoto の1回目）では兄弟を読まない（見せない側に倒す）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }));
        fakeSend.mockClear();
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test");
        expect(photoGets(["ph9"])).toHaveLength(0);
        await expectHidden();
    });

    it("【仕上げ3】再送でも、配り済みのラベルが無い・今の写真で印を残せる回は兄弟を読まない", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        // 配り済みのラベルが無い（絞った写真の初めての配り）
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }));
        fakeSend.mockClear();
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test", { requireNew: true });
        expect(photoGets(["ph9"])).toHaveLength(0);
        // 配り済みで、今の写真が公開（印を残せる）
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        setPhoto("ph1", row("ph1", { groupId: "grp", createdAt: NEW }));
        fakeSend.mockClear();
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", createdAt: NEW }) as never, "test", { requireNew: true });
        expect(photoGets(["ph9"])).toHaveLength(0);
        await expectShown();
    });

    it("【仕上げ4】印の無い配り済み＋絞った写真の再送では兄弟を読まない（残す印が無い）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [label("ph1", { l: "Kyoto", g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }));
        fakeSend.mockClear();
        await T.grantLabelQuietly(OWNER, row("ph1", { groupId: "grp", audience: "followers", createdAt: NEW }) as never, "test", { requireNew: true });
        expect(photoGets(["ph9"])).toHaveLength(0);
        await expectHidden();
    });

    it("【仕上げ2】25枚を超える束は、枠が満タンの回だけ読む（満タンでなければ次の GET に回す）", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("big");
        const ids = Array.from({ length: T.STALE_READ_MAX + 5 }, (_, i) => `b${i}`);
        // 新しい順: 先に1枚のラベル（候補）・あとに大きい束のラベル
        setTrunk(OWNER, { stuck: [okLabel("single"), okLabel("b0", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("single", { audience: "followers" }),
            ...ids.map((id) => row(id, { groupId: "big", audience: "followers" }))]);
        setPhoto("single", row("single", { audience: "followers" }));
        for (const id of ids) setPhoto(id, row(id, { groupId: "big", audience: "followers" }));
        const oks = () => (trunkRow(OWNER)!.stuck as Item[]).map((l) => l.o ?? null);
        await ownStuck();
        // 1回目: 1枚のラベルで枠を使ったので、大きい束は次に回る
        expect(oks()).toEqual([null, 1]);
        await ownStuck();
        expect(oks()).toEqual([null, null]);
    });

    it("【見直し9】再送で撮影地が変わっていたら印を外す（同じ撮影地なら残す）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [okLabel("ph1")], pocket: [] });
        setPhoto("ph1", row("ph1"));
        await grantLabel(OWNER, row("ph1") as never);
        await expectShown();
        setPhoto("ph1", row("ph1", { location: "大阪" }));
        await grantLabel(OWNER, row("ph1", { location: "大阪" }) as never);
        await expectHidden();
    });

    it("【見直し9】付け直しで、束の兄弟が誰にでも見える公開で同じ撮影地に残れば印を残す", async () => {
        setProfile(OWNER, {});
        const g = T.groupKey("grp");
        setTrunk(OWNER, { stuck: [okLabel("ph1", { g })], pocket: [] });
        mockListMyPhotos.mockResolvedValue([row("ph1", { groupId: "grp" }), row("ph9", { groupId: "grp" })]);
        setPhoto("ph9", row("ph9", { groupId: "grp" }));
        setPhoto("ph1", row("ph1", { groupId: "grp", audience: "followers" }));
        await refreshLabelPlaceQuietly(OWNER, "ph1", row("ph1", { groupId: "grp" }), "test");
        await expectShown();
    });

    it("【見直し5】伏せたラベルと、地名がもともと空のラベルは同じ形（見分けられない）", () => {
        const base = { photoId: "x", kind: "season" as const, season: "spring" as const, seed: 7, at: "2026-04-01T00:00:00.000Z" };
        const hidden = T.theirLabel(0, { ...base, id: "a", place: { name: "京都", country: "日本" } });
        const blank = T.theirLabel(0, { ...base, id: "b", place: { name: "" }, placeOk: true });
        expect(hidden).toEqual(blank);
        expect(hidden).toEqual({ id: "s0", kind: "season", seed: 7, place: { name: "" }, where: null });
    });

    it("【見直し6】人の口の id は写真の id から計算できない（返答の中の番号）", () => {
        const l = { id: "same-photo-id", photoId: "same-photo-id", kind: "place" as const, place: { name: "" }, seed: 1, at: NEW };
        expect(T.theirLabel(3, l).id).toBe("s3");
        expect(JSON.stringify(T.theirLabel(3, l))).not.toContain("same-photo-id");
    });

    it("posts は誰にでも見える公開の投稿だけで数える（絞った・下書き・ストーリーは数えない）", async () => {
        setProfile(OWNER, {});
        setTrunk(OWNER, { stuck: [] });
        mockListMyPhotos.mockResolvedValue([
            row("a"), row("b", { audience: "followers" }), row("c", { published: false }), row("d", { story: true }),
            row("e", { groupId: "g1" }), row("f", { groupId: "g1" }),
        ]);
        // 自分の口は今までどおり（下書き・ストーリーは数えない・絞った写真は数える＝iOS の古び方・節目と同じ）
        expect((await call("GET /user/trunk", { sub: OWNER })).json.posts).toBe(3);
        // 人の口は誰にでも見える公開の投稿だけ
        expect((await their()).json.posts).toBe(2);
    });
});
