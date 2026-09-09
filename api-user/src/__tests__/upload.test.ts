import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockCountUserPhotos = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() => vi.fn());
const mockPutObjectInput = vi.hoisted(() => vi.fn());

const mockListMyMedia = vi.hoisted(() => vi.fn());
const mockGetPhotoById = vi.hoisted(() => vi.fn());
const mockOverwriteOwnPhoto = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({
    putPhoto: mockPutPhoto,
    getPhotoById: mockGetPhotoById,
    overwriteOwnPhoto: mockOverwriteOwnPhoto,
    countUserPhotos: mockCountUserPhotos,
    listMyMediaItems: mockListMyMedia,
}));

const mockLookupIfSet = vi.hoisted(() => vi.fn());
vi.mock("../notify", () => ({ lookupDisplayNameIfSet: mockLookupIfSet }));

const mockRequestSiteRebuild = vi.hoisted(() => vi.fn());
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRequestSiteRebuild }));

// 共同アルバム（案C）。`savePhoto` が「メンバーか」を確かめるようになったので、
// ここを模さないと本物が DynamoDB を掴む。**列挙式のモックは production の
// import が増えたときに足す必要がある**（台帳が何度も踏んでいる型）
const mockIsAlbumMember = vi.hoisted(() => vi.fn());
const mockAddPhotoToAlbum = vi.hoisted(() => vi.fn());
vi.mock("../albums", () => ({
    isAlbumMember: mockIsAlbumMember,
    addPhotoToAlbum: mockAddPhotoToAlbum,
}));

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
const { savePhoto, presignedUrl, discardUpload, PHOTO_LIMIT_PER_USER } = await import("../upload");
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

/** 再送で書き直した内容（overwriteOwnPhoto に渡した写真） */
function savedRewrite(): Photo {
    return mockOverwriteOwnPhoto.mock.calls[0][0] as Photo;
}

beforeEach(() => {
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
    mockCountUserPhotos.mockReset().mockResolvedValue(0);
    mockGetSignedUrl.mockReset().mockResolvedValue("https://s3.example/presigned");
    mockPutObjectInput.mockReset();
    mockLookupIfSet.mockReset().mockResolvedValue(undefined);
    mockGetPhotoById.mockReset().mockResolvedValue(undefined);
    mockOverwriteOwnPhoto.mockReset().mockResolvedValue(true);
    mockRequestSiteRebuild.mockReset().mockResolvedValue(true);
    mockIsAlbumMember.mockReset().mockResolvedValue(true);
    mockAddPhotoToAlbum.mockReset().mockResolvedValue(undefined);
});

// **投稿しても世に出ない、を直した分。**
// このサイトは静的エクスポートなので、DynamoDB に書いただけでは写真ページも
// sitemap も生まれない。消す側（削除・非公開・退会）は最初から再ビルドを
// 頼んでいたのに、**作る側だけが抜けていた**——公開で投稿しても、次の
// 定期ビルド（週1）まで最大7日、本人がリンクを共有できなかった。
// **公開一覧用 GSI の印。** `GET /photos` の全表 Scan をやめるための下ごしらえ。
// 印は「公開中の写真」にだけ載せる——下書きに載せると一覧に出てしまい、
// 公開に戻したときに載せ忘れると**二度と一覧に出ない**（索引にしか現れない
// ので、行を見ても分からない）。
// **共同アルバム（案C）。** `albumId` を付けて保存できるのはメンバーだけ。
// ここを通さずに保存できると、**誰でも他人のアルバムに写真を差し込める**
// （アルバムの ID は招待を受けた人なら知っている）。
describe("savePhoto: 共同アルバム", () => {
    it("メンバーなら albumId を保存し、アルバムにも足す", async () => {
        const res = await invoke(event("u1", { ...BASE, albumId: "alb-1" }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().albumId).toBe("alb-1");
        expect(mockAddPhotoToAlbum).toHaveBeenCalledWith("alb-1", savedPhoto().id);
    });

    // **403 ではなく 404。** そのアルバムが実在することを教えない
    it("メンバーでなければ 404（保存しない）", async () => {
        mockIsAlbumMember.mockResolvedValue(false);
        const res = await invoke(event("u1", { ...BASE, albumId: "alb-1" }));
        expect(res.statusCode).toBe(404);
        expect(mockPutPhoto, "メンバーでないのに保存している").not.toHaveBeenCalled();
    });

    it("albumId が無ければ、メンバーかどうかも見ない", async () => {
        await invoke(event("u1", { ...BASE }));
        expect(mockIsAlbumMember).not.toHaveBeenCalled();
        expect("albumId" in savedPhoto()).toBe(false);
    });

    it.each([123, {}, [], "", null])("albumId が文字列でなければ無視する（%s）", async (v) => {
        const res = await invoke(event("u1", { ...BASE, albumId: v }));
        expect(res.statusCode).toBe(200);
        expect("albumId" in savedPhoto()).toBe(false);
        expect(mockIsAlbumMember).not.toHaveBeenCalled();
    });

    // **写真を書いてからアルバムに足す。** 逆にすると、保存に失敗したときに
    // アルバムへ「存在しない写真の ID」が残る
    it("保存に失敗したらアルバムにも足さない", async () => {
        mockPutPhoto.mockRejectedValue(new Error("boom"));
        await invoke(event("u1", { ...BASE, albumId: "alb-1" }));
        expect(mockAddPhotoToAlbum).not.toHaveBeenCalled();
    });

    // 足せなくても投稿は成功で返す（写真はもう保存されている）
    it("アルバムに足せなくても、投稿は成功で返す", async () => {
        mockAddPhotoToAlbum.mockRejectedValue(new Error("full"));
        const res = await invoke(event("u1", { ...BASE, albumId: "alb-1" }));
        expect(res.statusCode).toBe(200);
    });
});

describe("savePhoto: 公開一覧の索引に載せる印", () => {
    it("公開で保存したら印を付ける", async () => {
        await invoke(event("u1", { ...BASE, published: true }));
        expect(savedPhoto().publicFeed).toBe("1");
    });

    it("下書きには付けない（付けると一覧に出る）", async () => {
        await invoke(event("u1", { ...BASE, published: false }));
        expect("publicFeed" in savedPhoto(), "下書きが一覧に出る").toBe(false);
    });

    it("published 未指定は公開なので付ける", async () => {
        await invoke(event("u1", { ...BASE }));
        expect(savedPhoto().publicFeed).toBe("1");
    });

    // 再送で書き直すときも、その回の意図で載せ直す
    it("再送で下書き→公開に書き直したら、印も付く", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl, published: false,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        await invoke(event("u1", { ...BASE, published: true }));
        expect(savedRewrite().publicFeed).toBe("1");
    });
});

describe("savePhoto: 公開したら静的サイトを作り直してもらう", () => {
    it("公開で保存したら再ビルドを頼む", async () => {
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).toHaveBeenCalledTimes(1);
        expect(mockRequestSiteRebuild.mock.calls[0][0]).toContain(savedPhoto().id);
    });

    // **coalesce を付ける。** 最初は外していたが逆向きだった——月次予算は
    // coalesce の有無に関わらず1加算されるので、素通しにすると1人が100枚
    // 公開しただけで既定 200本 の半分を使い切り、使い切った月は
    // **削除・退会の掃除まで全部落ちる**（`photoUpdate.ts` が同じ判断を
    // 一度して戻している）。畳まれても、その1本のビルドが DynamoDB を
    // 読み直すので写真は載る。
    it("依頼はまとめる（月次予算を食い潰さない）", async () => {
        await invoke(event("u1", { ...BASE, published: true }));
        const opts = mockRequestSiteRebuild.mock.calls[0][1];
        expect(opts?.coalesce, "素通しにすると削除の掃除まで落ちる").toBe(true);
    });

    // 依頼が投げたら、**保存済みの写真について 500 を返す**ことになる
    // （画面はそれを「保存できませんでした」と読んで実体を捨てにいく）
    it("依頼が例外を投げても、投稿は成功で返す", async () => {
        mockRequestSiteRebuild.mockRejectedValue(new Error("dispatch exploded"));
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).success).toBe(true);
    });

    // **黙って握らない。** rebuild.ts は失敗のたびに必ずログを出す作りなので、
    // その終端に無言の catch を置くと、発動したときに手がかりが無くなる
    it("例外を握るときは、手がかりを残す", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            mockRequestSiteRebuild.mockRejectedValue(new Error("dispatch exploded"));
            await invoke(event("u1", { ...BASE, published: true }));
            const logged = err.mock.calls.some((c) => String(c[0]).includes("requestRebuildForNewPhoto"));
            expect(logged, "無言で握っている").toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    it("下書きでは頼まない（静的ページを持たないので作り直す理由が無い）", async () => {
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });

    // 写真はもう保存されている。ここで 500 を返すのは嘘になる
    it("依頼できなくても、投稿は成功で返す", async () => {
        mockRequestSiteRebuild.mockResolvedValue(false);
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).success).toBe(true);
    });

    it("保存に失敗したときは頼まない（作り直す中身が無い）", async () => {
        mockPutPhoto.mockRejectedValue(new Error("boom"));
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(500);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });

    // 再送は「公開で落ちて下書き保存 → 公開を押し直す」経路で起きる。
    // 最初の保存は下書きだったので頼んでいない＝ここで見ないと落ちる
    it("再送で下書き→公開に変わったときも頼む", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl, published: false,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).toHaveBeenCalledTimes(1);
    });

    it("再送でも今回が下書きなら頼まない", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl, published: false,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });

    // **`published` を持たない古い行も「公開だった」と読む。**
    // このリポジトリは「未指定は公開」で揃っている（同じ関数の `isPublished`
    // 自身がそう）。`=== true` で書くとここだけ慣習と逆になり、古い行の
    // 二重送信で予算を1本ずつ食う
    it("再送で published を持たない行なら、公開済みとして頼まない", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });

    // **既存の穴の目撃者**（この差分で作った回帰ではない）。
    // 「公開を押す → 応答だけ失われる → 下書き保存を押す」で、公開済みの行が
    // 下書きに書き換わるのに再ビルドを頼まず `staticStale` も立てない
    // （`photoUpdate.ts` の隠す3経路はどちらもやっている）。実際に静的ページが
    // 残るのは「その間に別のビルドの scan が挟まった」場合だけなので窓は狭い。
    // **いまの振る舞いを写し取っておく**——直すのは別の差分で。
    it("【既知の穴】再送で公開→下書きに落としても、いまは何も頼まない", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl, published: true,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(savedRewrite().published, "下書きに書き換わっている").toBe(false);
        // **印も一緒に落ちる。** いまは丸ごと Put なので構造上そうなるが、
        // `overwriteOwnPhoto` が部分更新に変われば静かに壊れる場所
        expect("publicFeed" in savedRewrite(), "下書きなのに一覧に出る").toBe(false);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });

    // **ただの二重送信では頼まない。** 再送は「モバイル回線で応答だけが
    // 失われた」ときに起きるので、公開済みの写真について何度も来うる。
    // そのたびに頼むと月の予算を1本ずつ食う（最初の保存で頼んである）
    it("再送で既に公開済みなら頼まない", async () => {
        mockPutPhoto.mockRejectedValue(Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" }));
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: BASE.publicUrl, published: true,
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockRequestSiteRebuild).not.toHaveBeenCalled();
    });
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

    it("上限に達していたら 403", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(PHOTO_LIMIT_PER_USER);
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
    /**
     * presign を頼む。**`fileSize` は既定で入れる。**
     * 必須にしたので（省くと `ContentLength` の署名ごと飛ぶ）、キーや
     * 拡張子を見たいだけのテストが毎回書かなくて済むようにしておく。
     * サイズそのものを見るテストは明示で上書きする。
     */
    const ask = (sub: string, body: unknown) => invokePresign({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string"
            ? body
            : JSON.stringify({ fileSize: 1000, ...(body as Record<string, unknown>) }),
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

    it("上限に達していれば 403（署名を渡さない）", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(PHOTO_LIMIT_PER_USER);
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
describe("枚数の上限: 数えられなければ通さない", () => {
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
        mockCountUserPhotos.mockResolvedValueOnce(PHOTO_LIMIT_PER_USER);
        expect((await invoke(event("u1", BASE))).statusCode).toBe(403);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    // **境界**: ちょうど上限なら断り、1つ手前なら通す。片側しか見ていないと
    // 「>= を > に変える」変異が素通りする
    it("上限の1つ手前は通る", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(PHOTO_LIMIT_PER_USER - 1);
        expect((await invoke(event("u1", BASE))).statusCode).toBe(200);
        expect(mockPutPhoto).toHaveBeenCalled();
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

    // **鍵から「導出」する（v5）。鍵に書いてある UUID をそのまま採らない。**
    // 一度そう書いたが、鍵は presign したものか誰も確かめていないので、
    // それだと `uploads/<自分のsub>/<好きなUUID>.webp` と送るだけで写真IDを
    // 選び放題になる（削除済み写真のURLを取り直せる／任意IDの生死が分かる）。
    it("同じ鍵からは必ず同じIDになる（再送を見分けられる）", async () => {
        await invoke(event("u1", body));
        const first = savedPhoto().id;
        mockPutPhoto.mockClear();
        await invoke(event("u1", body));
        expect(savedPhoto().id).toBe(first);
        expect(first).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("鍵に書いた UUID がそのままIDにならない（狙ったIDを作れない）", async () => {
        await invoke(event("u1", body));
        expect(savedPhoto().id).not.toBe(UUID);
    });

    it("鍵が違えば違うID（別の写真が同じIDにならない）", async () => {
        await invoke(event("u1", body));
        const first = savedPhoto().id;
        mockPutPhoto.mockClear();
        const key2 = "uploads/u1/9a8b7c6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d.webp";
        await invoke(event("u1", { key: key2, publicUrl: `https://cdn.example.com/${key2}` }));
        expect(savedPhoto().id).not.toBe(first);
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

    // 古い形の鍵でも保存そのものは落とさない（IDが決まればよい）
    it("UUID の形でない鍵でも保存できる", async () => {
        await invoke(event("u1", { key: "uploads/u1/legacy.webp", publicUrl: "https://cdn.example.com/uploads/u1/legacy.webp" }));
        expect(savedPhoto().id).not.toBe("legacy");
        expect(savedPhoto().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    // 接頭辞だけ見ていると `uploads/<自分>/../<他人>/x.webp` が通り、
    // 「自分の領域の鍵」という前提が崩れる。discardUpload は最初から弾いている
    it("`..` を含む鍵は弾く（discardUpload と揃える）", async () => {
        const key = "uploads/u1/../u2/x.webp";
        const res = await invoke(event("u1", { key, publicUrl: "https://cdn.example.com/uploads/u1/x.webp" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    // 再送を見つけて保存済みの行をそのまま返していたら、published を取り違えた。
    // 「下書き保存」で応答が落ちたあと「公開」を押すと、200 が返って画面は
    // 成功と出るのに**行は下書きのまま**。逆順のほうが重い——非公開に
    // したつもりで**写真は公開されたまま**になる。
    it("再送では、その回の published で書き直す", async () => {
        mockPutPhoto.mockRejectedValueOnce(condFail());
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: `https://cdn.example.com/${KEY}`,
            published: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        });
        mockOverwriteOwnPhoto.mockResolvedValue(true);
        const res = await invoke(event("u1", { ...body, published: true }));

        expect(res.statusCode).toBe(200);
        const [written, expectAt] = mockOverwriteOwnPhoto.mock.calls[0] as [Photo, string];
        expect(written.published).toBe(true);
        expect(written.createdAt).toBe("2026-01-01T00:00:00.000Z");   // 作成時刻は保存済みのまま
        expect(expectAt).toBe("2026-01-01T00:00:00.000Z");            // 触られていないことを条件にする
        expect(JSON.parse(res.body).photo.published).toBe(true);
    });

    // /user/edit で後から直した内容を、開きっぱなしのアップロードタブが
    // 巻き戻さない。書き直せなければ保存済みの方を返す（成功は成功）
    it("誰かが触っていたら書き直さず、保存済みの方を返す", async () => {
        mockPutPhoto.mockRejectedValueOnce(condFail());
        mockGetPhotoById.mockResolvedValue({
            id: "x", userId: "u1", src: `https://cdn.example.com/${KEY}`,
            published: true, title: { ja: "あとで直した", en: "edited" },
            createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
        });
        mockOverwriteOwnPhoto.mockResolvedValue(false);
        const res = await invoke(event("u1", { ...body, published: false }));

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).photo.title.ja).toBe("あとで直した");
    });
});

// **許可リストだけでは塞げていなかった。**
//
// `@aws-sdk/s3-request-presigner` は presign の前に
// `unsignableHeaders.add("content-type")` を無条件で実行する
// （`dist-cjs/index.js` の `prepareRequest`）。つまり既定では Content-Type が
// **署名対象から外れる**——`image/jpeg` で presign を取り（拡張子は `.jpg` に
// 固定される）、`text/html` で PUT できる。CloudFront はサイトと同一オリジンで
// その HTML を返すので、localStorage の Cognito トークンが読める。
// `uploadPolicy.ts` が SVG を弾く理由として書いている攻撃そのもの。
//
// `@smithy/signature-v4` の `getCanonicalHeaders` は `signableHeaders` に
// 入っていれば unsignable を上書きするので、明示して署名対象に戻す。
describe("presign が Content-Type を縛る", () => {
    it("署名対象に content-type を明示する", async () => {
        mockGetSignedUrl.mockResolvedValue("https://s3.example/put");
        await invokePresign({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ fileName: "a.jpg", fileType: "image/jpeg", fileSize: 1000 }),
        });

        const opts = mockGetSignedUrl.mock.calls.at(-1)?.[2] as { signableHeaders?: Set<string> };
        expect(opts?.signableHeaders, "signableHeaders が渡っていない（既定では外される）").toBeDefined();
        expect([...(opts.signableHeaders ?? [])], "content-type が署名対象に入っていない")
            .toContain("content-type");
    });

    // **署名した種別を応答で返すところまでが対**。返さないと、クライアントは
    // 自分で `file.type` を組み立てることになり、大文字やパラメータ付きの差で
    // **全アップロードが 403** になる。ここを消しても全件緑だったので足した
    it("署名した種別をそのまま応答に載せる（クライアントはこれを送る）", async () => {
        mockGetSignedUrl.mockResolvedValue("https://s3.example/put");
        const res = await invokePresign({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ fileName: "a.jpg", fileType: "IMAGE/JPEG; charset=utf-8", fileSize: 1000 }),
        });

        const signed = (mockPutObjectInput.mock.calls.at(-1)?.[0] as { ContentType: string }).ContentType;
        expect(signed, "正規化していない文字列を焼き付けている").toBe("image/jpeg");
        // **署名したものと応答が同じ**であることが要点（片方だけ直しても意味が無い）
        expect(JSON.parse(res.body).contentType, "署名した種別を返していない").toBe(signed);
    });
});

// **50MB の制限は画面の中にしか無かった。**
//
// `fileSize` は任意項目のクライアント申告で、省けば判定ごと飛び、嘘を
// 書けばそのまま通る。presigned URL 自体も本文の長さを縛らないので、
// 直接叩けば単発 PUT の上限（5GB）まで入る。しかも掃除する経路が無いので
// （台帳 ORPHAN-2）、公開バケットに残り続ける。
//
// `ContentLength` を渡すと署名対象に入る（本物の SDK で実測。
// `presignSigning.test.ts`）。**申告した長さちょうど**でしか PUT できなく
// なるので、嘘をついてもその嘘に縛られる＝上限が実際に効く。
describe("presign がサイズを縛る", () => {
    const ask = (body: unknown) => invokePresign({
        requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
        body: JSON.stringify(body),
    });

    it("申告した長さを署名に焼き付ける", async () => {
        mockGetSignedUrl.mockResolvedValue("https://s3.example/put");
        await ask({ fileName: "a.jpg", fileType: "image/jpeg", fileSize: 12345 });

        const input = mockPutObjectInput.mock.calls.at(-1)?.[0] as { ContentLength?: number };
        expect(input.ContentLength, "長さを焼き付けていない").toBe(12345);
        const opts = mockGetSignedUrl.mock.calls.at(-1)?.[2] as { signableHeaders?: Set<string> };
        expect([...(opts?.signableHeaders ?? [])], "content-length が署名対象に入っていない")
            .toContain("content-length");
    });

    // **省けるままだと、判定も署名も両方飛ぶ**（＝好きなだけ入れられる）
    it.each([
        ["省略", { fileName: "a.jpg", fileType: "image/jpeg" }],
        ["文字列", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: "1000" }],
        ["0", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: 0 }],
        ["負", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: -1 }],
        ["NaN 相当", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: null }],
        // 小数を通すと `ContentLength: "1234.5"` で署名され、ブラウザは
        // 整数しか送れないので**絶対に使えない presign** ができる
        ["小数", { fileName: "a.jpg", fileType: "image/jpeg", fileSize: 1234.5 }],
    ])("fileSize が %s なら断る（presign を発行しない）", async (_name, body) => {
        mockGetSignedUrl.mockClear();
        const res = await ask(body);
        expect(res.statusCode).toBe(400);
        expect(mockGetSignedUrl, "断ったのに presign を発行している").not.toHaveBeenCalled();
    });

    it("上限を超えたら断る", async () => {
        mockGetSignedUrl.mockClear();
        const res = await ask({ fileName: "a.jpg", fileType: "image/jpeg", fileSize: 50 * 1024 * 1024 + 1 });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toContain("50MB");
        expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it("上限ちょうどは通す（境界）", async () => {
        mockGetSignedUrl.mockResolvedValue("https://s3.example/put");
        const res = await ask({ fileName: "a.jpg", fileType: "image/jpeg", fileSize: 50 * 1024 * 1024 });
        expect(res.statusCode).toBe(200);
    });
});
