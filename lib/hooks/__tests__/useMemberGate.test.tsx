import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// 登録直後の AdminAddUserToGroup が落ちると、ログイン済みなのにグループが
// 付いていない人ができる。3つのページ（アップロード・編集・下書き）が
// 同じ判定を各自で書いていて、どれもログイン画面へ push していた。
// ところが /login はログイン済みだと next へ push し返すので、
// **無限に往復して何も表示されなかった**（本人には直す手段が無い）。

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: false, isAdminUser: false, isGeneralUser: false, loading: false },
}));
vi.mock("../../../app/auth/context", () => ({ useAuth: () => authState.current }));

const { useMemberGate } = await import("../useMemberGate");

beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    authState.current = { isAuthenticated: false, isAdminUser: false, isGeneralUser: false, loading: false };
});

describe("useMemberGate", () => {
    it("未ログインはログインへ送る（今までどおり）", () => {
        const { result } = renderHook(() => useMemberGate());
        expect(result.current).toBe("anonymous");
        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // **push だと戻るで抜けられなくなる。**
    //   [/] [/user/upload] [/login?next=/user/upload]
    // ログイン後に /user/upload へ進み、そこで戻ると /login に着地する。
    // /login はログイン済みだと next へ送り返すので、戻るを何度押しても
    // この2画面を往復するだけ。通せなかったページは履歴に残さない。
    it("履歴を伸ばさない（push ではなく replace）", () => {
        renderHook(() => useMemberGate());
        expect(mockPush, "push で送ると、戻るがログイン画面と往復して抜けられない").not.toHaveBeenCalled();
    });

    // ここが往復の元。**送り返してはいけない**
    it("ログイン済みで権限が無い人は、ログインへ送り返さない", () => {
        authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: false, loading: false };
        const { result } = renderHook(() => useMemberGate());
        expect(result.current).toBe("no-group");
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it("読み込み中は何もしない（判定が出る前に送らない）", () => {
        authState.current = { isAuthenticated: false, isAdminUser: false, isGeneralUser: false, loading: true };
        const { result } = renderHook(() => useMemberGate());
        expect(result.current).toBe("loading");
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it("一般ユーザーは通す", () => {
        authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
        expect(renderHook(() => useMemberGate()).result.current).toBe("ok");
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it("管理者も通す", () => {
        authState.current = { isAuthenticated: true, isAdminUser: true, isGeneralUser: false, loading: false };
        expect(renderHook(() => useMemberGate()).result.current).toBe("ok");
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
