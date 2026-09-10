import { describe, it, expect, vi, beforeEach } from "vitest";

// **管理APIの削除だけ、エッジの掃除が抜けていた。**
//
// `/uploads/*` は maxTTL 31536000秒（365日）、実体は `max-age=31536000`
// で置かれる（本番実測 2026-09-05）。S3 から消しても、エッジに載っていれば
// **URL を知っていれば最大1年 取れ続ける**——`srcOriginal`（GPS 入りの原本）も。
// api-user 側の削除・退会・ストーリー掃除は前から `invalidateUploads` を
// 通っていて、ここだけ素通りだった。

const mockS3Send = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn());
const mockGetPhoto = vi.hoisted(() => vi.fn());
const mockDeleteRow = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: mockInvalidate }));
vi.mock("../ddb-photos", () => ({
    getPhotoById: mockGetPhoto,
    deletePhotoById: mockDeleteRow,
    updatePhotoFields: vi.fn(),
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
vi.mock("../auth", () => ({ isAdmin: () => true, getCallerUserId: () => "admin" }));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { deletePhoto } = await import("../photosMutate");

const PHOTO = {
    id: "p1", userId: "someone",
    src: "https://cdn.test/uploads/someone/p1.jpg",
    srcOriginal: "https://cdn.test/uploads/someone/p1_orig.jpg",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (): Promise<{ statusCode: number }> => (deletePhoto as any)({
    pathParameters: { id: "p1" },
    requestContext: { authorizer: { jwt: { claims: { sub: "admin" } } } },
});

beforeEach(() => {
    mockS3Send.mockReset().mockResolvedValue({});
    mockInvalidate.mockReset().mockResolvedValue(true);
    mockGetPhoto.mockReset().mockResolvedValue(PHOTO);
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockRebuild.mockReset().mockResolvedValue(true);
});

describe("管理APIの写真削除", () => {
    it("消した実体をエッジからも消す（原本を含む）", async () => {
        const res = await invoke();

        expect(res.statusCode).toBe(200);
        expect(mockInvalidate, "エッジの掃除を呼んでいない").toHaveBeenCalled();
        expect(mockInvalidate.mock.calls[0][0]).toEqual(expect.arrayContaining([
            "uploads/someone/p1.jpg", "uploads/someone/p1_orig.jpg",
        ]));
    });

    // 逆向き: 消せなかったキーは回さない（消えていない実体のキャッシュを
    // 捨てても取り直されるだけで、無効化はパス単位で課金される）
    it("消せなかったキーはエッジに回さない", async () => {
        mockS3Send.mockImplementation((cmd: { input: { Key: string } }) =>
            cmd.input.Key.endsWith("_orig.jpg")
                ? Promise.reject(new Error("boom"))
                : Promise.resolve({}));

        const res = await invoke();

        expect(res.statusCode, "S3 が消せなければ行を残して 500").toBe(500);
        const keys = (mockInvalidate.mock.calls[0]?.[0] ?? []) as string[];
        expect(keys).not.toContain("uploads/someone/p1_orig.jpg");
        expect(keys, "消せたぶんは掃除する").toContain("uploads/someone/p1.jpg");
    });
});


// **ギャラリーに残した1枚の実体は消さない**（`api-user/src/stories.ts` の
// `storyMediaKeys` と**対**）。`keptAs` が立っているストーリーは、その S3
// オブジェクトの持ち主が写真の行に移っている。ここで消すと、投稿者が
// 残したはずの写真が**割れた画像**になる——行は残るので、下書き一覧にも
// 個別ページにも壊れた枠が並び、本人には直す手段が無い。
// `updatePhoto` にはある `story === true` の門が、削除には無い。
describe("管理APIの削除: ギャラリーに残した実体は消さない", () => {
    it("keptAs が立っていたら S3 に触らない（行は消す）", async () => {
        mockGetPhoto.mockResolvedValue({
            id: "p1", userId: "someone", story: true, keptAs: "photo-kept",
            src: "https://cdn.test/uploads/someone/s1.webp",
        });
        const res = await invoke();

        expect(res.statusCode).toBe(200);
        expect(mockS3Send, "残した写真の実体まで消している").not.toHaveBeenCalled();
        expect(mockInvalidate.mock.calls[0]?.[0] ?? [], "消していないものをエッジから消しにいく").toEqual([]);
        expect(mockDeleteRow, "行は予定どおり消す").toHaveBeenCalledWith("p1");
    });

    it("残していないストーリーは、これまでどおり実体ごと消す", async () => {
        mockGetPhoto.mockResolvedValue({
            id: "p1", userId: "someone", story: true,
            src: "https://cdn.test/uploads/someone/s1.webp",
        });
        await invoke();
        expect(mockS3Send, "実体を消していない").toHaveBeenCalled();
    });
});


// **`keptAs` はストーリーの行にしか立たない。** 上の分岐は「管理者が
// ストーリーを直に消しに来た」ときしか効かないので、**残した写真**を
// 管理画面から消すと、共有している S3 の実体は消えるのに元のストーリーが
// 生きたまま残る——期限切れまで最大24時間、**全員のトレイに割れた画像**が
// 出続け、`keptAs` が死んだIDを指したままなので二度と残せなくなる。
describe("管理APIの削除: 残した写真を消したら、元のストーリーも消す", () => {
    it("keptFrom があれば、返信の文書とストーリーの行も消す", async () => {
        mockGetPhoto.mockResolvedValue({
            id: "p1", userId: "someone", keptFrom: "story-1",
            src: "https://cdn.test/uploads/someone/p1.jpg",
        });
        const res = await invoke();

        expect(res.statusCode).toBe(200);
        const deleted = mockDeleteRow.mock.calls.map((c) => c[0] as string);
        expect(deleted, "割れたストーリーが残る").toContain("story-1");
        expect(deleted, "返信の本文が誰も辿れないまま残る").toContain("storyreplies#story-1");
        // 返信の文書を先に（行が消えると辿る手がかりが無くなる）
        expect(deleted.indexOf("storyreplies#story-1")).toBeLessThan(deleted.indexOf("story-1"));
        // 実体は消す（写真の側が持ち主）
        expect(mockS3Send, "残した写真の実体を消していない").toHaveBeenCalled();
    });

    it("出どころが無ければ、余計な行を消さない", async () => {
        mockGetPhoto.mockResolvedValue({ id: "p1", userId: "someone", src: "https://cdn.test/uploads/someone/p1.jpg" });
        await invoke();
        expect(mockDeleteRow.mock.calls.map((c) => c[0] as string)).toEqual(["p1"]);
    });
});
