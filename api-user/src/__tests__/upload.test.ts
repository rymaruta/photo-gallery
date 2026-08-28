import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockCountUserPhotos = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockPutObjectInput = vi.hoisted(() => vi.fn());

const mockListMyMedia = vi.hoisted(() => vi.fn());
const mockGetPhotoById = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({
    putPhoto: mockPutPhoto,
    getPhotoById: mockGetPhotoById,
    countUserPhotos: mockCountUserPhotos,
    listMyMediaItems: mockListMyMedia,
}));

const mockLookupIfSet = vi.hoisted(() => vi.fn());
vi.mock("../notify", () => ({ lookupDisplayNameIfSet: mockLookupIfSet }));

// 署名は必ずモックする。本物を呼ぶと AWS の認証情報を要求するので、
// 手元では通って CI では落ちる——**テストが実装ではなく環境を測る**。
// 実際にそれで本番デプロイを止めた（386eeef）。
// api/src/__tests__/upload.test.ts と profile.test.ts も同じ形。
const mockS3Send = vi.hoisted(() => vi.fn());
const mockDeleteObjectInput = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    PutObjectCommand: class {
        input: unknown;
        constructor(input: unknown) { this.input = input; mockPutObjectInput(input); }
    },
    DeleteObjectCommand: class {
        input: unknown;
        constructor(input: unknown) { this.input = input; mockDeleteObjectInput(input); }
    },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mockGetSignedUrl }));

// 環境変数はモジュール読込時に評価されるため、stub してから動的 import する
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.example.com");
const { savePhoto, presignedUrl, discardUpload } = await import("../upload");
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
    mockLookupIfSet.mockReset().mockResolvedValue(undefined);
    mockGetPhotoById.mockReset().mockResolvedValue(undefined);
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

// 「タグ無し」の保存形が2通りあった。ここは `tags: []` を必ず書き、
// photoUpdate.ts は空配列を REMOVE に倒す。そのせいで、この経路で
// 上げた写真を /user/edit で初めて保存すると sameStoredValue(undefined, [])
// が false になり、**中身を1文字も変えていないのに静的サイトの作り直しが
// 走った**（Actions の枠を1枚につき1回無駄に使う）。属性なしに揃える。
describe("savePhoto: タグ無しの保存形", () => {
    it("タグを送らなければ tags 属性を書かない", async () => {
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(200);
        expect("tags" in savedPhoto()).toBe(false);
    });

    it("空配列を送っても tags 属性を書かない（photoUpdate の REMOVE と同じ形）", async () => {
        const res = await invoke(event("u1", { ...BASE, tags: [] }));
        expect(res.statusCode).toBe(200);
        expect("tags" in savedPhoto()).toBe(false);
    });

    it("全部が空白のタグも「無し」に倒す", async () => {
        const res = await invoke(event("u1", { ...BASE, tags: ["  ", ""] }));
        expect(res.statusCode).toBe(200);
        expect("tags" in savedPhoto()).toBe(false);
    });

    it("タグがあれば今までどおり保存する", async () => {
        const res = await invoke(event("u1", { ...BASE, tags: ["山", "秋"] }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().tags).toEqual(["山", "秋"]);
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
    // IDの出どころは**鍵**（presign が採番して埋めたもの）に変わったが、
    // 本文の photoId は今も見ない。ここが外れると、他人の写真や通知文書
    // （notifs#...）を狙って書ける（実際に書けるかは putPhoto の
    // attribute_not_exists(id) 次第だが、そこに頼らせない）。
    it("本文の photoId は見ない（IDは鍵から取る）", async () => {
        const victimId = "someone-elses-photo-id";
        const res = await invoke(event("u1", { ...BASE, photoId: victimId }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().id).not.toBe(victimId);
        expect(savedPhoto().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    // 鍵から取るようにしたので、鍵に他人のIDを埋めて狙う筋が生まれる。
    // 鍵は uploadPrefix(userId) で始まることを先に確かめてあるので、
    // 埋められるのは**自分の領域のID**だけ。それでも重なったら
    // attribute_not_exists(id) が弾き、409 になる（上書きしない）。
    it("鍵に他人の写真IDを埋めても上書きしない", async () => {
        const victimId = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";
        const key = `uploads/u1/${victimId}.webp`;
        mockPutPhoto.mockRejectedValueOnce(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({ id: victimId, userId: "u2", src: "https://cdn.example.com/uploads/u2/x.webp" });
        const res = await invoke(event("u1", { key, publicUrl: `https://cdn.example.com/${key}` }));

        expect(res.statusCode).toBe(409);
        expect(mockPutPhoto).toHaveBeenCalledTimes(1);   // 条件付きの1回だけ
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


// 保存された displayName は静的HTMLと JSON-LD の author に焼き込まれる
// （lib/utils/seo.ts:131・PhotoPageClient:618）。本文から受け取ると
// 「運営」や他人の名前を写真ごとに名乗れる。
// 同じことをストーリーでは既に禁じていた（stories.ts:155）。
describe("savePhoto: 表示名はサーバーで引く", () => {
    it("本文の displayName は無視する", async () => {
        mockLookupIfSet.mockResolvedValue("本当の名前");
        await invoke(event("u1", { ...BASE, displayName: "運営" }));
        expect(savedPhoto().displayName).toBe("本当の名前");
        expect(mockLookupIfSet).toHaveBeenCalledWith("u1");
    });

    it("表示名を設定していない人の写真には付けない", async () => {
        // 既定名（「名前未設定さん」）を入れてしまうと、写真ページに
        // 「名前未設定さんの他の写真」という導線が新しく出る。表示は変えない。
        mockLookupIfSet.mockResolvedValue(undefined);
        await invoke(event("u1", { ...BASE, displayName: "運営" }));
        expect(savedPhoto().displayName).toBeUndefined();
    });
});

// 上限は容量と費用の管理。数えられなかったときに通すと、
// スロットリングを起こすだけで超えられる。
describe("100枚の上限: 数えられなければ通さない", () => {
    it("savePhoto: 数え上げが落ちたら 503（保存しない）", async () => {
        mockCountUserPhotos.mockRejectedValueOnce(new Error("throttled"));
        const res = await invoke(event("u1", BASE));
        expect(res.statusCode).toBe(503);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("presignedUrl: 数え上げが落ちたら 503（署名を渡さない）", async () => {
        mockCountUserPhotos.mockRejectedValueOnce(new Error("throttled"));
        const res = await invokePresign({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ fileName: "a.jpg", fileType: "image/jpeg" }),
        });
        expect(res.statusCode).toBe(503);
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("savePhoto: 上限に達していれば 403", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(100);
        expect((await invoke(event("u1", BASE))).statusCode).toBe(403);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("管理者は数え上げが落ちても通る（上限の対象外）", async () => {
        mockCountUserPhotos.mockRejectedValue(new Error("throttled"));
        // 管理者でも「自分の領域」の判定は通る必要がある（所有の根拠なので）
        const res = await invoke({
            requestContext: { authorizer: { jwt: { claims: { sub: "admin", "cognito:groups": "[admin]" } } } },
            body: JSON.stringify({
                key: "uploads/admin/p1.webp",
                publicUrl: "https://cdn.example.com/uploads/admin/p1.webp",
            }),
        });
        expect(res.statusCode).toBe(200);
    });

    it("数えられれば今までどおり通る", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(3);
        expect((await invoke(event("u1", BASE))).statusCode).toBe(200);
    });
});

// 投稿は「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目を
// 画面で捨てると、**実体だけが S3 に残る**。どの削除経路も DynamoDB の
// 項目からキーを引くので、項目の無いオブジェクトには誰も手が届かない
// ——退会しても、写真を消しても残り続ける（原本は GPS 入りのまま
// 公開URLで取れる）。それを消すための口。
describe("discardUpload", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discard = (e: unknown): Promise<LambdaResult> => (discardUpload as any)(e);
    const ME = "11111111-1111-4111-8111-111111111111";
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const MY_KEY = `uploads/${ME}/abc.jpg`;
    const ev = (sub: string | undefined, body: unknown) => ({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

    beforeEach(() => {
        mockListMyMedia.mockReset().mockResolvedValue([]);
        mockS3Send.mockReset().mockResolvedValue({});
        mockDeleteObjectInput.mockReset();
    });

    it("認証が無ければ 401", async () => {
        expect((await discard(ev(undefined, { key: MY_KEY }))).statusCode).toBe(401);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("自分の領域の、どこにも使われていないキーは消せる", async () => {
        const res = await discard(ev(ME, { key: MY_KEY }));
        expect(res.statusCode).toBe(200);
        expect(mockDeleteObjectInput.mock.calls[0][0]).toMatchObject({ Key: MY_KEY });
    });

    // 前置きを見ないと、他人の写真の実体だけを消せる（相手の一覧に
    // 割れた画像が並び、本人にも直せない）。
    it("他人の領域のキーは消せない", async () => {
        const res = await discard(ev(ME, { key: `uploads/${OTHER}/abc.jpg` }));
        expect(res.statusCode).toBe(403);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("uploads/ の外は消せない（アイコンを消させない）", async () => {
        for (const key of [`profiles/${ME}`, "app/data/photos.json", ""]) {
            expect((await discard(ev(ME, { key }))).statusCode).toBe(403);
        }
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("`..` を含むキーは消せない", async () => {
        const res = await discard(ev(ME, { key: `uploads/${ME}/../${OTHER}/abc.jpg` }));
        expect(res.statusCode).toBe(403);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    // ここが肝。使用中の判定が無いと、利用者は**自分の保存済みの写真の
    // 実体だけ**を消せてしまう（DynamoDB には行が残る）。
    it("保存済みの写真が使っているキーは消さない", async () => {
        mockListMyMedia.mockResolvedValue([
            { id: "p1", src: `https://cdn.example.com/${MY_KEY}` },
        ]);
        const res = await discard(ev(ME, { key: MY_KEY }));
        expect(res.statusCode).toBe(409);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("派生画像として使われていても消さない（原本・サムネ・AVIF）", async () => {
        for (const field of ["srcOriginal", "thumbSrc", "srcAvif", "src256"]) {
            mockListMyMedia.mockResolvedValue([{ id: "p1", [field]: `https://cdn.example.com/${MY_KEY}` }]);
            expect((await discard(ev(ME, { key: MY_KEY }))).statusCode).toBe(409);
        }
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    // listMyPhotos（ストーリー除外）で判定していた頃は、**自分の生きている
    // ストーリーの実体を消せた**。item は残るので、ログイン中の全員のトレイに
    // 壊れた画像／再生できない動画が最大24時間出続ける。
    it("生きているストーリーが使っているキーも消さない", async () => {
        mockListMyMedia.mockResolvedValue([
            { id: "story-1", story: true, src: `https://cdn.example.com/${MY_KEY}` },
        ]);
        const res = await discard(ev(ME, { key: MY_KEY }));
        expect(res.statusCode).toBe(409);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    // 「分からないなら止める」。ここで通すと取り返しのつかない削除になる。
    it("使用中かどうか確かめられなければ消さない（503）", async () => {
        mockListMyMedia.mockImplementationOnce(() => Promise.reject(new Error("ddb down")));
        const res = await discard(ev(ME, { key: MY_KEY }));
        expect(res.statusCode).toBe(503);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("S3 の削除が落ちたら 503（成功を装わない）", async () => {
        mockS3Send.mockImplementationOnce(() => Promise.reject(new Error("s3 down")));
        expect((await discard(ev(ME, { key: MY_KEY }))).statusCode).toBe(503);
    });

    it("壊れた JSON は 400", async () => {
        expect((await discard(ev(ME, "{"))).statusCode).toBe(400);
    });
});

// 保存の再送が**同じ写真をもう1枚**作っていた。
// 「公開」を押す → サーバーには届いたが応答が失われる（モバイル回線・
// API Gateway の 29 秒）→ 画面は error になる → 押し直すと、S3 に上げた分は
// 使い回すのに save だけもう一度飛び、新しいIDで2枚目の行ができる。
// 100枚の枠を2つ食い、片方を消すと共有している S3 の実体が消えて
// **もう片方が割れた画像になる**。
describe("savePhoto: 保存の再送で写真が増えない", () => {
    const UUID = "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607";
    const KEY = `uploads/u1/${UUID}.webp`;
    const body = { key: KEY, publicUrl: `https://cdn.example.com/${KEY}` };
    const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

    it("IDは presign が鍵に埋めたものを使う（採番し直さない）", async () => {
        await invoke(event("u1", body));
        expect(savedPhoto().id).toBe(UUID);
    });

    it("同じ鍵で送り直したら、成功を返して2枚目を作らない", async () => {
        mockPutPhoto.mockRejectedValueOnce(condFail());
        mockGetPhotoById.mockResolvedValue({
            id: UUID, userId: "u1", src: `https://cdn.example.com/${KEY}`, title: { ja: "前回", en: "prev" },
        });
        const res = await invoke(event("u1", body));

        expect(res.statusCode).toBe(200);
        // 返すのは**保存済みの方**（クライアントはこれを一覧に出す）
        expect(JSON.parse(res.body).photo.title.ja).toBe("前回");
        expect(mockPutPhoto).toHaveBeenCalledTimes(1);
    });

    // 他人のIDを狙って書いた場合に「成功しました」と返さない（存在も教えない）
    it("他人の写真とIDがぶつかったら 409（成功と言わない）", async () => {
        mockPutPhoto.mockRejectedValueOnce(condFail());
        mockGetPhotoById.mockResolvedValue({ id: UUID, userId: "u2", src: "https://cdn.example.com/uploads/u2/x.webp" });
        const res = await invoke(event("u1", body));

        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).success).toBeUndefined();
    });

    // 同じIDでも中身が違う（別の画像を同じ鍵で登録しようとした）なら通さない
    it("IDが同じでも src が違えば 409", async () => {
        mockPutPhoto.mockRejectedValueOnce(condFail());
        mockGetPhotoById.mockResolvedValue({ id: UUID, userId: "u1", src: "https://cdn.example.com/uploads/u1/other.webp" });
        expect((await invoke(event("u1", body))).statusCode).toBe(409);
    });

    // 鍵の形が違えば採番に落ちる（古い鍵で保存そのものを落とさない）
    it("UUID の形でない鍵はサーバーで採番する", async () => {
        await invoke(event("u1", { key: "uploads/u1/legacy.webp", publicUrl: "https://cdn.example.com/uploads/u1/legacy.webp" }));
        expect(savedPhoto().id).not.toBe("legacy");
        expect(savedPhoto().id).toMatch(/^[0-9a-f-]{36}$/);
    });
});
