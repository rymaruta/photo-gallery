import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * **公開範囲を絞った写真（フォロワーのみ・親しい友達）に、ID だけで触れない**（S-1）。
 *
 * コメント・いいね・保存の口は `published` と `story` しか見ておらず、
 * 写真の ID を知った人（元フォロワーなど）が限定写真のコメントを読み、
 * コメント・いいね・保存ができ、持ち主に通知まで飛んだ。
 *
 * ここでは**ブロック・フォロー・親しい友達の判定を本物のまま**通す
 * （`blockCheck` / `followCheck` / `userList` をモックしない）。
 * 位置指定のモック列ではなく、**キーで答える作り物のテーブル**を置く——
 * 判定の材料を何回どの順で読むかに縛られず、「誰に通るか」だけを見るため。
 */

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("../notify", () => ({
    pushNotification: mockPush,
    lookupDisplayName: vi.fn(async () => "名前"),
    deletedUserIds: vi.fn(async () => new Set<string>()),
    DELETED_USER_NAME: "退会したユーザー",
}));

type Row = Record<string, unknown>;
const table = vi.hoisted(() => new Map<string, Record<string, unknown>>());

function condFail() {
    return Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
}

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

/** 作り物のテーブル。写真の `likes` の条件式だけは、公開範囲の部分を本当に評価する */
function fakeSend(cmd: { constructor: { name: string }; input: Row }) {
    const kind = cmd.constructor.name;
    const input = cmd.input as {
        Key?: { id: string }; Item?: Row; ConditionExpression?: string;
        UpdateExpression?: string; ExpressionAttributeValues?: Row;
    };
    const id = input.Key?.id ?? String(input.Item?.id ?? "");
    const row = table.get(id);
    switch (kind) {
        case "GetCommand":
            return Promise.resolve(row ? { Item: { ...row } } : {});
        case "PutCommand":
            if (input.ConditionExpression?.includes("attribute_not_exists(id)") && row) {
                return Promise.reject(condFail());
            }
            table.set(id, { ...input.Item });
            return Promise.resolve({});
        case "DeleteCommand":
            if (input.ConditionExpression?.includes("attribute_exists(id)") && !row) {
                return Promise.reject(condFail());
            }
            table.delete(id);
            return Promise.resolve({});
        case "UpdateCommand": {
            const cond = input.ConditionExpression ?? "";
            const vals = input.ExpressionAttributeValues ?? {};
            if (id.startsWith("comments#")) {
                const items = [...((row?.items as unknown[]) ?? []), ...((vals[":new"] as unknown[]) ?? [])];
                table.set(id, { ...(row ?? { id }), items });
                return Promise.resolve({ Attributes: { items } });
            }
            if (!row) return Promise.reject(condFail());
            if (input.UpdateExpression?.includes("likes - :one")) {
                if (!(Number(row.likes ?? 0) > 0)) return Promise.reject(condFail());
                const next = { ...row, likes: Number(row.likes) - 1 };
                table.set(id, next);
                return Promise.resolve({ Attributes: next });
            }
            if (input.UpdateExpression?.includes("likes")) {
                if (cond.includes("attribute_not_exists(audience)") && row.audience) return Promise.reject(condFail());
                if (cond.includes("audience = :aud") && row.audience !== vals[":aud"]) return Promise.reject(condFail());
                const next = { ...row, likes: Number(row.likes ?? 0) + 1 };
                table.set(id, next);
                return Promise.resolve({ Attributes: next });
            }
            return Promise.resolve({});
        }
        default:
            return Promise.resolve({});
    }
}

const { getComments, getCommentsAuthed, postComment } = await import("../comments");
const { likePhoto, unlikePhoto, getLikeCount, getMyLike } = await import("../likes");
const { savePhoto } = await import("../saves");
const { reportPhoto } = await import("../report");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

function ev(sub: string | undefined, id: string, body?: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } }, http: { method: "POST" } },
        pathParameters: { id },
        body: body === undefined ? undefined : JSON.stringify(body),
    };
}

const OWNER = "owner-0001";
const FOLLOWER = "follower-01";
const CLOSE = "closefr-001";     // 親しい友達に入っている（フォローはしていない）
const STRANGER = "stranger-01";

const photo = (id: string, extra: Row = {}): Row => ({
    id, src: `https://cdn/${id}.jpg`, userId: OWNER, published: true, ...extra,
});

beforeEach(() => {
    table.clear();
    mockPush.mockReset();
    mockSend.mockReset().mockImplementation(fakeSend);
    table.set("pub", photo("pub"));
    table.set("pf", photo("pf", { audience: "followers" }));
    table.set("pc", photo("pc", { audience: "closeFriends" }));
    table.set(`follow#${OWNER}#${FOLLOWER}`, { id: `follow#${OWNER}#${FOLLOWER}` });
    table.set(`closefriends#${OWNER}`, { id: `closefriends#${OWNER}`, list: [CLOSE] });
    table.set("comments#pf", { id: "comments#pf", items: [{ id: "c1", uid: FOLLOWER, name: "n", text: "秘密", t: "2026-10-01" }] });
    table.set("comments#pc", { id: "comments#pc", items: [{ id: "c2", uid: CLOSE, name: "n", text: "秘密", t: "2026-10-01" }] });
});

/** 書く口3つ（コメント・いいね・保存）の応答番号 */
async function writeCodes(sub: string, photoId: string) {
    const c = await invoke(postComment, ev(sub, photoId, { text: "こんにちは" }));
    const l = await invoke(likePhoto, ev(sub, photoId));
    const s = await invoke(savePhoto, ev(sub, photoId));
    return [c.statusCode, l.statusCode, s.statusCode];
}

describe("未認証でコメントを読む口（GET /photos/{id}/comments）", () => {
    it("公開の写真は今までどおり読める", async () => {
        expect((await invoke(getComments, ev(undefined, "pub"))).statusCode).toBe(200);
    });

    it("絞った写真は、閲覧者が分からないので 404（本文を返さない）", async () => {
        for (const id of ["pf", "pc"]) {
            const res = await invoke(getComments, ev(undefined, id));
            expect(res.statusCode, id).toBe(404);
            expect(res.body, id).not.toContain("秘密");
        }
    });

    it("いいね数も、絞った写真は未認証では返さない", async () => {
        expect((await invoke(getLikeCount, ev(undefined, "pf"))).statusCode).toBe(404);
        expect((await invoke(getLikeCount, ev(undefined, "pub"))).statusCode).toBe(200);
    });
});

describe("認証つきでコメントを読む口（GET /user/comments/{id}）", () => {
    const read = async (sub: string, id: string) => (await invoke(getCommentsAuthed, ev(sub, id))).statusCode;

    it("フォロワーのみ: 本人・フォロワーは読める／他人・フォローしていない親しい友達は 404", async () => {
        expect(await read(OWNER, "pf")).toBe(200);
        expect(await read(FOLLOWER, "pf")).toBe(200);
        expect(await read(STRANGER, "pf")).toBe(404);
        expect(await read(CLOSE, "pf")).toBe(404);
    });

    it("親しい友達: 本人・親しい友達は読める／フォロワー・他人は 404", async () => {
        expect(await read(OWNER, "pc")).toBe(200);
        expect(await read(CLOSE, "pc")).toBe(200);
        expect(await read(FOLLOWER, "pc")).toBe(404);
        expect(await read(STRANGER, "pc")).toBe(404);
    });

    it("404 の本文にコメントは載らない", async () => {
        const res = await invoke(getCommentsAuthed, ev(STRANGER, "pf"));
        expect(res.body).not.toContain("秘密");
    });

    /// 利用者ごとの答えなので、共有キャッシュに載せると他人に配られる
    it("共有キャッシュに載せない", async () => {
        const res = await invoke(getCommentsAuthed, ev(FOLLOWER, "pf")) as unknown as { headers: Record<string, string> };
        expect(res.headers["Cache-Control"]).toContain("no-store");
        expect(res.headers["Cache-Control"]).not.toContain("public");
    });

    it("公開の写真は誰でも読める・認証が無ければ 400", async () => {
        expect(await read(STRANGER, "pub")).toBe(200);
        expect((await invoke(getCommentsAuthed, ev(undefined, "pub"))).statusCode).toBe(400);
    });
});

describe("フォロワーのみの写真に書く", () => {
    it("フォロワーはコメント・いいね・保存できる", async () => {
        expect(await writeCodes(FOLLOWER, "pf")).toEqual([200, 200, 200]);
        expect(table.get("pf")?.likes).toBe(1);
        expect(table.has(`save#pf#${FOLLOWER}`)).toBe(true);
    });

    it("フォローしていない人は 404・持ち主に通知も飛ばない・何も書かれない", async () => {
        expect(await writeCodes(STRANGER, "pf")).toEqual([404, 404, 404]);
        expect(mockPush).not.toHaveBeenCalled();
        expect(table.get("pf")?.likes).toBeUndefined();
        expect(table.has(`like#pf#${STRANGER}`), "いいねのマーカーを巻き戻していない").toBe(false);
        expect(table.has(`save#pf#${STRANGER}`)).toBe(false);
        expect((table.get("comments#pf")?.items as unknown[]).length).toBe(1);
    });

    it("親しい友達でも、フォローしていなければ 404（フォロワーのみ は親しい友達で代用しない）", async () => {
        expect(await writeCodes(CLOSE, "pf")).toEqual([404, 404, 404]);
    });

    it("本人は常にできる", async () => {
        expect(await writeCodes(OWNER, "pf")).toEqual([200, 200, 200]);
    });

    it("持ち主にブロックされたフォロワーは 404", async () => {
        table.set(`block#${OWNER}#${FOLLOWER}`, { id: `block#${OWNER}#${FOLLOWER}` });
        expect(await writeCodes(FOLLOWER, "pf")).toEqual([404, 404, 404]);
        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe("見る人のほうが持ち主をブロックしている", () => {
    // `canViewPhoto` は両向きを引く。持ち主→見る人 の向きだけ試していたので、
    // こちらの向き（`block#VIEWER#OWNER`）を外しても緑のままだった
    it("フォロワーのみ: 持ち主をブロックしたフォロワーは 404・何も書かれない", async () => {
        table.set(`block#${FOLLOWER}#${OWNER}`, { id: `block#${FOLLOWER}#${OWNER}` });
        expect(await writeCodes(FOLLOWER, "pf")).toEqual([404, 404, 404]);
        expect((await invoke(getCommentsAuthed, ev(FOLLOWER, "pf"))).statusCode).toBe(404);
        expect(mockPush).not.toHaveBeenCalled();
        expect(table.get("pf")?.likes).toBeUndefined();
    });

    it("親しい友達: 持ち主をブロックした親しい友達は 404", async () => {
        table.set(`block#${CLOSE}#${OWNER}`, { id: `block#${CLOSE}#${OWNER}` });
        expect(await writeCodes(CLOSE, "pc")).toEqual([404, 404, 404]);
        expect((await invoke(getCommentsAuthed, ev(CLOSE, "pc"))).statusCode).toBe(404);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("持ち主が親しい友達をブロックした向きも 404", async () => {
        table.set(`block#${OWNER}#${CLOSE}`, { id: `block#${OWNER}#${CLOSE}` });
        expect(await writeCodes(CLOSE, "pc")).toEqual([404, 404, 404]);
    });
});

describe("いいねのやり直しの更新は、読み直したときの公開範囲のままであることを条件にする", () => {
    /**
     * `incrementLikes` は「公開の条件」で外れたら写真を読み直し、判定を通れば
     * `audience = :aud` を条件にやり直す。**読み直しとやり直しの間に**持ち主が
     * 公開範囲を狭めたら（フォロワーのみ → 親しい友達）、やり直しは外れなければ
     * ならない——判定に使った材料が古いので
     */
    it("読み直しのあと親しい友達に狭められたら 404・いいねの印を巻き戻す・数は増えない", async () => {
        mockSend.mockImplementation((cmd: { constructor: { name: string }; input: Row }) => {
            const out = fakeSend(cmd as never);
            const input = cmd.input as { Key?: { id: string }; ProjectionExpression?: string };
            // `incrementLikes` の読み直し（射影に audience を含む写真の Get）を返した直後に狭める
            if (cmd.constructor.name === "GetCommand" && input.Key?.id === "pf"
                && input.ProjectionExpression?.includes("audience")) {
                table.set("pf", { ...table.get("pf"), audience: "closeFriends" });
            }
            return out;
        });
        const res = await invoke(likePhoto, ev(FOLLOWER, "pf"));
        expect(res.statusCode).toBe(404);
        expect(table.get("pf")?.likes, "狭めたあとの写真に +1 している").toBeUndefined();
        expect(table.has(`like#pf#${FOLLOWER}`), "いいねの印を巻き戻していない").toBe(false);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("変わっていなければ、やり直しで通る（対照）", async () => {
        expect((await invoke(likePhoto, ev(FOLLOWER, "pf"))).statusCode).toBe(200);
        expect(table.get("pf")?.likes).toBe(1);
    });
});

describe("いいね解除（DELETE /photos/{id}/like）の応答", () => {
    /** 以前いいねしていた人が、今は見せない相手になっている */
    function likedBefore(sub: string, id: string, likes = 3) {
        table.set(id, { ...table.get(id), likes });
        table.set(`like#${id}#${sub}`, { id: `like#${id}#${sub}`, like: true, photoId: id, uid: sub });
    }

    it("見せない相手には数を返さない（解除はする）", async () => {
        likedBefore(STRANGER, "pf");
        const res = await invoke(unlikePhoto, ev(STRANGER, "pf"));
        expect(res.statusCode).toBe(404);
        expect(res.body, "数が漏れている").not.toMatch(/likes/);
        expect(table.has(`like#pf#${STRANGER}`), "解除そのものは通す").toBe(false);
        expect(table.get("pf")?.likes).toBe(2);
    });

    it("ブロックされた元フォロワーにも数を返さない", async () => {
        likedBefore(FOLLOWER, "pf");
        table.set(`block#${OWNER}#${FOLLOWER}`, { id: `block#${OWNER}#${FOLLOWER}` });
        const res = await invoke(unlikePhoto, ev(FOLLOWER, "pf"));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toMatch(/likes/);
    });

    it("見せてよい相手には数を返す（対照）", async () => {
        likedBefore(FOLLOWER, "pf");
        const res = await invoke(unlikePhoto, ev(FOLLOWER, "pf"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: false, likes: 2 });
    });
});

describe("自分がいいね済みか（GET /user/likes/{id}）といいね数", () => {
    const read = async (sub: string, id: string) =>
        JSON.parse((await invoke(getMyLike, ev(sub, id))).body) as { liked: boolean; count?: number };

    it("見せてよい相手には count を返す（未認証の数の口が 404 になる写真でも）", async () => {
        table.set("pf", { ...table.get("pf"), likes: 4 });
        table.set(`like#pf#${FOLLOWER}`, { id: `like#pf#${FOLLOWER}` });
        expect(await read(FOLLOWER, "pf")).toEqual({ liked: true, count: 4 });
        expect(await read(OWNER, "pf")).toEqual({ liked: false, count: 4 });
        table.set("pc", { ...table.get("pc"), likes: 2 });
        expect(await read(CLOSE, "pc")).toEqual({ liked: false, count: 2 });
    });

    it("公開の写真は誰にでも count を返す・likes が無ければ 0", async () => {
        expect(await read(STRANGER, "pub")).toEqual({ liked: false, count: 0 });
    });

    it("見せない相手には count を含めない（liked は返す）", async () => {
        table.set("pf", { ...table.get("pf"), likes: 4 });
        table.set(`like#pf#${STRANGER}`, { id: `like#pf#${STRANGER}` });
        const got = await read(STRANGER, "pf");
        expect(got, "見せない相手に数が漏れている").toEqual({ liked: true });
        expect(await read(FOLLOWER, "pc")).toEqual({ liked: false });
        table.set(`block#${FOLLOWER}#${OWNER}`, { id: `block#${FOLLOWER}#${OWNER}` });
        expect(await read(FOLLOWER, "pf")).toEqual({ liked: false });
    });

    it("下書き・ストーリー・無い写真にも count を含めない", async () => {
        table.set("draft", photo("draft", { published: false, likes: 9 }));
        table.set("story", photo("story", { story: true, likes: 9 }));
        expect(await read(STRANGER, "draft")).toEqual({ liked: false });
        expect(await read(STRANGER, "story")).toEqual({ liked: false });
        expect(await read(STRANGER, "nope")).toEqual({ liked: false });
    });

    it("写真が読めなくても liked は返す（数だけ落とす）", async () => {
        table.set(`like#pub#${STRANGER}`, { id: `like#pub#${STRANGER}` });
        mockSend.mockImplementation((cmd: { input: { Key?: { id: string } } }) =>
            cmd.input.Key?.id === "pub" ? Promise.reject(new Error("throttled")) : fakeSend(cmd as never));
        const res = await invoke(getMyLike, ev(STRANGER, "pub"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ liked: true });
    });
});

describe("通報（POST /photos/{id}/report）は限定写真も見る人を問わず通す（2026-10-03 判断）", () => {
    const report = async (sub: string, id: string) =>
        (await invoke(reportPhoto, ev(sub, id, { reason: "spam" }))).statusCode;
    const reported = (sub: string, id: string) => table.has(`report#${id}#${sub}`);

    // 持ち主が狭めた・先にブロックした直後でも通報できることを優先する
    // （`report.ts` の「非公開・下書きも通す」と同じ約束）
    it("フォロワーのみ・親しい友達の写真を、判定を通らない人も通報できる", async () => {
        expect(await report(STRANGER, "pf")).toBe(200);
        expect(reported(STRANGER, "pf")).toBe(true);
        expect(await report(FOLLOWER, "pc")).toBe(200);
        expect(reported(FOLLOWER, "pc")).toBe(true);
    });

    it("見えている人（フォロワー・親しい友達）も今までどおり通報できる", async () => {
        expect(await report(FOLLOWER, "pf")).toBe(200);
        expect(await report(CLOSE, "pc")).toBe(200);
    });

    it("持ち主にブロックされた人も通報できる", async () => {
        table.set(`block#${OWNER}#${FOLLOWER}`, { id: `block#${OWNER}#${FOLLOWER}` });
        expect(await report(FOLLOWER, "pf")).toBe(200);
    });

    it("無い写真は 404・本人は 400（今までどおり）", async () => {
        expect(await report(STRANGER, "nope")).toBe(404);
        expect(reported(STRANGER, "nope")).toBe(false);
        expect(await report(OWNER, "pf")).toBe(400);
    });

    it("公開の写真・非公開の写真は今までどおり誰でも通報できる", async () => {
        table.set("draft", photo("draft", { published: false }));
        expect(await report(STRANGER, "pub")).toBe(200);
        expect(await report(STRANGER, "draft")).toBe(200);
    });
});

describe("親しい友達の写真に書く", () => {
    it("親しい友達はコメント・いいね・保存できる", async () => {
        expect(await writeCodes(CLOSE, "pc")).toEqual([200, 200, 200]);
    });

    it("フォロワーでも、選ばれていなければ 404（狭い方が勝つ）", async () => {
        expect(await writeCodes(FOLLOWER, "pc")).toEqual([404, 404, 404]);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("どちらでもない人は 404", async () => {
        expect(await writeCodes(STRANGER, "pc")).toEqual([404, 404, 404]);
    });

    it("本人は常にできる", async () => {
        expect(await writeCodes(OWNER, "pc")).toEqual([200, 200, 200]);
    });
});

describe("判定の材料が読めないときは閉じる", () => {
    it("フォローのマーカーが読めなければ、フォロワーでも 404", async () => {
        mockSend.mockImplementation((cmd: { input: { Key?: { id: string } } }) =>
            cmd.input.Key?.id?.startsWith("follow#")
                ? Promise.reject(new Error("throttled"))
                : fakeSend(cmd as never));
        expect(await writeCodes(FOLLOWER, "pf")).toEqual([404, 404, 404]);
    });
});

describe("公開の写真は今までどおり", () => {
    it("誰でもコメント・いいね・保存できる", async () => {
        expect(await writeCodes(STRANGER, "pub")).toEqual([200, 200, 200]);
    });
});
