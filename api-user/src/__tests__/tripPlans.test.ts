import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 旅行プラン（`trips#<uid>`）。
 *
 * ここで固定したいのは6つ:
 *
 *  1. **本人だけが見られる**——行 ID は JWT の `sub` からしか作らない。
 *     パス・クエリ・本文のどれで他人の ID を渡しても、読むのは自分の行
 *  2. **`visibility` は受け取らない**（本文に `"public"` と書いても非公開）
 *  3. **上限は黙って落とさず断る**——プランは利用者が書いた中身で戻せない
 *  4. **送られた項目だけを差し替える**（題だけ直しても日程は消えない）
 *  5. **旅の日付は未来を通す**（`sanitizeDate` は撮影日用で未来を捨てる）
 *  6. **無い ID に 200 を返さない**
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
// planId は毎回変わると期待値が書けない。**形は本物を通す**ので
// `randomUUID` だけ固定する
vi.mock("crypto", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    randomUUID: () => "11111111-2222-3333-4444-555555555555",
}));

const {
    getMyTrips, createTrip, updateTrip, deleteTrip,
    TRIPS_MAX, TRIP_TITLE_MAX, TRIP_DAYS_MAX, TRIP_ITEMS_PER_DAY_MAX, TRIP_NOTE_MAX,
    sanitizeTripDate, fitsBudget, fitsPlanBudget, isStoredTripPlan,
} = await import("../tripPlans");

type AnyEvent = Parameters<typeof createTrip>[0];

const ev = (sub: string, extra: Record<string, unknown> = {}) =>
    ({
        requestContext: { authorizer: { jwt: { claims: { sub } } }, http: { method: "POST" } },
        ...extra,
    }) as unknown as AnyEvent;

const run = async (h: typeof createTrip, e: AnyEvent) =>
    (await h(e, {} as never, () => undefined)) as { statusCode: number; body: string; headers?: Record<string, string> };

const input = (i: number) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, unknown> }).input;
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

/** 保存されている形のプラン */
const plan = (planId: string, over: Record<string, unknown> = {}) => ({
    planId, ownerId: "u1", title: `旅 ${planId}`, days: [],
    visibility: "private" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
});

const SPOT = "sp_0123456789ab";

beforeEach(() => { mockDdbSend.mockReset(); });

describe("一覧（GET /user/trips）", () => {
    it("自分の行だけを読む（他人の ID を渡す口が無い）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [plan("a")], rev: 1 } });
        const res = await run(getMyTrips, ev("u1", {
            pathParameters: { planId: "x" },
            queryStringParameters: { userId: "u2" },
            body: JSON.stringify({ ownerId: "u2" }),
        }));
        expect(res.statusCode).toBe(200);
        expect(input(0).Key).toEqual({ id: "trips#u1" });
        expect(JSON.parse(res.body).plans).toHaveLength(1);
    });

    it("共有キャッシュに載せない", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await run(getMyTrips, ev("u1"));
        expect(res.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("形の壊れた行は落とす（画面ごと落とさない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [plan("a"), "こわれ", { planId: "b" }], rev: 1 } });
        const res = await run(getMyTrips, ev("u1"));
        expect(JSON.parse(res.body).plans.map((p: { planId: string }) => p.planId)).toEqual(["a"]);
    });

    it("まだ1つも無ければ空（失敗と混ぜない）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await run(getMyTrips, ev("u1"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ plans: [] });
    });

    it("読めなければ 500（0件と混ぜない）", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("ddb down"));
        expect((await run(getMyTrips, ev("u1"))).statusCode).toBe(500);
    });
});

describe("作る（POST /user/trips）", () => {
    it("新しい順に積み、非公開で保存する", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [plan("old")], rev: 2 } }).mockResolvedValueOnce({});
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "北欧の冬" }) }));
        expect(res.statusCode).toBe(200);
        const item = input(1).Item as { id: string; list: Record<string, unknown>[]; rev: number };
        expect(item.id).toBe("trips#u1");
        expect(item.rev).toBe(3);
        expect(item.list.map((p) => p.planId)).toEqual(["11111111-2222-3333-4444-555555555555", "old"]);
        expect(item.list[0]).toMatchObject({ title: "北欧の冬", ownerId: "u1", visibility: "private", days: [] });
    });

    it("🔴 本文の `visibility` は効かない（公開にする口を開けない）", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        await run(createTrip, ev("u1", { body: JSON.stringify({ title: "旅", visibility: "public" }) }));
        expect((input(1).Item as { list: { visibility: string }[] }).list[0].visibility).toBe("private");
    });

    it("🔴 本文の `ownerId` は効かない（他人のプランとして作れない）", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        await run(createTrip, ev("u1", { body: JSON.stringify({ title: "旅", ownerId: "u2" }) }));
        expect((input(1).Item as { list: { ownerId: string }[] }).list[0].ownerId).toBe("u1");
    });

    it("題が無ければ 400（無題の行を作らない）", async () => {
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ days: [] }) }));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("本文が壊れていれば 400", async () => {
        expect((await run(createTrip, ev("u1", { body: "{" }))).statusCode).toBe(400);
        expect((await run(createTrip, ev("u1", { body: "[1,2]" }))).statusCode).toBe(400);
    });

    it("題は上限で切る", async () => {
        mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
        await run(createTrip, ev("u1", { body: JSON.stringify({ title: "あ".repeat(TRIP_TITLE_MAX + 50) }) }));
        expect((input(1).Item as { list: { title: string }[] }).list[0].title).toHaveLength(TRIP_TITLE_MAX);
    });

    it("🔴 上限に達したら、古い方を落とさずに断る", async () => {
        const full = Array.from({ length: TRIPS_MAX }, (_, i) => plan(`p${i}`));
        mockDdbSend.mockResolvedValueOnce({ Item: { list: full, rev: 1 } });
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "あふれる" }) }));
        expect(res.statusCode).toBe(403);
        // **書き込みが飛んでいない**＝既存のプランは1つも消えていない
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    /**
     * 🔴 **天井は2段あり、断り文が違う。**
     *
     * 最初は行の予算だけだったので、**上限いっぱいの日程を作ると
     * 「プランを消してください」と言われた**（消しても直らない）。
     * 実測: 項目1つ最大 839B × 60日 × 30項目 ＝ 1,475KB ＞ 行の予算 350KB。
     */
    it("🔴 1プランが大きすぎたら、プランの側の言葉で断る", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } });
        const days = Array.from({ length: TRIP_DAYS_MAX }, () => ({
            items: Array.from({ length: TRIP_ITEMS_PER_DAY_MAX }, () => ({ kind: "location", slug: "x".repeat(150), note: "ん".repeat(TRIP_NOTE_MAX) })),
        }));
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "詰め込みすぎ", days }) }));
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toContain("この旅程");
        // **書き込みが飛んでいない**＝既存のプランは1つも消えていない
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("🔴 行ぜんぶが大きすぎたら、プランを減らす側の言葉で断る", async () => {
        const day = { items: Array.from({ length: TRIP_ITEMS_PER_DAY_MAX }, () => ({ kind: "location", slug: "x".repeat(150), note: "ん".repeat(TRIP_NOTE_MAX) })) };
        // 1つあたりは1プランの天井（128KB）に収まる大きさ。**並べたから当たる**
        const fat = plan("fat", { days: [day, day] });
        const many = Array.from({ length: 20 }, (_, i) => ({ ...fat, planId: `f${i}` }));
        mockDdbSend.mockResolvedValueOnce({ Item: { list: many, rev: 1 } });
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "もう入らない" }) }));
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toContain("使わないプラン");
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });
});

describe("日程と項目", () => {
    const withDays = (days: unknown) => JSON.stringify({ title: "旅", days });
    const savedDays = () => (input(1).Item as { list: { days: unknown }[] }).list[0].days;

    beforeEach(() => { mockDdbSend.mockResolvedValueOnce({}).mockResolvedValueOnce({}); });

    it("公式スポットと撮影地の2種を受ける", async () => {
        await run(createTrip, ev("u1", { body: withDays([{ date: "2026-12-24", items: [
            { kind: "spot", spotId: SPOT, note: "朝いちで" },
            { kind: "location", slug: "パリ" },
        ] }]) }));
        expect(savedDays()).toEqual([{ date: "2026-12-24", items: [
            { kind: "spot", spotId: SPOT, note: "朝いちで" },
            { kind: "location", slug: "パリ" },
        ] }]);
    });

    it("知らない種別・壊れた ID の項目は落とす（枠を食わせない）", async () => {
        await run(createTrip, ev("u1", { body: withDays([{ items: [
            { kind: "hotel", name: "宿" },
            { kind: "spot", spotId: "sp_XYZ" },
            { kind: "location", slug: "a#b" },
            { kind: "location", slug: "" },
            { kind: "location", slug: "生きてる" },
        ] }]) }));
        expect(savedDays()).toEqual([{ items: [{ kind: "location", slug: "生きてる" }] }]);
    });

    /**
     * **構造の上限を見るテスト。** ひとことは1つの日だけ長くする
     * ——全部の項目を最大にすると `TRIP_PLAN_BUDGET_BYTES` に当たって
     * 403 になり、**切っているかどうかを観測できない**（最初これで落ちた）。
     */
    it("日数・1日の項目数・ひとことを上限で切る", async () => {
        const longNote = "ん".repeat(TRIP_NOTE_MAX + 20);
        await run(createTrip, ev("u1", { body: withDays(
            Array.from({ length: TRIP_DAYS_MAX + 5 }, (_, d) => ({
                items: Array.from({ length: TRIP_ITEMS_PER_DAY_MAX + 5 }, () => (
                    d === 0 ? { kind: "location", slug: "x", note: longNote } : { kind: "location", slug: "x" }
                )),
            })),
        ) }));
        const days = savedDays() as { items: { note?: string }[] }[];
        expect(days).toHaveLength(TRIP_DAYS_MAX);
        expect(days[0].items).toHaveLength(TRIP_ITEMS_PER_DAY_MAX);
        expect(days[0].items[0].note).toHaveLength(TRIP_NOTE_MAX);
    });

    it("読めない日付の日は、日付を持たない日として残す（項目ごと捨てない）", async () => {
        await run(createTrip, ev("u1", { body: withDays([{ date: "2026-02-30", items: [{ kind: "location", slug: "a" }] }]) }));
        expect(savedDays()).toEqual([{ items: [{ kind: "location", slug: "a" }] }]);
    });
});

describe("旅の日付（`sanitizeTripDate`）", () => {
    it("🔴 未来を通す（`sanitizeDate` は撮影日用で未来を捨てる）", () => {
        expect(sanitizeTripDate("2030-05-01")).toBe("2030-05-01");
    });
    it("`YYYY-MM-DD` 以外は通さない", () => {
        for (const v of ["2026-05-01T09:00:00Z", "2026/05/01", "5月1日", "", " ", 20260501, null, {}]) {
            expect(sanitizeTripDate(v), String(v)).toBeUndefined();
        }
    });
    it("実在しない日は通さない（`Date` の繰り上げに乗らない）", () => {
        expect(sanitizeTripDate("2026-02-30")).toBeUndefined();
        expect(sanitizeTripDate("2026-13-01")).toBeUndefined();
        expect(sanitizeTripDate("2024-02-29"), "うるう年は実在する").toBe("2024-02-29");
    });
});

describe("直す（PUT /user/trips/{planId}）", () => {
    const existing = () => plan("p1", {
        title: "前の題",
        startDate: "2026-12-24",
        days: [{ date: "2026-12-24", items: [{ kind: "location", slug: "パリ" }] }],
    });

    it("🔴 送っていない項目は触らない（題だけ直しても日程が消えない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        const res = await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ title: "新しい題" }) }));
        expect(res.statusCode).toBe(200);
        const saved = (input(1).Item as { list: Record<string, unknown>[] }).list[0];
        expect(saved.title).toBe("新しい題");
        expect(saved.days).toEqual(existing().days);
        expect(saved.startDate).toBe("2026-12-24");
    });

    it("日程を送れば置き換わる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ days: [{ items: [{ kind: "spot", spotId: SPOT }] }] }) }));
        expect((input(1).Item as { list: { days: unknown }[] }).list[0].days).toEqual([{ items: [{ kind: "spot", spotId: SPOT }] }]);
    });

    it("空文字を送れば日付が消える／送らなければ残る", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ startDate: "" }) }));
        expect((input(1).Item as { list: Record<string, unknown>[] }).list[0].startDate).toBeUndefined();
    });

    it("🔴 読めない日付で、保存済みの日付を黙って消さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ startDate: "2026-13-99" }) }));
        expect((input(1).Item as { list: Record<string, unknown>[] }).list[0].startDate).toBe("2026-12-24");
    });

    it("題を送ったのに読めなければ 400（黙って無題にしない）", async () => {
        const res = await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ title: "   " }) }));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("🔴 本文の `visibility` / `ownerId` は効かない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ title: "t", visibility: "public", ownerId: "u2" }) }));
        const saved = (input(1).Item as { list: Record<string, unknown>[] }).list[0];
        expect(saved.visibility).toBe("private");
        expect(saved.ownerId).toBe("u1");
    });

    it("🔴 無い ID には 404（消えたプランに『保存しました』と言わない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } });
        const res = await run(updateTrip, ev("u1", { pathParameters: { planId: "よそ" }, body: JSON.stringify({ title: "t" }) }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("他人の行は触れない（読むのは自分の行）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [existing()], rev: 1 } }).mockResolvedValueOnce({});
        await run(updateTrip, ev("u1", { pathParameters: { planId: "p1" }, body: JSON.stringify({ title: "t" }) }));
        expect(input(0).Key).toEqual({ id: "trips#u1" });
        expect((input(1).Item as { id: string }).id).toBe("trips#u1");
    });
});

describe("消す（DELETE /user/trips/{planId}）", () => {
    it("消せる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [plan("a"), plan("b")], rev: 1 } }).mockResolvedValueOnce({});
        const res = await run(deleteTrip, ev("u1", { pathParameters: { planId: "a" } }));
        expect(res.statusCode).toBe(200);
        expect((input(1).Item as { list: { planId: string }[] }).list.map((p) => p.planId)).toEqual(["b"]);
        expect(JSON.parse(res.body).plans.map((p: { planId: string }) => p.planId)).toEqual(["b"]);
    });

    it("既に無ければ書かない（冪等）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [plan("b")], rev: 1 } });
        const res = await run(deleteTrip, ev("u1", { pathParameters: { planId: "a" } }));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("🔴 上限を超えて入っている行でも、消す操作で他が巻き添えにならない", async () => {
        // 上限を後から下げた／backfill が多めに書いた行。**切らない**のが正しい
        const over = Array.from({ length: TRIPS_MAX + 5 }, (_, i) => plan(`p${i}`));
        mockDdbSend.mockResolvedValueOnce({ Item: { list: over, rev: 1 } }).mockResolvedValueOnce({});
        await run(deleteTrip, ev("u1", { pathParameters: { planId: "p0" } }));
        expect((input(1).Item as { list: unknown[] }).list).toHaveLength(TRIPS_MAX + 4);
    });

    it("planId が無ければ 400", async () => {
        expect((await run(deleteTrip, ev("u1", { pathParameters: {} }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("書けなかったとき", () => {
    it("競合し続けたら 503（押し直せば通ると伝える）", async () => {
        for (let i = 0; i < 4; i++) {
            mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockRejectedValueOnce(condFail());
        }
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "旅" }) }));
        expect(res.statusCode).toBe(503);
    });

    it("それ以外の失敗は 500（200 を返して嘘をつかない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockRejectedValueOnce(new Error("boom"));
        const res = await run(createTrip, ev("u1", { body: JSON.stringify({ title: "旅" }) }));
        expect(res.statusCode).toBe(500);
    });

    it("`sub` が無ければ 400（空の行 ID を作らない）", async () => {
        const anon = { requestContext: { authorizer: { jwt: { claims: {} } } }, body: "{}" } as unknown as AnyEvent;
        for (const h of [getMyTrips, createTrip, updateTrip, deleteTrip]) {
            expect((await run(h, anon)).statusCode).toBe(400);
        }
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("道具の自己確認", () => {
    it("`isStoredTripPlan` は芯だけ見る（上限を下げても読めなくならない）", () => {
        expect(isStoredTripPlan(plan("a"))).toBe(true);
        // 日数が上限を超えていても「保存されている行」としては通す
        expect(isStoredTripPlan(plan("a", { days: Array.from({ length: 999 }, () => ({ items: [] })) }))).toBe(true);
        expect(isStoredTripPlan({ planId: "a", title: "t" }), "days が無い").toBe(false);
        expect(isStoredTripPlan({ planId: "", title: "t", days: [] }), "planId が空").toBe(false);
        expect(isStoredTripPlan(null)).toBe(false);
        expect(isStoredTripPlan("文字列")).toBe(false);
    });
    it("`fitsBudget` は通す例と断る例の両方を持つ", () => {
        expect(fitsBudget([plan("a")])).toBe(true);
        expect(fitsBudget([plan("a", { title: "あ".repeat(200_000) })])).toBe(false);
    });
    it("`fitsPlanBudget` も同じ（行より先に当たる）", () => {
        expect(fitsPlanBudget(plan("a"))).toBe(true);
        expect(fitsPlanBudget(plan("a", { title: "あ".repeat(60_000) })), "1プランの天井").toBe(false);
        expect(fitsBudget([plan("a", { title: "あ".repeat(60_000) })]), "行の天井にはまだ届かない").toBe(true);
    });
});
