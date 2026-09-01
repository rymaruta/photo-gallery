import { describe, it, expect, vi, beforeEach } from "vitest";

// **退会処理から共有の場所へ出した部品。**
//
// 1件ずつ直列に消していた頃は、写真が数十枚あるだけで Lambda の実行時間を
// 使い切っていた。ストーリーの掃除も同じ形が要る——1行あたり最大8キーを
// 直列に消しており、しかも「消せなければ行を残す」に変えたので、消せない行が
// 溜まると毎回先頭に来て（`queryStories` は昇順）実行時間を食い切り、
// 後ろにいる新しい期限切れストーリーに永久に到達しなくなる。
//
// 移したときに**1000件で切る分岐にテストが1本も無い**ことが分かったので、
// ここで固定する（変異させても全件緑だった）。

const mockS3Send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

const mockInvalidate = vi.hoisted(() => vi.fn());
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: mockInvalidate }));

vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { s3DeleteMany } = await import("../s3Delete");

/** 送ったリクエストごとのキー一覧 */
const sentChunks = (): string[][] =>
    mockS3Send.mock.calls.map((c) =>
        (c[0] as { input: { Delete: { Objects: Array<{ Key: string }> } } }).input.Delete.Objects.map((o) => o.Key));

beforeEach(() => { mockS3Send.mockReset().mockResolvedValue({}); mockInvalidate.mockReset().mockResolvedValue(true); });

describe("s3DeleteMany", () => {
    // 空のときの保証はループそのもの（早期 return は置いていない）
    it("何も渡さなければ1本も投げない", async () => {
        expect(await s3DeleteMany([])).toBe(0);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("1000件までは1リクエストにまとめる", async () => {
        const keys = Array.from({ length: 1000 }, (_, i) => `uploads/k${i}.jpg`);
        expect(await s3DeleteMany(keys)).toBe(0);
        expect(sentChunks()).toHaveLength(1);
        expect(sentChunks()[0]).toHaveLength(1000);
    });

    // **ここが無テストだった。** S3 の DeleteObjects は1回1000件までで、
    // 超えると API 側が断る。切らないと退会（写真100枚＋派生）で溢れうる
    it("1000件を超えたら分けて投げる", async () => {
        const keys = Array.from({ length: 1001 }, (_, i) => `uploads/k${i}.jpg`);
        expect(await s3DeleteMany(keys)).toBe(0);
        const chunks = sentChunks();
        expect(chunks, "1000件で切っていない").toHaveLength(2);
        expect(chunks[0]).toHaveLength(1000);
        expect(chunks[1]).toEqual(["uploads/k1000.jpg"]);
    });

    it("Errors に載った分を失敗として数える（投げないので見落としやすい）", async () => {
        mockS3Send.mockResolvedValue({ Errors: [{ Key: "uploads/a.jpg" }, { Key: "uploads/b.jpg" }] });
        expect(await s3DeleteMany(["uploads/a.jpg", "uploads/b.jpg", "uploads/c.jpg"])).toBe(2);
    });

    it("リクエストごと落ちたら、その塊を全部失敗として数える", async () => {
        mockS3Send.mockRejectedValue(new Error("s3 down"));
        expect(await s3DeleteMany(["uploads/a.jpg", "uploads/b.jpg"])).toBe(2);
    });

    it("塊ごとに数え上げる（片方だけ落ちても、もう片方は消える）", async () => {
        const keys = Array.from({ length: 1002 }, (_, i) => `uploads/k${i}.jpg`);
        mockS3Send
            .mockRejectedValueOnce(new Error("s3 down"))
            .mockResolvedValueOnce({});
        expect(await s3DeleteMany(keys)).toBe(1000);
        // **1本目が落ちても2本目は投げる**（塊ごとに独立して数える）
        expect(sentChunks()).toHaveLength(2);
        expect(sentChunks()[1]).toEqual(["uploads/k1000.jpg", "uploads/k1001.jpg"]);
    });
});

// **消した実体はエッジからも消す（LEFT-4）。**
// アップロードは max-age=31536000（1年）で配っているので、S3 から消すだけ
// では URL を知っていれば取れ続ける（GPS 入りの原本も同じ）。
describe("エッジの掃除へ渡すもの", () => {
    it("消せたキーを渡す", async () => {
        await s3DeleteMany(["uploads/a.jpg", "uploads/b.jpg"]);
        expect(mockInvalidate).toHaveBeenCalledTimes(1);
        expect(mockInvalidate.mock.calls[0][0]).toEqual(["uploads/a.jpg", "uploads/b.jpg"]);
    });

    // **消えていないものまで無効化しない。** キャッシュを捨てて取り直させる
    // だけで、消えていない実体は消えない（課金対象のパスも無駄に増える）
    it("消せなかったキーは渡さない", async () => {
        mockS3Send.mockResolvedValue({ Errors: [{ Key: "uploads/b.jpg" }] });
        await s3DeleteMany(["uploads/a.jpg", "uploads/b.jpg"]);
        expect(mockInvalidate.mock.calls[0][0]).toEqual(["uploads/a.jpg"]);
    });

    it("S3 の呼び出しごと失敗したら、何も渡さない", async () => {
        mockS3Send.mockRejectedValue(new Error("boom"));
        await s3DeleteMany(["uploads/a.jpg"]);
        expect(mockInvalidate.mock.calls[0][0]).toEqual([]);
    });
});
