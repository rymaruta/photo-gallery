import { describe, it, expect, vi, beforeEach } from "vitest";

// **管理APIの非公開化だけ、掃除の依頼が届かなくても印を残していなかった。**
//
// 依頼は `coalesce: true` なので、直近10分に誰かが依頼していれば見送られ、
// **見送られた分は後から実行されない**。そのまま削除すると、削除側は
// 「非公開だった写真には静的ページが無い」と決め打ちして掃除を省く経路が
// あるので、`/photo/<id>` の静的HTML（本文・撮影地・EXIF・表示名入りの
// JSON-LD）が誰にも消されないまま残る。
//
// api-user 側（`photoUpdate.ts`）には印を入れたのに、**ここだけ抜けていた**
// ——presign が3か所あって1か所塞ぎ残したのと同じ形。

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend } }));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
vi.mock("../auth", () => ({
    isAdmin: () => true,
    getCallerUserId: () => "admin-sub",
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { updatePhoto } = await import("../photosMutate");

type Result = { statusCode: number; body: string };
const invoke = (body: unknown): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updatePhoto as any)({
        requestContext: { authorizer: { jwt: { claims: { sub: "admin-sub", "cognito:groups": "admin" } } } },
        pathParameters: { id: "p1" },
        body: JSON.stringify(body),
    });

const PHOTO = { id: "p1", src: "https://cdn/p1.jpg", published: true, title: "海" };

/** 送られた UpdateCommand の式を順に集める */
const updateExprs = (): string[] => mockDdbSend.mock.calls
    .map((c) => c[0] as { constructor: { name: string }; input?: { UpdateExpression?: string } })
    .filter((cmd) => cmd?.constructor?.name === "UpdateCommand")
    .map((cmd) => String(cmd.input?.UpdateExpression ?? ""));

beforeEach(() => {
    mockRebuild.mockReset().mockResolvedValue(true);
    mockDdbSend.mockReset().mockImplementation((cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: PHOTO });
        return Promise.resolve({ Attributes: { ...PHOTO, published: false } });
    });
});

describe("管理APIで非公開にしたとき", () => {
    it("掃除の依頼が届かなければ印を残す", async () => {
        mockRebuild.mockResolvedValue(false);   // 畳まれた・予算切れ・dispatch 失敗

        const res = await invoke({ published: false });
        expect(res.statusCode).toBe(200);   // 非公開そのものは成立している
        expect(updateExprs().some((e) => e.includes("staticStale")),
            "届いていないのに印を残していない").toBe(true);
    });

    it("届いたときは印を残さない（余計な書き込みをしない）", async () => {
        mockRebuild.mockResolvedValue(true);

        await invoke({ published: false });
        expect(updateExprs().some((e) => e.includes("staticStale"))).toBe(false);
    });

    // 公開する側は privacy の失敗にならないので、印は要らない
    it("公開する側では印を残さない", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { ...PHOTO, published: false } });
            return Promise.resolve({ Attributes: { ...PHOTO, published: true } });
        });
        mockRebuild.mockResolvedValue(false);

        await invoke({ published: true });
        expect(updateExprs().some((e) => e.includes("staticStale"))).toBe(false);
    });

    it("何も変わらない保存では依頼も印も無い", async () => {
        await invoke({ published: true });   // 元から公開
        expect(mockRebuild).not.toHaveBeenCalled();
        expect(updateExprs().some((e) => e.includes("staticStale"))).toBe(false);
    });
});
