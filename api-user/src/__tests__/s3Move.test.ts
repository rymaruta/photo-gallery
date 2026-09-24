import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", async (orig) => {
    const actual = await orig<typeof import("@aws-sdk/client-s3")>();
    return { ...actual, S3Client: class { send = mockSend } };
});
vi.mock("../s3Delete", () => ({ s3DeleteMany: mockDeleteMany }));
vi.stubEnv("UPLOAD_BUCKET", "prod-journey-photo-upload");

const { copyAll, dropOld } = await import("../s3Move");

beforeEach(() => {
    mockSend.mockReset().mockResolvedValue({});
    mockDeleteMany.mockReset().mockResolvedValue(0);
});

const moves = [
    { from: "uploads/u1/a.jpg", to: "private/u1/a.jpg" },
    { from: "uploads/u1/a-t.jpg", to: "private/u1/a-t.jpg" },
];

describe("実体を移す", () => {
    it("全部コピーできたら true", async () => {
        expect(await copyAll(moves)).toBe(true);
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    // 🔴 **半分だけ移すと、行が指す先と実体がちぐはぐになる**
    it("1つでも失敗したら false（呼び出し側が何も進めないように）", async () => {
        mockSend.mockReset()
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error("AccessDenied"));
        expect(await copyAll(moves)).toBe(false);
    });

    it("`CopySource` はバケット名込みで、URL エンコードする", async () => {
        await copyAll([{ from: "uploads/u1/日本 の 写真.jpg", to: "private/u1/日本 の 写真.jpg" }]);
        const input = (mockSend.mock.calls[0][0] as { input: Record<string, string> }).input;
        expect(input.CopySource.startsWith("prod-journey-photo-upload/")).toBe(true);
        expect(input.CopySource).not.toContain(" ");
        expect(input.Key).toBe("private/u1/日本 の 写真.jpg");
    });

    // **エッジの無効化まで面倒を見る。** 消しただけでは古い URL が
    // 1年（max-age=31536000）取れ続ける＝「絞ったのに取り続けられる」
    it("元を消すのは `s3DeleteMany` を通す（エッジも掃除される）", async () => {
        await dropOld(moves);
        expect(mockDeleteMany).toHaveBeenCalledWith(
            ["uploads/u1/a.jpg", "uploads/u1/a-t.jpg"], "s3Move");
    });

    it("消せなかった数をそのまま返す", async () => {
        mockDeleteMany.mockResolvedValue(2);
        expect(await dropOld(moves)).toBe(2);
    });

    // **コピーと削除は別の関数。** 1つにまとめると、あいだに行の
    // 書き換えを挟めない＝途中で落ちたときに行が空の実体を指す
    it("コピーだけでは、何も消さない", async () => {
        await copyAll(moves);
        expect(mockDeleteMany).not.toHaveBeenCalled();
    });
});
