import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **消したのにエッジに残っていた（LEFT-4）。**
//
// アップロードは `max-age=31536000`（1年）で配っている。S3 から消しても
// エッジのぶんは URL を知っていれば取れ続ける——削除・退会・期限切れ
// ストーリーのどれも「消したつもりで消えていない」時間があった。
// 本番の配信設定を CI から読んで確認: マネージドの CachingOptimized
// （既定1日・最大1年）。GPS 入りの原本も同じ扱い。

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-cloudfront", () => ({
    CloudFrontClient: class { send = send; },
    CreateInvalidationCommand: class { constructor(public input: unknown) { } },
}));

beforeEach(() => { send.mockReset().mockResolvedValue({}); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); });

async function load(distId?: string) {
    if (distId === undefined) vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", "");
    else vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", distId);
    vi.resetModules();
    return (await import("../cdnInvalidate")).invalidateUploads;
}

describe("エッジからも消す", () => {
    it("消したキーを無効化する（先頭に / を付ける）", async () => {
        const invalidate = await load("E123");
        expect(await invalidate(["uploads/u1/a.jpg", "uploads/u1/a_thumb.webp"])).toBe(true);

        const input = (send.mock.calls[0][0] as { input: { DistributionId: string; InvalidationBatch: { Paths: { Items: string[]; Quantity: number } } } }).input;
        expect(input.DistributionId).toBe("E123");
        expect(input.InvalidationBatch.Paths.Items).toEqual(["/uploads/u1/a.jpg", "/uploads/u1/a_thumb.webp"]);
        expect(input.InvalidationBatch.Paths.Quantity).toBe(2);
    });

    // 無効化は**パス単位で課金**される。同じパスを2回数えない
    it("同じパスは畳む", async () => {
        const invalidate = await load("E123");
        await invalidate(["uploads/a.jpg", "/uploads/a.jpg", "uploads/a.jpg"]);
        const input = (send.mock.calls[0][0] as { input: { InvalidationBatch: { Paths: { Items: string[] } } } }).input;
        expect(input.InvalidationBatch.Paths.Items).toEqual(["/uploads/a.jpg"]);
    });

    // **削除そのものを止めない。** ここで投げると「S3 からは消えたのに
    // API はエラー」になり、利用者は消えていないと思ってもう一度押す
    it("失敗しても投げない", async () => {
        const invalidate = await load("E123");
        send.mockRejectedValue(new Error("AccessDenied"));
        expect(await invalidate(["uploads/a.jpg"])).toBe(false);
    });

    it("配信IDが未設定なら何もしない（削除は成功のまま）", async () => {
        const invalidate = await load();
        expect(await invalidate(["uploads/a.jpg"])).toBe(false);
        expect(send, "配信IDが無いのに呼びに行っている").not.toHaveBeenCalled();
    });

    it("キーが無ければ呼ばない", async () => {
        const invalidate = await load("E123");
        expect(await invalidate([])).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });
    // **ランタイムに `@aws-sdk/client-cloudfront` が無かった場合。**
    //
    // serverless の esbuild は `@aws-sdk/*` をバンドルから外すので、
    // この import が解決できるかは Lambda ランタイムが何を積んでいるか次第。
    // 以前はトップレベルの import だったので、無ければ**モジュール読み込みの
    // 時点で落ち**、この関数を import しているだけの deleteMyPhoto /
    // deleteAccount / cleanupStories が丸ごと失敗する形になっていた
    // （「失敗しても削除は成功として扱う」を、読み込みの段で破っていた）。
    it("モジュールが読めなくても投げない・呼び出し側は先へ進める", async () => {
        vi.resetModules();
        vi.doMock("@aws-sdk/client-cloudfront", () => {
            throw new Error("Cannot find module '@aws-sdk/client-cloudfront'");
        });
        vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", "E123");
        const { invalidateUploads } = await import("../cdnInvalidate");
        // 投げないこと自体が要件。戻り値は「掃除できなかった」
        await expect(invalidateUploads(["uploads/a.jpg"])).resolves.toBe(false);
        vi.doUnmock("@aws-sdk/client-cloudfront");
    });
});
