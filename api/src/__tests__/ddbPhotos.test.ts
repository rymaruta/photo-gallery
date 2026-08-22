import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { updatePhotoFields, putPhoto } = await import("../ddb-photos");

type Input = { UpdateExpression: string; ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
const lastInput = (): Input => (mockSend.mock.calls[0][0] as { input: Input }).input;

beforeEach(() => mockSend.mockReset().mockResolvedValue({ Attributes: { id: "p1" } }));

// 「その項目を空にする」指定（undefined）は SET に混ぜられない。
//
// DocumentClient は removeUndefinedValues: true なので、
// ExpressionAttributeValues から :location ごと落ちる。式に
// `SET #location = :location` が残ると DynamoDB は ValidationException を
// 返し、ハンドラは 500 になる——つまり /admin/edit で撮影地や説明を
// 空にして保存すると必ず「更新に失敗しました」になっていた。
// ユーザーAPI側（api-user/src/photoUpdate.ts）は REMOVE を組み立てている。
describe("updatePhotoFields: 空にする指定", () => {
    it("undefined は REMOVE にする（値の欄に残さない）", async () => {
        await updatePhotoFields("p1", { location: undefined, title: { ja: "海" }, updatedAt: "t" });
        const input = lastInput();
        expect(input.UpdateExpression).toContain("REMOVE #location");
        expect(input.UpdateExpression).toContain("#title = :title");
        expect(input.ExpressionAttributeValues).not.toHaveProperty(":location");
        expect(input.ExpressionAttributeValues).toHaveProperty(":title");
    });

    it("全部が空指定でも壊れない（SET だけの空の式を作らない）", async () => {
        await updatePhotoFields("p1", { location: undefined, category: undefined });
        expect(lastInput().UpdateExpression).toBe("REMOVE #location, #category");
    });

    // 条件が無いと UpdateItem は行を**作る**。写真ID以外（notifs#… /
    // comments#… など同じテーブルの内部文書）を指定して行を生やせる。
    it("存在しない ID で行を作らない条件を必ず付ける", async () => {
        await updatePhotoFields("p1", { location: "北海道" });
        expect(lastInput().ConditionExpression).toBe("attribute_exists(id)");
    });

    it("値だけなら従来どおり SET のみ", async () => {
        await updatePhotoFields("p1", { location: "北海道", updatedAt: "t" });
        const input = lastInput();
        expect(input.UpdateExpression).toBe("SET #location = :location, #updatedAt = :updatedAt");
        expect(input.ExpressionAttributeValues).toEqual({ ":location": "北海道", ":updatedAt": "t" });
    });
});

// 新規作成専用。条件が無いと、同じIDの既存レコードを丸ごと置き換える。
// このテーブルには通知（notifs#…）やコメント（comments#…）も同居しているので、
// ID を指定できるだけで他人の通知を全部消せてしまう（元に戻せない）。
describe("putPhoto: 既存の行を置き換えない", () => {
    it("attribute_not_exists(id) を必ず付ける", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await putPhoto({ id: "p1", src: "https://cdn/p1.jpg" } as any);
        const input = mockSend.mock.calls[0][0].input as { ConditionExpression?: string; Item?: unknown };
        expect(input.ConditionExpression).toBe("attribute_not_exists(id)");
        expect(input.Item).toEqual({ id: "p1", src: "https://cdn/p1.jpg" });
    });
});

// 削除経路（photosMutate.deletePhoto）は getPhotoById の戻り値から
// srcOriginal（GPS入り原本）のキーを読んで S3 の実体を消す。
// データ層がここを「公開向けに」落とすと、**原本が二度と消せなくなる**。
// 公開APIで落とすのはハンドラ側（photos.ts）だけ——データ層側から固定する。
describe("getPhotoById: srcOriginal を落とさない", () => {
    it("保存されている項目をそのまま返す", async () => {
        mockSend.mockResolvedValueOnce({ Item: {
            id: "p1", src: "https://cdn/p1.jpg",
            srcOriginal: "https://cdn/uploads/originals/p1.jpg", key: "uploads/u1/p1.jpg",
        } });
        const { getPhotoById } = await import("../ddb-photos");
        const p = await getPhotoById("p1");
        expect(p).toHaveProperty("srcOriginal", "https://cdn/uploads/originals/p1.jpg");
        expect(p).toHaveProperty("key", "uploads/u1/p1.jpg");
    });
});
