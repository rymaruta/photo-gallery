import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ピン留めは「配列まるごと」を PUT していた。この画面はプロフィールを
// 開いたときに1回読むだけなので、PC のタブを開いたままスマホでピン留めすると、
// 次に PC でピン留めしたときスマホの分が消える（サーバーは新しい rev を
// 普通に書けるため、rev では検出できない）。増減で送る。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/auth/cognito", () => ({ getCurrentSession: mockGetCurrentSession }));
vi.mock("../../../lib/utils/api", async (importActual) => {
    const actual = await importActual<typeof import("../../../lib/utils/api")>();
    return {
        // 実物を土台にする。列挙だけだと、実装が新しく使い始めた export を
        // 読んだ瞬間に vitest が投げ、呼び出し側の catch に飲まれて
        // **緑のまま間違ったことを測るテスト**になる。
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import UserProfileClient from "../UserProfileClient";

const ME = "11111111-1111-4111-8111-111111111111";
const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub } }) });
const photo = (id: string) => ({
    id, src: `https://cdn/x/${id}.jpg`, userId: ME, published: true,
    title: id, createdAt: "2026-08-01T00:00:00Z",
});

/** PUT /user/profile の body */
function putBodies(): Record<string, unknown>[] {
    return mockUserFetch.mock.calls
        .filter((c) => c[1]?.method === "PUT")
        .map((c) => JSON.parse(c[1].body as string) as Record<string, unknown>);
}

/** オーナーとして開き、写真2枚が出るまで待つ */
async function openAsOwner(profile: Record<string, unknown>) {
    mockGetCurrentSession.mockResolvedValue(session(ME));
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => profile });
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "PUT") {
            return Promise.resolve(reply(true, 200, { ...profile, pinnedPhotoIds: ["p9", "p1"] }));
        }
        return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
    });
    render(<UserProfileClient userId={ME} />);
    await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
}

beforeEach(() => {
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset();
    mockShowToast.mockReset();
});

/** json() と clone() を持つ最小の応答 */
const reply = (ok: boolean, status: number, data: unknown) => {
    const r = {
        ok, status,
        json: async () => data,
        clone: () => reply(ok, status, data),
    };
    return r;
};

describe("ピン留めの送り方", () => {
    it("配列ではなく「どの1枚をどうするか」を送る", async () => {
        // 手元のプロフィールは p9 を知らない（開いた時点では空だった）
        await openAsOwner({ userId: ME, displayName: "旅人" });
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        const body = putBodies()[0];
        expect(body).toEqual({ pinPhotoId: "p1", pin: true });
        // 配列を送っていない（送ると、知らない p9 を消してしまう）
        expect(body).not.toHaveProperty("pinnedPhotoIds");
    });

    it("解除も1枚単位で送る", async () => {
        await openAsOwner({ userId: ME, displayName: "旅人", pinnedPhotoIds: ["p1"] });
        fireEvent.click(screen.getAllByTitle("ピン留め解除")[0]);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0]).toEqual({ pinPhotoId: "p1", pin: false });
    });

    it("保存後はサーバーが返した一覧に揃える（他の端末の分を取り込む）", async () => {
        // 手元は「1枚もピン留めしていない」と思っている。
        // 実際は別の端末が p2 をピン留め済みで、サーバーは2枚を返す。
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve(reply(true, 200, { userId: ME, pinnedPhotoIds: ["p2", "p1"] }));
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        expect(screen.queryAllByTitle("ピン留め解除")).toHaveLength(0);

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        // 見込みでは1枚だが、サーバーの返り値を取り込んで2枚になる。
        // 取り込まないと、次にもう1枚押したとき手元は「まだ1枚」のつもりで
        // 上限（3枚）の案内も出せず、サーバーの実態とずれ続ける。
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));
    });

    it("サーバーが断った理由をそのまま出す（「保存に失敗しました」で潰さない）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve(reply(false, 409, { error: "ピン留めは3枚までです" }));
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("ピン留めは3枚までです", "error"));
        // 見込みで付けた星は戻す
        await waitFor(() => expect(screen.queryAllByTitle("ピン留め解除")).toHaveLength(0));
    });

    // 手元が「3枚」と思い込んでいると、以前は**要求すら投げずに**断っていた。
    // 別の端末で解除したあとのタブは、投げないので実態を知る機会が来ない
    // ——リロードするまで正当な操作が黙って塞がれる。
    it("手元が3枚でも投げる（上限の判定はサーバー）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ userId: ME, displayName: "旅人", pinnedPhotoIds: ["x1", "x2", "x3"] }),
        });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.resolve(reply(true, 200, { pinnedPhotoIds: ["x1", "p1"] }));
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0]).toEqual({ pinPhotoId: "p1", pin: true });
    });

    // 断られた回こそ同期する。上限の 409 は今の一覧を添えてくるので、
    // 取り込まないと「星が1つも無いのに3枚までと言われる」まま直らない。
    it("409 に添えられた一覧を取り込む", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve(reply(false, 409, {
                    error: "ピン留めは3枚までです",
                    pinnedPhotoIds: ["p1", "p2", "x3"],
                }));
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        expect(screen.queryAllByTitle("ピン留め解除")).toHaveLength(0);

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("ピン留めは3枚までです", "error"));
        // 巻き戻しで終わらず、サーバーの一覧に揃う（p1・p2 が星）
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));
    });
});

// **本人には、本人が留めたぶんを全部見せる。**
//
// 公開プロフィール（getPublicProfile）は「今は見えない写真」の ID を
// 落として返すようになった（他人に隠した写真の ID を渡さないため）。
// ところがこの画面はオーナーも同じ公開APIを読んでいたので、非公開に
// した写真の星が消える一方、サーバーの枠（上限3）は埋まったまま——
// 4枚目を留めようとすると 409「ピン留めは3枚までです」が出続け、
// 解除ボタンは星の付いた写真にしか無いので画面から直せない。
describe("オーナーが見るピン留め", () => {
    it("非公開にした写真のピンも星が付く（公開ぶんで上書きしない）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        // 公開プロフィールは p2（非公開）を落として返す
        mockUserPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ userId: ME, displayName: "旅人", pinnedPhotoIds: ["p1"] }),
        });
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/profile") {
                // 保存されている本当のピン（非公開の p2 を含む）
                return Promise.resolve({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1", "p2"] }) });
            }
            return Promise.resolve({
                ok: true,
                json: async () => [photo("p1"), { ...photo("p2"), published: false }],
            });
        });

        render(<UserProfileClient userId={ME} />);

        await waitFor(() => expect(
            screen.getAllByTitle("ピン留め解除"),
            "非公開にしたピンの星が消えている（外す手段が無くなる）",
        ).toHaveLength(2));
    });

    // 1枚も留めていない人の行には pinnedPhotoIds が無い。公開ぶんは必ず
    // 保存ぶんの部分集合なので、キーが無ければ触らないのが正しい
    // （触ると、公開APIが返したピンを消してしまう）。
    it("自分の行が読めなくても、公開ぶんのピンは残す", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ userId: ME, displayName: "旅人", pinnedPhotoIds: ["p1"] }),
        });
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/profile") return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });

        render(<UserProfileClient userId={ME} />);

        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        expect(screen.getAllByTitle("ピン留め解除"), "読めなかっただけでピンを消している").toHaveLength(1);
    });

    // 写真一覧の取得は、プロフィールの取得を待って直列にしない
    it("自分の写真一覧は、ピンの取得と並べて投げる", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME }) });
        let profileResolved = false;
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/profile") {
                return new Promise((res) => setTimeout(() => {
                    profileResolved = true;
                    res({ ok: true, json: async () => ({ userId: ME }) });
                }, 30));
            }
            expect(profileResolved, "プロフィールを待ってから写真を取りに行っている").toBe(false);
            return Promise.resolve({ ok: true, json: async () => [photo("p1")] });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
    });
});

// 別のタブでログアウトした・セッションが切れた人は、userFetch が
// トークン不在で投げる。「保存に失敗しました」だと何をすればいいか
// 分からないまま押し直すことになる。
describe("トークンが無いとき", () => {
    it("「ログインしてください」を出す（通信の失敗と混ぜない）", async () => {
        const { AUTH_REQUIRED_MESSAGE } = await import("../../../lib/utils/api");
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.reject(new Error(AUTH_REQUIRED_MESSAGE));
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(AUTH_REQUIRED_MESSAGE, "error"));
    });

    it("通信そのものが落ちた場合は従来の文言のまま", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.reject(new TypeError("Failed to fetch"));
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));
    });
});

// ピン留めは連打できる。サーバーは「その要求が書いた時点の姿」を返すので、
// 追い越して届いた古い応答をそのまま取り込むと、**サーバーには2枚あるのに
// 画面は1枚**になり、リロードするまで直らない。
describe("応答の追い越し", () => {
    it("後から届いた古い応答で、新しい一覧を上書きしない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });

        let resolveFirst: (() => void) | null = null;
        let putCount = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method !== "PUT") {
                return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
            }
            putCount += 1;
            if (putCount === 1) {
                // 1本目（p1）は保留。あとで手動に返す
                return new Promise((res) => {
                    resolveFirst = () => res(reply(true, 200, { pinnedPhotoIds: ["p1"] }));
                });
            }
            return Promise.resolve(reply(true, 200, { pinnedPhotoIds: ["p1", "p2"] }));
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p1（応答は保留）
        await waitFor(() => expect(putCount).toBe(1));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p2（先に返る）
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));

        // ここで1本目が遅れて届く。中身は ["p1"]（1枚）
        await act(async () => { resolveFirst!(); await Promise.resolve(); });

        // 2枚のまま。追い越された応答は捨てる
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));
    });
});
