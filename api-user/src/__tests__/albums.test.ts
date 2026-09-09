import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const albumsModule = await import("../albums");
const addPhotoToAlbumModule = albumsModule;
const { createAlbum, listAlbums, createInvite, revokeInvite, getInvite, joinAlbum, isAlbumMember, addPhotoToAlbum } = albumsModule;
const { ALBUMS_PER_USER, MEMBERS_PER_ALBUM, PHOTOS_PER_ALBUM, INVITE_PREVIEW_PHOTOS, INVITE_LOOKUP_BUDGET, isValidInviteToken } = await import("../invite");

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
    // **途中で失敗したら、作ったアルバムを片付ける。**
    // 参加の印を書けないまま残すと「自分のアルバムなのに自分がメンバーで
    // ない」＝そこに写真を入れられない行ができる（一覧にも出ない）
    it("参加の印を書けなかったら、アルバムを消して 500", async () => {
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const id = String((cmd.input.Key as { id?: string })?.id ?? (cmd.input.Item as { id?: string })?.id ?? "");
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { albumIds: [] } });
            if (id.startsWith("albummember#")) return Promise.reject(new Error("boom"));
            return Promise.resolve({});
        });
        const r = await call(createAlbum, authed("u1", { title: "北欧の冬" }));
        expect(r.statusCode).toBe(500);
        const deleted = mockSend.mock.calls
            .map((c) => c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } })
            .filter((c) => c.constructor.name === "DeleteCommand")
            .map((c) => String(c.input.Key?.id ?? ""));
        expect(deleted.some((d) => d.startsWith("album#")), "作ったアルバムが残っている").toBe(true);
    });

    it("上限に達していたら作らない", async () => {
        mockSend.mockResolvedValueOnce({ Item: { albumIds: Array.from({ length: ALBUMS_PER_USER }, (_, i) => `a${i}`) } });
        const r = await call(createAlbum, authed("u1", { title: "もう1つ" }));
        expect(r.statusCode).toBe(403);
        expect(inputs().some((i) => String((i.Item as { id?: string })?.id ?? "").startsWith("album#")),
            "上限なのに作っている").toBe(false);
    });

    // **案内する操作が実際にできること。** 「使わないものを消してください」と
    // 言うなら、消す口が無いといけない（無い間は文言から落としていた）
    it("消せと案内するなら、消す口がある", async () => {
        mockSend.mockResolvedValueOnce({ Item: { albumIds: Array.from({ length: ALBUMS_PER_USER }, (_, i) => `a${i}`) } });
        const r = await call(createAlbum, authed("u1", { title: "もう1つ" }));
        if (/消し|削除/.test(String(bodyOf(r).error))) {
            expect(typeof (albumsModule as Record<string, unknown>).deleteAlbum,
                "消せない口を案内している").toBe("function");
        }
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
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", title: "旅1", memberIds: ["u1", "u2"] } })
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

// **書き戻しに失敗したら、いま作ったトークンを取り消す。**
// 取り消しは `album.inviteToken` からしか辿れないので、書き戻せないまま
// 残すと**取り消せない生きたリンクが30日残る**
describe("createInvite: 途中で失敗したとき", () => {
    it("アルバムに書き戻せなかったら、作ったトークンを取り消して 500", async () => {
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const key = String((cmd.input.Key as { id?: string })?.id ?? "");
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { id: "album#a1", ownerId: "u1" } });
            // アルバムへの書き戻しだけ落とす
            if (cmd.constructor.name === "UpdateCommand" && key.startsWith("album#")) {
                return Promise.reject(new Error("boom"));
            }
            return Promise.resolve({});
        });
        const r = await call(createInvite, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(500);
        const revoked = inputs().find((i) =>
            String((i.Key as { id?: string })?.id ?? "").startsWith("invite#")
            && String(i.UpdateExpression ?? "").includes("revoked"));
        expect(revoked, "取り消せないリンクが30日残る").toBeTruthy();
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
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u1", title: "北欧の冬", memberIds: ["u1", "u2", "u3"] } });
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

    it("参加すると、印を書いて一覧に足す", async () => {
        mockSend
            .mockResolvedValueOnce(live)
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberIds: ["u2"] } })
            .mockResolvedValueOnce({});                       // まだメンバーでない
        const r = await call(joinAlbum, authed("u1", undefined, { token: "a".repeat(32) }));
        expect(r.statusCode).toBe(200);
        const put = inputs().find((i) => String((i.Item as { id?: string })?.id ?? "") === "albummember#a1#u1");
        expect(put, "参加の印を書いていない").toBeTruthy();
        // **二重に入れない**（同時に2回押されても印は1つ）
        expect(String(put!.ConditionExpression)).toContain("attribute_not_exists(id)");
        const add = inputs().find((i) => String(i.UpdateExpression ?? "").includes("memberIds"));
        expect(add, "参加者の一覧に足していない").toBeTruthy();
        // **同時に2人が参加しても上限を超えない／重複しない**（条件付き更新）
        expect(String(add!.ConditionExpression)).toContain("size(memberIds) <");
        expect(String(add!.ConditionExpression)).toContain("NOT contains(memberIds, :uid)");
    });

    // **何度押しても同じ結果になる。** 招待リンクは共有されるので、
    // 同じ人が二度開くのは普通に起きる
    it("既に参加していれば、何も書かずに成功で返す", async () => {
        mockSend
            .mockResolvedValueOnce(live)
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberIds: ["u2", "u3"] } })
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
            .mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "u2", memberIds: Array.from({ length: MEMBERS_PER_ALBUM }, (_, i) => `m${i}`) } })
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


describe("getInvite: アルバムの写真", () => {
    const live = (extra: Record<string, unknown> = {}) => ({
        Item: { id: "invite#x", albumId: "a1", expiresAt: new Date(Date.now() + 60_000).toISOString(), ...extra },
    });
    const tok = { pathParameters: { token: "a".repeat(32) } };

    /**
     * **キーで返す。** 順番で返す `mockResolvedValueOnce` の並びだと、
     * 実装が ID をどの順で引いても同じ答えになる——`.reverse()` を
     * 消す変異が42件すべて緑のまま通っていた（レビューが実測）。
     */
    function serve(album: Record<string, unknown>, photos: Record<string, Record<string, unknown>>) {
        mockSend.mockImplementation((cmd: { input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (id.startsWith("invite#")) return Promise.resolve(live());
            if (id.startsWith("album#")) return Promise.resolve({ Item: { id, ...album } });
            return Promise.resolve({ Item: photos[id] });
        });
    }

    it("新しい方から返す", async () => {
        serve({ title: "旅", photoIds: ["p1", "p2"] }, {
            p1: { id: "p1", src: "https://cdn/1.jpg" },
            p2: { id: "p2", src: "https://cdn/2.jpg" },
        });
        const r = await call(getInvite, tok);
        expect(bodyOf(r).photos.map((p: { id: string }) => p.id), "新しい順になっていない").toEqual(["p2", "p1"]);
    });

    // **未認証で叩ける口なので、ここが最後の砦。**
    // 入る筋が2つある: 「下書き保存」でも `albumId` を送る／あとから
    // 非公開にしても `photoIds` からは消えない
    it("非公開・下書きの写真は出さない", async () => {
        serve({ title: "旅", photoIds: ["pub", "draft"] }, {
            pub: { id: "pub", src: "https://cdn/pub.jpg", published: true },
            draft: { id: "draft", src: "https://cdn/HIDDEN.jpg", published: false },
        });
        const r = await call(getInvite, tok);
        expect(r.body, "下書きが未認証で読める").not.toContain("HIDDEN");
        expect(bodyOf(r).photos.map((p: { id: string }) => p.id)).toEqual(["pub"]);
    });

    // 未指定は公開（リポジトリ全体の慣習）
    it("published を持たない古い行は出す", async () => {
        serve({ title: "旅", photoIds: ["old"] }, { old: { id: "old", src: "https://cdn/old.jpg" } });
        expect(bodyOf(await call(getInvite, tok)).photos.map((p: { id: string }) => p.id)).toEqual(["old"]);
    });

    // **未認証で叩ける口。** 全部引くと写真500枚で GetItem 500回になる
    it("決まった数までしか返さない", async () => {
        const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
        const photos = Object.fromEntries(ids.map((id) => [id, { id, src: `https://cdn/${id}.jpg` }]));
        serve({ title: "旅", photoIds: ids }, photos);
        const r = await call(getInvite, tok);
        expect(bodyOf(r).photos.length).toBe(INVITE_PREVIEW_PHOTOS);
        // 招待 + アルバム + 写真 の回数（それ以上引いていない）
        expect(mockSend.mock.calls.length).toBe(2 + INVITE_PREVIEW_PHOTOS);
    });

    // **死んだ ID で窓を埋めない。** 消された写真が直近24件に並ぶと、
    // 生きている写真があるのに空に見えていた
    it("消された写真は飛ばして、生きている写真で埋める", async () => {
        const ids = ["alive1", "dead1", "dead2", "alive2"];
        serve({ title: "旅", photoIds: ids }, {
            alive1: { id: "alive1", src: "https://cdn/1.jpg" },
            alive2: { id: "alive2", src: "https://cdn/2.jpg" },
            // dead1 / dead2 は行が無い
        });
        const r = await call(getInvite, tok);
        expect(bodyOf(r).photos.map((p: { id: string }) => p.id),
            "死んだ ID で窓が埋まっている").toEqual(["alive2", "alive1"]);
    });

    // **未認証で叩ける口なので、遡る回数にも歯止めが要る**
    it("全部死んでいても、読み取りは上限で打ち切る", async () => {
        const ids = Array.from({ length: 500 }, (_, i) => `dead${i}`);
        serve({ title: "旅", photoIds: ids }, {});
        const r = await call(getInvite, tok);
        expect(bodyOf(r).photos).toEqual([]);
        expect(mockSend.mock.calls.length, "好きなだけ読ませている").toBe(2 + INVITE_LOOKUP_BUDGET);
    });

    // **原本（GPS 入り）と S3 のキーを外に出さない**
    it("表示に要るものだけ返す", async () => {
        mockSend
            .mockResolvedValueOnce(live())
            .mockResolvedValueOnce({ Item: { id: "album#a1", title: "旅", photoIds: ["p1"] } })
            .mockResolvedValueOnce({ Item: {
                id: "p1", src: "https://cdn/1.jpg", thumbSrc: "https://cdn/t1.jpg",
                srcOriginal: "https://cdn/orig-with-gps.jpg", key: "uploads/u1/1.jpg",
                publicFeed: "1", staticStale: true,
            } });
        const r = await call(getInvite, tok);
        expect(r.body).not.toContain("orig-with-gps");
        expect(r.body).not.toContain("uploads/u1");
        expect(r.body).not.toContain("staticStale");
        expect(bodyOf(r).photos[0].thumbSrc).toBe("https://cdn/t1.jpg");
    });

    it("引けなかった写真・壊れた行は落とす", async () => {
        mockSend
            .mockResolvedValueOnce(live())
            .mockResolvedValueOnce({ Item: { id: "album#a1", title: "旅", photoIds: ["p1", "p2"] } })
            .mockResolvedValueOnce({})                                  // 消えた
            .mockResolvedValueOnce({ Item: { id: "p1" } });             // src が無い
        expect(bodyOf(await call(getInvite, tok)).photos).toEqual([]);
    });

    it("写真がまだ無くても 200 で返す", async () => {
        mockSend
            .mockResolvedValueOnce(live())
            .mockResolvedValueOnce({ Item: { id: "album#a1", title: "旅" } });
        const r = await call(getInvite, tok);
        expect(r.statusCode).toBe(200);
        expect(bodyOf(r).photos).toEqual([]);
    });
});


describe("removePhotoFromAlbum", () => {
    it("一覧から取り除く（書き直す前の一覧を条件にする）", async () => {
        mockSend
            .mockResolvedValueOnce({ Item: { id: "album#a1", photoIds: ["p1", "p2", "p3"] } })
            .mockResolvedValueOnce({});
        await addPhotoToAlbumModule.removePhotoFromAlbum("a1", "p2");
        const i = inputs()[1];
        expect((i.ExpressionAttributeValues as Record<string, unknown>)[":next"]).toEqual(["p1", "p3"]);
        // **その間に誰かが足していたら何もしない**（足された写真を取りこぼさない）
        expect(String(i.ConditionExpression)).toContain("photoIds = :prev");
    });

    it("そこに無ければ書きに行かない", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", photoIds: ["p1"] } });
        await addPhotoToAlbumModule.removePhotoFromAlbum("a1", "p2");
        expect(inputs().length, "無駄に書いている").toBe(1);
    });

    it("アルバムが無くても落ちない", async () => {
        mockSend.mockResolvedValueOnce({});
        await expect(addPhotoToAlbumModule.removePhotoFromAlbum("a1", "p1")).resolves.toBeUndefined();
    });
});

describe("addPhotoToAlbum: 二度入れない", () => {
    it("既に入っていれば条件で落ちる形になっている", async () => {
        await addPhotoToAlbum("a1", "p1");
        const i = inputs()[0];
        expect(String(i.ConditionExpression), "同じ写真を二度入れられる").toContain("NOT contains(photoIds, :id)");
        expect((i.ExpressionAttributeValues as Record<string, unknown>)[":id"]).toBe("p1");
    });
});


describe("renameAlbum", () => {
    it("未認証は 401", async () => {
        const r = await call(albumsModule.renameAlbum, { requestContext: { authorizer: { jwt: { claims: {} } } }, pathParameters: { id: "a1" }, body: "{}" });
        expect(r.statusCode).toBe(401);
    });

    it("名前が空なら 400（書きに行かない）", async () => {
        const r = await call(albumsModule.renameAlbum, authed("u1", { title: "  " }, { id: "a1" }));
        expect(r.statusCode).toBe(400);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it("持ち主だけが変えられる（条件に ownerId が入る）", async () => {
        const r = await call(albumsModule.renameAlbum, authed("u1", { title: "夏の旅" }, { id: "a1" }));
        expect(r.statusCode).toBe(200);
        const i = inputs()[0];
        expect(String(i.UpdateExpression)).toContain("title = :t");
        // **Get してから Update だと、その間に持ち主が変わる筋が残る**
        expect(String(i.ConditionExpression), "持ち主を見ていない").toContain("ownerId = :me");
    });

    // **持ち主でなければ「無い」と返す**（実在を教えない）
    it("持ち主でなければ 404", async () => {
        mockSend.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" }));
        expect((await call(albumsModule.renameAlbum, authed("u1", { title: "夏" }, { id: "a1" }))).statusCode).toBe(404);
    });
});

describe("deleteAlbum", () => {
    const deletedIds = () => mockSend.mock.calls
        .map((c) => c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } })
        .filter((c) => c.constructor.name === "DeleteCommand")
        .map((c) => String(c.input.Key?.id ?? ""));

    it("持ち主でなければ 404（何も消さない）", async () => {
        mockSend.mockResolvedValueOnce({ Item: { id: "album#a1", ownerId: "other" } });
        const r = await call(albumsModule.deleteAlbum, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(404);
        expect(deletedIds()).toEqual([]);
    });

    it("本体・参加の印を消し、一覧から外す", async () => {
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand" && id === "album#a1") {
                return Promise.resolve({ Item: { id, ownerId: "u1", memberIds: ["u1", "u2"] } });
            }
            if (cmd.constructor.name === "GetCommand" && id === "albums#u1") {
                return Promise.resolve({ Item: { albumIds: ["a1", "a2"] } });
            }
            return Promise.resolve({});
        });
        const r = await call(albumsModule.deleteAlbum, authed("u1", undefined, { id: "a1" }));
        expect(r.statusCode).toBe(200);
        const del = deletedIds();
        expect(del, "本体を消していない").toContain("album#a1");
        // **参加の印は一覧からしか辿れない**（前方一致で列挙できないテーブル）
        expect(del, "参加の印が残る").toContain("albummember#a1#u1");
        expect(del).toContain("albummember#a1#u2");
        const list = inputs().find((i) => String(i.UpdateExpression ?? "").includes("albumIds = :next"));
        expect((list!.ExpressionAttributeValues as Record<string, unknown>)[":next"]).toEqual(["a2"]);
    });

    // **アルバムの行を先に消すと、`inviteToken` から辿れなくなって
    // 取り消せないリンクが残る**
    it("招待リンクを、本体を消す前に取り消す", async () => {
        const tok = "t".repeat(32);
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand" && id === "album#a1") {
                return Promise.resolve({ Item: { id, ownerId: "u1", inviteToken: tok, memberIds: ["u1"] } });
            }
            return Promise.resolve({});
        });
        await call(albumsModule.deleteAlbum, authed("u1", undefined, { id: "a1" }));
        const order = mockSend.mock.calls.map((c) => {
            const cmd = c[0] as { constructor: { name: string }; input: { Key?: { id?: string } } };
            return `${cmd.constructor.name}:${cmd.input.Key?.id ?? ""}`;
        });
        const revokeAt = order.findIndex((o) => o === `UpdateCommand:invite#${tok}`);
        const deleteAt = order.findIndex((o) => o === "DeleteCommand:album#a1");
        expect(revokeAt, "招待を取り消していない").toBeGreaterThanOrEqual(0);
        expect(revokeAt, "本体を消したあとでは辿れない").toBeLessThan(deleteAt);
    });

    // **写真は消さない。** アルバムは束ねているだけ
    it("写真は消さない", async () => {
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: { Key?: { id?: string } } }) => {
            const id = String(cmd.input.Key?.id ?? "");
            if (cmd.constructor.name === "GetCommand" && id === "album#a1") {
                return Promise.resolve({ Item: { id, ownerId: "u1", memberIds: ["u1"], photoIds: ["p1", "p2"] } });
            }
            return Promise.resolve({});
        });
        await call(albumsModule.deleteAlbum, authed("u1", undefined, { id: "a1" }));
        expect(deletedIds().some((d) => d === "p1" || d === "p2"), "写真まで消している").toBe(false);
    });
});
