import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **「非公開にしました」と出るのに、検索から開ける個別ページは残っている。**
// 静的HTML（/photo/<id>）はサイトを作り直すまで消えない。サーバーは削除の
// たびに再ビルドを頼むが、頼めないことがある（本番は今まさにトークン未設定）。
// 頼めなかったときは応答に `staticStale` が乗るので、そのまま伝える。

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
const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data, clone: () => reply(data) });

/** オーナーとして開き、写真のトグルを押す */
async function toggleFirstPhoto(published: boolean, putResponse: unknown) {
    mockGetCurrentSession.mockResolvedValue(session(ME));
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "私" }) });
    mockUserFetch.mockImplementation((_url: string, init?: { method?: string }) =>
        init?.method === "PUT"
            ? Promise.resolve(reply(putResponse))
            : Promise.resolve({ ok: true, json: async () => [{ ...photo("p1"), published }] }));
    render(<UserProfileClient userId={ME} />);
    const btn = await screen.findByTitle(published ? "非公開にする" : "公開する");
    fireEvent.click(btn);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const put = mockUserFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    return {
        toast: String(mockShowToast.mock.calls[0][0]),
        sent: put ? JSON.parse(put[1].body as string) as { published?: boolean } : null,
    };
}

beforeEach(() => {
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset();
    mockShowToast.mockReset();
});

// **押した向きと逆を送っていた。** 公開中の写真の「非公開にする」を押すと
// `published: true`（＝そのまま公開）が飛び、画面は「公開しました」と出る。
// 非公開の写真の「公開する」を押すと `published: false` が飛ぶ。
// つまり**この画面からは公開も非公開もできない**（押すたびに今の状態を
// 送り直すだけ）。写真ページと編集画面には別経路があるので気づきにくい
describe("プロフィールの公開トグル", () => {
    it("公開中の写真の「非公開にする」で、非公開を送る", async () => {
        const { sent, toast } = await toggleFirstPhoto(true, { success: true });
        expect(sent, "押した向きと逆を送っている").toEqual({ published: false });
        expect(toast).toBe("写真を非公開にしました");
    });

    it("非公開の写真の「公開する」で、公開を送る", async () => {
        const { sent, toast } = await toggleFirstPhoto(false, { success: true });
        expect(sent).toEqual({ published: true });
        expect(toast).toBe("写真を公開しました");
    });

    // **押した結果が画面に出るのは、向きが直った今回が初めて。** 送る中身と
    // 文言だけ見ていると、画面に書き戻す向き（`setPhotos`）が逆でも気づけない
    it("押した結果が画面に出る（ボタンが裏返り、非公開の件数が増える）", async () => {
        await toggleFirstPhoto(true, { success: true });
        expect(await screen.findByTitle("公開する"), "非公開にしたのにボタンが変わらない").toBeInTheDocument();
        expect(screen.queryByTitle("非公開にする")).toBeNull();
        expect(screen.getByText(/うち非公開\s*1/)).toBeInTheDocument();
    });

    // 効くようになった今は、連打で「画面は公開・サーバーは非公開」を作れる
    it("同じ写真の切り替えは重ねない（応答の入れ替わりで画面がずれる）", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "私" }) });
        // TS は「代入は fireEvent の中でしか起きない」と読めないので明示する
        let release: (() => void) | undefined;
        mockUserFetch.mockImplementation((_url: string, init?: { method?: string }) =>
            init?.method === "PUT"
                ? new Promise<unknown>((resolve) => { release = () => resolve(reply({ success: true })); })
                : Promise.resolve({ ok: true, json: async () => [photo("p1")] }));
        render(<UserProfileClient userId={ME} />);
        const btn = await screen.findByTitle("非公開にする");
        fireEvent.click(btn);
        fireEvent.click(btn);
        fireEvent.click(btn);
        const puts = () => mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
        await waitFor(() => expect(puts().length).toBeGreaterThan(0));
        expect(puts(), "応答を待たずに重ねて投げている").toHaveLength(1);
        // 決着したら、また押せる
        release?.();
        await waitFor(() => expect(screen.getByTitle("公開する")).toBeInTheDocument());
        fireEvent.click(screen.getByTitle("公開する"));
        await waitFor(() => expect(puts()).toHaveLength(2));
    });
});

describe("プロフィールから非公開にしたとき", () => {
    it("静的ページが残るなら、そう伝える", async () => {
        const { toast } = await toggleFirstPhoto(true, { success: true, staticStale: true });
        expect(toast).toContain("写真を非公開にしました");
        expect(toast, "隠せていないのに「隠した」だけを出している").toContain("残ることがあります");
    });

    it("掃除が頼めていれば、余計なことは言わない", async () => {
        const { toast } = await toggleFirstPhoto(true, { success: true });
        expect(toast).toBe("写真を非公開にしました");
    });
});
