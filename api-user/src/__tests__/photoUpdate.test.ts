import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

import { updatePhotoVisibility } from "../photoUpdate";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (updatePhotoVisibility as any)(event);

function event(sub: string, id: string | undefined, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

beforeEach(() => mockDdbSend.mockReset());

describe("updatePhotoVisibility", () => {
    it("id なしは 400", async () => {
        const res = await invoke(event("u1", undefined, { published: true }));
        expect(res.statusCode).toBe(400);
    });

    it("不正な JSON は 400", async () => {
        const res = await invoke(event("u1", "p1", "{broken"));
        expect(res.statusCode).toBe(400);
    });

    it("published が boolean でなければ 400", async () => {
        const res = await invoke(event("u1", "p1", { published: "yes" }));
        expect(res.statusCode).toBe(400);
    });

    it("写真が存在しなければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(404);
    });

    it("所有者以外は 403（他人の写真は非公開化できない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner" } });
        const res = await invoke(event("attacker", "p1", { published: false }));
        expect(res.statusCode).toBe(403);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Update は実行されない
    });

    it("userId が無い写真は uploadedBy で所有権を判定する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", uploadedBy: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);
    });

    it("所有者は published を更新できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression).toContain("published");
        expect(update.ExpressionAttributeValues[":p"]).toBe(false);
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(500);
    });
});
