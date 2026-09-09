import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { createAlbum, listAlbums, createInvite, revokeInvite, getInvite, joinAlbum, isAlbumMember, addPhotoToAlbum } = await import("../albums");
const { ALBUMS_PER_USER, MEMBERS_PER_ALBUM, PHOTOS_PER_ALBUM, isValidInviteToken } = await import("../invite");

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
const call = (fn: unknown, event: unknown): Promise<Result> => (fn as any)(event);

const authed = (sub: string, body?: unknown, path?: Record<string, string>) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: path,
    body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
});

/** 送られた各コマンドの入力（コンストラクタが持っている） */
const inputs = () => mockSend.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);
const bodyOf = (r: Result) => JSON.parse(r.body);

beforeEach(() => { mockSend.mockReset().mockResolvedValue({}); });

// 共同アルバム（案C）。**未認証で読める口が1つある**ので、
//   - 持ち主でない相手には「無い」と返す（実在を教えない）
//   - 招待の形を DynamoDB に投げる前に見る（無駄な読み取りを起こさせない）
// を重点的に固定する。

describe("createAlbum", () => {
    it("未認証は 401", async () => {
        const r = await call(createAlbum, { requestContext: { authorizer: { jwt: { claims: {} } } }, body: "{}" });
        expect(r.statusCode).toBe(401);
    });

    it("壊れた JSON は 400", async () => {
        expect((await call(createAlbum, authed("u1", "{broken"))).statusCode).toBe(400);
    });

    it("名前が空なら 400", async () => {
        expect((await call(createAlbum, authed("u1", { title: "   " }))).statusCode).toBe(400);
    });

    it("作ると、アルバム・参加の印・一覧の3つを書く", async () => {
        mockSend.mockResolvedValueOnce({ Item: { albumIds: [] } });   // 既存の一覧
        const r = await call(createAlbum, authed("u1", { title: "北欧の冬" }));
        expect(r.statusCode).toBe(200);
        const ins = inputs();
        const album = ins.find((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("album#"));
        const member = ins.find((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("albummember#"));
        const list = ins.find((i) => String((i.Key as { id?: string })?.id ?? "").startsWith("albums#"));
        expect(album, "アルバムの行を書いていない").toBeTruthy();
        expect((album!.Item as { ownerId: string; title: string }).ownerId).toBe("u1");
        expect((album!.Item as { title: string }).title).toBe("北欧の冬");
        // **既存の行を丸ごと置き換えない**（同居する通知やコメントを消さないため）
        expect(album!.ConditionExpression).toContain("attribute_not_exists(id)");
        expect(member, "作った人が参加者になっていない").toBeTruthy();
        expect(list, "一覧に足していない").toBeTruthy();
    });

    // **上限は作る前に見る。** 作ってから一覧に入れられないと、
    // どこからも辿れないアルバムが残る
    it("上限に達していたら作らない", async () => {
        mockSend.mockResolvedValueOnce({ Item: { albumIds: Array.from({ length: ALBUMS_PER_USER }, (_, i) => `a${i}`) } });
        const r = await call(createAlbum, authed("u1", { title: "もう1つ" }));
        expect(r.statusCode).toBe(403);
        expect(inputs().some((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("album#")),
            "上限なのに作っている").toBe(false);
    });

    it("上限の1つ手前は作れる（境界）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { albumIds: Array.from({ length: ALBUMS_PER_USER - 1 }, (_, i) => `a${i}`) } });
        expect((await call(createAlbum, authed("u1", { title: "ぎりぎり" }))).statusCode).toBe(200);
    });
});

describe("listAlbums", () => {
    it("自分のものだけ返す", async () => {
        mockSend
            .mockResolvedValueOnce({ Item: { albumIds: ["a1", "a2"] } })
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", title: "旅1", memberCount: 2 } })
            .mockResolvedValueOnce({ Item: { id: "album#a2", ownerId: "other", title: "他人の" } });
        const r = await call(listAlbums, authed("u1"));
        expect(bodyOf(r).albums.map((a: { id: string }) => a.id)).toEqual(["a1"]);
    });

    // 消えたアルバムの ID が一覧に残っていても、開けない何かを画面に出さない
    it("引けなかった行は落とす", async () => {
        mockSend
            .mockResolvedValueOnce({ Item: { albumIds: ["a1"] } })
            .mockResolvedValueOnce({});
        expect(bodyOf(await call(listAlbums, authed("u1"))).albums).toEqual([]);
    });

    it("一覧が無ければ空で返す（エラーにしない）", async () => {
        mockSend.mockResolvedValueOnce({});
        const r = await call(listAlbums, authed("u1"));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).albums).toEqual([]);
    });
});

describe("createInvite", () => {
    // **持ち主でなければ「無い」と返す。** 403 だと、その ID のアルバムが
    // 実在することを教えてしまう
    it("持ち主でなければ 404（403 にしない）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "other" } });
        const r = await call(createInvite, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(404);
    });

    it("アルバムが無ければ 404", async () => {
        mockSend.mockResolvedValueOnce({});
        expect((await call(createInvite, authed("u1", undefined, { id: "a1" }))).statusCode).toBe(404);
    });

    it("推測できないトークンを発行し、アルバムに書き戻す", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1" } });
        const r = await call(createInvite, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(200);
        const { token, expiresAt } = bodyOf(r);
        expect(isValidInviteToken(token), "形が招待トークンになっていない").toBe(true);
        expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
        const write = inputs().find((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("invite#"));
        expect((write!.Item as { albumId: string }).albumId).toBe("a1");
        const back = inputs().find((i) => String(i.UpdateExpression ?? "").includes("inviteToken = :t"));
        expect(back, "アルバムに書き戻していない").toBeTruthy();
        // 書き戻しも持ち主だけ（Get と Update の間に持ち主が変わる筋を塞ぐ）
        expect(String(back!.ConditionExpression)).toContain("ownerId = :me");
    });

    // **前のリンクを取り消す。** 新しいのを配ったのに古いのが生きていると
    // 「取り消したつもり」が効かない
    it("前の招待リンクを取り消す", async () => {
        const old = "o".repeat(32);
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", inviteToken: old } });
        await call(createInvite, authed("u1", undefined, { id: "a1" }));
        const revoke = inputs().find((i) => String((i.Key as { id?: string })?.id ?? "") === `invite#${old}`);
        expect(revoke, "前のリンクを取り消していない").toBeTruthy();
        expect(String(revoke!.UpdateExpression)).toContain("revoked");
    });
});

describe("revokeInvite", () => {
    it("持ち主でなければ 404", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "other", inviteToken: "t".repeat(32) } });
        expect((await call(revokeInvite, authed("u1", undefined, { id: "a1" }))).statusCode).toBe(404);
    });

    it("リンクを取り消し、アルバムからも消す", async () => {
        const tok = "t".repeat(32);
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", inviteToken: tok } });
        const r = await call(revokeInvite, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(200);
        expect(inputs().some((i) => String((i.Key as { id?: string })?.id ?? "") === `invite#${tok}`)).toBe(true);
        expect(inputs().some((i) => String(i.UpdateExpression ?? "").includes("REMOVE inviteToken"))).toBe(true);
    });

    // 押し直しても同じ結果になる（既に無いものを消してもエラーにしない）
    it("リンクが無くても成功で返す", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1" } });
        expect((await call(revokeInvite, authed("u1", undefined, { id: "a1" }))).statusCode).toBe(200);
    });
});

describe("getInvite（未認証で読める）", () => {
    const live = (albumId = "a1") => ({
        Item: { id: "invite#x", albumId, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });

    // **形を先に見る。** DynamoDB に投げる前に落とせば、未認証の口で
    // 無駄な読み取りを好きなだけ起こされない
    it.each(["short", "", "a".repeat(200), "bad+token/=".padEnd(40, "x")])("形が違えば読みに行かない（%s）", async (t) => {
        const r = await call(getInvite, { pathParameters: { token: t } });
        expect(r.statusCode).toBe(404);
        expect(mockSend, "DynamoDB を引きに行っている").not.toHaveBeenCalled();
    });

    it("生きている招待はアルバムの概要を返す", async () => {
        mockSend
            .mockResolvedValueOnce(live())
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", title: "北欧の冬", memberCount: 3 } });
        const r = await call(getInvite, { pathParameters: { token: "a".repeat(32) } });
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).album).toEqual({ id: "a1", title: "北欧の冬", memberCount: 3 });
        // **キャッシュさせない**（取り消しが効かなくなる）
        expect(r.headers?.["Cache-Control"]).toBe("no-store");
    });

    // **持ち主の userId を外に出さない**（未認証で読める口なので）
    it("持ち主の id は返さない", async () => {
        mockSend
            .mockResolvedValueOnce(live())
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1-secret", title: "旅" } });
        const r = await call(getInvite, { pathParameters: { token: "a".repeat(32) } });
        expect(r.body).not.toContain("u1-secret");
    });

    it("期限切れは 410（理由が分かる）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "invite#x", albumId: "a1", expiresAt: new Date(Date.now() - 1).toISOString() } });
        const r = await call(getInvite, { pathParameters: { token: "a".repeat(32) } });
        expect(r.statusCode).toBe(410);
        expect(bodyOf(r).error).toContain("期限");
    });

    it("取り消し済みは 410", async () => {
        mockSend.mockResolvedValueOnce({ Item: { ...live().Item, revoked: true } });
        const r = await call(getInvite, { pathParameters: { token: "a".repeat(32) } });
        expect(r.statusCode).toBe(410);
        expect(bodyOf(r).error).toContain("取り消");
    });

    it("無い招待は 404", async () => {
        mockSend.mockResolvedValueOnce({});
        expect((await call(getInvite, { pathParameters: { token: "a".repeat(32) } })).statusCode).toBe(404);
    });

    // 招待は生きているのにアルバムが無い＝掃除の取りこぼし。利用者には同じ文言
    it("行き先のアルバムが無ければ 404", async () => {
        mockSend.mockResolvedValueOnce(live()).mockResolvedValueOnce({});
        expect((await call(getInvite, { pathParameters: { token: "a".repeat(32) } })).statusCode).toBe(404);
    });
});


describe("joinAlbum（参加はログインが要る）", () => {
    const live = { Item: { id: "invite#x", albumId: "a1", expiresAt: new Date(Date.now() + 60_000).toISOString() } };

    it("未認証は 401", async () => {
        const r = await call(joinAlbum, { requestContext: { authorizer: { jwt: { claims: {} } } }, pathParameters: { token: "a".repeat(32) } });
        expect(r.statusCode).toBe(401);
    });

    it("形の違うトークンは読みに行かない", async () => {
        const r = await call(joinAlbum, authed("u1", undefined, { token: "short" }));
        expect(r.statusCode).toBe(404);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("期限切れは 410", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "invite#x", albumId: "a1", expiresAt: new Date(Date.now() - 1).toISOString() } });
        expect((await call(joinAlbum, authed("u1", undefined, { token: "a".repeat(32) }))).statusCode).toBe(410);
    });

    it("参加すると、印を書いて人数を増やす", async () => {
        mockSend
            .mockResolvedValueOnce(live)
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberCount: 1 } })
            .mockResolvedValueOnce({});                       // まだメンバーでない
        const r = await call(joinAlbum, authed("u1", undefined, { token: "a".repeat(32) }));
        expect(r.statusCode).toBe(200);
        const put = inputs().find((i) => String((i.Item as { id?: string })?.id ?? "") === "albummember#a1#u1");
        expect(put, "参加の印を書いていない").toBeTruthy();
        // **二重に入れない**（同時に2回押されても印は1つ）
        expect(String(put!.ConditionExpression)).toContain("attribute_not_exists(id)");
        expect(inputs().some((i) => String(i.UpdateExpression ?? "").includes("memberCount")),
            "人数を増やしていない").toBe(true);
    });

    // **何度押しても同じ結果になる。** 招待リンクは共有されるので、
    // 同じ人が二度開くのは普通に起きる
    it("既に参加していれば、何も書かずに成功で返す", async () => {
        mockSend
            .mockResolvedValueOnce(live)
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberCount: 2 } })
            .mockResolvedValueOnce({ Item: { id: "albummember#a1#u1" } });
        const r = await call(joinAlbum, authed("u1", undefined, { token: "a".repeat(32) }));
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).already).toBe(true);
        expect(inputs().some((i) => i.Item), "何か書いている").toBe(false);
    });

    // **黙って切り捨てない**（`following` の2000人切り捨てと同じ形を作らない）
    it("人数の上限に達していたら断る", async () => {
        mockSend
            .mockResolvedValueOnce(live)
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberCount: MEMBERS_PER_ALBUM } })
            .mockResolvedValueOnce({});
        const r = await call(joinAlbum, authed("u1", undefined, { token: "a".repeat(32) }));
        expect(r.statusCode).toBe(403);
        expect(inputs().some((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("albummember#"))).toBe(false);
    });
});

describe("isAlbumMember", () => {
    it("印があれば true", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "albummember#a1#u1" } });
        expect(await isAlbumMember("a1", "u1")).toBe(true);
    });

    it("印が無ければ false", async () => {
        mockSend.mockResolvedValueOnce({});
        expect(await isAlbumMember("a1", "u1")).toBe(false);
    });

    // 空を渡したときに DynamoDB を引きに行かない（無駄な読み取りを作らない）
    it.each([["", "u1"], ["a1", ""]])("空なら引きに行かない（%s,%s）", async (a, u) => {
        expect(await isAlbumMember(a, u)).toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
    });
});

describe("addPhotoToAlbum", () => {
    it("上限を超えたら足さない条件が付いている", async () => {
        await addPhotoToAlbum("a1", "p1");
        const i = inputs()[0];
        expect(String(i.UpdateExpression)).toContain("list_append");
        expect(String(i.ConditionExpression), "上限を見ていない").toContain("size(photoIds) <");
        expect((i.ExpressionAttributeValues as Record<string, unknown>)[":max"]).toBe(PHOTOS_PER_ALBUM);
    });
});
