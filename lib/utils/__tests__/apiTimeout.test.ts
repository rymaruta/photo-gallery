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
        // **タイマーは時間切れまで残る**（本文が止まる回線を見張るため）。
        // 済んだ `fetch` への中断は何も起こさないので、これで害は無い
        await vi.advanceTimersByTimeAsync(60_000);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("[]");
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

    // **ヘッダだけ来て本文が止まる**回線（電波が弱いときの典型）。
    // `fetch` はヘッダの時点で返るので、そこでタイマーを片付けると
    // `res.json()` が無防備になる——レビューの実測で 27秒経ってもトーストが
    // 出なかった
    it("本文が止まったら、本文の読み取りが時間切れになる", async () => {
        const { publicFetch } = await import("../api");
        let cancelled: unknown = null;
        fetchMock.mockImplementation(async () => {
            const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal | undefined;
            // 本文は流れ始めるが終わらない
            const body = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("[")); 
                    signal?.addEventListener("abort", () => {
                        cancelled = signal.reason;
                        controller.error(signal.reason);
                    }, { once: true });
                },
            });
            return new Response(body, { status: 200 });
        });

        const res = await publicFetch("/photos");
        const read = res.text().catch((e: Error) => e.name);
        await vi.advanceTimersByTimeAsync(20_001);
        expect(await read, "本文が止まっても諦めていない").toBe("TimeoutError");
        expect((cancelled as Error).name).toBe("TimeoutError");
    });

    // 退会だけはサーバーが最長23秒使うので、既定の20秒では足りない
    it("呼び出しごとに打ち切りを伸ばせる", async () => {
        const { userFetch } = await import("../api");
        fetchMock.mockImplementation(neverResolves);
        // **決着したかどうかで見る。**「まだ呼ばれている」だけでは、
        // 既定の20秒で諦める実装と区別が付かない（変異が生き残った）
        let settled: string | null = null;
        const seen = userFetch("/user/account", { method: "DELETE", timeoutMs: 35_000 })
            .catch((e: Error) => { settled = e.name; return e.name; });
        await vi.advanceTimersByTimeAsync(20_001);
        expect(settled, "既定の20秒で諦めている（伸ばした値を見ていない）").toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(await seen).toBe("TimeoutError");
        // 素の `fetch` に知らない項目を渡さない
        expect((fetchMock.mock.calls[0][1] as Record<string, unknown>).timeoutMs).toBeUndefined();
    });
});
