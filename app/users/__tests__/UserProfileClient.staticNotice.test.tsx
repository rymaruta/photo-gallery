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
