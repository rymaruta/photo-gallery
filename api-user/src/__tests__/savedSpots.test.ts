import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 「行きたい場所」（撮影スポットの保存）。
 *
 * ここで固定したいのは4つ:
 *
 *  1. **重複して保存しない**（冪等）
 *  2. **解除できる**
 *  3. **本人だけが見られる** ——行 ID は JWT の `sub` からしか作らない。
 *     パス・クエリ・本文のどれで他人の ID を渡しても、読むのは自分の行
 *  4. **書けなかったら 200 を返さない** ——この一覧が唯一の状態なので、
 *     飲み込むと画面だけが「保存した」と言い続ける
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { getMySavedSpots, saveSpot, unsaveSpot, SAVED_SPOTS_MAX } = await import("../savedSpots");

type AnyEvent = Parameters<typeof saveSpot>[0];

/** 認証済みイベント。`sub` が「自分」 */
const ev = (sub: string, extra: Record<string, unknown> = {}) =>
    ({
        requestContext: { authorizer: { jwt: { claims: { sub } } }, http: { method: "POST" } },
        ...extra,
    }) as unknown as AnyEvent;

const run = async (h: typeof saveSpot, e: AnyEvent) =>
    (await h(e, {} as never, () => undefined)) as { statusCode: number; body: string; headers?: Record<string, string> };

const putInput = (i: number) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, unknown> }).input;
const getInput = (i: number) => (mockDdbSend.mock.calls[i][0] as { input: Record<string, unknown> }).input;
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

beforeEach(() => { mockDdbSend.mockReset(); });

describe("保存する（POST /user/spots）", () => {
    it("新しい順に積む", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["パリ"], rev: 2 } }).mockResolvedValueOnce({});
        const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: "山中湖" }) }));
        expect(res.statusCode).toBe(200);
        expect(putInput(1).Item).toMatchObject({ id: "spots#u1", uid: "u1", list: ["山中湖", "パリ"], rev: 3 });
        expect(JSON.parse(res.body)).toEqual({ saved: true, slugs: ["山中湖", "パリ"] });
    });

    // **二度押しても1件のまま**（`updateUserList` の mutate が null を返す＝書かない）
    it("既に保存済みなら書き込まない（冪等）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["山中湖"], rev: 1 } });
        const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: "山中湖" }) }));
        expect(res.statusCode).toBe(200);
        // 読みの1回だけ。Put は飛んでいない
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
        expect(JSON.parse(res.body)).toEqual({ saved: true, slugs: ["山中湖"] });
    });

    it("スラッグが空・`#` つきなら断る", async () => {
        for (const slug of ["", "spots#u2"]) {
            const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug }) }));
            expect(res.statusCode, `slug=${slug}`).toBe(400);
        }
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /**
     * **長さは「文字数」ではなく「バイト数」で見る。**
     *
     * `slugify`（`lib/utils/collections.ts`）は `clampSlugBytes` で 200
     * **バイト**に切る。日本語は1文字3バイトなので `slugify` が返せるのは
     * 66文字まで——文字数で 200 まで通していた頃は、**600バイトの値が
     * 保存できた**（開けない `/location/…` が一覧に残り、行が300KB近くまで育つ）。
     *
     * 66文字（198バイト）は通り、67文字（201バイト）は断ることで、
     * **判定の単位そのもの**を固定する。文字数に戻すとここが落ちる。
     */
    it("200バイトを超えるスラッグは断る（文字数ではなくバイト数）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockResolvedValueOnce({});
        const ok = "あ".repeat(66);   // 198 バイト
        expect(Buffer.byteLength(ok, "utf8")).toBe(198);
        expect((await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: ok }) }))).statusCode).toBe(200);

        mockDdbSend.mockReset();
        const ng = "あ".repeat(67);   // 201 バイト（文字数では 200 未満）
        expect(ng.length).toBeLessThan(200);
        expect((await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: ng }) }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /**
     * **上限を変える前に入った長い値も、見えて・外せる。**
     *
     * 読みと解除まで長さで断ると「GET には出ない／DELETE は 400／
     * 枠は占有したまま」の三すくみになる。いいねと違って**マーカーによる
     * 復旧経路が無い**ので、そうなると直す手が無い。
     */
    it("長すぎる値が既に入っていても、一覧に出て外せる", async () => {
        const long = "あ".repeat(300);
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [long, "パリ"] } });
        expect(JSON.parse((await run(getMySavedSpots, ev("u1"))).body).slugs).toContain(long);

        mockDdbSend.mockReset();
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [long, "パリ"], rev: 1 } }).mockResolvedValueOnce({});
        const res = await run(unsaveSpot, ev("u1", { pathParameters: { slug: long } }));
        expect(res.statusCode).toBe(200);
        expect(putInput(1).Item).toMatchObject({ list: ["パリ"] });
    });

    it("本文が JSON でなくても落ちない", async () => {
        const res = await run(saveSpot, ev("u1", { body: "{" }));
        expect(res.statusCode).toBe(400);
    });

    // **`likes.ts` の `noteLiked` と違って飲み込まない。** あちらは判定を
    // マーカーが持つので一覧が欠けても直せるが、こちらは一覧が唯一の状態
    it("書き込みに失敗したら 200 を返さない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { list: [], rev: 1 } })
            .mockRejectedValueOnce(Object.assign(new Error("no"), { name: "AccessDeniedException" }));
        const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: "パリ" }) }));
        expect(res.statusCode).toBe(500);
    });

    // 競合で諦めた回は押し直せば通る。「混み合っている」と分かる番号にする
    it("競合し続けたら 503", async () => {
        for (let i = 0; i < 8; i++) {
            mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockRejectedValueOnce(condFail());
        }
        const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: "パリ" }) }));
        expect(res.statusCode).toBe(503);
    });

    // 上限で切るのは `updateUserList` の仕事だが、**応答が返す一覧も
    // 切れていること**を見る（画面が保存されていない場所を出さない）
    it("上限を超えたら古い方が落ち、応答も切れている", async () => {
        const full = Array.from({ length: SAVED_SPOTS_MAX }, (_, i) => `s${i}`);
        mockDdbSend.mockResolvedValueOnce({ Item: { list: full, rev: 1 } }).mockResolvedValueOnce({});
        const res = await run(saveSpot, ev("u1", { body: JSON.stringify({ slug: "新" }) }));
        const body = JSON.parse(res.body) as { slugs: string[] };
        expect(body.slugs).toHaveLength(SAVED_SPOTS_MAX);
        expect(body.slugs[0]).toBe("新");
        expect(body.slugs).not.toContain(`s${SAVED_SPOTS_MAX - 1}`);
        expect((putInput(1).Item as { list: string[] }).list).toHaveLength(SAVED_SPOTS_MAX);
    });
});

describe("解除する（DELETE /user/spots/{slug}）", () => {
    it("一覧から外す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["山中湖", "パリ"], rev: 3 } }).mockResolvedValueOnce({});
        const res = await run(unsaveSpot, ev("u1", { pathParameters: { slug: "山中湖" } }));
        expect(res.statusCode).toBe(200);
        expect(putInput(1).Item).toMatchObject({ list: ["パリ"], rev: 4 });
        expect(JSON.parse(res.body)).toEqual({ saved: false, slugs: ["パリ"] });
    });

    it("入っていなければ書き込まない（冪等）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["パリ"], rev: 1 } });
        const res = await run(unsaveSpot, ev("u1", { pathParameters: { slug: "山中湖" } }));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    // **応答も上限で切る。** 足す側だけ切っていたので、上限を超えて入って
    // いる行では **DB の500件と応答の501件が食い違い**、画面が
    // 「保存されていない場所」を出し続けた
    it("上限を超えている行から外しても、応答は上限で切れている", async () => {
        const over = Array.from({ length: SAVED_SPOTS_MAX + 5 }, (_, i) => `s${i}`);
        mockDdbSend.mockResolvedValueOnce({ Item: { list: over, rev: 1 } }).mockResolvedValueOnce({});
        const res = await run(unsaveSpot, ev("u1", { pathParameters: { slug: "s0" } }));
        const body = JSON.parse(res.body) as { slugs: string[] };
        expect(body.slugs).toHaveLength(SAVED_SPOTS_MAX);
        // DB に書かれたぶんと同じ（食い違わない）
        expect(body.slugs).toEqual((putInput(1).Item as { list: string[] }).list);
    });

    it("スラッグが無ければ断る", async () => {
        expect((await run(unsaveSpot, ev("u1", { pathParameters: {} }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("一覧を読む（GET /user/spots）", () => {
    it("新しい順のまま返す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["山中湖", "パリ"] } });
        const res = await run(getMySavedSpots, ev("u1"));
        expect(JSON.parse(res.body)).toEqual({ slugs: ["山中湖", "パリ"] });
    });

    // **共有キャッシュに載せない。** 載せると次に来た別の人へ配られる
    it("private, no-store を付ける", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [] } });
        const res = await run(getMySavedSpots, ev("u1"));
        expect(res.headers?.["Cache-Control"]).toBe("private, no-store");
    });

    it("行が壊れていても落ちない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: "oops" } });
        expect(JSON.parse((await run(getMySavedSpots, ev("u1"))).body)).toEqual({ slugs: [] });
    });
});

/**
 * **本人だけが見られる。**
 *
 * 他人の一覧へ届く経路が「無い」ことを、**入力を変えても読む行が変わらない**
 * という形で固定する。ハンドラの中を読んで「uid を受け取っていないから
 * 大丈夫」と言うのでは、誰かがパスに `{uid}` を足した日に気づけない。
 */
describe("他人の一覧は読めない", () => {
    it("パス・クエリ・本文で他人の ID を渡しても、読むのは自分の行", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["ひみつ"] } });
        await run(getMySavedSpots, ev("me", {
            pathParameters: { uid: "victim", slug: "victim" },
            queryStringParameters: { uid: "victim" },
            body: JSON.stringify({ uid: "victim" }),
        }));
        expect(getInput(0).Key).toEqual({ id: "spots#me" });
    });

    it("保存も解除も、書くのは自分の行だけ", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { list: [], rev: 1 } }).mockResolvedValueOnce({});
        await run(saveSpot, ev("me", {
            pathParameters: { uid: "victim" },
            body: JSON.stringify({ slug: "パリ", uid: "victim" }),
        }));
        expect(getInput(0).Key).toEqual({ id: "spots#me" });
        expect(putInput(1).Item).toMatchObject({ id: "spots#me", uid: "me" });

        mockDdbSend.mockReset();
        mockDdbSend.mockResolvedValueOnce({ Item: { list: ["パリ"], rev: 1 } }).mockResolvedValueOnce({});
        await run(unsaveSpot, ev("me", { pathParameters: { slug: "パリ", uid: "victim" } }));
        expect(putInput(1).Item).toMatchObject({ id: "spots#me" });
    });

    // **認証が抜けた（sub が空）ときに `spots#` を読みに行かない。**
    // 空の sub を通すと、全員が同じ1行を共有することになる
    it("sub が無ければ断る（`spots#` を読みに行かない）", async () => {
        expect((await run(getMySavedSpots, ev(""))).statusCode).toBe(400);
        expect((await run(saveSpot, ev("", { body: JSON.stringify({ slug: "パリ" }) }))).statusCode).toBe(400);
        expect((await run(unsaveSpot, ev("", { pathParameters: { slug: "パリ" } }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});
