import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * 旅行プランのフック。
 *
 * 固定したいのは4つ:
 *
 *  1. **「まだ」「聞けなかった」「0件」を混ぜない**——混ぜると、通信に
 *     失敗しただけの人に「まだプランはありません」と言い切る
 *  2. **書き込みの応答をそのまま映す**（自分で足し引きしない）
 *  3. **サーバーの言い分を出す**——403（上限）と 503（混雑）を
 *     「保存に失敗しました」に潰すと、何をすれば直るか分からない
 *  4. **形の違う応答で画面ごと落とさない**（読めない行は落とす）
 */
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useTripPlans, usableTripPlan, readPlans } from "../useTripPlans";

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const bad = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) });

const P = (planId: string, over: Record<string, unknown> = {}) =>
    ({ planId, title: `旅 ${planId}`, days: [], ...over });

beforeEach(() => { mockUserFetch.mockReset(); });

const mount = () => renderHook(({ a, l }: { a: boolean; l: boolean }) => useTripPlans(a, l), {
    initialProps: { a: true, l: false },
});

describe("取得", () => {
    it("取れたら一覧を出す", async () => {
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [P("a"), P("b")] }));
        const { result } = mount();
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.plans.map((p) => p.planId)).toEqual(["a", "b"]);
        expect(result.current.failed).toBe(false);
        expect(mockUserFetch.mock.calls[0][0]).toBe("/user/trips");
    });

    it("🔴 聞けなかったときは `failed`（0件と混ぜない）", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        const { result } = mount();
        await waitFor(() => expect(result.current.failed).toBe(true));
        expect(result.current.plans).toEqual([]);
        expect(result.current.pending).toBe(false);
    });

    it("🔴 形の違う応答も `failed`（空の一覧として描かない）", async () => {
        mockUserFetch.mockResolvedValueOnce(ok({ plans: "こわれ" }));
        const { result } = mount();
        await waitFor(() => expect(result.current.failed).toBe(true));
    });

    it("投げて落ちたときも `failed`", async () => {
        mockUserFetch.mockRejectedValueOnce(new Error("圏外"));
        const { result } = mount();
        await waitFor(() => expect(result.current.failed).toBe(true));
    });

    it("未ログインは待たせない（`pending` にしない・聞きにも行かない）", async () => {
        const { result } = renderHook(() => useTripPlans(false, false));
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.plans).toEqual([]);
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン確認中は `pending`（「まだありません」と出さない）", () => {
        const { result } = renderHook(() => useTripPlans(false, true));
        expect(result.current.pending).toBe(true);
    });

    it("再試行でもう一度聞く", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce(ok({ plans: [P("a")] }));
        const { result } = mount();
        await waitFor(() => expect(result.current.failed).toBe(true));
        act(() => result.current.retry());
        await waitFor(() => expect(result.current.plans).toHaveLength(1));
        expect(result.current.failed).toBe(false);
    });
});

describe("作る・直す・消す", () => {
    const loaded = async () => {
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [] }));
        const h = mount();
        await waitFor(() => expect(h.result.current.pending).toBe(false));
        return h;
    };

    it("作ると、応答の一覧をそのまま映す", async () => {
        const { result } = await loaded();
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [P("new1"), P("old")] }));
        let made: unknown;
        await act(async () => { made = await result.current.create("北欧の冬"); });
        expect((made as { planId: string }).planId).toBe("new1");
        expect(result.current.plans.map((p) => p.planId)).toEqual(["new1", "old"]);
        const [path, init] = mockUserFetch.mock.calls[1] as [string, RequestInit];
        expect(path).toBe("/user/trips");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ title: "北欧の冬" });
    });

    it("直すと PUT を送り、送った項目だけが本文に乗る", async () => {
        const { result } = await loaded();
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [P("a")] }));
        await act(async () => { await result.current.update("a", { title: "新しい題" }); });
        const [path, init] = mockUserFetch.mock.calls[1] as [string, RequestInit];
        expect(path).toBe("/user/trips/a");
        expect(init.method).toBe("PUT");
        expect(JSON.parse(init.body as string)).toEqual({ title: "新しい題" });
    });

    it("planId は URL に入れる前にエンコードする", async () => {
        const { result } = await loaded();
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [] }));
        await act(async () => { await result.current.remove("a/b?c"); });
        expect(mockUserFetch.mock.calls[1][0]).toBe("/user/trips/a%2Fb%3Fc");
    });

    it("🔴 サーバーの言い分をそのまま出す（403 を既定文に潰さない）", async () => {
        const { result } = await loaded();
        mockUserFetch.mockResolvedValueOnce(bad(403, "旅行プランは50個までです。使わないものを消してください"));
        await act(async () => { await result.current.create("あふれる"); });
        expect(result.current.error).toContain("50個まで");
        // **失敗したぶんを一覧に足していない**
        expect(result.current.plans).toEqual([]);
    });

    it("成功すると、前の言い分が消える", async () => {
        const { result } = await loaded();
        mockUserFetch.mockResolvedValueOnce(bad(503, "混み合っています"));
        await act(async () => { await result.current.create("x"); });
        expect(result.current.error).toBe("混み合っています");
        mockUserFetch.mockResolvedValueOnce(ok({ plans: [P("a")] }));
        await act(async () => { await result.current.create("y"); });
        expect(result.current.error).toBeNull();
    });

    it("書き込み中は次を受け付けない（連打を止める）", async () => {
        const { result } = await loaded();
        let release: (v: unknown) => void = () => {};
        mockUserFetch.mockReturnValueOnce(new Promise((r) => { release = r; }));
        let second: unknown = "まだ";
        await act(async () => {
            const first = result.current.create("1本目");
            second = await result.current.remove("a");   // 走っている間の2本目
            release(ok({ plans: [] }));
            await first;
        });
        expect(second, "連打が素通りした").toBe(false);
        // 取得1回 ＋ 書き込み1回だけ
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });
});

describe("応答の均し（`usableTripPlan` / `readPlans`）", () => {
    it("`planId` の無い行は落とす", () => {
        expect(usableTripPlan({ title: "t", days: [] })).toBeNull();
        expect(usableTripPlan(null)).toBeNull();
        expect(usableTripPlan("文字列")).toBeNull();
    });
    it("知らない形の項目は落とす（画面が描けない項目を残さない）", () => {
        const p = usableTripPlan({ planId: "a", title: "t", days: [{ items: [
            { kind: "spot", spotId: "sp_1" },
            { kind: "hotel", name: "宿" },
            { kind: "location" },
            "こわれ",
            { kind: "location", slug: "パリ" },
        ] }] });
        expect(p?.days[0].items).toEqual([{ kind: "spot", spotId: "sp_1" }, { kind: "location", slug: "パリ" }]);
    });
    it("`days` が無くても落とさない（空として描く）", () => {
        expect(usableTripPlan({ planId: "a", title: "t" })?.days).toEqual([]);
    });
    it("`plans` が配列でなければ `null`（0件と混ぜない）", () => {
        expect(readPlans({ plans: "x" })).toBeNull();
        expect(readPlans({})).toBeNull();
        expect(readPlans(null)).toBeNull();
        expect(readPlans({ plans: [] }), "本当の0件は配列で来る").toEqual([]);
    });
});
