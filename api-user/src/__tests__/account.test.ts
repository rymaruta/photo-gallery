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
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

const mockRebuild = vi.hoisted(() => vi.fn());
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));

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
// 写真の派生画像は DeleteObjects でまとめて消す（1枚ごとに直列で消していた頃は
// 写真が数十枚あるだけで Lambda の実行時間を使い切っていた）。
// アバター/カバーは決定的キーなので単発の DeleteObject のまま。
function deletedS3Keys(): string[] {
    const keys: string[] = [];
    for (const call of mockS3Send.mock.calls) {
        const input = call[0]?.input as { Key?: unknown; Delete?: { Objects?: { Key?: unknown }[] } } | undefined;
        if (input?.Key) keys.push(String(input.Key));
        for (const o of input?.Delete?.Objects ?? []) keys.push(String(o.Key));
    }
    return keys;
}

beforeEach(() => {
    mockRebuild.mockReset().mockResolvedValue(true);
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

// 退会は取り消せない。消し残しは個人情報が公開URLに残ることを意味するので、
// 「何を消すか」をテストで固定しておく。
describe("deleteAccount: 消し残しを作らない", () => {
    function setupWithPhoto(item: Record<string, unknown>, profile?: Record<string, unknown>) {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const name = cmd.constructor.name;
            if (name === "QueryCommand") return Promise.resolve({ Items: [{ id: "p1", userId: "me" }] });
            if (name === "GetCommand") {
                const key = cmd.input.Key as { id?: string; userId?: string };
                if (key.id === "p1") return Promise.resolve({ Item: item });
                if (key.userId === "me") return Promise.resolve({ Item: profile ?? {} });
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    }

    it("EXIF付きの原本と派生画像もすべて消す", async () => {
        // srcOriginal は EXIF を落とす前の原本。GPS が入ったままなので
        // 消し残すと退会後も公開URLで取得できてしまう。
        setupWithPhoto({
            id: "p1",
            userId: "me",
            src: "https://cdn.test/uploads/p1.jpg",
            srcOriginal: "https://cdn.test/uploads/p1_orig.jpg",
            srcAvif: "https://cdn.test/uploads/p1.avif",
            src256: "https://cdn.test/uploads/p1_256.webp",
            thumbSrc: "https://cdn.test/uploads/p1_thumb.webp",
            thumbSm: "https://cdn.test/uploads/p1_sm.webp",
            thumbAvif: "https://cdn.test/uploads/p1_thumb.avif",
            thumbSmAvif: "https://cdn.test/uploads/p1_sm.avif",
        });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        const keys = deletedS3Keys();
        for (const k of [
            "uploads/p1.jpg", "uploads/p1_orig.jpg", "uploads/p1.avif", "uploads/p1_256.webp",
            "uploads/p1_thumb.webp", "uploads/p1_sm.webp", "uploads/p1_thumb.avif", "uploads/p1_sm.avif",
        ]) {
            expect(keys).toContain(k);
        }
    });

    it("ユーザー名の予約も解放する（再登録で同じ名前を取り戻せるように）", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me", username: "ryuhei" });
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(deletedDdbIds()).toContain("username#ryuhei");
    });

    it("ユーザー名が未設定なら予約の削除は行わない", async () => {
        setupWithPhoto({ id: "p1", userId: "me", src: "https://cdn.test/uploads/p1.jpg" }, { userId: "me" });
        await invoke(deleteAccount, ev("me"));
        expect(deletedDdbIds().some((id) => id.startsWith("username#"))).toBe(false);
    });
});

// 退会しても静的ページ（/photo/<id>・/users/<id>）は S3 に残り続ける。
// 本文も撮影地も表示名入りの JSON-LD も焼き込まれているので、
// 「消したのに検索から見える」状態になる。定期ビルドは止めてあるため、
// ここで頼まないと誰かが push するまで直らない。
describe("deleteAccount: 静的ページの掃除", () => {
    it("成功したらサイトの再ビルドを頼む", async () => {
        mockDdbSend.mockResolvedValue({});
        const res = await invoke(deleteAccount, ev("me"));
        expect(res.statusCode).toBe(200);
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(String(mockRebuild.mock.calls[0][0])).toContain("me");
    });
});
