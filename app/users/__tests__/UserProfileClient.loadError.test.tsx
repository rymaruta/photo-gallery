import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// プロフィールの取得失敗が無言だった（SW-b9）。名前・自己紹介・BGM・
// ピン留めが黙って出ないので「未設定の人」に見える。オーナーの一覧取得が
// 失敗したときは公開一覧で代用していて、非公開・下書きが消えたように見え、
// 「消えた」と誤解した本人が目のアイコンを押し直して**本当に再公開する**
// 誘導になっていた。失敗は失敗と伝える。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../lib/auth/cognito", () => ({ getCurrentSession: mockGetCurrentSession }));
vi.mock("../../../lib/utils/api", () => ({
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import UserProfileClient from "../UserProfileClient";

const ME = "11111111-1111-4111-8111-111111111111";
const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub } }) });

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

describe("プロフィールの取得失敗", () => {
    it("失敗を伝え、再読み込みで立て直す", async () => {
        // 失敗の間はすべて失敗にする（effect は再マウント等で複数回走りうるので
        // Once で組むと、2回目の成功が1回目の失敗表示を消してしまう）
        mockUserPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        render(<UserProfileClient userId={ME} />);
        expect(await screen.findByText(/プロフィールを読み込めませんでした/)).toBeInTheDocument();

        mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ userId: ME, displayName: "旅人" }) });
        fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
        await waitFor(() => expect(screen.queryByText(/読み込めませんでした/)).toBeNull());
    });

    it("成功時は何も出さない", async () => {
        render(<UserProfileClient userId={ME} />);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });
});

describe("オーナーの写真一覧の取得失敗", () => {
    it("公開一覧で代用せず、下書き・非公開が出ていないことを伝える", async () => {
        mockGetCurrentSession.mockResolvedValue(session(ME));
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

        render(<UserProfileClient userId={ME} />);
        expect(await screen.findByText(/自分の写真一覧を読み込めませんでした/)).toBeInTheDocument();
        // 代用のために公開一覧を取りに行かない（非公開が消えたように見せない）
        expect(mockPublicFetch).not.toHaveBeenCalled();
    });
});
