import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// 登録直後の AdminAddUserToGroup が落ちると、ログイン済みなのにグループが
// 付いていない人ができる。3つのページ（アップロード・編集・下書き）が
// 同じ判定を各自で書いていて、どれもログイン画面へ push していた。
// ところが /login はログイン済みだと next へ push し返すので、
// **無限に往復して何も表示されなかった**（本人には直す手段が無い）。

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
// **同じ object を返す。** 毎回作ると `useEffect` の依存が常に変わり、
// 依存配列の取りこぼし（`hasUnsavedWork` を入れ忘れる等）を素通りさせる
const stableRouter = vi.hoisted(() => ({ push: mockPush, replace: mockReplace }));
vi.mock("next/navigation", () => ({ useRouter: () => stableRouter }));

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

// **打ちかけがあるときは送り返さない。** `router.replace` は画面を
// 作り直すので、打ちかけごと消える（`/user/edit` の未保存の確認も通らない）。
// 引数を足したのに、この口を直接見るテストが1件も無かった。
describe("useMemberGate: 打ちかけがあるとき", () => {
    it("未ログインでも送り返さない", () => {
        const { result } = renderHook(() => useMemberGate(true));
        expect(result.current).toBe("anonymous");
        expect(mockReplace, "打ちかけごと画面を入れ替えている").not.toHaveBeenCalled();
    });

    // **打ちかけが無くなったら送り返す。** 依存に入れ忘れると、
    // 一度留めたあとは何をしても送り返さなくなる
    it("打ちかけが無くなったら送り返す", () => {
        const { rerender } = renderHook(({ unsaved }) => useMemberGate(unsaved), {
            initialProps: { unsaved: true },
        });
        expect(mockReplace).not.toHaveBeenCalled();
        rerender({ unsaved: false });
        expect(mockReplace, "打ちかけが無くなっても送り返さない").toHaveBeenCalled();
    });

    it("ログイン済みなら、打ちかけの有無に関係なく通す", () => {
        authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
        expect(renderHook(() => useMemberGate(true)).result.current).toBe("ok");
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
