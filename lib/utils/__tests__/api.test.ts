import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Cognito セッションは使わないが、import 時に評価されるためモックしておく
vi.mock("../../auth/cognito", () => ({ getCurrentSession: async () => null }));

const { publicFetch, userPublicFetch } = await import("../api");

const ADMIN_API = process.env.NEXT_PUBLIC_API_BASE_URL;
const USER_API = process.env.NEXT_PUBLIC_USER_API_BASE_URL;

describe("publicFetch / userPublicFetch の宛先", () => {
    let calls: string[];

    beforeEach(() => {
        calls = [];
        vi.stubGlobal("fetch", vi.fn((url: string) => {
            calls.push(url);
            return Promise.resolve(new Response("{}"));
        }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    // いいね・コメント・フォローの各エンドポイントはユーザーAPIにしか無い。
    // 管理APIへ投げると 404 になり、失敗は握り潰されて「常に0件」になる回帰を防ぐ。
    it("userPublicFetch はユーザーAPIを向く", async () => {
        await userPublicFetch("/photos/abc/like");
        expect(calls[0].endsWith("/photos/abc/like")).toBe(true);
        if (USER_API) expect(calls[0].startsWith(USER_API)).toBe(true);
    });

    it("publicFetch と userPublicFetch の宛先は別（設定されている場合）", async () => {
        await publicFetch("/photos");
        await userPublicFetch("/photos");
        if (ADMIN_API && USER_API && ADMIN_API !== USER_API) {
            expect(calls[0]).not.toBe(calls[1]);
        }
    });

    it("先頭スラッシュが無くても正しく連結する", async () => {
        await userPublicFetch("users/search?q=a");
        expect(calls[0]).toContain("/users/search?q=a");
        expect(calls[0]).not.toContain("comusers");
    });
});
