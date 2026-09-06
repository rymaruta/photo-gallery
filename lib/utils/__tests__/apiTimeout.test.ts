import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// **打ち切りが1つも無かった。** 応答が返らない回線（電波が弱い・トンネル・
// 相手が詰まっている）では `fetch` は失敗もせず待ち続ける。実測で出ていた症状:
// ストーリーの投稿が返らず全画面の下書きから出られない／フォローが
// 「フォロー中」の見た目のまま固まる／通知の取得が60秒ごとに積み上がる。

vi.mock("../../auth/cognito", () => ({
    getCurrentSession: async () => ({ getIdToken: () => ({ getJwtToken: () => "jwt" }) }),
}));

const fetchMock = vi.fn();
let prevFetch: typeof globalThis.fetch;

beforeEach(() => {
    prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    fetchMock.mockReset();
    vi.useFakeTimers();
});
afterEach(() => {
    globalThis.fetch = prevFetch;
    vi.useRealTimers();
});

/** 中断されるまで返らない `fetch`（＝返らない回線）。
 *  **本物と同じく、既に中断されている signal では即座に拒否する**
 *  （ここを緩く作ると「投げる前から中断」のテストが永久に待つ） */
const neverResolves = () => new Promise<Response>((_res, rej) => {
    const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal | undefined;
    if (signal?.aborted) { rej(signal.reason); return; }
    signal?.addEventListener("abort", () => rej(signal.reason), { once: true });
});

describe("API の打ち切り", () => {
    it("応答が返らなければ時間切れで諦める", async () => {
        const { publicFetch, REQUEST_TIMEOUT_MS } = await import("../api");
        fetchMock.mockImplementation(neverResolves);
        const p = publicFetch("/photos");
        const seen = p.catch((e: Error) => e);

        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2);
        const err = await seen as Error;
        // **`AbortError` にしない。** 「自分で畳んだ」中断を無視する実装が
        // あるので、同じ名前だと時間切れが黙って捨てられる
        expect(err.name).toBe("TimeoutError");
    });

    it("認証付きの経路も同じ（トークンを積んでから投げる）", async () => {
        const { userFetch } = await import("../api");
        fetchMock.mockImplementation(neverResolves);
        const seen = userFetch("/user/notifications").catch((e: Error) => e.name);
        await vi.advanceTimersByTimeAsync(20_001);
        expect(await seen).toBe("TimeoutError");
        expect((fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer jwt");
    });

    it("普通に返る要求は素通り（打ち切りに巻き込まれない）", async () => {
        const { publicFetch } = await import("../api");
        fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
        const res = await publicFetch("/photos");
        expect(res.status).toBe(200);
        // **タイマーを残さない。** 返ったあとも20秒ぶんの予約が積み上がると、
        // 通知の60秒ごとの取得のような常駐経路でタイマーが溜まる
        expect(vi.getTimerCount(), "打ち切りのタイマーが残っている").toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(res.status).toBe(200);
    });

    // 画面を離れたときの後片付け・追い越しの破棄は今までどおり効く
    it("呼び出し側の中断は生きている", async () => {
        const { publicFetch } = await import("../api");
        fetchMock.mockImplementation(neverResolves);
        const controller = new AbortController();
        const seen = publicFetch("/photos", { signal: controller.signal }).catch((e: Error) => e.name);
        controller.abort(new DOMException("やめた", "AbortError"));
        await vi.advanceTimersByTimeAsync(1);
        expect(await seen).toBe("AbortError");
    });

    it("投げる前から中断されていれば、そのまま中断で返す", async () => {
        const { publicFetch } = await import("../api");
        fetchMock.mockImplementation(neverResolves);
        const controller = new AbortController();
        controller.abort(new DOMException("やめた", "AbortError"));
        const seen = publicFetch("/photos", { signal: controller.signal }).catch((e: Error) => e.name);
        await vi.advanceTimersByTimeAsync(1);
        expect(await seen).toBe("AbortError");
    });
});
