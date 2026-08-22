import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// 管理APIのアップロード。**このファイルにはテストが1本も無かった。**
//
// ここが守っているのは主に2つ:
//   1. SVG を受け付けない。SVG は <script> を書ける実行可能な文書で、
//      配信はサイトと同じ CloudFront（＝同一オリジン）。1枚上げるだけで
//      localStorage の Cognito トークンを読み出せる。
//   2. 保存する src は削除時にそのまま S3 のキーになる。外部URLや
//      profiles/<他人> を入れられると、削除で他人のアイコンが消える。
// どちらも無検証のまま動いていた。

const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockPutObjectInput = vi.hoisted(() => vi.fn());
const mockPutPhoto = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) { this.input = input; mockPutObjectInput(input); }
    },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mockGetSignedUrl }));
vi.mock("../ddb-photos", () => ({ putPhoto: mockPutPhoto }));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
const { presignedUrl, savePhoto, isOwnUploadUrl } = await import("../upload");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);

const ev = (body: unknown, groups = "admin") => ({
    requestContext: { authorizer: { jwt: { claims: { sub: "admin-sub", "cognito:groups": groups } } } },
    body: typeof body === "string" ? body : JSON.stringify(body),
});

beforeEach(() => {
    mockGetSignedUrl.mockReset().mockResolvedValue("https://s3.example/presigned");
    mockPutObjectInput.mockReset();
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
});

describe("presignedUrl: 誰が叩けるか", () => {
    it("管理者でなければ 403", async () => {
        const res = await invoke(presignedUrl, ev({ fileName: "a.jpg", fileType: "image/jpeg" }, ""));
        expect(res.statusCode).toBe(403);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
});

describe("presignedUrl: 受け付ける形式", () => {
    const ask = (fileType: string, fileName = "a.jpg") =>
        invoke(presignedUrl, ev({ fileName, fileType }));

    it("よく使う画像形式は通る", async () => {
        for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/gif"]) {
            expect((await ask(t)).statusCode).toBe(200);
        }
    });

    it("SVG は通さない（同一オリジンで実行できる文書のため）", async () => {
        expect((await ask("image/svg+xml")).statusCode).toBe(400);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("動画も通さない（管理APIは写真だけ）", async () => {
        for (const t of ["video/mp4", "video/webm", "video/quicktime"]) {
            expect((await ask(t)).statusCode).toBe(400);
        }
    });

    it("画像以外は通さない", async () => {
        for (const t of ["application/pdf", "text/html", "application/octet-stream"]) {
            expect((await ask(t)).statusCode).toBe(400);
        }
    });

    it("50MB を超えるものは断る", async () => {
        const res = await invoke(presignedUrl, ev({
            fileName: "a.jpg", fileType: "image/jpeg", fileSize: 51 * 1024 * 1024,
        }));
        expect(res.statusCode).toBe(400);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("ファイル名とファイルタイプが無ければ 400", async () => {
        expect((await invoke(presignedUrl, ev({ fileType: "image/jpeg" }))).statusCode).toBe(400);
        expect((await invoke(presignedUrl, ev({ fileName: "a.jpg" }))).statusCode).toBe(400);
    });

    it("壊れた JSON は 400", async () => {
        expect((await invoke(presignedUrl, ev("{"))).statusCode).toBe(400);
    });
});

describe("presignedUrl: 作るキーと焼き付ける Content-Type", () => {
    it("拡張子はファイル名ではなく種別から決める", async () => {
        // ファイル名由来だと "a.svg" のような名前がそのまま S3 のキーになる。
        const res = await invoke(presignedUrl, ev({ fileName: "わな.svg", fileType: "image/png" }));
        const { key } = JSON.parse(res.body) as { key: string };
        expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
        expect(key).not.toContain("svg");
        expect(key).not.toContain("わな");
    });

    it("Content-Type はクライアントの文字列そのままではなく正規化して焼き付ける", async () => {
        await invoke(presignedUrl, ev({ fileName: "a.jpg", fileType: " IMAGE/JPEG ; charset=utf-8" }));
        const input = mockPutObjectInput.mock.calls[0][0] as { ContentType: string; Bucket: string };
        expect(input.ContentType).toBe("image/jpeg");
        expect(input.Bucket).toBe("bucket-test");
    });

    it("返す公開URLは配信ドメイン + キー", async () => {
        const res = await invoke(presignedUrl, ev({ fileName: "a.jpg", fileType: "image/jpeg" }));
        const { key, publicUrl } = JSON.parse(res.body) as { key: string; publicUrl: string };
        expect(publicUrl).toBe(`https://cdn.example.com/${key}`);
    });
});

describe("isOwnUploadUrl", () => {
    it("自分のアップロード領域は通る", () => {
        expect(isOwnUploadUrl("https://cdn.example.com/uploads/abc.jpg")).toBe(true);
    });

    it("別ホストは通さない", () => {
        expect(isOwnUploadUrl("https://evil.example.com/uploads/abc.jpg")).toBe(false);
    });

    it("https 以外は通さない", () => {
        expect(isOwnUploadUrl("http://cdn.example.com/uploads/abc.jpg")).toBe(false);
    });

    it("uploads/ 以外は通さない（削除で他人のアイコンを消せてしまう）", () => {
        expect(isOwnUploadUrl("https://cdn.example.com/profiles/someone")).toBe(false);
        expect(isOwnUploadUrl("https://cdn.example.com/uploads/")).toBe(false);
    });

    it("URL でないもの・文字列でないものは通さない", () => {
        expect(isOwnUploadUrl("not-a-url")).toBe(false);
        expect(isOwnUploadUrl(undefined)).toBe(false);
        expect(isOwnUploadUrl(123)).toBe(false);
    });
});

describe("savePhoto", () => {
    const ok = {
        key: "uploads/abc.jpg",
        publicUrl: "https://cdn.example.com/uploads/abc.jpg",
        title: { ja: "海" },
    };

    it("管理者でなければ 403", async () => {
        expect((await invoke(savePhoto, ev(ok, ""))).statusCode).toBe(403);
    });

    it("sub の無いトークンは 401（userId が空の写真を作らない）", async () => {
        const noSub = {
            requestContext: { authorizer: { jwt: { claims: { "cognito:groups": "admin" } } } },
            body: JSON.stringify({}),
        };
        expect((await invoke(savePhoto, noSub)).statusCode).toBe(401);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("外部URLを src にはできない", async () => {
        const res = await invoke(savePhoto, ev({ ...ok, publicUrl: "https://evil.example.com/uploads/a.jpg" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("profiles/ を src にはできない（削除で他人のアイコンが消える）", async () => {
        const res = await invoke(savePhoto, ev({ ...ok, publicUrl: "https://cdn.example.com/profiles/someone" }));
        expect(res.statusCode).toBe(400);
    });

    it("uploads/ 以外のキーは断る", async () => {
        const res = await invoke(savePhoto, ev({ ...ok, key: "profiles/someone" }));
        expect(res.statusCode).toBe(400);
    });

    it("GPS 入りの exif は保存されない", async () => {
        await invoke(savePhoto, ev({
            ...ok,
            exif: { camera: "X100V", gpsLatitude: "35.6812", gpsLongitude: "139.7671" },
        }));
        const saved = mockPutPhoto.mock.calls[0][0] as { exif?: Record<string, unknown> };
        expect(saved.exif).toEqual({ camera: "X100V" });
    });

    it("座標は約1kmに丸めて保存する", async () => {
        await invoke(savePhoto, ev({ ...ok, coords: { lat: 35.681236, lng: 139.767125 } }));
        const saved = mockPutPhoto.mock.calls[0][0] as { coords?: { lat: number; lng: number } };
        expect(saved.coords).toEqual({ lat: 35.68, lng: 139.77 });
    });

    it("ID はサーバーで採番する（リクエストの指定を使わない）", async () => {
        // ID を指定できると、既存の写真や notifs#… / comments#… の文書を
        // 同じIDで丸ごと置き換えられる。
        await invoke(savePhoto, ev({ ...ok, photoId: "notifs#someone", id: "notifs#someone" }));
        const saved = mockPutPhoto.mock.calls[0][0] as { id: string };
        expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(saved.id).not.toContain("#");
    });

    it("正しい入力は保存され、200 を返す", async () => {
        const res = await invoke(savePhoto, ev({ ...ok, location: "北海道", tags: ["海", "夏"] }));
        expect(res.statusCode).toBe(200);
        const saved = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect(saved.src).toBe("https://cdn.example.com/uploads/abc.jpg");
        expect(saved.location).toBe("北海道");
        expect(saved.tags).toEqual(["海", "夏"]);
        expect(saved.published).toBe(true);
    });

    it("表示名は付けない（個人名の直書きを消した）", async () => {
        // 以前は "丸田 竜平" が直書きされていて、誰が上げても同じ名前が
        // 付いた。そのまま静的HTMLと JSON-LD の author に載る。
        await invoke(savePhoto, ev(ok));
        const saved = mockPutPhoto.mock.calls[0][0] as Record<string, unknown>;
        expect(saved).not.toHaveProperty("displayName");
    });

    it("ソースに個人名を持たない", async () => {
        // 直書きが戻ってきたら気づけるようにしておく。
        const src = readFileSync(path.join(__dirname, "..", "upload.ts"), "utf-8");
        expect(src).not.toContain("丸田");
    });

    it("ファイル情報が無ければ 400", async () => {
        expect((await invoke(savePhoto, ev({ title: { ja: "海" } }))).statusCode).toBe(400);
    });

    it("保存に失敗したら 500", async () => {
        mockPutPhoto.mockRejectedValueOnce(new Error("ddb down"));
        expect((await invoke(savePhoto, ev(ok))).statusCode).toBe(500);
    });
});
