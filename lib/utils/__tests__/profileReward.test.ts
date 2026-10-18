import { describe, it, expect, vi, beforeEach } from "vitest";

// お礼の頼み直し（#304・2026-10-18 見直し）: 置いた直後は CDN が「まだ無い」と答えることがあるので、
// 足せず印も無いときだけ、約12秒おいて1回だけ頼み直す
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ userFetch: (...a: unknown[]) => mockUserFetch(...a) }));

import { claimProfileReward, REWARD_RETRY_MS } from "../profileReward";

const answer = (v: Record<string, unknown>) => ({ ok: true, json: async () => v });

beforeEach(() => { mockUserFetch.mockReset(); });

describe("claimProfileReward", () => {
    it("足せず印も無い（置いた直後）なら約12秒おいて1回だけ頼み直す", async () => {
        mockUserFetch
            .mockResolvedValueOnce(answer({ granted: false, added: 0, coins: 2, rewarded: false }))
            .mockResolvedValueOnce(answer({ granted: true, added: 3, coins: 5, rewarded: true }));
        const wait = vi.fn(async () => {});
        expect(await claimProfileReward("cover", wait)).toEqual({ granted: true, added: 3, coins: 5, rewarded: true });
        expect(wait).toHaveBeenCalledWith(REWARD_RETRY_MS);
        expect(REWARD_RETRY_MS).toBeGreaterThanOrEqual(11_000);
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });

    it("2回目もだめなら、それ以上は頼まない", async () => {
        mockUserFetch.mockResolvedValue(answer({ granted: false, added: 0, coins: 2, rewarded: false }));
        const r = await claimProfileReward("avatar", async () => {});
        expect(r?.added).toBe(0);
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });

    it("足せた・もらい済み（rewarded）・失敗なら頼み直さない", async () => {
        const wait = vi.fn(async () => {});
        mockUserFetch.mockResolvedValueOnce(answer({ granted: true, added: 3, coins: 3, rewarded: true }));
        await claimProfileReward("avatar", wait);
        mockUserFetch.mockResolvedValueOnce(answer({ granted: false, added: 0, coins: 9, rewarded: true }));
        await claimProfileReward("avatar", wait);
        mockUserFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
        expect(await claimProfileReward("avatar", wait)).toBeNull();
        expect(wait).not.toHaveBeenCalled();
        expect(mockUserFetch).toHaveBeenCalledTimes(3);
    });
});
