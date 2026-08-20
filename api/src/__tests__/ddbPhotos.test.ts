import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: mockSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

const { updatePhotoFields } = await import("../ddb-photos");

type Input = { UpdateExpression: string; ExpressionAttributeValues?: Record<string, unknown> };
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

    it("値だけなら従来どおり SET のみ", async () => {
        await updatePhotoFields("p1", { location: "北海道", updatedAt: "t" });
        const input = lastInput();
        expect(input.UpdateExpression).toBe("SET #location = :location, #updatedAt = :updatedAt");
        expect(input.ExpressionAttributeValues).toEqual({ ":location": "北海道", ":updatedAt": "t" });
    });
});
