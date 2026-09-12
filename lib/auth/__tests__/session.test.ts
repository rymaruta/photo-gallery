import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * **端末に痕跡が無ければ、認証 SDK を読み込まない。**
 *
 * 実測（`npx next build` の出力を gzip して数えた）:
 *
 *     写真ページが読む JS   828KB → gzip 257KB   （変更前）
 *                           688KB → gzip 215KB   （変更後）
 *     認証 SDK は 142ページ中 **2ページ**（/login と /signup）だけになった
 *
 * ここで守るのは2つ:
 *   1. 痕跡が無いときに `./cognito` を**読み込まない**（読み込んだら効果が消える）
 *   2. 痕跡があるとき・分からないときは**本物に判断させる**
 *      （間違えるとログインしている人を未ログインとして扱う＝いちばん悪い壊れ方）
 */
const mockLookup = vi.hoisted(() => vi.fn(async () => ({ session: { id: "s" }, unreachable: false })));
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock("../cognito", () => {
    loaded.count++;
    return { lookupSession: mockLookup };
});
const config = vi.hoisted(() => ({ clientId: "testclientid" }));
vi.mock("../config", () => ({ cognitoConfig: config }));

const KEY = "CognitoIdentityServiceProvider.testclientid.LastAuthUser";

beforeEach(() => {
    localStorage.clear();
    loaded.count = 0;
    mockLookup.mockClear();
    config.clientId = "testclientid";
});

describe("lib/auth/session（薄い入口）", () => {
    it("痕跡が無ければ SDK を読み込まずに「ログインしていない」を返す", async () => {
        const { lookupSession } = await import("../session");
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
        expect(mockLookup, "SDK を呼んでいる（全ページに載る）").not.toHaveBeenCalled();
        expect(loaded.count, "SDK のモジュールを読み込んでいる").toBe(0);
    });

    it("痕跡があれば本物に引かせる", async () => {
        localStorage.setItem(KEY, "u1");
        const { lookupSession } = await import("../session");
        expect(await lookupSession()).toEqual({ session: { id: "s" }, unreachable: false });
        expect(mockLookup).toHaveBeenCalledTimes(1);
    });

    // **「確かめられなかった」を勝手に「ログインしていない」にしない。**
    // ここを潰すと、圏外で編集中の人を `/login` へ追い出す（`b366ddff` が
    // 苦労して分けたもの）
    it("圏外の答えはそのまま通す", async () => {
        localStorage.setItem(KEY, "u1");
        mockLookup.mockResolvedValueOnce({ session: null, unreachable: true } as never);
        const { lookupSession } = await import("../session");
        expect(await lookupSession()).toEqual({ session: null, unreachable: true });
    });

    // **迷ったら読み込む側に倒す。** プライベートモードや容量超過で
    // `localStorage` が投げる端末で「無い」と決めると、ログインしている人を
    // 未ログインとして扱うことになる
    it("localStorage が読めない端末では、本物に判断させる", async () => {
        const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
        try {
            const { lookupSession } = await import("../session");
            await lookupSession();
            expect(mockLookup, "読めないだけで未ログインにしている").toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
    });

    it("設定（clientId）が無ければ、本物に判断させる", async () => {
        config.clientId = "";
        const { lookupSession } = await import("../session");
        await lookupSession();
        expect(mockLookup).toHaveBeenCalledTimes(1);
    });

    // **鍵の綴りは SDK が決めている。** ずれると常に短絡＝全員ログアウト
    it("見る鍵は clientId ごとに違う（別の clientId の痕跡では短絡しない…はしない）", async () => {
        localStorage.setItem("CognitoIdentityServiceProvider.other.LastAuthUser", "u1");
        const { lookupSession } = await import("../session");
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
        expect(mockLookup, "別の clientId の痕跡で本物を呼んでいる").not.toHaveBeenCalled();
    });

    it("getCurrentSession は理由を捨てた同じ答え", async () => {
        const { getCurrentSession } = await import("../session");
        expect(await getCurrentSession()).toBeNull();
        localStorage.setItem(KEY, "u1");
        expect(await getCurrentSession()).toEqual({ id: "s" });
    });
});
