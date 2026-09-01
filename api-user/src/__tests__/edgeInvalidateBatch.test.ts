import { describe, it, expect, vi, beforeEach } from "vitest";

// **エッジの掃除を、消す実体1つごとに1本ずつ作っていた。**
//
// `s3DeleteMany` は最後に `invalidateUploads` を呼ぶ。ところが退会と
// ストーリーの掃除は**1行ごとに** `s3DeleteMany` を呼ぶので、写真 N 枚の
// 退会で CloudFront の無効化が N 本できる（しかも退会は 8 並列）。
//
// CloudFront は**同時に進行できる無効化の本数に上限がある**（既定15）。
// 超えたぶんは `TooManyInvalidationsInProgress` で断られ、
// `invalidateUploads` は投げずに警告だけ出して false を返す設計なので、
// **削除は成功したように見えたままエッジの掃除だけが静かに落ちる**。
// アップロードは `max-age=31536000`（1年）で配っているので、消したはずの
// 実体——GPS 入りの原本を含む——がエッジから取れ続ける（LEFT-4 の再発）。
// 上限に当たらない場合でも、無効化は**パス単位で課金**されるので N 倍払う。

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());
const mockCfSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index", STORY_FEED_KEY: "1",
}));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
    DeleteObjectsCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class { send = mockCfSend; },
    CreateInvalidationCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: vi.fn().mockResolvedValue(true) }));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
vi.stubEnv("USERS_TABLE", "users-test");
vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", "E123");
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");

const { deleteAccount } = await import("../account");
const { cleanupExpiredStories } = await import("../stories");

const PHOTOS = 12;
const photo = (n: number) => ({
    id: `p${n}`, userId: "u1",
    src: `https://cdn.example.com/uploads/u1/p${n}.jpg`,
    srcOriginal: `https://cdn.example.com/uploads/originals/p${n}.jpg`,
    thumbSrc: `https://cdn.example.com/uploads/u1/p${n}_thumb.webp`,
    published: true,
});

beforeEach(() => {
    mockCfSend.mockReset().mockResolvedValue({});
    mockS3Send.mockReset().mockResolvedValue({ Errors: [] });
    mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string }; input?: { Key?: { id?: unknown } } }) => {
        const name = cmd.constructor.name;
        if (name === "QueryCommand") {
            // 写真一覧は1ページで返す（ページングは別のテストが見ている）
            return Promise.resolve({ Items: Array.from({ length: PHOTOS }, (_, i) => photo(i)) });
        }
        if (name === "GetCommand") {
            const id = String(cmd.input?.Key?.id ?? "");
            const n = Number(id.replace("p", ""));
            return Promise.resolve({ Item: Number.isFinite(n) ? photo(n) : undefined });
        }
        if (name === "ScanCommand") return Promise.resolve({ Items: [] });
        return Promise.resolve({});
    });
});

const ev = { requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = () => (deleteAccount as any)(ev, {}, () => { }) as Promise<{ statusCode: number }>;

describe("退会: エッジの掃除は1本にまとめる", () => {
    it(`写真が ${PHOTOS} 枚でも無効化は1本`, async () => {
        await run();
        expect(mockCfSend, "写真の枚数ぶん無効化を作っている").toHaveBeenCalledTimes(1);
    });

    it("消したキーは全部その1本に入る（畳んでも取りこぼさない）", async () => {
        await run();
        const paths = (mockCfSend.mock.calls[0][0] as {
            input: { InvalidationBatch: { Paths: { Items: string[]; Quantity: number } } };
        }).input.InvalidationBatch.Paths;
        // 1枚につき src / srcOriginal / thumbSrc の3つ
        expect(paths.Items).toHaveLength(PHOTOS * 3);
        expect(paths.Quantity).toBe(PHOTOS * 3);
        expect(paths.Items).toContain("/uploads/originals/p0.jpg");
        expect(paths.Items).toContain(`/uploads/u1/p${PHOTOS - 1}_thumb.webp`);
    });

    // 消せなかった実体のキャッシュまで捨てない（`s3DeleteMany` と同じ約束）
    it("S3 が消せなかったキーは無効化に載せない", async () => {
        mockS3Send.mockImplementation((cmd: { input?: { Delete?: { Objects?: { Key: string }[] } } }) => {
            const objs = cmd.input?.Delete?.Objects ?? [];
            const bad = objs.filter((o) => o.Key.includes("originals"));
            return Promise.resolve({ Errors: bad.map((o) => ({ Key: o.Key })) });
        });
        await run();
        const items = (mockCfSend.mock.calls[0][0] as {
            input: { InvalidationBatch: { Paths: { Items: string[] } } };
        }).input.InvalidationBatch.Paths.Items;
        expect(items.some((p) => p.includes("originals")), "消せていない原本を無効化している").toBe(false);
        expect(items.length).toBeGreaterThan(0);
    });

    it("消すものが無ければ無効化しない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (cmd.constructor.name === "ScanCommand") return Promise.resolve({ Items: [] });
            return Promise.resolve({});
        });
        await run();
        expect(mockCfSend).not.toHaveBeenCalled();
    });
});

// 掃除は**1時間ごと**に走り、溜まった回ほど1回で消す件数が増える。
// 件数ぶん無効化を作ると、溜まった回ほど上限に当たりやすい——
// 「消えたはずの GPS 入り動画がエッジに残る」が起きるのは、まさにその回。
describe("期限切れストーリーの掃除: エッジの掃除は1本にまとめる", () => {
    const STORIES = 9;
    const story = (n: number) => ({
        id: `story-s${n}`, userId: "u1", story: true,
        src: `https://cdn.example.com/uploads/u1/s${n}.mp4`,
        expiresAt: "2020-01-01T00:00:00.000Z",
    });

    beforeEach(() => {
        mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "QueryCommand") {
                return Promise.resolve({ Items: Array.from({ length: STORIES }, (_, i) => story(i)) });
            }
            return Promise.resolve({});
        });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = () => (cleanupExpiredStories as any)({}, {}, () => { }) as Promise<{ deleted: number }>;

    it(`期限切れが ${STORIES} 件でも無効化は1本`, async () => {
        const res = await run();
        expect(res.deleted, "そもそも消せていない").toBe(STORIES);
        expect(mockCfSend, "件数ぶん無効化を作っている").toHaveBeenCalledTimes(1);
    });

    it("消したキーは全部その1本に入る", async () => {
        await run();
        const items = (mockCfSend.mock.calls[0][0] as {
            input: { InvalidationBatch: { Paths: { Items: string[] } } };
        }).input.InvalidationBatch.Paths.Items;
        expect(items).toContain("/uploads/u1/s0.mp4");
        expect(items).toContain(`/uploads/u1/s${STORIES - 1}.mp4`);
        expect(items).toHaveLength(STORIES);
    });

    it("期限切れが無ければ無効化しない", async () => {
        mockDdbSend.mockImplementation(() => Promise.resolve({ Items: [] }));
        await run();
        expect(mockCfSend).not.toHaveBeenCalled();
    });
});
