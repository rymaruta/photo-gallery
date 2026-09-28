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
// **アルバムの掃除は境界としてモックする**（実体は突き合わせのテストと
// `api-user` 側が見る）。ここで見たいのは「呼ぶかどうか」
const mockRemoveFromAlbum = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../albumCleanup", () => ({ removePhotoFromAlbum: mockRemoveFromAlbum }));
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
const invoke = (): Promise<{ statusCode: number; body: string }> => (deletePhoto as any)({
    pathParameters: { id: "p1" },
    requestContext: { authorizer: { jwt: { claims: { sub: "admin" } } } },
});

beforeEach(() => {
    mockS3Send.mockReset().mockResolvedValue({});
    mockInvalidate.mockReset().mockResolvedValue(true);
    mockGetPhoto.mockReset().mockResolvedValue(PHOTO);
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockRebuild.mockReset().mockResolvedValue(true);
    mockRemoveFromAlbum.mockReset().mockResolvedValue(undefined);
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

    // **公開範囲を絞った写真は `private/` に移っている**（api-user の
    // `privateMove.ts`）。拾わないと、管理者が消しても実体が残る
    it("private/ に移った写真の実体も消す", async () => {
        mockGetPhoto.mockResolvedValue({
            id: "p1", userId: "someone", audience: "followers",
            src: "https://cdn.test/private/someone/p1.jpg",
            thumbSrc: "private/someone/p1_thumb.webp",
        });
        const res = await invoke();
        expect(res.statusCode).toBe(200);
        const deleted = mockS3Send.mock.calls.map((c) => (c[0] as { input: { Key: string } }).input.Key);
        expect(deleted).toEqual(expect.arrayContaining(["private/someone/p1.jpg", "private/someone/p1_thumb.webp"]));
    });

        // **掃除を頼めたかを応答に載せる。**
    //
    // `requestSiteRebuild` の**戻り値を捨てて**いたので、管理画面は削除の
    // たびに「写真を削除しました。」とだけ言っていた——利用者側の3画面は
    // 「個別ページは残ることがあります」と毎回言っているのに、
    // **管理者だけが「消えた」と思い込む**状態だった。本番はトークン
    // 未設定なので、実際は毎回残る（本文・撮影地・表示名入りの JSON-LD ごと）
    it("依頼が届かなければ、応答で知らせる", async () => {
        mockRebuild.mockResolvedValue(false);
        const res = await invoke();
        expect(res.statusCode).toBe(200);   // 削除そのものは成立している
        expect(JSON.parse(res.body).staticStale, "画面が伝えようがない").toBe(true);
    });

    it("届いたときは載せない", async () => {
        mockRebuild.mockResolvedValue(true);
        const res = await invoke();
        expect(JSON.parse(res.body).staticStale).toBeUndefined();
        expect(JSON.parse(res.body).success).toBe(true);
    });

    // **一度も公開していない下書きには、残るページが無い。**
    // `!dispatched` をそのまま返していたので、本番（トークン未設定＝常に
    // false）では**下書きを消すたびに**「個別ページは残ることがあります」
    // と出ていた——「管理者だけが『消えた』と思い込む」を直すつもりで、
    // **逆向きの嘘**（消えているのに残ると言う）を作っていた。
    // 判定は `api-user` の `deleteMyPhoto` と同じ形
    it("下書きを消したときは、残るとは言わない", async () => {
        mockRebuild.mockResolvedValue(false);
        mockGetPhoto.mockResolvedValue({ ...PHOTO, published: false });
        const res = await invoke();
        expect(JSON.parse(res.body).staticStale, "まだ無いページについて残ると言っている").toBeUndefined();
    });

    // **掃除が届かなかった非公開写真は別。** ページは公開されたまま
    // 残っているので、伝える（`staticStale` の印がその根拠）
    it("掃除が届かなかった非公開写真では、残ると言う", async () => {
        mockRebuild.mockResolvedValue(false);
        mockGetPhoto.mockResolvedValue({ ...PHOTO, published: false, staticStale: true });
        const res = await invoke();
        expect(JSON.parse(res.body).staticStale, "公開されたままのページを黙っている").toBe(true);
    });

    // **下書きでは依頼そのものを出さない**（`api-user` の `deleteMyPhoto`
    // と同じ位置）。一度、依頼は無条件のまま応答の印だけ抑える形にした
    // ——印の嘘は消えるが、**月次の予算は1本使う**（`rebuild.ts` は
    // 「総量の予算は coalesce に関わらず見る」と明記）。下書きを1枚消す
    // たびに8分のビルドが走る
    it("下書きでは再ビルドを頼まない（予算を使わない）", async () => {
        mockGetPhoto.mockResolvedValue({ ...PHOTO, published: false });
        await invoke();
        expect(mockRebuild, "無いページのためにビルドを1本使っている").not.toHaveBeenCalled();
    });

    it("公開中なら、今までどおり頼む", async () => {
        mockGetPhoto.mockResolvedValue({ ...PHOTO, published: true });
        await invoke();
        expect(mockRebuild).toHaveBeenCalled();
    });

    // `published` を持たない古い行は「公開」（このリポジトリの慣習）
    it("published を持たない古い行でも頼む", async () => {
        const noPublished: Record<string, unknown> = { ...PHOTO };
        delete noPublished.published;
        mockGetPhoto.mockResolvedValue(noPublished);
        await invoke();
        expect(mockRebuild, "未指定＝公開の慣習から外れている").toHaveBeenCalled();
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

// **管理者削除がアルバムから取り除いていなかった。**
//
// `removePhotoFromAlbum` の docstring が「呼ばれないと何が困るか」を
// 自分で書いている——500枚の枠を食う／招待ページの窓を死んだ ID で
// 埋めて「生きている写真があるのに空」に見える。それでも呼んでいたのは
// `deleteMyPhoto` だけで、`api/src` には `album` の文字が1つも無かった。
//
// 写真の行が `albumId` の唯一の手がかりなので、行を消したあとは
// 誰も辿り直せない＝**永久にずれる**。
describe("管理APIの削除: 共同アルバムから取り除く", () => {
    it("アルバムに入っていた写真は、アルバムからも外す", async () => {
        mockGetPhoto.mockResolvedValue({ ...PHOTO, albumId: "A" });
        const res = await invoke();
        expect(res.statusCode).toBe(200);
        expect(mockRemoveFromAlbum, "死んだ ID がアルバムに残る（枠を食い、招待ページの窓を埋める）")
            .toHaveBeenCalledWith("A", "p1");
    });

    it("アルバムに入っていない写真では呼ばない", async () => {
        mockGetPhoto.mockResolvedValue(PHOTO);
        await invoke();
        expect(mockRemoveFromAlbum, "関係ないのに引きに行っている").not.toHaveBeenCalled();
    });

    // **掃除の失敗で削除を失敗にしない。** 写真はもう消えているので、
    // ここで 500 を返すと「消えているのに失敗と出る」——押し直しても
    // 行はもう無いので直らない（`deleteMyPhoto`・`deleteAccount` と同じ形）
    it("取り除きに失敗しても、削除は成立する", async () => {
        mockGetPhoto.mockResolvedValue({ ...PHOTO, albumId: "A" });
        mockRemoveFromAlbum.mockRejectedValue(new Error("conditional check failed"));
        const res = await invoke();
        expect(res.statusCode, "掃除の失敗で削除を止めている").toBe(200);
    });
});

describe("管理APIの写真削除: 2枚目以降（extraImages）", () => {
    /** S3 に DeleteObject を投げたキーを集める */
    const deletedKeys = (): string[] => mockS3Send.mock.calls
        .map((c) => (c[0] as { input?: { Key?: string } }).input?.Key)
        .filter((v): v is string => typeof v === "string");

    it("🔴 2枚目以降の実体と派生も消す（`api-user/src/photoImages.ts` と対）", async () => {
        mockGetPhoto.mockResolvedValue({
            ...PHOTO,
            extraImages: [{
                src: "https://cdn.test/uploads/someone/a.webp",
                srcAvif: "https://cdn.test/uploads/someone/a.avif",
                thumbSrc: "https://cdn.test/uploads/someone/a_512.webp",
                thumbAvif: "https://cdn.test/uploads/someone/a_512.avif",
                thumbSm: "https://cdn.test/uploads/someone/a_256.webp",
                thumbSmAvif: "https://cdn.test/uploads/someone/a_256.avif",
            }],
        });
        const res = await invoke();
        expect(res.statusCode).toBe(200);
        const keys = deletedKeys();
        for (const k of ["a.webp", "a.avif", "a_512.webp", "a_512.avif", "a_256.webp", "a_256.avif"]) {
            expect(keys, `uploads/someone/${k} を消していない`).toContain(`uploads/someone/${k}`);
        }
        // エッジからも消す（S3 だけ消してもキャッシュに最大1年残る）
        expect(mockInvalidate.mock.calls[0][0]).toEqual(
            expect.arrayContaining(["uploads/someone/a.webp", "uploads/someone/a.avif"]));
    });

    it("2枚目以降でも uploads/ の外は消さない（他人のアイコンを消させない）", async () => {
        mockGetPhoto.mockResolvedValue({
            ...PHOTO,
            extraImages: [{ src: "https://cdn.test/profiles/victim" }],
        });
        await invoke();
        expect(deletedKeys()).not.toContain("profiles/victim");
    });

    it("ギャラリーに残した写真（keptAs）なら、2枚目以降も消さない", async () => {
        mockGetPhoto.mockResolvedValue({
            ...PHOTO, keptAs: "photo-1",
            extraImages: [{ src: "https://cdn.test/uploads/someone/a.webp" }],
        });
        await invoke();
        expect(deletedKeys()).toEqual([]);
    });

    it("extraImages が壊れていても、表紙の削除は変わらない", async () => {
        mockGetPhoto.mockResolvedValue({ ...PHOTO, extraImages: [null, {}, "x"] });
        const res = await invoke();
        expect(res.statusCode).toBe(200);
        expect(deletedKeys()).toEqual(
            expect.arrayContaining(["uploads/someone/p1.jpg", "uploads/someone/p1_orig.jpg"]));
    });
});
