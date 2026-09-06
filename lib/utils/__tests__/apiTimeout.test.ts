import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// **打ち切りが1つも無かった。** 応答が返らない回線（電波が弱い・トンネル・
// 相手が詰まっている）では `fetch` は失敗もせず待ち続ける。実測で出ていた症状:
// ストーリーの投稿が返らず全画面の下書きから出られない／フォローが
// 「フォロー中」の見た目のまま固まる／通知の取得が60秒ごとに積み上がる。

// セッションの返り方をテストごとに差し替える。**`vi.doMock` は使わない**
// ——台帳に「原因不明のフレークを出した」と記録がある手なので、
// 登録は1回にして中身だけ差し替える
const session = vi.hoisted(() => ({
    current: null as null | Promise<unknown>,
}));
vi.mock("../../auth/cognito", () => ({
    getCurrentSession: () => session.current ?? Promise.resolve({ getIdToken: () => ({ getJwtToken: () => "jwt" }) }),
}));

const fetchMock = vi.fn();
let prevFetch: typeof globalThis.fetch;

beforeEach(() => {
    prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    fetchMock.mockReset();
    session.current = null;
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
        // ヘッダが来た時点でタイマーは片付く（本文は読み取り側で守る）
        expect(vi.getTimerCount(), "ヘッダの打ち切りが残っている").toBe(0);
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
    // **ヘッダだけ来て本文が止まる**回線（電波が弱いときの典型）。
    // 中断ではなく**読み取り側の競走**で守る——Chromium で測ると、本文の
    // 途中で中断しても理由は捨てられて `AbortError` になり（実測）、
    // 「自分で畳んだ中断」として各所が握り潰してしまう
    it("本文が止まったら、本文の読み取りが時間切れになる", async () => {
        const { publicFetch } = await import("../api");
        fetchMock.mockImplementation(async () => new Response(
            new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("[")); /* 閉じない */ } }),
            { status: 200 },
        ));

        const res = await publicFetch("/photos");
        const read = res.text().catch((e: Error) => e.name);
        await vi.advanceTimersByTimeAsync(20_001);
        expect(await read, "本文が止まっても諦めていない").toBe("TimeoutError");
    });

    // **ヘッダが来たらタイマーを片付ける。** 残すと、応答を受け取ってから
    // 他の待ち事を挟む経路（`Promise.all([fetch, getCurrentSession()])`）で、
    // 届いていた本文が後から読めなくなる（Chromium で実測）
    it("受け取ったあと時間が経っても、本文は読める", async () => {
        const { publicFetch } = await import("../api");
        fetchMock.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }));
        const res = await publicFetch("/photos");
        await vi.advanceTimersByTimeAsync(60_000);   // 他の待ち事で時間が経つ
        expect(await res.json(), "受け取った応答が読めなくなっている").toEqual({ ok: true });
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

// **`fetch` に打ち切りを入れただけでは足りなかった。** 認証付きの経路は
// `await getCurrentSession()` の後に `fetch` を呼ぶ。`getSession` は
// 期限切れトークンで Cognito へ通信し、そのコールバックには時間切れが無い
// ——返らなければ `fetch` に到達すらしない（レビュー指摘）。
describe("トークン取得の打ち切り", () => {
    it("セッションが返らなければ、fetch へ行く前に諦める", async () => {
        session.current = new Promise(() => {});   // 返らない
        const { userFetch } = await import("../api");
        const seen = userFetch("/user/notifications").catch((e: Error) => e.name);
        // セッションの待ちは**短く固定**（要求ごとの打ち切りと直列なので、
        // 同じ値にすると最悪で倍かかる）
        await vi.advanceTimersByTimeAsync(10_001);
        expect(await seen).toBe("TimeoutError");
        expect(fetchMock, "セッションが返っていないのに投げている").not.toHaveBeenCalled();
    });

    it("セッションが普通に返れば、今までどおり投げる", async () => {
        fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
        const { userFetch } = await import("../api");
        const res = await userFetch("/user/notifications");
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
