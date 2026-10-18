import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createHash } from "crypto";

/**
 * 管理 API から写真を消した・非公開にした・撮影地を変えたときに、旅のトランクのラベルの
 * 「地名を人に見せてよい」印（`o`）を外す（2026-10-18・`trunkPlace.ts`）。
 * DynamoDB は中身を持つ作り物（rev 条件の Put を本当に通す）。写真の行の読み書きは `ddb-photos` を模す
 */
type Item = Record<string, unknown>;
const store = vi.hoisted(() => new Map<string, Item>());
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
const mockGetPhotoById = vi.hoisted(() => vi.fn());
const mockUpdatePhotoFields = vi.hoisted(() => vi.fn());
const mockDeletePhotoById = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({
    getPhotoById: mockGetPhotoById, updatePhotoFields: mockUpdatePhotoFields, deletePhotoById: mockDeletePhotoById,
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: vi.fn(async () => true) }));
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: vi.fn(async () => true) }));
vi.mock("../albumCleanup", () => ({ removePhotoFromAlbum: vi.fn(async () => undefined) }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(async () => ({})); },
    DeleteObjectCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

async function send(cmd: { constructor: { name: string }; input: Item }) {
    const input = cmd.input as { Key?: Item; Item?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    if (cmd.constructor.name === "GetCommand") {
        const v = store.get(String(input.Key!.id));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (cmd.constructor.name === "PutCommand") {
        const k = String(input.Item!.id);
        const cur = store.get(k);
        const want = input.ExpressionAttributeValues?.[":rev"];
        const ok = input.ConditionExpression?.includes("attribute_not_exists(rev)")
            ? !cur || cur.rev === undefined || cur.rev === want : cur?.rev === want;
        if (!ok) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        store.set(k, structuredClone(input.Item!));
        return {};
    }
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}

// トップレベルの await は使わない（api の型検査の基準 11 件を増やさない）
let dropTrunkPlaceOkQuietly: typeof import("../trunkPlace").dropTrunkPlaceOkQuietly;
let dropPlaceOkFrom: typeof import("../trunkPlace").dropPlaceOkFrom;
let updatePhoto: typeof import("../photosMutate").updatePhoto;
let deletePhoto: typeof import("../photosMutate").deletePhoto;
beforeAll(async () => {
    ({ dropTrunkPlaceOkQuietly, dropPlaceOkFrom } = await import("../trunkPlace"));
    ({ updatePhoto, deletePhoto } = await import("../photosMutate"));
});

const OWNER = "owner";
const gk = (g: string) => `g:${createHash("sha256").update(g).digest("hex").slice(0, 12)}`;
const trunk = () => store.get(`trunk#${OWNER}`)!;
const oOf = (list: "pocket" | "stuck") => (trunk()[list] as Item[]).map((l) => l.o ?? null);

const ev = (id: string, body?: unknown) => ({
    pathParameters: { id },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: OWNER, "cognito:groups": "" } } } },
});

beforeEach(() => {
    store.clear();
    mockDdbSend.mockReset().mockImplementation(send);
    mockGetPhotoById.mockReset();
    mockUpdatePhotoFields.mockReset().mockResolvedValue({ id: "p1" });
    mockDeletePhotoById.mockReset().mockResolvedValue(undefined);
    store.set(`trunk#${OWNER}`, {
        id: `trunk#${OWNER}`, uid: OWNER, rev: 3, coins: 5,
        pocket: [{ i: "p1", n: "京都", d: 1, o: 1 }, { i: "other", n: "札幌", d: 2, o: 1 }],
        stuck: [{ i: "p0", n: "京都", d: 3, o: 1, g: gk("grp") }],
    });
});

describe("dropTrunkPlaceOkQuietly（管理 API）", () => {
    it("この写真のラベルの印だけ外し、rev を上げて置き直す（ほかの項目はそのまま）", async () => {
        await dropTrunkPlaceOkQuietly({ id: "p1", userId: OWNER }, "test");
        expect(oOf("pocket")).toEqual([null, 1]);
        expect(oOf("stuck")).toEqual([1]);
        expect(trunk().rev).toBe(4);
        expect(trunk().coins).toBe(5);
    });

    it("束の写真なら、束の鍵が同じラベルの印も外す（兄弟がまだ公開でも＝見せない側）", async () => {
        await dropTrunkPlaceOkQuietly({ id: "p5", userId: OWNER, groupId: " grp " }, "test");
        expect(oOf("stuck")).toEqual([null]);
    });

    it("当たるラベルが無い・印が無い・行が無いなら書かない", async () => {
        await dropTrunkPlaceOkQuietly({ id: "none", userId: OWNER }, "test");
        expect(trunk().rev).toBe(3);
        await dropTrunkPlaceOkQuietly({ id: "p1", userId: "nobody" }, "test");
        expect(mockDdbSend.mock.calls.filter((c) => c[0].constructor.name === "PutCommand")).toHaveLength(0);
    });

    it("書く間に api-user が書いていたら（rev が進んだ）、読み直してやり直す", async () => {
        let raced = false;
        mockDdbSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Item }) => {
            if (cmd.constructor.name === "PutCommand" && !raced) {
                raced = true;
                store.set(`trunk#${OWNER}`, { ...trunk(), rev: 9, coins: 6 });
            }
            return send(cmd);
        });
        await dropTrunkPlaceOkQuietly({ id: "p1", userId: OWNER }, "test");
        expect(trunk().rev).toBe(10);
        expect(trunk().coins).toBe(6);
        expect(oOf("pocket")).toEqual([null, 1]);
    });

    it("投げない（DynamoDB が落ちても）", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        mockDdbSend.mockRejectedValue(new Error("boom"));
        await expect(dropTrunkPlaceOkQuietly({ id: "p1", userId: OWNER }, "test")).resolves.toBeUndefined();
        err.mockRestore();
    });

    it("古い形（長い鍵）のラベルの印も外す", () => {
        expect(dropPlaceOkFrom([{ id: "p1", placeOk: true }], "p1", "")).toEqual([{ id: "p1" }]);
        expect(dropPlaceOkFrom("x", "p1", "")).toBeNull();
    });
});

describe("管理 API の口から外す", () => {
    it("deletePhoto: 写真を消したら印を外す", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: OWNER, src: "https://cdn.example.com/uploads/a.webp" });
        const res = await (deletePhoto as unknown as (e: unknown) => Promise<{ statusCode: number }>)(ev("p1"));
        expect(res.statusCode).toBe(200);
        expect(oOf("pocket")).toEqual([null, 1]);
    });

    it("updatePhoto: 非公開にした・撮影地を変えた・消したら外す。題だけ・公開のままなら外さない", async () => {
        const run = async (photo: Item, body: Item) => {
            store.set(`trunk#${OWNER}`, { ...trunk(), pocket: [{ i: "p1", n: "京都", d: 1, o: 1 }] });
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: OWNER, published: true, location: "京都", ...photo });
            await (updatePhoto as unknown as (e: unknown) => Promise<unknown>)(ev("p1", body));
            return oOf("pocket")[0];
        };
        expect(await run({}, { published: false })).toBeNull();
        expect(await run({}, { location: "大阪" })).toBeNull();
        expect(await run({}, { location: "" })).toBeNull();
        expect(await run({}, { title: { ja: "題", en: "" } })).toBe(1);
        expect(await run({}, { published: true, location: "京都" })).toBe(1);
        // もう非公開の写真を非公開のまま保存しても外さない（外すものは既に外れている）
        expect(await run({ published: false }, { published: false })).toBe(1);
    });
});
