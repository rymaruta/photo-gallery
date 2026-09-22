import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ハイライト（⑦）。アーカイブのストーリーを束ねてマイページの輪にする。
 *
 * 見るのは4つ:
 *   1. **入れられるのは自分の・印のある・期限の切れたストーリーだけ**
 *      （黙って落とさず、理由を言って断る）
 *   2. 本体の行は `userId` を持たない（`userId-createdAt-index` に混ざらない）。
 *      一覧は `updateUserList` の行（`list` / `rev`）
 *   3. 🔴 **読む口は本人とフォロワーだけ**。未認証は 401、追っていない人には
 *      輪は0件・中身は 404。返すのは表示に要る列だけ——閲覧者・返信の数・
 *      `keptAs`・S3 のキーは出さない
 *   4. 持ち主でなければ 404（403 だと ID の実在を教える）
 */

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockSend }, PHOTOS_TABLE: "photos-test" }));
vi.stubEnv("USERS_TABLE", "users-test");

const {
    createHighlight, updateHighlight, deleteHighlight, getUserHighlights, getHighlight,
    HIGHLIGHTS_PER_USER, STORIES_PER_HIGHLIGHT, highlightKey, highlightsOfUserKey,
} = await import("../highlights");

type Result = { statusCode: number; headers?: Record<string, string>; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const bodyOf = (r: Result) => JSON.parse(r.body);
const authed = (sub: string, body?: unknown, pathParameters?: Record<string, string>) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(pathParameters ? { pathParameters } : {}),
});
/**
 * sub の無い呼び出し。`getUserId` は `requestContext.authorizer.jwt` を
 * そのまま辿るので、**認可ごと外した形にすると 401 ではなく例外**になる
 * （＝500）。ここで見たいのは「sub が取れないときに中身を出さないか」なので、
 * 器はそのままでクレームだけ空にする
 */
const anon = (pathParameters: Record<string, string>) => ({
    requestContext: { authorizer: { jwt: { claims: {} } } },
    pathParameters,
});

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const cmds = () => mockSend.mock.calls.map((c) => c[0] as Cmd);
const ofKind = (name: string) => cmds().filter((c) => c.constructor.name === name);
const puts = () => ofKind("PutCommand").map((c) => c.input.Item as Record<string, unknown>);

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sid = (n: number) => `story-${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** 公開アーカイブのストーリー1行（期限切れ・掃除済み） */
const archived = (n: number, extra: Record<string, unknown> = {}) => ({
    id: sid(n), story: true, userId: ME, src: `https://cdn.test/uploads/${ME}/${n}.webp`, key: `uploads/${ME}/${n}.webp`,
    createdAt: `2026-07-0${n}T10:00:00.000Z`, expiresAt: `2026-07-0${n + 1}T10:00:00.000Z`,
    archive: true, archivedAt: `2026-07-0${n + 1}T10:00:00.000Z`, ...extra,
});

/**
 * **キーで答える。** 順番で答えると、実装がどの ID をどの順で引いても同じ
 * 結果になる（`getInvite` のテストが実測した穴）。書き込みは記録するだけ
 */
function serve(store: Record<string, Record<string, unknown> | undefined>, deletedUser = false) {
    mockSend.mockImplementation((cmd: Cmd) => {
        const key = cmd.input.Key as { id?: string; userId?: string } | undefined;
        // users テーブル（墓石の確認）。鍵は `userId`
        if (cmd.input.TableName === "users-test") {
            return Promise.resolve({ Item: deletedUser ? { userId: key?.userId, deletedAt: "2026-07-01T00:00:00.000Z" } : { userId: key?.userId } });
        }
        if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: store[String(key?.id ?? "")] });
        if (cmd.constructor.name === "PutCommand") {
            const item = cmd.input.Item as { id: string };
            store[item.id] = item;
        }
        return Promise.resolve({});
    });
}

beforeEach(() => { mockSend.mockReset(); });

// ────────────────────────────────
// 1. 作る: 入れられるものだけ
// ────────────────────────────────
describe("createHighlight", () => {
    const create = (body: unknown) => call(createHighlight, authed(ME, body));

    it("公開アーカイブを束ねて、本体と一覧を書く（本体に userId を持たせない）", async () => {
        serve({ [sid(1)]: archived(1), [sid(2)]: archived(2) });
        const r = await create({ title: "  北海道  ", storyIds: [sid(2), sid(1), sid(2)] });
        expect(r.statusCode, r.body).toBe(200);
        const body = bodyOf(r).highlight;
        // 並びは保つ・重複は落とす・表紙は先頭
        expect(body.storyIds).toEqual([sid(2), sid(1)]);
        expect(body.coverStoryId).toBe(sid(2));
        expect(body.title).toBe("北海道");

        const row = puts().find((i) => String(i.id).startsWith("highlight#"))!;
        expect(row, "本体を書いていない").toBeTruthy();
        expect(row.ownerId).toBe(ME);
        expect(row, "`userId` を持つと userId-createdAt-index に載る（退会の掃除に混ざる）").not.toHaveProperty("userId");
        expect(row).not.toHaveProperty("storyFeed");
        const put = ofKind("PutCommand").find((c) => String((c.input.Item as { id: string }).id).startsWith("highlight#"))!;
        expect(String(put.input.ConditionExpression), "新規作成専用の条件が無い").toContain("attribute_not_exists(id)");

        const list = puts().find((i) => i.id === highlightsOfUserKey(ME))!;
        expect(list, "一覧を書いていない").toBeTruthy();
        expect(list.list).toEqual([body.id]);
    });

    it("表紙は選んだ中から。外の ID なら断る", async () => {
        serve({ [sid(1)]: archived(1), [sid(2)]: archived(2) });
        const ok = await create({ title: "旅", storyIds: [sid(1), sid(2)], coverStoryId: sid(2) });
        expect(bodyOf(ok).highlight.coverStoryId).toBe(sid(2));
        mockSend.mockClear();
        const ng = await create({ title: "旅", storyIds: [sid(1)], coverStoryId: sid(2) });
        expect(ng.statusCode).toBe(400);
        expect(puts(), "断ったのに書いている").toHaveLength(0);
    });

    // 公開範囲は owner が無くした（`storyVisibility.ts` の節）。ハイライトも
    // ストーリーもフォロワーにしか出ないので、**古い `visibility` の列が
    // 残っている行を断らない**（断ると、公開範囲があった頃に投稿した
    // アーカイブが永久にハイライトへ入れられなくなる）
    it("古い `visibility` の列が残っている行も入れられる（死んだ列は見ない）", async () => {
        serve({ [sid(1)]: archived(1, { visibility: "followers" }), [sid(2)]: archived(2, { visibility: "public" }) });
        const r = await create({ title: "旅", storyIds: [sid(1), sid(2)] });
        expect(r.statusCode, r.body).toBe(200);
        expect(bodyOf(r).highlight.storyIds).toEqual([sid(1), sid(2)]);
    });

    // 期限前の行を通すと、まだ生きているストーリーが閲覧の記録を残さずに読める
    it("まだ24時間が過ぎていない投稿は断る（アーカイブに入ってから）", async () => {
        serve({ [sid(1)]: archived(1, { expiresAt: "2099-01-01T00:00:00.000Z", archivedAt: undefined }) });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).error).toContain("24時間");
        expect(puts()).toHaveLength(0);
    });

    it("「アーカイブに自動保存」の無い投稿は断る（掃除が実体ごと消すので割れる）", async () => {
        serve({ [sid(1)]: archived(1, { archive: undefined }) });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).error).toContain("アーカイブに自動保存");
    });

    it("他人の投稿・無い投稿・ストーリーでない行は 404（実在を教えない）", async () => {
        serve({
            [sid(1)]: archived(1, { userId: OTHER }),
            [sid(2)]: undefined,
            [sid(3)]: { id: sid(3), userId: ME, src: "x", archive: true },   // story: true が無い
        });
        for (const id of [sid(1), sid(2), sid(3)]) {
            const r = await create({ title: "旅", storyIds: [id] });
            expect(r.statusCode, id).toBe(404);
        }
        expect(puts()).toHaveLength(0);
    });

    it("形の違う ID・空・上限超えは、引きにいく前に断る", async () => {
        serve({});
        for (const ids of [["story-x"], ["../etc"], [1], "story-1", []]) {
            mockSend.mockClear();
            const r = await create({ title: "旅", storyIds: ids });
            expect(r.statusCode, JSON.stringify(ids)).toBe(400);
            expect(ofKind("GetCommand"), `${JSON.stringify(ids)} で引きにいっている`).toHaveLength(0);
        }
        mockSend.mockClear();
        const many = Array.from({ length: STORIES_PER_HIGHLIGHT + 1 }, (_, i) => sid(i + 1));
        expect((await create({ title: "旅", storyIds: many })).statusCode).toBe(400);
        expect(ofKind("GetCommand")).toHaveLength(0);
    });

    it("名前が空なら断る", async () => {
        serve({ [sid(1)]: archived(1) });
        expect((await create({ title: "   ", storyIds: [sid(1)] })).statusCode).toBe(400);
        expect((await create({ storyIds: [sid(1)] })).statusCode).toBe(400);
    });

    // **上限は作る前に見る**（作ってから一覧に入れられないと、辿れない行が残る）
    it("上限に達していたら 403 で、何も書かない", async () => {
        serve({
            [sid(1)]: archived(1),
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: Array.from({ length: HIGHLIGHTS_PER_USER }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`), rev: 3 },
        });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        expect(r.statusCode).toBe(403);
        expect(puts()).toHaveLength(0);
    });

    it("新しいものを一覧の先頭に（輪は新しい順）", async () => {
        serve({
            [sid(1)]: archived(1),
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
        });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        const list = puts().find((i) => i.id === highlightsOfUserKey(ME))!;
        expect(list.list).toEqual([bodyOf(r).highlight.id, HID]);
    });

    // 「作る前」の検査と一覧の書き込みの間に、別の呼び出しが1つ足していた
    it("同時に作られて上限に達していたら、一覧に足さず本体を片付けて 403", async () => {
        const full = Array.from({ length: HIGHLIGHTS_PER_USER }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
        let listReads = 0;
        mockSend.mockImplementation((cmd: Cmd) => {
            const key = cmd.input.Key as { id?: string } | undefined;
            const id = String(key?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === sid(1)) return Promise.resolve({ Item: archived(1) });
                if (id === highlightsOfUserKey(ME)) {
                    listReads++;
                    // 1回目（作る前の検査）は19、2回目（書き込み前の読み直し）は20
                    return Promise.resolve({ Item: { id, list: listReads === 1 ? full.slice(1) : full, rev: listReads } });
                }
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        expect(r.statusCode).toBe(403);
        expect(puts().some((i) => i.id === highlightsOfUserKey(ME)), "上限を超えて一覧に足している").toBe(false);
        const del = ofKind("DeleteCommand").map((c) => (c.input.Key as { id: string }).id);
        expect(del.some((id) => id.startsWith("highlight#")), "本体を片付けていない").toBe(true);
    });

    // 一覧に足せなければ本体を片付ける（辿れない行を残さない）
    it("一覧の書き込みが転んだら本体を消して 500", async () => {
        const store: Record<string, Record<string, unknown> | undefined> = { [sid(1)]: archived(1) };
        serve(store);
        mockSend.mockImplementation((cmd: Cmd) => {
            const key = cmd.input.Key as { id?: string } | undefined;
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: store[String(key?.id ?? "")] });
            if (cmd.constructor.name === "PutCommand" && (cmd.input.Item as { id: string }).id === highlightsOfUserKey(ME)) {
                return Promise.reject(new Error("boom"));
            }
            return Promise.resolve({});
        });
        const r = await create({ title: "旅", storyIds: [sid(1)] });
        expect(r.statusCode).toBe(500);
        const del = ofKind("DeleteCommand").map((c) => (c.input.Key as { id: string }).id);
        expect(del.some((id) => id.startsWith("highlight#")), "作った本体を片付けていない").toBe(true);
    });
});

// ────────────────────────────────
// 2. 直す・消す: 持ち主だけ
// ────────────────────────────────
describe("updateHighlight / deleteHighlight", () => {
    const mine = { id: highlightKey(HID), ownerId: ME, title: "旧", storyIds: [sid(1)], coverStoryId: sid(1), createdAt: "2026-07-01T00:00:00.000Z" };

    it("直す: 持ち主の条件つきで置き換える", async () => {
        serve({ [highlightKey(HID)]: mine, [sid(1)]: archived(1), [sid(2)]: archived(2) });
        const r = await call(updateHighlight, authed(ME, { title: "新", storyIds: [sid(1), sid(2)], coverStoryId: sid(2) }, { id: HID }));
        expect(r.statusCode, r.body).toBe(200);
        const upd = ofKind("UpdateCommand")[0]!;
        expect(String(upd.input.ConditionExpression)).toContain("ownerId = :me");
        expect((upd.input.ExpressionAttributeValues as Record<string, unknown>)[":ids"]).toEqual([sid(1), sid(2)]);
        expect((upd.input.ExpressionAttributeValues as Record<string, unknown>)[":cover"]).toBe(sid(2));
    });

    it("直す: 他人のハイライトは 404（403 ではない）", async () => {
        serve({ [highlightKey(HID)]: { ...mine, ownerId: OTHER }, [sid(1)]: archived(1) });
        const r = await call(updateHighlight, authed(ME, { title: "新", storyIds: [sid(1)] }, { id: HID }));
        expect(r.statusCode).toBe(404);
        expect(ofKind("UpdateCommand")).toHaveLength(0);
    });

    it("直す: 中身の検査は作るときと同じ（期限前を断る）", async () => {
        serve({ [highlightKey(HID)]: mine, [sid(1)]: archived(1, { expiresAt: "2099-01-01T00:00:00.000Z", archivedAt: undefined }) });
        const r = await call(updateHighlight, authed(ME, { title: "新", storyIds: [sid(1)] }, { id: HID }));
        expect(r.statusCode).toBe(400);
        expect(bodyOf(r).error).toContain("24時間");
        expect(ofKind("UpdateCommand")).toHaveLength(0);
    });

    it("消す: 本体を持ち主の条件つきで消し、一覧から外す。中のストーリーは消さない", async () => {
        serve({
            [highlightKey(HID)]: mine,
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID, "other"], rev: 1 },
        });
        const r = await call(deleteHighlight, authed(ME, undefined, { id: HID }));
        expect(r.statusCode, r.body).toBe(200);
        const del = ofKind("DeleteCommand");
        expect(del.map((c) => (c.input.Key as { id: string }).id)).toEqual([highlightKey(HID)]);
        expect(String(del[0].input.ConditionExpression)).toContain("ownerId = :me");
        const list = puts().find((i) => i.id === highlightsOfUserKey(ME))!;
        expect(list.list).toEqual(["other"]);
        // 「無い」を根拠に外すので強整合で読む
        const get = ofKind("GetCommand").find((c) => (c.input.Key as { id: string }).id === highlightKey(HID))!;
        expect(get.input.ConsistentRead).toBe(true);
    });

    it("消す: 他人のもの・無いものは 404 で、本体を消さない", async () => {
        serve({ [highlightKey(HID)]: { ...mine, ownerId: OTHER } });
        expect((await call(deleteHighlight, authed(ME, undefined, { id: HID }))).statusCode).toBe(404);
        expect((await call(deleteHighlight, authed(ME, undefined, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }))).statusCode).toBe(404);
        expect(ofKind("DeleteCommand")).toHaveLength(0);
        // 一覧に無いので一覧も書かない
        expect(puts()).toHaveLength(0);
    });

    // 前回の削除で一覧の書き込みだけ転ぶと、幽霊の ID が枠を食い続ける。
    // 読む口は書けないので、もう一度 DELETE を呼んだときに外す
    it("消す: 本体が無くても自分の一覧に残っていれば外す（枠を食う幽霊）", async () => {
        serve({ [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID, "other"], rev: 4 } });
        const r = await call(deleteHighlight, authed(ME, undefined, { id: HID }));
        expect(r.statusCode).toBe(404);
        const list = puts().find((i) => i.id === highlightsOfUserKey(ME))!;
        expect(list, "幽霊を一覧から外していない").toBeTruthy();
        expect(list.list).toEqual(["other"]);
    });
});

// ────────────────────────────────
// 3. 読む: 本人とフォロワーだけ・GetItem だけ・要る列だけ
// ────────────────────────────────

/** `viewer` が `target` をフォローしている印（`followMarkerId` と同じ綴り） */
const followRow = (target: string, viewer: string) => ({
    [`follow#${target}#${viewer}`]: { id: `follow#${target}#${viewer}`, createdAt: "2026-07-01T00:00:00.000Z" },
});

describe("getUserHighlights（マイページの輪）", () => {
    const H2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const H3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    /** 本人が自分の輪を見る（`canSeeHighlights` は本人を素通しする） */
    const asOwner = () => authed(ME, undefined, { userId: ME });

    it("一覧の順に、題・数・表紙を返す。GetItem 以外を打たない", async () => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID, H2], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "北海道", storyIds: [sid(1), sid(2)], coverStoryId: sid(2) },
            [highlightKey(H2)]: { id: highlightKey(H2), ownerId: ME, title: "沖縄", storyIds: [sid(3)], coverStoryId: sid(3) },
            [sid(1)]: archived(1), [sid(2)]: archived(2, { mediaType: "video" }), [sid(3)]: archived(3),
        });
        const r = await call(getUserHighlights, asOwner());
        expect(r.statusCode, r.body).toBe(200);
        expect(bodyOf(r).highlights).toEqual([
            { id: HID, title: "北海道", count: 2, cover: { src: archived(2).src, mediaType: "video" } },
            { id: H2, title: "沖縄", count: 1, cover: { src: archived(3).src } },
        ]);
        expect(cmds().every((c) => c.constructor.name === "GetCommand"), "Query・Scan を打っている（索引を足さずに済む形のはず）").toBe(true);
        // 見る人によって中身が変わるので、共有キャッシュに載せさせない
        expect(r.headers?.["Cache-Control"], "CloudFront がフォロワー向けの輪を他人に配る").toBe("private, no-store");
    });

    it("持ち主が違う本体は出さない。表紙が消えていれば次の1枚、全部消えていれば null", async () => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID, H2, H3], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: OTHER, title: "他人", storyIds: [sid(1)] },
            [highlightKey(H2)]: { id: highlightKey(H2), ownerId: ME, title: "表紙が消えた", storyIds: [sid(9), sid(2)], coverStoryId: sid(9) },
            [highlightKey(H3)]: { id: highlightKey(H3), ownerId: ME, title: "全部消えた", storyIds: [sid(8)], coverStoryId: sid(8) },
            [sid(1)]: archived(1), [sid(2)]: archived(2),
        });
        const r = await call(getUserHighlights, asOwner());
        const hs = bodyOf(r).highlights;
        expect(hs.map((h: { id: string }) => h.id)).toEqual([H2, H3]);
        expect(hs[0].cover.src).toBe(archived(2).src);
        expect(hs[1].cover).toBeNull();
    });

    // 表紙に期限前の1枚が紛れても出さない（作るときに断っているが、最後の砦）
    it.each([
        ["期限前", { expiresAt: "2099-01-01T00:00:00.000Z" }],
        ["印が無い", { archive: undefined }],
        ["他人の行に差し替わった", { userId: OTHER }],
    ])("入れられない行（%s）は表紙にしない", async (_label, extra) => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "x", storyIds: [sid(1)], coverStoryId: sid(1) },
            [sid(1)]: archived(1, extra),
        });
        const r = await call(getUserHighlights, asOwner());
        expect(r.statusCode).toBe(200);
        expect(r.body).not.toContain(archived(1).src);
        expect(bodyOf(r).highlights[0].cover).toBeNull();
    });

    // ── 🔴 誰に見せるか ──
    // 本番で `/highlights/{userId}` が**誰でも読める**状態になっていた。
    // 中身はストーリーそのもので、ストーリーはフォロワーにしか出ない

    it("sub が取れなければ 401（引きにいかない）", async () => {
        serve({});
        const r = await call(getUserHighlights, anon({ userId: ME }));
        expect(r.statusCode).toBe(401);
        expect(mockSend, "認証を見る前に引いている").not.toHaveBeenCalled();
    });

    // 0件で返すのは、画面が「取得の失敗」と「0件」を分けて扱うため。
    // 403 にすると訪問者のプロフィールに赤い1行が出る
    it("追っていない人には 0件（本体も一覧も引かない）", async () => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "秘密", storyIds: [sid(1)], coverStoryId: sid(1) },
            [sid(1)]: archived(1),
        });
        const r = await call(getUserHighlights, authed(OTHER, undefined, { userId: ME }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).highlights).toEqual([]);
        expect(r.body).not.toContain("秘密");
        expect(r.body).not.toContain(archived(1).src);
        expect(r.headers?.["Cache-Control"]).toBe("private, no-store");
        const gets = ofKind("GetCommand").map((c) => String((c.input.Key as { id?: string }).id ?? ""));
        expect(gets.some((id) => id.startsWith("highlight")), "見せないのに引いている").toBe(false);
    });

    it("フォロワーには出る", async () => {
        serve({
            ...followRow(ME, OTHER),
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "北海道", storyIds: [sid(1)], coverStoryId: sid(1) },
            [sid(1)]: archived(1),
        });
        const r = await call(getUserHighlights, authed(OTHER, undefined, { userId: ME }));
        expect(r.statusCode, r.body).toBe(200);
        expect(bodyOf(r).highlights).toEqual([{ id: HID, title: "北海道", count: 1, cover: { src: archived(1).src } }]);
    });

    // **向きを間違えない。** `follow#<追われる人>#<追う人>`。逆向きの印
    // （相手が自分を追っている）で見せると、片思いされただけで中身が出る
    it("向きが逆の印では見せない（相手が自分を追っているだけ）", async () => {
        serve({
            ...followRow(OTHER, ME),
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "秘密", storyIds: [sid(1)] },
        });
        expect(bodyOf(await call(getUserHighlights, authed(OTHER, undefined, { userId: ME }))).highlights).toEqual([]);
    });

    // **読めなければ見せない。** ここを「見せる」に倒すと、DynamoDB が
    // 詰まった瞬間だけ他人のストーリーが配られる
    it("フォローの確認が転んだら 0件（見せる側に倒さない）", async () => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "秘密", storyIds: [sid(1)] },
        });
        const store = mockSend.getMockImplementation()!;
        mockSend.mockImplementation((cmd: Cmd) =>
            String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("follow#")
                ? Promise.reject(new Error("throttled"))
                : store(cmd));
        const r = await call(getUserHighlights, authed(OTHER, undefined, { userId: ME }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).highlights).toEqual([]);
        expect(r.body).not.toContain("秘密");
    });

    // 退会の掃除が転んで一覧が残っても、題（本人の書いた文字列）を返し続けない
    it("退会した人のものは 404（本体を引きにいかない）", async () => {
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "秘密", storyIds: [sid(1)] },
        }, true);
        const r = await call(getUserHighlights, asOwner());
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain("秘密");
        expect(ofKind("GetCommand").some((c) => c.input.TableName === "photos-test"), "墓石なのに写真テーブルを引いている").toBe(false);
    });

    // 引けなかったら出さない側に倒す
    it("墓石の確認が転んだら 404", async () => {
        serve({ [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 } });
        mockSend.mockImplementation((cmd: Cmd) => cmd.input.TableName === "users-test" ? Promise.reject(new Error("throttled")) : Promise.resolve({}));
        expect((await call(getUserHighlights, asOwner())).statusCode).toBe(404);
    });

    // 代わりの表紙を探すのは数枚まで（1つで最大100回の読み取りにしない）
    it("表紙の代わりを探すのは決まった数まで", async () => {
        const dead = Array.from({ length: 10 }, (_, i) => sid(10 + i));
        serve({
            [highlightsOfUserKey(ME)]: { id: highlightsOfUserKey(ME), list: [HID], rev: 1 },
            [highlightKey(HID)]: { id: highlightKey(HID), ownerId: ME, title: "x", storyIds: [...dead, sid(1)], coverStoryId: dead[0] },
            [sid(1)]: archived(1),
        });
        const r = await call(getUserHighlights, asOwner());
        const hs = bodyOf(r).highlights;
        expect(hs[0].count).toBe(11);
        expect(hs[0].cover, "上限を超えて探している").toBeNull();
        const storyGets = ofKind("GetCommand").filter((c) => String((c.input.Key as { id: string }).id).startsWith("story-"));
        expect(storyGets.length).toBeLessThanOrEqual(3);
    });

    it("形の違う userId は引きにいかない", async () => {
        serve({});
        expect((await call(getUserHighlights, authed(ME, undefined, { userId: "../x" }))).statusCode).toBe(404);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("一覧が無ければ空", async () => {
        serve({});
        expect(bodyOf(await call(getUserHighlights, asOwner())).highlights).toEqual([]);
    });
});

describe("getHighlight（開いたときの中身）", () => {
    const row = { id: highlightKey(HID), ownerId: ME, title: "北海道", storyIds: [sid(2), sid(1), sid(3)], coverStoryId: sid(1) };
    /** 本人が自分のハイライトを開く */
    const asOwner = (id: string) => authed(ME, undefined, { userId: ME, id });

    it("保存した並びで、表示に要る列だけを返す", async () => {
        serve({
            [highlightKey(HID)]: row,
            [sid(1)]: archived(1, { viewers: { [OTHER]: { displayName: "見た人" } }, replyCount: 3, keptAs: "p1", lat: 35, lng: 139, caption: "朝", texts: [{ t: "x" }] }),
            [sid(2)]: archived(2, { viewers: {}, replyCount: 0, storyFeed: "1", archivedAt: undefined }),
            [sid(3)]: archived(3),
        });
        const r = await call(getHighlight, asOwner(HID));
        expect(r.statusCode, r.body).toBe(200);
        const b = bodyOf(r);
        expect(b.title).toBe("北海道");
        expect(b.coverStoryId).toBe(sid(1));
        expect(b.items.map((s: { id: string }) => s.id)).toEqual([sid(2), sid(1), sid(3)]);
        // 他人の名前・数・内部の印・S3 のキー・座標は出さない
        expect(r.body).not.toContain("見た人");
        for (const k of ["viewers", "replyCount", "keptAs", "key", "lat", "lng", "storyFeed"]) {
            expect(b.items.some((s: Record<string, unknown>) => k in s), `${k} が漏れている`).toBe(false);
        }
        expect(b.items[1].caption).toBe("朝");
        expect(b.items[1].texts).toEqual([{ t: "x" }]);
        // 返信の欄は出させない・アーカイブとして開かせる（掃除前の行にも期限の時刻を埋める）
        for (const s of b.items) {
            expect(s.allowReplies).toBe(false);
            expect(s.archive).toBe(true);
            expect(typeof s.archivedAt).toBe("string");
        }
        expect(b.items[0].archivedAt).toBe(archived(2).expiresAt);
        expect(cmds().every((c) => c.constructor.name === "GetCommand")).toBe(true);
        expect(r.headers?.["Cache-Control"], "見る人で 200 と 404 が割れるので共有キャッシュに載せない").toBe("private, no-store");
    });

    it("消えた・他人の・印の無い・期限前の行は落とす（最後の砦）", async () => {
        serve({
            [highlightKey(HID)]: { ...row, storyIds: [sid(1), sid(2), sid(3), sid(4), sid(5), sid(6)] },
            [sid(1)]: archived(1),
            [sid(2)]: undefined,
            [sid(3)]: archived(3, { userId: OTHER, src: "https://cdn.test/OTHERS.webp" }),
            // 公開範囲は無くなった（`storyVisibility.ts`）。死んだ列を見て落とすと、
            // 昔の投稿を入れたハイライトが**中身だけ空**になる
            [sid(4)]: archived(4, { visibility: "followers" }),
            [sid(5)]: archived(5, { archive: undefined, src: "https://cdn.test/NOARCHIVE.webp" }),
            [sid(6)]: archived(6, { expiresAt: "2099-01-01T00:00:00.000Z", src: "https://cdn.test/LIVE.webp" }),
        });
        const r = await call(getHighlight, asOwner(HID));
        expect(bodyOf(r).items.map((s: { id: string }) => s.id)).toEqual([sid(1), sid(4)]);
        for (const s of ["OTHERS", "NOARCHIVE", "LIVE"]) expect(r.body, s).not.toContain(s);
    });

    it("退会した人のものは 404", async () => {
        serve({ [highlightKey(HID)]: row, [sid(1)]: archived(1) }, true);
        expect((await call(getHighlight, asOwner(HID))).statusCode).toBe(404);
    });

    it("持ち主が URL の人でなければ 404（本体は読めても中身を引かない）", async () => {
        // URL の人（OTHER）を追っている状態にして、フォローの門を越えさせる
        serve({ ...followRow(OTHER, ME), [highlightKey(HID)]: row, [sid(1)]: archived(1) });
        const r = await call(getHighlight, authed(ME, undefined, { userId: OTHER, id: HID }));
        expect(r.statusCode).toBe(404);
        const gets = ofKind("GetCommand").map((c) => String((c.input.Key as { id?: string }).id ?? ""));
        expect(gets.some((id) => id.startsWith("story-")), "持ち主が違うのに中身を引いている").toBe(false);
    });

    it("形の違う ID は引きにいかない", async () => {
        serve({});
        expect((await call(getHighlight, authed(ME, undefined, { userId: ME, id: "x" }))).statusCode).toBe(404);
        expect((await call(getHighlight, authed(ME, undefined, { userId: "x", id: HID }))).statusCode).toBe(404);
        expect(mockSend).not.toHaveBeenCalled();
    });

    // ── 🔴 誰に見せるか（輪と同じ線） ──

    it("sub が取れなければ 401（引きにいかない）", async () => {
        serve({});
        const r = await call(getHighlight, anon({ userId: ME, id: HID }));
        expect(r.statusCode).toBe(401);
        expect(mockSend).not.toHaveBeenCalled();
    });

    // 輪（0件）と違って 404。在ることも教えない
    it("追っていない人には 404（本体も中身も引かない）", async () => {
        serve({ [highlightKey(HID)]: row, [sid(1)]: archived(1) });
        const r = await call(getHighlight, authed(OTHER, undefined, { userId: ME, id: HID }));
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain("北海道");
        const gets = ofKind("GetCommand").map((c) => String((c.input.Key as { id?: string }).id ?? ""));
        expect(gets.some((id) => id.startsWith("highlight#") || id.startsWith("story-")), "見せないのに引いている").toBe(false);
    });

    it("フォロワーには中身が出る", async () => {
        serve({ ...followRow(ME, OTHER), [highlightKey(HID)]: row, [sid(1)]: archived(1), [sid(2)]: archived(2), [sid(3)]: archived(3) });
        const r = await call(getHighlight, authed(OTHER, undefined, { userId: ME, id: HID }));
        expect(r.statusCode, r.body).toBe(200);
        expect(bodyOf(r).items.map((s: { id: string }) => s.id)).toEqual([sid(2), sid(1), sid(3)]);
    });

    it("フォローの確認が転んだら 404（見せる側に倒さない）", async () => {
        serve({ [highlightKey(HID)]: row, [sid(1)]: archived(1) });
        const store = mockSend.getMockImplementation()!;
        mockSend.mockImplementation((cmd: Cmd) =>
            String((cmd.input.Key as { id?: string })?.id ?? "").startsWith("follow#")
                ? Promise.reject(new Error("throttled"))
                : store(cmd));
        const r = await call(getHighlight, authed(OTHER, undefined, { userId: ME, id: HID }));
        expect(r.statusCode).toBe(404);
        expect(r.body).not.toContain("北海道");
    });
});

// ────────────────────────────────
// 4. 配線: 読む口は読み取り専用ロール
// ────────────────────────────────
describe("serverless.yml", () => {
    const yml = fs.readFileSync(path.join(__dirname, "..", "..", "serverless.yml"), "utf8");
    const block = (fn: string) => {
        const m = yml.match(new RegExp(`\\n  ${fn}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`));
        expect(m, `${fn} が serverless.yml に無い`).toBeTruthy();
        return m![1];
    };

    // 🔴 **読む口にもログインが要る。** 中身はストーリーそのもので、一覧
    // （`getStories`）は認証必須——「全員に公開」は**ログインした全員**の
    // 意味なので、未認証で開くと投稿者が選んだ範囲より広く配ることになる。
    // 一度そうして本番まで出した（`/highlights/{userId}` が誰でも読めた）
    it("5つとも cognitoAuthorizer が要る（未認証で読める口を作らない）", () => {
        for (const fn of ["getUserHighlights", "getHighlight", "createHighlight", "updateHighlight", "deleteHighlight"]) {
            expect(block(fn), `${fn} が認可なし`).toContain("name: cognitoAuthorizer");
        }
    });

    // `PublicReadRole` は「未認証で呼べる口」の目印。認可を付けた関数に
    // 残すと `scripts/__tests__/publicLambdaRole.test.ts` の対応が崩れる
    it("読み取り専用ロールは付けない（未認証の口の目印なので）", () => {
        for (const fn of ["getUserHighlights", "getHighlight"]) {
            expect(block(fn), `${fn} に未認証の口の目印が残っている`).not.toContain("PublicReadRole");
        }
    });
});
