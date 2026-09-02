import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **消したのにエッジに残っていた（LEFT-4）。**
//
// アップロードは `max-age=31536000`（1年）で配っている。S3 から消しても
// エッジのぶんは URL を知っていれば取れ続ける——削除・退会・期限切れ
// ストーリーのどれも「消したつもりで消えていない」時間があった。
// 本番の配信設定を CI から読んで確認: マネージドの CachingOptimized
// （既定1日・最大1年）。GPS 入りの原本も同じ扱い。

const send = vi.hoisted(() => vi.fn());
// **工場を名前で持つ。** 下の「モジュールが読めない」テストが
// `vi.doUnmock` するので、そのままだと**以降のテストが本物の SDK を掴む**
// （実際に踏んだ——後から足したテストが「資格情報が無い」で落ちた）。
// 外したら同じ工場で戻す。
const cloudfrontMock = vi.hoisted(() => () => ({
    CloudFrontClient: class { send = send; },
    CreateInvalidationCommand: class { constructor(public input: unknown) { } },
}));
vi.mock("@aws-sdk/client-cloudfront", cloudfrontMock);

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
        // **戻す。** 外したままだと以降のテストが本物の SDK を掴む
        vi.doMock("@aws-sdk/client-cloudfront", cloudfrontMock);
    });
    // **同じ上限を片方だけ守っていた。** `scripts/deploy-static-site.js` は
    // `MAX_PATHS_PER_REQUEST = 3000` で分割しているのに、こちらは全部を1回に
    // 入れていた。CloudFront は1リクエスト3,000パスまでで、超えると断る
    // ——この関数は投げずに警告だけ出すので、**消えたように見えたまま
    // エッジの掃除だけが静かに落ちる**。
    //
    // 届くのは期限切れストーリーの掃除（1時間ごと・溜まった回ほど件数が増える。
    // しかも「1行ごとに1本」をやめて1本にまとめたぶん、1本が大きくなった）。
    it("3,000 を超えたら分けて送る", async () => {
        const invalidate = await load("E123");
        const keys = Array.from({ length: 7001 }, (_, i) => `uploads/u1/p${i}.jpg`);
        expect(await invalidate(keys)).toBe(true);

        expect(send, "1回に押し込んでいる").toHaveBeenCalledTimes(3);
        const batches = send.mock.calls.map((c) =>
            (c[0] as { input: { InvalidationBatch: { Paths: { Items: string[]; Quantity: number } } } })
                .input.InvalidationBatch.Paths);
        expect(batches.map((b) => b.Items.length)).toEqual([3000, 3000, 1001]);
        // Quantity は Items と必ず一致（ずれると CloudFront が断る）
        for (const b of batches) expect(b.Quantity).toBe(b.Items.length);
        // 取りこぼしも重複も無い
        const all = batches.flatMap((b) => b.Items);
        expect(new Set(all).size).toBe(7001);
        expect(all).toContain("/uploads/u1/p7000.jpg");
    });

    // 分割の境目でも CallerReference がぶつからない
    // （同じ値で違うバッチを送ると CloudFront が InvalidationBatchAlreadyExists で断る）
    it("分けたリクエストの CallerReference が重ならない", async () => {
        const invalidate = await load("E123");
        await invalidate(Array.from({ length: 6000 }, (_, i) => `uploads/u1/p${i}.jpg`));
        const refs = send.mock.calls.map((c) =>
            (c[0] as { input: { InvalidationBatch: { CallerReference: string } } })
                .input.InvalidationBatch.CallerReference);
        expect(refs).toHaveLength(2);
        expect(new Set(refs).size, "同じ CallerReference で違うバッチを送っている").toBe(2);
    });

    it("ちょうど 3,000 なら1回のまま", async () => {
        const invalidate = await load("E123");
        await invalidate(Array.from({ length: 3000 }, (_, i) => `uploads/u1/p${i}.jpg`));
        expect(send).toHaveBeenCalledTimes(1);
    });
});
