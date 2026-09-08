import { describe, it, expect, vi } from "vitest";

// **この文字列が、6か所の見分けの土台になっている。**
// `userFetch` / `authenticatedFetch` はトークンが取れないと
// `AUTH_REQUIRED_MESSAGE` を投げ、呼び出し側は `e.message === 定数` で
// 「押し直しても直らない失敗」を見分けて文言を書き分ける
// （`useFollow` / `useComments` / `/user/edit` / `/user/profile` /
//  `UserProfileClient` / `PhotoPageClient`）。
//
// **投げる側を確かめるテストが1本も無かった。** 全部が
// `new Error(AUTH_REQUIRED_MESSAGE)` を自分で注入していたので、
// **投げる文言を別のものに変えてもフルスイート 3,340件が緑**だった
// （＝本番では見分けが全部外れ、「保存に失敗しました」に戻る）。

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/cognito", () => ({
    getCurrentSession: async () => session.current,
    lookupSession: async () => ({ session: session.current, unreachable: false }),
}));

const { userFetch, authenticatedFetch, AUTH_REQUIRED_MESSAGE } = await import("../api");

const thrown = async (f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { return e; }
    throw new Error("投げなかった");
};

describe("トークンが取れないときに投げる文言", () => {
    it.each([
        ["userFetch", () => userFetch("/x", { method: "POST" })],
        ["authenticatedFetch", () => authenticatedFetch("/x", { method: "POST" })],
    ])("%s は AUTH_REQUIRED_MESSAGE ちょうどを投げる", async (_name, call) => {
        session.current = null;
        const e = await thrown(call);
        // **`toBe` で見る。** `toContain` だと、前後に何か足した文言でも通り、
        // 呼び出し側の `===` は外れる（見分けだけが静かに死ぬ）
        expect((e as Error).message).toBe(AUTH_REQUIRED_MESSAGE);
    });

    it("セッションはあるが ID トークンが無い場合も同じ文言", async () => {
        session.current = { getIdToken: () => ({ getJwtToken: () => "" }) };
        const e = await thrown(() => userFetch("/x", { method: "POST" }));
        expect((e as Error).message).toBe(AUTH_REQUIRED_MESSAGE);
    });

    // 正常系: トークンがあれば、この門で止めずに通信まで進む
    // （応答の包み方はここの関心ではないので、`fetch` に届いたことで見る）
    it("トークンがあれば止めずに通信へ進む", async () => {
        session.current = { getIdToken: () => ({ getJwtToken: () => "jwt" }) };
        const f = vi.fn(async () => { throw new Error("ここまで来れば十分"); });
        vi.stubGlobal("fetch", f);
        const e = await thrown(() => userFetch("/x", { method: "POST" }));
        expect((e as Error).message, "トークンがあるのに門で止めている").not.toBe(AUTH_REQUIRED_MESSAGE);
        expect(f, "通信に進んでいない").toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
