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

// 認証切れの表示。API Gateway の JWT オーソライザは期限切れトークンに
// {"message":"Unauthorized"} を返し、以前はその英語が生でトーストに出ていた。
// 自前の API が返す日本語の error はそのまま通す。
describe("readApiError: 401 の英語定型を置き換える", () => {
    const res = (status: number, body: unknown) => ({
        status,
        json: async () => body,
    }) as unknown as Response;
    const nonJson = (status: number) => ({
        status,
        json: async () => { throw new Error("not json"); },
    }) as unknown as Response;

    it('401 の {"message":"Unauthorized"} は再ログインの文言になる', async () => {
        const { readApiError, SESSION_EXPIRED_MESSAGE } = await import("../api");
        expect(await readApiError(res(401, { message: "Unauthorized" }), "fallback"))
            .toBe(SESSION_EXPIRED_MESSAGE);
    });

    it("401 でも自前の日本語 error はそのまま通す", async () => {
        const { readApiError } = await import("../api");
        expect(await readApiError(res(401, { error: "認証が必要です" }), "fallback"))
            .toBe("認証が必要です");
    });

    it("401 で本文が JSON でなくても再ログインの文言になる", async () => {
        const { readApiError, SESSION_EXPIRED_MESSAGE } = await import("../api");
        expect(await readApiError(nonJson(401), "fallback")).toBe(SESSION_EXPIRED_MESSAGE);
    });

    it("401 以外は今までどおり（error 優先・無ければ既定文）", async () => {
        const { readApiError } = await import("../api");
        expect(await readApiError(res(400, { error: "不正なYouTube URLです" }), "fb"))
            .toBe("不正なYouTube URLです");
        expect(await readApiError(res(500, {}), "保存できませんでした"))
            .toBe("保存できませんでした");
        expect(await readApiError(nonJson(503), "fb")).toBe("fb");
    });
});
