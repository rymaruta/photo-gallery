import { describe, it, expect, vi, beforeEach } from "vitest";

// 一般ユーザーには自分の写真を消す手段が無かった。写真削除は管理API
// （admin 限定）にしか無く、api-user には deleteStory / deleteComment /
// deleteAccount はあるのに deletePhoto が無い。できるのは「非公開にする」
// だけで S3 の実体は残る——「撮影地に自宅の最寄り駅が写り込んでいた」と
// 気づいた人の選択肢が「隠す（原本は公開URLに残る）」か「退会する」の
// 二択だった。24時間で消えるストーリーは消せるのに、永久に残る写真が消せない。

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectsCommand: class { input: unknown; readonly kind = "s3delete"; constructor(i: unknown) { this.input = i; } },
}));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { deleteMyPhoto } = await import("../photoUpdate");

type Result = { statusCode: number; body: string };
const invoke = (sub: string | undefined, id: string | undefined): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (deleteMyPhoto as any)({
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id === undefined ? undefined : { id },
    });

const ME = "me";
const PHOTO = {
    id: "p1", userId: ME, published: true,
    src: "https://cdn.test/uploads/me/p1.jpg",
    srcOriginal: "https://cdn.test/uploads/me/p1_orig.jpg",
    thumbSrc: "https://cdn.test/uploads/me/p1_thumb.webp",
};

/** DynamoDB で消されたキー */
const deletedIds = () => mockDdbSend.mock.calls
    .map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> })
    .filter((c) => c.constructor.name === "DeleteCommand")
    .map((c) => String((c.input.Key as { id?: string })?.id ?? ""));
/** S3 で消されたキー */
const deletedS3 = () => mockS3Send.mock.calls
    .flatMap((c) => ((c[0] as { input: { Delete?: { Objects?: { Key: string }[] } } }).input.Delete?.Objects ?? []))
    .map((o) => o.Key);

// 既定値を使わない。undefined を渡したら「行が無い世界」にする
// （`= PHOTO` の既定引数だと undefined でも PHOTO に化ける）
function world(item?: Record<string, unknown> | null) {
    const found = item === undefined ? PHOTO : item ?? undefined;
    mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: found });
        return Promise.resolve({});
    });
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset().mockResolvedValue({});
    mockRebuild.mockReset().mockResolvedValue(true);
});

describe("deleteMyPhoto", () => {
    it("実体（原本・派生を含む）と行とコメントを消す", async () => {
        world();
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(200);
        // GPS 入りの原本まで消す（消し残すと削除後も公開URLで取れる）
        expect(deletedS3()).toEqual(expect.arrayContaining([
            "uploads/me/p1.jpg", "uploads/me/p1_orig.jpg", "uploads/me/p1_thumb.webp",
        ]));
        expect(deletedIds()).toContain("comments#p1");
        expect(deletedIds()).toContain("p1");
    });

    it("S3 を先、行を後（途中で切れても原本が孤児にならない）", async () => {
        world();
        const order: string[] = [];
        mockS3Send.mockImplementation(async () => { order.push("s3"); return {}; });
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: PHOTO });
            if (cmd.constructor.name === "DeleteCommand"
                && String((cmd.input.Key as { id?: string })?.id) === "p1") order.push("row");
            return Promise.resolve({});
        });
        await invoke(ME, "p1");
        expect(order).toEqual(["s3", "row"]);
    });

    it("S3 が消せなかったら行を残して 500（押し直せば続きから消える）", async () => {
        world();
        mockS3Send.mockResolvedValue({ Errors: [{ Key: "uploads/me/p1.jpg" }] });
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(500);
        expect(deletedIds()).not.toContain("p1");
    });

    it("他人の写真は 403（何も消さない）", async () => {
        world({ ...PHOTO, userId: "someone-else" });
        const res = await invoke(ME, "p1");

        expect(res.statusCode).toBe(403);
        expect(deletedS3()).toEqual([]);
        expect(deletedIds()).toEqual([]);
    });

    // 持ち主が空の行 × sub の無いトークンで "" === "" が成立させない
    it("持ち主のいない行は 403", async () => {
        world({ id: "p1", src: "https://cdn.test/uploads/x.jpg" });
        expect((await invoke(ME, "p1")).statusCode).toBe(403);
    });

    it("sub が無ければ 401（DDB を触らない）", async () => {
        world();
        const res = await invoke("", "p1");
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // 通知 notifs# / コメント comments# / フォロー関係も同じキー空間にいる
    it("# を含む id は 404（写真以外を消させない）", async () => {
        world();
        const res = await invoke(ME, "notifs#me");
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // ストーリーは deleteStory の担当。ここで消すと期限切れ掃除と二重管理になる
    it("ストーリーは 404", async () => {
        world({ ...PHOTO, story: true });
        const res = await invoke(ME, "p1");
        expect(res.statusCode).toBe(404);
        expect(deletedS3()).toEqual([]);
    });

    it("無い写真は 404", async () => {
        world(null);
        expect((await invoke(ME, "p1")).statusCode).toBe(404);
    });

    it("公開写真を消したら静的ページの作り直しを頼む", async () => {
        world();
        await invoke(ME, "p1");
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    // 下書きには静的ページが無いので作り直す中身が無い（A-5d と同じ判定）
    it("下書きなら頼まない", async () => {
        world({ ...PHOTO, published: false });
        await invoke(ME, "p1");
        expect(mockRebuild).not.toHaveBeenCalled();
    });
});
