import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`isGoneResponse`）が undefined になり、呼んだ瞬間に投げる——それを
// hook の catch が飲むので、**緑のまま間違ったことを測るテスト**になる
// （`usePhotoLikes.test.tsx` の同じコメントを参照）。
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import { usePhotoSave } from "../usePhotoSave";

/** サーバーの応答をひとつ作る */
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const gone = (body: unknown) => ({
    ok: false, status: 404,
    json: async () => body,
    clone: () => ({ json: async () => body }),
});

beforeEach(() => { mockUserFetch.mockReset(); mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }); });
afterEach(() => vi.clearAllMocks());

describe("usePhotoSave", () => {
    it("初期は未保存", () => {
        const { result } = renderHook(() => usePhotoSave("p1", false));
        expect(result.current.saved).toBe(false);
    });

    it("ログイン中はマウント時に保存済みかを聞く", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await waitFor(() => expect(result.current.saved).toBe(true));
        expect(mockUserFetch).toHaveBeenCalledWith("/user/saves/p1", expect.anything());
    });

    it("**未ログインでは聞きに行かない**（401 が返るだけ）", () => {
        renderHook(() => usePhotoSave("p1", false));
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン確認中も聞きに行かない", () => {
        renderHook(() => usePhotoSave("p1", true, true));
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("保存: POST を投げ、しおりが付く", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(true);
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/save", { method: "POST" });
    });

    it("解除: 保存済みから押すと DELETE", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await waitFor(() => expect(result.current.saved).toBe(true));

        mockUserFetch.mockResolvedValue(ok({ saved: false }));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(false);
        expect(mockUserFetch).toHaveBeenLastCalledWith("/photos/p1/save", { method: "DELETE" });
    });

    // **未ログインで楽観的にしおりを付けない。** 付けると「保存した」と
    // 見えるのに、どこにも残らない（いいねは端末の控えがあるが、保存は無い）
    it("未ログインは requiresAuth を返し、しおりを付けない", async () => {
        const { result } = renderHook(() => usePhotoSave("p1", false));
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toEqual({ ok: false, requiresAuth: true });
        expect(result.current.saved).toBe(false);
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("ログイン確認中の一押しはサーバーへ送らない（未ログイン扱いにしない）", async () => {
        const { result } = renderHook(() => usePhotoSave("p1", false, true));
        await act(async () => { expect(await result.current.toggle()).toEqual({ ok: true }); });
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("失敗したら巻き戻し、サーバーが言っている理由を運ぶ", async () => {
        const body = { error: "保存に失敗しました" };
        mockUserFetch.mockResolvedValue({
            ok: false, status: 500, json: async () => body, clone: () => ({ json: async () => body }),
        });
        const { result } = renderHook(() => usePhotoSave("p1", true));
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(result.current.saved).toBe(false);
        expect(r).toEqual({ ok: false, message: "保存に失敗しました" });
    });

    // **いちばん多い失敗はセッション切れ。** API Gateway の JWT オーソライザは
    // `{"message":"Unauthorized"}` しか返さないので、そのままだと
    // 「もう一度お試しください」になる——押し直しても直らない失敗なのに。
    // `readApiError` が「セッションの有効期限が切れています」に置き換える
    it("セッション切れ（401・英語の定型）は、再ログインを促す文言になる", async () => {
        const body = { message: "Unauthorized" };
        mockUserFetch.mockResolvedValue({
            ok: false, status: 401, json: async () => body, clone: () => ({ json: async () => body }),
        });
        const { result } = renderHook(() => usePhotoSave("p1", true));
        let r: Awaited<ReturnType<typeof result.current.toggle>> | undefined;
        await act(async () => { r = await result.current.toggle(); });
        expect(r?.ok).toBe(false);
        expect(r?.message).toContain("セッション");
        expect(r?.message).not.toContain("Unauthorized");
    });

    // **「もう見えない」と「あなたの保存は残っている」を分ける。**
    // 未保存に戻すと、開いている間ずっと解除の導線が出ない
    it("非公開になった写真の保存（404 + saved:true）は、保存済みのまま", async () => {
        mockUserFetch.mockResolvedValue(gone({ error: "写真が見つかりません", saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(true);
    });

    it("保存していない写真の 404（saved なし）は巻き戻す", async () => {
        mockUserFetch.mockResolvedValue(gone({ error: "写真が見つかりません" }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(false);
    });

    // サーバーは DELETE で公開状態を見ない（見ると棚から永久に外せなくなる）。
    // ここで巻き戻すと、サーバーは解除済みなのに画面は保存済みに戻り、
    // 押し直しても同じ 404 で直らない
    it("解除の 404 は「解除できた」として扱う", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await waitFor(() => expect(result.current.saved).toBe(true));

        mockUserFetch.mockResolvedValue(gone({ error: "写真が見つかりません" }));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(false);
    });

    // モーダルは**同じフックのまま**次の写真へ進む（コンポーネントを
    // 作り直さない）。捨てないと1枚目のしおりが2枚目にも付いて見え、
    // 押すと解除が飛ぶ（いいねが実際に踏んだ形）
    it("写真が変わったら状態を捨てる", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result, rerender } = renderHook(
            ({ id }) => usePhotoSave(id, true), { initialProps: { id: "p1" } });
        await waitFor(() => expect(result.current.saved).toBe(true));

        mockUserFetch.mockResolvedValue(ok({ saved: false }));
        rerender({ id: "p2" });
        expect(result.current.saved).toBe(false);
    });

    // マウント時の取得は「押す前の状態」を運ぶ。遅れて着地すると、
    // せっかく押したしおりを古い値で巻き戻す
    it("押したあとは、遅れて着地した取得で上書きしない", async () => {
        let release: ((v: unknown) => void) | undefined;
        // 1回目（マウントの確認）は握ったまま返さない
        mockUserFetch.mockImplementationOnce(() => new Promise((r) => { release = r; }));
        const { result } = renderHook(() => usePhotoSave("p1", true));

        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.saved).toBe(true);

        // ここで「押す前は未保存でした」が着地する
        await act(async () => { release?.(ok({ saved: false })); await Promise.resolve(); });
        expect(result.current.saved).toBe(true);
    });

    it("連打しても2回は飛ばない", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await act(async () => {
            await Promise.all([result.current.toggle(), result.current.toggle()]);
        });
        const saves = mockUserFetch.mock.calls.filter((c) => c[0] === "/photos/p1/save");
        expect(saves).toHaveLength(1);
    });

    it("いいねの経路を叩かない（別の棚である）", async () => {
        mockUserFetch.mockResolvedValue(ok({ saved: true }));
        const { result } = renderHook(() => usePhotoSave("p1", true));
        await act(async () => { await result.current.toggle(); });
        for (const c of mockUserFetch.mock.calls) {
            expect(String(c[0])).not.toContain("like");
        }
    });
});
