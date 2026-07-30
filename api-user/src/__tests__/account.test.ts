import { describe, it, expect, vi, beforeEach } from "vitest";

// DynamoDB / S3 をモック
const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
vi.stubEnv("USERS_TABLE", "users-test");
const { deleteAccount } = await import("../account");

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (handler: unknown, event: unknown): Promise<LambdaResult> => (handler as any)(event);

function ev(sub: string | undefined) {
    return { requestContext: { authorizer: { jwt: { claims: { sub } } } } };
}

// 送信された DeleteCommand / UpdateCommand の Key.id を集める
function deletedDdbIds(): string[] {
    return mockDdbSend.mock.calls
        .map((c) => c[0])
        .filter((cmd) => cmd?.constructor?.name === "DeleteCommand")
        .map((cmd) => String(cmd.input?.Key?.id ?? cmd.input?.Key?.userId ?? ""));
}
function deletedS3Keys(): string[] {
    return mockS3Send.mock.calls.map((c) => String(c[0]?.input?.Key ?? ""));
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset().mockResolvedValue({});
});

describe("deleteAccount", () => {
    it("認証なし（sub 欠落）は 401 で何も削除しない", async () => {
        const res = await invoke(deleteAccount, ev(undefined));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("写真の S3 本体/サムネと item、プロフィール、既知ドキュメントを削除する", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") {
                // GSI: 写真1枚（1ページで終了）
                return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            }
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1") {
                    return Promise.resolve({
                        Item: {
                            id: "p1",
                            userId: "me",
                            src: "https://cdn.test/uploads/p1.jpg",
                            thumbSrc: "https://cdn.test/uploads/p1_thumb.jpg",
                        },
                    });
                }
                // golist / following は空
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });

        // 写真本体とサムネの両方を S3 から削除
        const s3 = deletedS3Keys();
        expect(s3).toContain("uploads/p1.jpg");
        expect(s3).toContain("uploads/p1_thumb.jpg");
        // アバター/カバーも決定的キーで削除
        expect(s3).toContain("profiles/me");
        expect(s3).toContain("profiles/me/cover");

        // 写真 item・プロフィール・既知ドキュメントを削除
        const ids = deletedDdbIds();
        expect(ids).toContain("p1");
        expect(ids).toContain("me"); // USERS_TABLE の {userId: "me"}
        expect(ids).toContain("golist#me");
        expect(ids).toContain("notifs#me");
        expect(ids).toContain("followstats#me");
        expect(ids).toContain("following#me");
    });

    it("golist の go# マーカー削除と対象写真 goCount 減算、following の follow# 削除と followers 減算", async () => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "golist#me") return Promise.resolve({ Item: { list: [{ photoId: "ph1" }, { photoId: "ph2" }] } });
                if (id === "following#me") return Promise.resolve({ Item: { list: ["userA", "userB"] } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);

        const ids = deletedDdbIds();
        // go マーカー
        expect(ids).toContain("go#ph1#me");
        expect(ids).toContain("go#ph2#me");
        // follow マーカー
        expect(ids).toContain("follow#userA#me");
        expect(ids).toContain("follow#userB#me");

        // goCount / followers の減算 Update が対象キーに対して送られている
        const updates = mockDdbSend.mock.calls
            .map((c) => c[0])
            .filter((cmd) => cmd?.constructor?.name === "UpdateCommand")
            .map((cmd) => String(cmd.input?.Key?.id ?? ""));
        expect(updates).toContain("ph1");
        expect(updates).toContain("ph2");
        expect(updates).toContain("followstats#userA");
        expect(updates).toContain("followstats#userB");
    });

    it("個別削除が1件失敗しても続行し 200 を返す（耐障害）", async () => {
        mockS3Send.mockRejectedValue(new Error("s3 down")); // すべての S3 削除が失敗
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1") return Promise.resolve({ Item: { id: "p1", src: "https://cdn.test/uploads/p1.jpg" } });
                return Promise.resolve({ Item: undefined });
            }
            if (name === "DeleteCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "notifs#me") return Promise.reject(new Error("ddb delete failed")); // 一部失敗
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
        // 失敗の後の削除も実行される
        expect(deletedDdbIds()).toContain("following#me");
    });

    it("GSI が複数ページでも全ページを辿って削除する", async () => {
        let queried = 0;
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") {
                queried++;
                if (queried === 1) return Promise.resolve({ Items: [{ id: "p1" }], LastEvaluatedKey: { userId: "me" } });
                return Promise.resolve({ Items: [{ id: "p2" }] });
            }
            if (name === "GetCommand") {
                const id = String((cmd.input.Key as { id?: string }).id ?? "");
                if (id === "p1" || id === "p2") return Promise.resolve({ Item: { id } });
                return Promise.resolve({ Item: undefined });
            }
            return Promise.resolve({});
        });

        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(queried).toBe(2);
        const ids = deletedDdbIds();
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
    });
});
