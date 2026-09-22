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
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../lib/auth/cognito", () => {
    const getCurrentSession = mockGetCurrentSession;
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
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
// **hover でしか見えないボタンが、写真の上に乗っていた。**
//
// Tailwind の `hover:` は `@media (hover: hover)` 付きで出力されるので、
// タッチ端末では**タップしても現れない**。`z-10` で写真のリンクより上に
// あるため、セルの隅を触ると気づかないまま非公開になる／ピンが外れる。
// ポインタで指せる端末は今までどおり hover、そうでない端末では薄く見せる。
describe("オーナー専用ボタンの見え方", () => {
    it("タッチ端末では最初から見える（hover 頼みにしない）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME }) });
        mockUserFetch.mockImplementation((url: string) =>
            url === "/user/profile"
                ? Promise.resolve({ ok: true, json: async () => ({ userId: ME }) })
                : Promise.resolve({ ok: true, json: async () => [photo("p1")] }));

        render(<UserProfileClient userId={ME} />);
        const pin = (await screen.findAllByTitle("先頭にピン留め"))[0];

        // hover が無い端末向けの見た目を持っている（クラス名で固定する。
        // jsdom は @media (hover) を解決しないので、ここだけは名前で見る）
        expect(pin.className, "hover でしか見えないまま（タッチでは透明）")
            .toMatch(/\[@media\(hover:none\)\]:bg-black/);
        // `title` はタッチでは読めないので、読み上げ用の名前も要る
        expect(pin.getAttribute("aria-label"), "読み上げ用の名前が無い").toBe("先頭にピン留め");
    });
});

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

    // **一覧をピンに待たせない。** `Promise.all` で束ねていたので、星の
    // ためだけの取得が写真一覧の描画を人質に取っていた——その間はビルド時
    // JSON（全件 published:true）のままで、非公開バッジが出ない。この画面が
    // 何度も警告している「消えたと誤解して目のアイコンを押し、本当に
    // 再公開する」窓がそのぶん開く。
    it("プロフィールが返らなくても、自分の写真一覧は反映される", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME }) });
        mockUserFetch.mockImplementation((url: string) => {
            // 返らない（落ちるのではなく、ぶら下がる）
            if (url === "/user/profile") return new Promise(() => {});
            return Promise.resolve({
                ok: true,
                json: async () => [photo("p1"), { ...photo("p2"), published: false }],
            });
        });

        render(<UserProfileClient userId={ME} />);

        // 非公開バッジ＝認証済みの一覧が反映された証拠
        await waitFor(() => expect(
            screen.getAllByText("非公開").length,
            "ピンの取得を待って、一覧がビルド時のままになっている",
        ).toBeGreaterThan(0));
        // 2本とも投げている（片方を消す変異も捕まえる）。
        // **`/user/` のぶんだけを見る**——ログインしている人のマイページは
        // ハイライトの輪（`/highlights/<uid>`）も引くので、全件の突き合わせだと
        // この試験と関係のない取得で落ちる
        expect(mockUserFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/user/")).sort())
            .toEqual(["/user/photos", "/user/profile"]);
    });

    // 遅れて届くこの取得が運ぶのは「投げた時点の姿」。待っている間に星を
    // 押されると、押したあとの一覧を押す前の一覧で上書きしてしまう
    // （「先頭にピン留めしました ⭐」と出たそばから星が消える）。
    // PUT の応答に付けてある追い越しの仕組み（pinSeqRef）に乗せる。
    it("待っている間に留めたピンを、遅れて届いた取得で巻き戻さない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        let resolveProfile: ((v: unknown) => void) | null = null;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve(reply(true, 200, { pinnedPhotoIds: ["p1", "p2"] }));
            }
            if (url === "/user/profile") {
                return new Promise((res) => { resolveProfile = res; });
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));

        // ここで読み込み時の取得が「押す前の一覧」を持って着地する
        await act(async () => {
            resolveProfile!({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }) });
            await Promise.resolve();
        });

        await waitFor(() => expect(
            screen.getAllByTitle("ピン留め解除"),
            "留めたばかりのピンが巻き戻っている",
        ).toHaveLength(2));
    });

    // **捨てたら取り直す。** 追い越しの番号は保存の**入口**で進むので、
    // その保存が失敗して巻き戻ると、待っていた本人の行の取得は捨てられた
    // まま二度と当たらない——公開ぶん（非公開の ID を落とした部分集合）で
    // 固定され、まさに直したかった「星が無くて外せない」に戻る。
    it("保存に失敗しても、本人のピンを取り直す", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        // 公開プロフィールは p2（非公開）を落とす
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        let resolveFirstProfile: ((v: unknown) => void) | null = null;
        let profileCalls = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.resolve(reply(false, 500, {}));   // 保存が落ちる
            if (url === "/user/profile") {
                profileCalls += 1;
                // 1本目は保留（星を押すまで返さない）。2本目＝取り直し
                if (profileCalls === 1) return new Promise((res) => { resolveFirstProfile = res; });
                return Promise.resolve({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1", "p2"] }) });
            }
            return Promise.resolve({
                ok: true,
                json: async () => [photo("p1"), { ...photo("p2"), published: false }],
            });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        // 待っている間に別の写真を留めようとして、失敗する
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));

        // 1本目が遅れて着地しても、番号が進んでいるので捨てられる
        await act(async () => {
            resolveFirstProfile!({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1", "p2"] }) });
            await Promise.resolve();
        });

        // 取り直しで、非公開の p2 のぶんも星が付く
        await waitFor(() => expect(
            screen.getAllByTitle("ピン留め解除"),
            "捨てたまま取り直していない（非公開のピンが外せない）",
        ).toHaveLength(2));
    });

    /**
     * **2本続けて失敗すると、サーバーに無い星が残っていた。**
     *
     * 巻き戻しは最後の1本しかしない（追い越された分は何もしない）ので、
     * 後始末の担い手は取り直しだけ。ところが取り直しは「キーが無ければ
     * 触らない」——保存側は0枚になると項目ごと落とすので、**0枚の人だけ
     * 誰も後始末しない**。画面には見込みの星が残り、訪問者には見えない。
     */
    it("2本とも失敗したら、見込みで付けた星は残さない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        // サーバーは0枚（項目ごと無い）
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME }) });
        let failFirst: (() => void) | null = null;
        let putCount = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                putCount += 1;
                if (putCount === 1) return new Promise((res) => { failFirst = () => res(reply(false, 500, {})); });
                return Promise.resolve(reply(false, 500, {}));
            }
            if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({ userId: ME }) });
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p1（保留）
        await waitFor(() => expect(putCount).toBe(1));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p2（即失敗）
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));

        await act(async () => { failFirst!(); await new Promise((r) => setTimeout(r, 20)); });

        await waitFor(() => expect(
            screen.queryAllByTitle("ピン留め解除"),
            "サーバーに無い星が残っている",
        ).toHaveLength(0));
    });

    // 逆向き: 壊れた 200（profile の形をしていない）で星を消さない
    it("profile の形をしていない応答では、星を触らない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.resolve(reply(false, 500, {}));
            // userId が無い＝プロフィールではない（プロキシのエラーページ等）
            if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({ message: "ng" }) });
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p2 を留めようとして失敗
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

        // 元から留まっていた p1 は残る（巻き戻しぶんだけ戻る）
        expect(screen.getAllByTitle("ピン留め解除"), "壊れた応答で星を消している").toHaveLength(1);
    });

    /**
     * 追い越された保存の失敗から取り直すと、**成功した保存を消す**。
     *
     * 取り直しが持ってくるのは「その GET を投げた時点の写し」なので、
     * あとから成功した保存より古い。捕捉する番号は呼び出し時点＝最新なので
     * 捨てられもしない。`isLatest()` が塞いでいるのはこの筋
     * （22f1ff0 で入れたが、テストが無かった）。
     *
     * `mode` で 4xx/5xx と通信断（catch）の両方を見る——同じ形のガードが
     * 2か所にあり、片方だけ外しても気づけない状態だった。
     */
    it.each([
        ["4xx/5xx で断られた", "reject-500"],
        ["通信そのものが落ちた", "throw"],
    ])("追い越された保存の失敗が、成功した保存の星を消さない（%s）", async (_label, mode) => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        // サーバーの保存ぶんは p1。公開ぶんも同じ
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        let failFirst: (() => void) | null = null;
        let putCount = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                putCount += 1;
                // 1本目（p2）は保留。あとで落とす
                if (putCount === 1) {
                    return new Promise((res, rej) => {
                        failFirst = () => (mode === "throw" ? rej(new TypeError("Failed to fetch")) : res(reply(false, 500, {})));
                    });
                }
                return Promise.resolve(reply(true, 200, { pinnedPhotoIds: ["p1", "p3"] }));
            }
            if (url === "/user/profile") {
                // 取り直しが走ったら、p3 を書く**前**の写しを返す
                return Promise.resolve({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }) });
            }
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2"), photo("p3")] });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p2（保留）
        await waitFor(() => expect(putCount).toBe(1));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p3（成功）
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(2));

        await act(async () => { failFirst!(); await new Promise((r) => setTimeout(r, 20)); });

        expect(screen.getAllByTitle("ピン留め解除"),
            "追い越された失敗の後始末が、成功した星を消している").toHaveLength(2);
    });

    // 通信断（catch）側にも取り直しがある（80fe2fa）。4xx/5xx 側だけを
    // 見ていると、こちらを消しても気づけない
    it("通信が落ちた保存のあとも、本人のピンを取り直す", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        let resolveFirstProfile: ((v: unknown) => void) | null = null;
        let profileCalls = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") return Promise.reject(new TypeError("Failed to fetch"));
            if (url === "/user/profile") {
                profileCalls += 1;
                if (profileCalls === 1) return new Promise((res) => { resolveFirstProfile = res; });
                return Promise.resolve({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1", "p2"] }) });
            }
            return Promise.resolve({
                ok: true,
                json: async () => [photo("p1"), { ...photo("p2"), published: false }],
            });
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));
        await act(async () => {
            resolveFirstProfile!({ ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1", "p2"] }) });
            await Promise.resolve();
        });

        await waitFor(() => expect(
            screen.getAllByTitle("ピン留め解除"),
            "通信断のあと取り直していない（非公開のピンが外せない）",
        ).toHaveLength(2));
    });

    // 1枚も留めていない人の行には pinnedPhotoIds が無い。キーが無ければ
    // 触らない（触ると、公開APIが返したピンを消してしまう）
    it("自分の行にピンのキーが無ければ、公開ぶんを消さない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({
            ok: true, json: async () => ({ userId: ME, pinnedPhotoIds: ["p1"] }),
        });
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({ userId: ME }) });
            return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
        });

        render(<UserProfileClient userId={ME} />);

        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));
        // 少し待っても消えない（取得は済んでいる）
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(screen.getAllByTitle("ピン留め解除"), "キーが無いのにピンを消している").toHaveLength(1);
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
    // 失敗の後始末（巻き戻し・取り直し）も追い越しを見る。どちらも
    // 「この保存を投げる前の姿」に戻す操作なので、追い越された分がやると
    // **あとから押した星を消す**。
    it("追い越された保存が失敗しても、あとから押した星を消さない", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME }) });

        let failFirst: (() => void) | null = null;
        let putCount = 0;
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method !== "PUT") {
                if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({ userId: ME }) });
                return Promise.resolve({ ok: true, json: async () => [photo("p1"), photo("p2")] });
            }
            putCount += 1;
            // 1本目（p1）は保留したうえで、あとから 500 で落とす
            if (putCount === 1) return new Promise((res) => { failFirst = () => res(reply(false, 500, {})); });
            return Promise.resolve(reply(true, 200, { pinnedPhotoIds: ["p2"] }));
        });

        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(screen.getAllByTitle(/ピン留め/).length).toBeGreaterThan(0));

        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p1（保留）
        await waitFor(() => expect(putCount).toBe(1));
        fireEvent.click(screen.getAllByTitle("先頭にピン留め")[0]);   // p2（成功して着地）
        await waitFor(() => expect(screen.getAllByTitle("ピン留め解除")).toHaveLength(1));

        await act(async () => { failFirst!(); await Promise.resolve(); });

        // p2 の星は残る（p1 の失敗は自分の分だけ諦める）
        await waitFor(() => expect(
            screen.getAllByTitle("ピン留め解除"),
            "追い越された失敗が、あとから押した星を消している",
        ).toHaveLength(1));
    });

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
