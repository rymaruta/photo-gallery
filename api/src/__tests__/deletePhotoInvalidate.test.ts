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
