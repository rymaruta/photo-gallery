import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { profileImageExists, profileImageKey } from "../profileImage";

/** アイコン・カバーが置かれているか（#304 のお礼の確かめ・`profileImage.ts`）。公開の CDN に HEAD で聞く */

const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test/");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers) });

describe("profileImageExists", () => {
    it("置き場は profile.ts と同じ決まったキー", () => {
        expect(profileImageKey("u1", "avatar")).toBe("profiles/u1");
        expect(profileImageKey("u1", "cover")).toBe("profiles/u1/cover");
    });

    it("在れば true。CDN の URL に HEAD で、毎回ちがう問いを付けて聞く", async () => {
        fetchMock.mockResolvedValue(res(200, { "content-type": "image/jpeg", "content-length": "1234" }));
        expect(await profileImageExists("u1", "cover")).toBe(true);
        expect(await profileImageExists("u1", "cover")).toBe(true);
        const [url1, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const [url2] = fetchMock.mock.calls[1] as [string];
        expect(url1).toMatch(/^https:\/\/cdn\.test\/profiles\/u1\/cover\?r=/);
        expect(url1).not.toBe(url2);
        expect(init.method).toBe("HEAD");
        expect(init.signal).toBeDefined();
    });

    it("空の実体・エラーページ（HTML）は無いのと同じ", async () => {
        fetchMock.mockResolvedValueOnce(res(200, { "content-type": "image/jpeg", "content-length": "0" }));
        expect(await profileImageExists("u1", "avatar")).toBe(false);
        fetchMock.mockResolvedValueOnce(res(200, { "content-type": "text/html; charset=utf-8" }));
        expect(await profileImageExists("u1", "avatar")).toBe(false);
    });

    it("404・403・500・失敗・時間切れは「無い」に倒す", async () => {
        for (const status of [404, 403, 500]) {
            fetchMock.mockResolvedValueOnce(res(status));
            expect(await profileImageExists("u1", "avatar")).toBe(false);
        }
        fetchMock.mockRejectedValueOnce(new Error("timeout"));
        expect(await profileImageExists("u1", "avatar")).toBe(false);
    });

    it("CLOUDFRONT_URL が無ければ聞かずに「無い」", async () => {
        vi.stubEnv("CLOUDFRONT_URL", "");
        expect(await profileImageExists("u1", "avatar")).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
