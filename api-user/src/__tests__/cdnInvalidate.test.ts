import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// **消したのにエッジに残っていた（LEFT-4）。**
//
// アップロードは `max-age=31536000`（1年）で配っている。S3 から消しても
// エッジのぶんは URL を知っていれば取れ続ける——削除・退会・期限切れ
// ストーリーのどれも「消したつもりで消えていない」時間があった。
// 本番の配信設定を CI から読んで確認: マネージドの CachingOptimized
// （既定1日・最大1年）。GPS 入りの原本も同じ扱い。

const send = vi.hoisted(() => vi.fn());
// **工場は1つだけ。旗で投げさせる。**
//
// 以前は「モジュールが読めない」テストだけ `vi.doMock` で投げる工場に
// 差し替え、`afterEach` で元の工場に戻していた。**その形はフレークした**
// ——フルスイート2回に1回、`resolves.toBe(false)` が `true` になる
// （＝差し替えたはずの投げる工場ではなく、元の工場を掴んでいる）。
// 単体では6回とも緑で、機序は特定できていない。
//
// 登録を1つにすれば、差し替えの順序そのものが無くなる。旗は
// `vi.hoisted` で工場と同じ巻き上げに乗せる。
const failImport = vi.hoisted(() => ({ on: false }));
vi.mock("@aws-sdk/client-cloudfront", () => ({
    // **旗は工場の中ではなく、読み出しの側に置く。**
    // `vi.mock` の工場は**一度しか走らない**（`vi.resetModules()` でも
    // 呼び直されない。実測: 工場の中で投げる形にしたら、旗を立てても
    // 何も起きなかった）。名前を読むたびに評価される getter なら効く。
    //
    // 本物の失敗は `await import(...)` そのものが reject する形だが、
    // **投げる場所は同じ try の中**なので、この関数が通る経路
    // （catch → 警告 → false）は変わらない。
    get CloudFrontClient() {
        if (failImport.on) throw new Error("Cannot find module '@aws-sdk/client-cloudfront'");
        return class { send = send; };
    },
    CreateInvalidationCommand: class { constructor(public input: unknown) { } },
}));

beforeEach(() => { failImport.on = false; send.mockReset().mockResolvedValue({}); vi.resetModules(); });
afterEach(() => { failImport.on = false; vi.unstubAllEnvs(); });

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
        failImport.on = true;
        vi.resetModules();
        vi.stubEnv("CLOUDFRONT_DISTRIBUTION_ID", "E123");
        const { invalidateUploads } = await import("../cdnInvalidate");
        // 投げないこと自体が要件。戻り値は「掃除できなかった」
        await expect(invalidateUploads(["uploads/a.jpg"])).resolves.toBe(false);
    });

    // **旗が効いていることを、この形でも確かめる。** 旗を立てても工場が
    // 投げなければ、上のテストは「読めているのに false」を見ているだけで
    // 何も守らない（同じ形の穴を作らないため）
    it("旗を立てると、SDK を読み出した時点で投げる", async () => {
        failImport.on = true;
        vi.resetModules();
        const mod = await import("@aws-sdk/client-cloudfront");
        expect(() => mod.CloudFrontClient, "旗が効いていない（上のテストが何も守らない）")
            .toThrow(/Cannot find module/);
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
    // **1本落ちても残りは投げる。** `await` を並べただけだと、最初に断られた
    // チャンクで残り全部が捨てられる。分割した意味は「全部を届ける」ことなので、
    // 途中で降りると**分割していない頃より悪い**（前半だけ消えて後半が残る、
    // という追いにくい状態になる）。
    it("途中のチャンクが落ちても、残りは投げる", async () => {
        const invalidate = await load("E123");
        send.mockReset()
            .mockResolvedValueOnce({})                        // 1本目: 成功
            .mockRejectedValueOnce(new Error("Throttling"))   // 2本目: 失敗
            .mockResolvedValueOnce({});                       // 3本目: 成功
        const keys = Array.from({ length: 7001 }, (_, i) => `uploads/u1/p${i}.jpg`);

        // 全部は届かなかったので false（呼び出し側は削除を成功として扱う）
        expect(await invalidate(keys)).toBe(false);
        expect(send, "落ちた時点で降りている").toHaveBeenCalledTimes(3);

        // 3本目のパスがちゃんと投げられている（＝後半を捨てていない）
        const last = (send.mock.calls[2][0] as {
            input: { InvalidationBatch: { Paths: { Items: string[] } } };
        }).input.InvalidationBatch.Paths.Items;
        expect(last).toContain("/uploads/u1/p7000.jpg");
    });

    it("全部通れば true", async () => {
        const invalidate = await load("E123");
        send.mockReset().mockResolvedValue({});
        expect(await invalidate(Array.from({ length: 6000 }, (_, i) => `uploads/u1/p${i}.jpg`))).toBe(true);
        expect(send).toHaveBeenCalledTimes(2);
    });

    // 何本中何本落ちたかをログに残す（部分的に無効化された状態を後から追う手がかり）
    it("失敗の本数をログに残す", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => { });
        const invalidate = await load("E123");
        send.mockReset()
            .mockRejectedValueOnce(new Error("Throttling"))
            .mockResolvedValueOnce({});
        await invalidate(Array.from({ length: 4000 }, (_, i) => `uploads/u1/p${i}.jpg`));
        expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/2 本中 1 本が失敗/);
    });
});
