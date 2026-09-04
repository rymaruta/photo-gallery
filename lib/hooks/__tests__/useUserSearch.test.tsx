import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// **検索の失敗が「見つかりませんでした」になっていた。**
//
// `catch` で `setUsers([])` にしていたので、API が落ちている・URL の設定が
// 違う、というときに「その人は登録していない」と読める文言が出る。
// 知り合いを探しに来た新規ユーザーが最初に踏む画面で、しかも
// 「登録していない」と読んだ人は二度と探しに来ない。
//
// `loading` と 0件 は分けてあった。分けていなかったのは**エラーと 0件**。

const mockUserPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({ userPublicFetch: mockUserPublicFetch }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useUserSearch } = await import("../useUserSearch");

const HIT = { userId: "u1", displayName: "旅子" };

beforeEach(() => { mockUserPublicFetch.mockReset(); });

describe("ユーザー検索: 失敗と0件を分ける", () => {
    it("HTTP エラーは failed（0件ではない）", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result } = renderHook(() => useUserSearch("たびこ"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed, "失敗を「見つからなかった」と同じ扱いにしている").toBe(true);
        expect(result.current.users).toEqual([]);
    });

    it("通信が落ちても failed", async () => {
        mockUserPublicFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => useUserSearch("たびこ"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed).toBe(true);
    });

    // 正常系: **本当に0件のときは failed にしない**（ここを取り違えると、
    // 誰も居ないだけなのに「検索できませんでした」と言う逆の嘘になる）
    it("0件で返ってきたら failed にしない", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
        const { result } = renderHook(() => useUserSearch("たびこ"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.failed).toBe(false);
        expect(result.current.users).toEqual([]);
    });

    it("見つかったら failed にしない", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [HIT] }) });
        const { result } = renderHook(() => useUserSearch("たびこ"));
        await waitFor(() => expect(result.current.users).toHaveLength(1));
        expect(result.current.failed).toBe(false);
    });

    // 前の失敗を引きずらない
    it("検索語を消したら failed を下ろす", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result, rerender } = renderHook(({ q }) => useUserSearch(q), {
            initialProps: { q: "たびこ" },
        });
        await waitFor(() => expect(result.current.failed).toBe(true));
        rerender({ q: "" });
        await waitFor(() => expect(result.current.failed, "前の失敗が残っている").toBe(false));
    });

    it("成功したら前の failed を下ろす", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result, rerender } = renderHook(({ q }) => useUserSearch(q), {
            initialProps: { q: "たびこ" },
        });
        await waitFor(() => expect(result.current.failed).toBe(true));

        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [HIT] }) });
        rerender({ q: "たびこさん" });
        await waitFor(() => expect(result.current.users).toHaveLength(1));
        expect(result.current.failed).toBe(false);
    });
});

// **「聞けなかった」を「見つからなかった」に混ぜない**（このフックの冒頭の
// コメントが書いているとおり）。行のふるいを足したとき `?? []` にしたので、
// `users` が配列でない応答で `failed` が立たず、画面が
// 「見つかりませんでした」を出していた——`showEmpty = searched && !failed &&
// users.length === 0`（`app/users/search/page.tsx`）。
describe("応答の形がおかしいとき", () => {
    it.each([
        ["users が配列でない", { users: { a: 1 } }],
        ["users が無い", { count: 0 }],
        ["本文が null", null],
    ])("%s なら failed を立てる", async (_name, body) => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => body });
        const { result } = renderHook(({ q }) => useUserSearch(q), { initialProps: { q: "たびこ" } });
        await waitFor(() => expect(result.current.failed,
            "「見つかりませんでした」と同じ見た目になる").toBe(true));
        expect(result.current.users).toEqual([]);
    });

    // 読めない行は落として、残りは出す（失敗にはしない）
    it("読めない行が混じっても、残りは出す", async () => {
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ users: [HIT, null, "文字列"] }),
        });
        const { result } = renderHook(({ q }) => useUserSearch(q), { initialProps: { q: "たびこ" } });
        await waitFor(() => expect(result.current.users).toHaveLength(1));
        expect(result.current.failed).toBe(false);
    });

    // 正常系: 本当に0件なら failed は立てない（逆向きの混同を作らない）
    it("本当に0件なら failed を立てない", async () => {
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
        const { result } = renderHook(({ q }) => useUserSearch(q), { initialProps: { q: "たびこ" } });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.users).toEqual([]);
        expect(result.current.failed, "0件を失敗にしている").toBe(false);
    });
});
