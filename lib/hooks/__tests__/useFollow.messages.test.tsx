import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// サーバーは断る理由を返し分けている（503「確認できませんでした。時間を
// おいて…」/ 404「ユーザーが見つかりません」/ 400「自分はフォローできません」）。
// 番号だけ投げていたので、画面はすべて「うまくいきませんでした」になり、
// 直せるものも直せない案内になっていた。別タブでログアウトしたときの
// 「認証が必要です」も同じ扱いで、押し直しても直らないのに直りそうに見えた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../utils/api")>("../../utils/api");
    return {
        ...actual,
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("../../utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useFollow } = await import("../useFollow");
const { AUTH_REQUIRED_MESSAGE } = await import("../../utils/api");

const TARGET = "u2";

beforeEach(() => {
    mockUserFetch.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ following: [] }) });
});

describe("useFollow: 断られた理由を捨てない", () => {
    const ready = async () => {
        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        return result;
    };

    it("サーバーの文言をそのまま返す", async () => {
        const result = await ready();
        mockUserFetch.mockResolvedValue({
            ok: false, status: 400, json: async () => ({ error: "自分はフォローできません" }),
        });
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.result).toBe("error");
        expect(r?.message).toBe("自分はフォローできません");
    });

    // トークンが取れない（別タブでログアウト・リフレッシュ失効）。
    // 「うまくいきませんでした」では直らないので、押し直させない
    it("トークンが取れないときは auth-required にする", async () => {
        const result = await ready();
        mockUserFetch.mockRejectedValue(new Error(AUTH_REQUIRED_MESSAGE));
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.result).toBe("auth-required");
        expect(r?.message).toBe(AUTH_REQUIRED_MESSAGE);
    });

    it("成功したときは結果だけ（文言は要らない）", async () => {
        const result = await ready();
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 1 }) });
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.result).toBe("followed");
    });

    it("未ログインは通信せずに auth-required", async () => {
        const { result } = renderHook(() => useFollow(TARGET, false));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.result).toBe("auth-required");
        expect(mockUserFetch).not.toHaveBeenCalled();
    });
});
