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

describe("profileAvatarPresignedUrl: 返す公開URL", () => {
    it("配信ドメイン + キー", async () => {
        const res = await invoke(ev("u1", { fileType: "image/jpeg" }));
        const { publicUrl, presignedUrl } = JSON.parse(res.body) as { publicUrl: string; presignedUrl: string };
        expect(publicUrl).toBe("https://cdn.example.com/profiles/u1");
        expect(presignedUrl).toBe("https://s3.example/presigned");
    });

    // CLOUDFRONT_URL は環境変数なので、末尾スラッシュ付きで渡されうる。
    // 詰めていないと `https://cdn.example.com//profiles/u1` になり、
    // S3 のキーとしては先頭に空の階層を持つ**別物**を指す。保存された
    // その URL は、あとで削除・派生生成が探すキーと一致しない。
    // uploadPolicy.ts の canonicalUploadUrl が同じ理由で同じ処理をしている。
    it("配信ドメインの末尾スラッシュを詰める（二重スラッシュにしない）", async () => {
        vi.resetModules();
        vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com/");
        const mod = await import("../profile");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (mod.profileAvatarPresignedUrl as any)(ev("u1", { fileType: "image/jpeg" })) as Result;
        expect(JSON.parse(res.body).publicUrl).toBe("https://cdn.example.com/profiles/u1");
        vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
        vi.resetModules();
    });
});

// 署名は落ちうる（資格情報の期限切れ・KMS・S3 の一時障害）。
// 囲っていない頃は Lambda が投げ、API Gateway が **JSON ではない 502 の
// 素の body** を返していた。呼び出し側は res.json() で落ちるので、
// 画面には何も出ないまま「押しても反応しない」ように見える。
describe("profileAvatarPresignedUrl: 署名に失敗したとき", () => {
    it("JSON の 503 を返す（素の 502 を漏らさない）", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => { /* 想定内 */ });
        mockGetSignedUrl.mockImplementationOnce(() => Promise.reject(new Error("kms down")));
        const res = await invoke(ev("u1", { fileType: "image/jpeg" }));
        expect(res.statusCode).toBe(503);
        expect(() => JSON.parse(res.body)).not.toThrow();
        expect(JSON.parse(res.body).error).toBeTruthy();
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

// アバター側も同じ。presigner は既定で `content-type` を署名対象から外すので、
// 「許可済みの種別を焼き付ける」と書いてあっても何も縛れていなかった。
// `image/jpeg` で presign を取り `text/html` で PUT すると、サイトと同一
// オリジンで任意のスクリプトが動く（localStorage の Cognito トークンが読める）。
describe("アバターの presign が Content-Type を縛る", () => {
    it("署名対象に content-type を明示する", async () => {
        await invoke({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ fileType: "image/jpeg" }),
        });

        const opts = mockGetSignedUrl.mock.calls.at(-1)?.[2] as { signableHeaders?: Set<string> };
        expect(opts?.signableHeaders, "signableHeaders が渡っていない（既定では外される）").toBeDefined();
        expect([...(opts.signableHeaders ?? [])]).toContain("content-type");
    });

    it("署名した種別をそのまま応答に載せる（クライアントはこれを送る）", async () => {
        const res = await invoke({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ fileType: "IMAGE/PNG; charset=utf-8" }),
        });
        expect(JSON.parse(res.body).contentType, "署名した種別を返していない").toBe("image/png");
    });
});
