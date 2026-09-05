import { describe, it, expect, vi, beforeEach } from "vitest";

// 写しの側が**実際に動く**ことを見る（コードの一致は
// `scripts/__tests__/cdnInvalidateParity.test.ts` が縛る）。
// このテストは `api/src/` に置く——`api/node_modules` があるかどうかで
// `@aws-sdk/client-cloudfront` の解決先が変わるので、モジュールと同じ
// 場所から `vi.mock` しないと当たらない（ルートから両方を import する
// 形は、実際にそれで落ちた）。

const sent = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class {
        send = async (cmd: { input: Record<string, unknown> }) => { sent.calls.push(cmd.input); return {}; };
    },
    CreateInvalidationCommand: class {
        input: Record<string, unknown>;
        constructor(i: Record<string, unknown>) { this.input = i; }
    },
}));

vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", "DIST123");
const { invalidateUploads } = await import("../cdnInvalidate");

const paths = () => sent.calls.map((c) => (c.InvalidationBatch as { Paths: { Items: string[] } }).Paths.Items);

beforeEach(() => { sent.calls = []; });

describe("エッジの掃除（api 側の写し）", () => {
    it("先頭に / を1つだけ付け、重複を畳んで送る", async () => {
        await expect(invalidateUploads(["/uploads/a.jpg", "uploads/a.jpg", "uploads/b.jpg"])).resolves.toBe(true);
        expect(paths()).toEqual([["/uploads/a.jpg", "/uploads/b.jpg"]]);
        expect(sent.calls[0].DistributionId).toBe("DIST123");
    });

    it("3000を超えたら分けて送る（CloudFront の上限）", async () => {
        await invalidateUploads(Array.from({ length: 3001 }, (_, i) => `uploads/x${i}.jpg`));
        expect(paths().map((p) => p.length)).toEqual([3000, 1]);
    });

    it("空なら何も送らない", async () => {
        await expect(invalidateUploads([])).resolves.toBe(true);
        expect(sent.calls).toHaveLength(0);
    });
});
