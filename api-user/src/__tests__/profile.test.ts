import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockPutObject = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) { this.input = input; mockPutObject(input); }
    },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: mockGetSignedUrl,
}));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
const { profileAvatarPresignedUrl } = await import("../profile");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<Result> => (profileAvatarPresignedUrl as any)(event);

const ev = (sub: string | undefined, body: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    body: typeof body === "string" ? body : JSON.stringify(body),
});

beforeEach(() => {
    mockGetSignedUrl.mockReset().mockResolvedValue("https://s3.example/presigned");
    mockPutObject.mockReset();
});

describe("profileAvatarPresignedUrl: 受け付ける形式", () => {
    it("よく使う画像形式は通る", async () => {
        for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic"]) {
            expect((await invoke(ev("u1", { fileType: t }))).statusCode).toBe(200);
        }
    });

    it("SVG は通さない", async () => {
        // SVG は <script> を書ける文書で、アイコンは写真と同じ CloudFront から
        // 返る（＝サイトと同一オリジン）。しかもキーは profiles/<uid> 固定なので、
        // 上げた時点で決まったURLから配信される——保存の一手すら要らない。
        // 通すと誰でもサイト上でスクリプトを実行でき、localStorage の
        // Cognito トークンを盗める。
        const res = await invoke(ev("u1", { fileType: "image/svg+xml" }));
        expect(res.statusCode).toBe(400);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("動画も通さない（アイコンに動画は要らない）", async () => {
        expect((await invoke(ev("u1", { fileType: "video/mp4" }))).statusCode).toBe(400);
    });

    it("画像以外は通さない", async () => {
        for (const t of ["text/html", "application/pdf", "", undefined]) {
            expect((await invoke(ev("u1", { fileType: t }))).statusCode).toBe(400);
        }
    });

    it("Content-Type はクライアントの文字列そのままではなく正規化して焼き付ける", async () => {
        await invoke(ev("u1", { fileType: "IMAGE/JPEG; charset=utf-8" }));
        const input = mockPutObject.mock.calls[0][0] as { ContentType: string; Key: string };
        expect(input.ContentType).toBe("image/jpeg");
        expect(input.Key).toBe("profiles/u1");
    });

    it("type=cover はカバー用のキーになる", async () => {
        await invoke(ev("u1", { fileType: "image/jpeg", type: "cover" }));
        expect((mockPutObject.mock.calls[0][0] as { Key: string }).Key).toBe("profiles/u1/cover");
    });

    it("認証が無ければ 401（キーが profiles/ になってしまうため）", async () => {
        const res = await invoke(ev(undefined, { fileType: "image/jpeg" }));
        expect(res.statusCode).toBe(401);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("壊れた JSON は 400", async () => {
        expect((await invoke(ev("u1", "{"))).statusCode).toBe(400);
    });
});
