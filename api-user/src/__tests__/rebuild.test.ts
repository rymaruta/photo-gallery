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

const originalFetch = globalThis.fetch;

async function loadWith(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) vi.stubEnv(k, "");
        else vi.stubEnv(k, v);
    }
    return import("../rebuild");
}

beforeEach(() => { vi.unstubAllEnvs(); });
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
