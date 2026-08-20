import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPhotoById = vi.hoisted(() => vi.fn());
const mockUpdatePhotoFields = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../ddb-photos", () => ({
    getPhotoById: mockGetPhotoById,
    updatePhotoFields: mockUpdatePhotoFields,
    deletePhotoById: vi.fn(),
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    DeleteObjectCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { updatePhoto } = await import("../photosMutate");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<Result> => (updatePhoto as any)(event);

const ev = (id: string, body: unknown, sub = "owner", groups = "") => ({
    pathParameters: { id },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub, "cognito:groups": groups } } } },
});

beforeEach(() => {
    mockGetPhotoById.mockReset();
    mockUpdatePhotoFields.mockReset().mockResolvedValue({ id: "p1" });
    mockRebuild.mockReset().mockResolvedValue(true);
});

// この口は api-user 側の PUT /photos/{id} と同じ道の別実装。
// どちらのホストもクライアントのバンドルに入っているので、利用者は
// どちらでも叩ける。しかも権限判定は「管理者 **または** 所有者」なので
// 管理者専用ではない——普通の利用者が自分の写真に対して使える。
describe("updatePhoto", () => {
    it("ストーリーは編集できない（404）", async () => {
        // ストーリーを published:true にできると、24時間で消えるはずのものが
        // 永久の公開ページになる。しかも掃除は実体しか消さないので、
        // 壊れたページとサイトマップの項目が残る。
        // ストーリーは動画も許しているので、写真ギャラリーに動画を
        // 差し込む経路にもなっていた。
        mockGetPhotoById.mockResolvedValue({
            id: "story-1", story: true, userId: "owner", src: "https://cdn/s.jpg", published: false,
        });
        const res = await invoke(ev("story-1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("自分の写真は編集できる", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
        expect((await invoke(ev("p1", { location: "北海道" }))).statusCode).toBe(200);
        expect(mockUpdatePhotoFields.mock.calls[0][1]).toMatchObject({ location: "北海道" });
    });

    it("他人の写真は編集できない（403）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "someone-else", src: "https://cdn/p1.jpg" });
        expect((await invoke(ev("p1", { location: "北海道" }))).statusCode).toBe(403);
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
    });

    it("GPS 入りの exif は保存されない", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
        await invoke(ev("p1", { exif: { camera: "X100V", gpsLatitude: "35.6812" } }));
        expect(mockUpdatePhotoFields.mock.calls[0][1].exif).toEqual({ camera: "X100V" });
    });

    describe("静的ページの作り直し", () => {
        it("公開状態が変わったときだけ頼む", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        it("公開状態が同じで他も変えなければ頼まない", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: true }));
            await invoke(ev("p1", { published: true }));
            expect(mockRebuild).not.toHaveBeenCalled();
        });

        it("本文や撮影地を変えたときも頼む", async () => {
            // 静的HTMLには本文・撮影地・EXIF・表示名入りの JSON-LD が焼き込まれている。
            // 「公開状態が変わったときだけ」に絞ると、説明に書いてしまった
            // 個人情報を消して保存しても、静的HTMLには残り続ける。
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { location: "" , description: "" }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        it("何も変えない保存では頼まない", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", {}));
            expect(mockRebuild).not.toHaveBeenCalled();
        });

        it("連打で枠を使い切らせないよう畳む指定を付ける", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
        });

        it("published が未設定の写真（＝公開扱い）を非公開にしたら頼む", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });
    });
});
