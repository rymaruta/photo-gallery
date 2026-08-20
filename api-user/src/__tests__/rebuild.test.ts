import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 再ビルド依頼。退会・写真削除・非公開のあとに1回だけ叩く。
//
// 静的エクスポートなので、DynamoDB と S3 を消しても、既に配ってある
// /photo/<id> の HTML は残り続ける（本文・撮影地・EXIF・表示名入りの
// JSON-LD まで焼き込まれている）。定期ビルドは Actions の枠の都合で
// 止めてあるので、ここが唯一の掃除経路になる。
//
// ただし、ここで例外を投げたり待たせすぎたりして削除そのものを
// 失敗させてはいけない。「消えたけど掃除は後回し」は許容できるが、
// 「消せませんでした」と言いながらデータは半分消えた、は許容できない。

// クールダウンの判定は DynamoDB を叩く。モックしないと、テストが
// 実エンドポイントへ発射して遅く・不安定になる（資格情報が無いと
// 数秒かけて失敗し、fail-open で「通った」ことになる）。
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));

const originalFetch = globalThis.fetch;
const condFail = () => Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });

async function loadWith(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) vi.stubEnv(k, "");
        else vi.stubEnv(k, v);
    }
    return import("../rebuild");
}

beforeEach(() => { vi.unstubAllEnvs(); mockDdbSend.mockReset().mockResolvedValue({}); });
afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); });

describe("requestSiteRebuild", () => {
    it("設定が無ければ何もせず false（削除自体は失敗させない）", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "", REBUILD_DISPATCH_TOKEN: "" });
        expect(await requestSiteRebuild("test")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("トークンだけ無い場合も何もしない", async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "" });
        expect(await requestSiteRebuild("test")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("設定があれば repository_dispatch を1回叩く", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });

        expect(await requestSiteRebuild("photo deleted: p1")).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.github.com/repos/o/r/dispatches");
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body)) as { event_type: string; client_payload: { reason: string } };
        expect(body.event_type).toBe("site-rebuild");
        expect(body.client_payload.reason).toBe("photo deleted: p1");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("GitHub が失敗を返しても投げない", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 401, text: async () => "bad credentials",
        }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("test")).toBe(false);
    });

    it("通信そのものが失敗しても投げない", async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("test")).toBe(false);
    });
});


// クールダウンは一度作りを誤った。すべての依頼に一律でかけたところ、
// 当たった依頼は**見送られるだけで後から実行されない**ので、
// 「12:00 に写真削除 → 12:04 に別の人が退会」だと退会分の掃除が
// 永久に走らなくなった（定期ビルドは止めてあり、本人はもうアカウントが
// 無いので手動実行もできない）。
// 連打の畳み込みはワークフロー側で済んでいるので、ここで要るのは
// 「データを壊さずに何度でも起こせる操作」を抑えることだけ。
describe("requestSiteRebuild: クールダウン", () => {
    const setup = async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
        return loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
    };

    it("削除・退会は畳まない（指定しなければ素通し）", async () => {
        const { requestSiteRebuild } = await setup();
        mockDdbSend.mockRejectedValue(condFail());   // 直近に依頼済みでも
        expect(await requestSiteRebuild("photo deleted: p1")).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("coalesce を指定したときだけ、直近の依頼があれば見送る", async () => {
        const { requestSiteRebuild } = await setup();
        mockDdbSend.mockRejectedValue(condFail());
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("直近の依頼が無ければ通す", async () => {
        const { requestSiteRebuild } = await setup();
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("依頼そのものが失敗したら印を戻す（次の依頼を巻き添えにしない）", async () => {
        // トークン失効中に削除 → 印だけ残ると、直したあとも次の依頼が
        // 見送られて掃除が落ちる。
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("x", { coalesce: true })).toBe(false);
        const removes = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "REMOVE lastAt");
        expect(removes).toHaveLength(1);
    });

    // 戻すのは**自分が書いた印**だけ。無条件に消していた頃は、
    // 判定に失敗して素通しした呼び出し（何も書いていない）が失敗すると、
    // 同じ瞬間に印を取って実際にビルドを始めた別の呼び出しの印まで
    // 消していた——ロックが無いより弱い。
    it("戻すときは自分が書いた印かどうかを条件に付ける", async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        await requestSiteRebuild("x", { coalesce: true });
        const release = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => i?.UpdateExpression === "REMOVE lastAt");
        expect(release?.ConditionExpression).toBe("lastAt = :mine");
        const claim = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => String(i?.UpdateExpression ?? "").startsWith("SET lastAt"));
        const claimed = (claim?.ExpressionAttributeValues as Record<string, unknown>)[":now"];
        expect((release?.ExpressionAttributeValues as Record<string, unknown>)[":mine"]).toBe(claimed);
    });

    it("印を書けていない呼び出しは、他人の印を消しに行かない", async () => {
        // 判定そのものが落ちた（＝素通しした）ケース。書いていないので戻すものも無い。
        mockDdbSend.mockRejectedValue(new Error("ddb down"));
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad" }) as unknown as typeof fetch;
        const { requestSiteRebuild } = await loadWith({ REBUILD_REPO: "o/r", REBUILD_DISPATCH_TOKEN: "tok" });
        expect(await requestSiteRebuild("x", { coalesce: true })).toBe(false);
        const removes = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: { UpdateExpression?: string } }).input?.UpdateExpression)
            .filter((u) => u === "REMOVE lastAt");
        expect(removes).toHaveLength(0);
    });

    // 見送りは「次の依頼が来れば一緒に走る」前提だった。その編集が最後だと、
    // 消したはずの文言が静的HTMLに残ったままになる（定期ビルドは止めてある）。
    it("見送ったら、見送ったことを記録する", async () => {
        const { requestSiteRebuild } = await setup();
        mockDdbSend.mockRejectedValueOnce(condFail());
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(false);
        const pending = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => i?.UpdateExpression === "SET pending = :r");
        expect(pending?.Key).toEqual({ id: "rebuild#lock" });
        expect((pending?.ExpressionAttributeValues as Record<string, unknown>)[":r"]).toBe("photo updated: p1");
    });

    it("依頼できたときは見送りの記録を下ろす", async () => {
        const { requestSiteRebuild } = await setup();
        expect(await requestSiteRebuild("photo updated: p1", { coalesce: true })).toBe(true);
        const claim = mockDdbSend.mock.calls
            .map((c) => (c[0] as { input?: Record<string, unknown> }).input)
            .find((i) => String(i?.UpdateExpression ?? "").startsWith("SET lastAt"));
        expect(claim?.UpdateExpression).toContain("REMOVE pending");
    });
});
