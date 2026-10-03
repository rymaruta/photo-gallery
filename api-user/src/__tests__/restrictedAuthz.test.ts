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

const { getComments, postComment } = await import("../comments");
const { likePhoto, getLikeCount } = await import("../likes");
const { savePhoto } = await import("../saves");

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
