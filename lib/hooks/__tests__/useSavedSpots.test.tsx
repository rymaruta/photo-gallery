import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * 「行きたい場所」のフック。**このフックには振る舞いのテストが1本も無かった**
 * ——触っていたのは `SaveSpotButton` と `/saved-spots` のページテストだけで、
 * フックを共通部（`useMyPhotoIdList`）の包みに書き換えたとき、
 * 「振る舞いが変わっていない」と言える根拠が使い捨ての A/B しか無かった。
 *
 * ここに残すのは、**共通部に `apply` という新しい口が入ったことで
 * 意味を持つようになった筋**2つ。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({ userFetch: (...a: unknown[]) => mockUserFetch(...a) }));
vi.mock("../../utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useSavedSpots } from "../useSavedSpots";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => { mockUserFetch.mockReset(); });

describe("useSavedSpots", () => {
    /**
     * **飛行中にログアウトが確定したら、書き込みの応答を採らない。**
     *
     * `toggle` の応答は `apply` で映すが、`apply` は**投げた条件（`token`）**
     * で置く。途中でログアウトが確定すると条件が変わるので、着地した一覧は
     * 描画のときに捨てられる——捨てないと、ログアウトした画面に
     * 「保存済み」が残る。
     */
    it("toggle が飛んでいる間にログアウトが確定したら、その一覧は採らない", async () => {
        mockUserFetch.mockResolvedValueOnce(ok({ slugs: [] }));

        const { result, rerender } = renderHook(
            ({ auth }: { auth: boolean }) => useSavedSpots(auth, false),
            { initialProps: { auth: true } },
        );
        await waitFor(() => expect(result.current.pending).toBe(false));

        // POST は「着地を遅らせる」形で握っておく
        let land!: (v: unknown) => void;
        mockUserFetch.mockReturnValueOnce(new Promise((r) => { land = r; }));
        let done!: Promise<boolean>;
        act(() => { done = result.current.toggle("paris"); });

        // 着地する前にログアウトが確定する
        rerender({ auth: false });
        await act(async () => {
            land(ok({ slugs: ["paris"] }));
            await done;
        });

        expect(result.current.slugs, "ログアウト後の画面に保存済みが残っている").toEqual([]);
        expect(result.current.isSaved("paris"), "ログアウト後に保存済みと名乗っている").toBe(false);
    });

    /**
     * **「聞けなかった」と「0件」を混ぜない。** 混ぜると、通信に失敗した
     * だけの人に「保存した場所はまだありません」と言い切ることになるうえ、
     * 保存済みのスポットが「行きたい」と表示され、押すと**解除ではなく
     * 保存**が飛ぶ（その場で解除できない）。
     */
    it.each([
        ["応答が 5xx", { ok: false, json: async () => ({}) }],
        ["slugs が配列でない", ok({ slugs: "nope" })],
        ["slugs が無い", ok({})],
    ])("%s なら failed で、0件と区別できる", async (_name, res) => {
        mockUserFetch.mockResolvedValueOnce(res);

        const { result } = renderHook(() => useSavedSpots(true, false));
        await waitFor(() => expect(result.current.pending).toBe(false));

        expect(result.current.failed, "失敗を 0件に混ぜている").toBe(true);
        expect(result.current.slugs).toEqual([]);
        // **`false` ではなく `undefined`。** `false` だと「保存していない」と
        // 言い切ることになる
        expect(result.current.isSaved("paris"), "聞けなかったのに保存済みでないと言い切っている")
            .toBeUndefined();
        // 状態が分からないうちは押させない（解除のつもりの一押しが保存になる）
        await act(async () => { expect(await result.current.toggle("paris")).toBe(false); });
        expect(mockUserFetch, "状態が分からないのに書きに行った").toHaveBeenCalledTimes(1);
    });
});
