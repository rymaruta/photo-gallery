import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockCountUserPhotos = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockPutObjectInput = vi.hoisted(() => vi.fn());

vi.mock("../ddb-photos", () => ({
    putPhoto: mockPutPhoto,
    countUserPhotos: mockCountUserPhotos,
}));

// 署名は必ずモックする。本物を呼ぶと AWS の認証情報を要求するので、
// 手元では通って CI では落ちる——**テストが実装ではなく環境を測る**。
// 実際にそれで本番デプロイを止めた（386eeef）。
// api/src/__tests__/upload.test.ts と profile.test.ts も同じ形。
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) { this.input = input; mockPutObjectInput(input); }
    },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mockGetSignedUrl }));

// 環境変数はモジュール読込時に評価されるため、stub してから動的 import する
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
const { savePhoto, presignedUrl } = await import("../upload");
import type { Photo } from "../types";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (savePhoto as any)(event);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invokePresign = (event: unknown): Promise<LambdaResult> => (presignedUrl as any)(event);

function event(sub: string, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

// キーは投稿者ごとの領域（uploads/<userId>/）に置く。ここが「他人のファイルを
// 自分の写真として登録できない」ことの土台になっている。
const BASE = { key: "uploads/u1/p1.webp", publicUrl: "https://cdn.example.com/uploads/u1/p1.webp" };

function savedPhoto(): Photo {
    return mockPutPhoto.mock.calls[0][0] as Photo;
}

beforeEach(() => {
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
    mockCountUserPhotos.mockReset().mockResolvedValue(0);
    mockGetSignedUrl.mockReset().mockResolvedValue("https://s3.example/presigned");
    mockPutObjectInput.mockReset();
});

describe("savePhoto: thumbUrl（一覧グリッド用サムネイル）", () => {
    it("https の thumbUrl は thumbSrc として保存される", async () => {
        const thumbUrl = "https://cdn.example.com/uploads/u1/t1.webp";
        const res = await invoke(event("u1", { ...BASE, thumbUrl }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().thumbSrc).toBe(thumbUrl);
    });

    it("thumbUrl なしでも保存できる（thumbSrc は付かない）", async () => {
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("http:// の thumbUrl は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, thumbUrl: "http://evil.example.com/x.webp" }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("500文字を超える thumbUrl は破棄される", async () => {
        const thumbUrl = `https://cdn.example.com/uploads/u1/${"a".repeat(500)}.webp`;
        const res = await invoke(event("u1", { ...BASE, thumbUrl }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("文字列以外の thumbUrl は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, thumbUrl: 123 }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });
});

describe("savePhoto: 基本バリデーション", () => {
    it("key / publicUrl がなければ 400", async () => {
        const res = await invoke(event("u1", { thumbUrl: "https://x.example.com/t.webp" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("不正な JSON は 400", async () => {
        const res = await invoke(event("u1", "{broken"));
        expect(res.statusCode).toBe(400);
    });

    it("100枚上限に達していたら 403", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(100);
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(403);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });
});

describe("savePhoto: blurDataURL（ぼかしプレビュー）", () => {
    const blur = "data:image/webp;base64,UklGRAAAAABXRUJQ";
    it("有効な画像 data URI は blurDataURL として保存される", async () => {
        const res = await invoke(event("u1", { ...BASE, blurDataURL: blur }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().blurDataURL).toBe(blur);
    });
    it("data URI でない文字列は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, blurDataURL: "https://evil.example.com/x.webp" }));
        expect(res.statusCode).toBe(200);
        expect("blurDataURL" in savedPhoto()).toBe(false);
    });
    it("4000文字を超えるものは破棄される", async () => {
        const big = "data:image/webp;base64," + "A".repeat(4100);
        const res = await invoke(event("u1", { ...BASE, blurDataURL: big }));
        expect(res.statusCode).toBe(200);
        expect("blurDataURL" in savedPhoto()).toBe(false);
    });
});

describe("savePhoto: 下書き（published フラグ）", () => {
    it("既定（published 未指定）は公開で保存する", async () => {
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(true);
    });

    it("published:false は下書き（非公開）で保存する", async () => {
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(false);
    });

    it("published:true を明示した場合も公開で保存する", async () => {
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(true);
    });

    it("下書きは必須項目なしでも保存できる（title 未指定は既定の無題）", async () => {
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().title).toEqual({ ja: "無題", en: "Untitled" });
    });
});

describe("savePhoto: exif（撮影情報）のサニタイズ", () => {
    it("既知のフィールドだけが保存される（GPSや未知キーは落ちる）", async () => {
        const res = await invoke(event("u1", {
            ...BASE,
            exif: {
                camera: "SONY ILCE-7M3", lens: "FE 24-70mm", aperture: "f/4",
                exposure: "1/640s", iso: 100, focalLength: "70mm",
                whiteBalance: "Manual", imageSize: "6000x4000",
                dateTimeOriginal: "2026-01-20T07:32:00.000Z",
                GPSLatitude: 35.0, evil: "<script>",
            },
        }));
        expect(res.statusCode).toBe(200);
        const exif = savedPhoto().exif as Record<string, unknown>;
        expect(exif.camera).toBe("SONY ILCE-7M3");
        expect(exif.iso).toBe(100);
        expect(exif.dateTimeOriginal).toBe("2026-01-20T07:32:00.000Z");
        expect("GPSLatitude" in exif).toBe(false);
        expect("evil" in exif).toBe(false);
    });

    it("文字列は100文字に切り詰められる", async () => {
        const res = await invoke(event("u1", { ...BASE, exif: { camera: "x".repeat(300) } }));
        expect(res.statusCode).toBe(200);
        expect((savedPhoto().exif as { camera: string }).camera.length).toBe(100);
    });

    it("空・不正な exif は保存されない", async () => {
        const res = await invoke(event("u1", { ...BASE, exif: { iso: -5, camera: "  " } }));
        expect(res.statusCode).toBe(200);
        expect("exif" in savedPhoto()).toBe(false);
    });
});

// 他人のデータを壊せる経路を塞いだことの回帰ガード。
// いずれも「ログインしていれば誰でも実行できた」ものなので、外れたら即座に気づけるようにする。
describe("savePhoto: 他人のデータを壊せないこと", () => {
    it("リクエストの photoId は無視し、必ずサーバーで採番する", async () => {
        // 写真IDはURLで公開されている。受け取ってしまうと、他人の写真や
        // 通知文書（notifs#...）を丸ごと上書きできてしまう。
        const victimId = "someone-elses-photo-id";
        const res = await invoke(event("u1", { ...BASE, photoId: victimId }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().id).not.toBe(victimId);
        expect(savedPhoto().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("配信ドメイン外の publicUrl は弾く", async () => {
        const res = await invoke(event("u1", { ...BASE, publicUrl: "https://evil.example.com/uploads/x.jpg" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("uploads/ 以外を指す publicUrl は弾く（他人のアイコンを消せてしまうため）", async () => {
        const res = await invoke(event("u1", {
            ...BASE,
            publicUrl: "https://cdn.example.com/profiles/victim-user-id",
        }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("uploads/ 以外の key は弾く", async () => {
        const res = await invoke(event("u1", { ...BASE, key: "profiles/victim-user-id" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("他人の領域を指す publicUrl は弾く", async () => {
        // 以前は uploads/ 配下かどうかしか見ていなかったので、他人の写真の
        // 公開URLを自分の写真の src として登録でき、その写真を削除すると
        // 相手の実ファイルが S3 から消えた（元に戻せない）。
        const res = await invoke(event("u1", {
            key: "uploads/u2/victim.jpg",
            publicUrl: "https://cdn.example.com/uploads/u2/victim.jpg",
        }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("他人の領域を指す thumbUrl は捨てる", async () => {
        // thumbSrc も退会時の削除対象なので、publicUrl と同じ強さで確かめる。
        const res = await invoke(event("u1", {
            ...BASE,
            thumbUrl: "https://cdn.example.com/uploads/u2/victim.jpg",
        }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("外部ドメインの thumbUrl は捨てる（訪問者のIPを他所に渡さない）", async () => {
        const res = await invoke(event("u1", { ...BASE, thumbUrl: "https://evil.example/tracker.gif" }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });
});


// presignedUrl は今まで1本もテストが無かった。
// ここが決めているのは「どの種別を受け入れるか」と「どこに置くか」で、
// 後者（uploads/<userId>/）が **他人のファイルを自分の写真として
// 登録・削除できない**ことの土台そのもの。
describe("presignedUrl", () => {
    const ask = (sub: string, body: unknown) => invokePresign({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

    it("sub が取れなければ 401", async () => {
        // 通すと key が uploads// になり、全員が同じ場所を共有する
        // ＝所有の判定が成り立たなくなる。
        const res = await ask("", { fileName: "a.jpg", fileType: "image/jpeg" });
        expect(res.statusCode).toBe(401);
    });

    it("キーは投稿者ごとの領域に置く", async () => {
        const res = await ask("u1", { fileName: "a.jpg", fileType: "image/jpeg" });
        expect(res.statusCode).toBe(200);
        const { key, publicUrl } = JSON.parse(res.body) as { key: string; publicUrl: string };
        expect(key).toMatch(/^uploads\/u1\/[0-9a-f-]{36}\.jpg$/);
        expect(publicUrl).toBe(`https://cdn.example.com/${key}`);
    });

    it("拡張子はファイル名ではなく種別から決める", async () => {
        // ファイル名由来だと "わな.svg" がそのまま S3 のキーになっていた。
        const res = await ask("u1", { fileName: "わな.svg", fileType: "image/png" });
        const { key } = JSON.parse(res.body) as { key: string };
        expect(key.endsWith(".png")).toBe(true);
        expect(key).not.toContain("svg");
    });

    it("SVG は通さない（同一オリジンで実行できる文書のため）", async () => {
        expect((await ask("u1", { fileName: "a.svg", fileType: "image/svg+xml" })).statusCode).toBe(400);
    });

    it("動画は通す（ストーリー用）", async () => {
        for (const t of ["video/mp4", "video/webm", "video/quicktime"]) {
            expect((await ask("u1", { fileName: "a.mp4", fileType: t })).statusCode).toBe(200);
        }
    });

    it("画像でも動画でもないものは通さない", async () => {
        for (const t of ["application/pdf", "text/html"]) {
            expect((await ask("u1", { fileName: "a", fileType: t })).statusCode).toBe(400);
        }
    });

    it("50MB を超えるものは断る", async () => {
        const res = await ask("u1", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: 51 * 1024 * 1024 });
        expect(res.statusCode).toBe(400);
    });

    it("ファイル名とファイルタイプが無ければ 400", async () => {
        expect((await ask("u1", { fileType: "image/jpeg" })).statusCode).toBe(400);
        expect((await ask("u1", { fileName: "a.jpg" })).statusCode).toBe(400);
    });

    it("壊れた JSON は 400", async () => {
        expect((await ask("u1", "{")).statusCode).toBe(400);
    });

    it("100枚に達していれば 403（署名を渡さない）", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(100);
        const res = await ask("u1", { fileName: "a.jpg", fileType: "image/jpeg" });
        expect(res.statusCode).toBe(403);
    });
});
