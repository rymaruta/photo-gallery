import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **`/profile/<id>` の応答は形を一切見ていなかった。**
//
// `as UserProfile` は「そう主張しているだけ」で、実行時には何も確かめない。
// 中身は描画の途中で読むので、`bio` がオブジェクトだと React が
// 「Objects are not valid as a React child」で投げ、`ErrorBoundary` の
// カードが**ヘッダーごと画面を覆う**（写真一覧も、他人のプロフィールも
// 出なくなる）。本文が `null` の 200 は `loadError` すら立たず、
// 「未設定の人」と見分けが付かない。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
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
const ErrorBoundary = (await import("../../components/ErrorBoundary")).default;

const ME = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset();
    mockGetCurrentSession.mockReset().mockResolvedValue(null);
});

function profileResponse(body: unknown) {
    mockUserPublicFetch.mockResolvedValue({ ok: true, json: async () => body });
}

describe("プロフィールの応答の形が想定と違うとき", () => {
    it("文字列のはずの項目がオブジェクトでも、ページごと落ちない", async () => {
        profileResponse({ userId: ME, displayName: "旅人", bio: { ja: "こんにちは" } });
        render(<ErrorBoundary><UserProfileClient userId={ME} /></ErrorBoundary>);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 30));

        expect(screen.queryByText(/予期しないエラー/), "ページ全体が落ちている").toBeNull();
        // 読める項目は今までどおり出す（1項目の巻き添えで全部を失わない）
        expect(await screen.findByText("旅人")).toBeInTheDocument();
    });

    it("配列のはずの項目が配列でなくても、ページごと落ちない", async () => {
        profileResponse({ userId: ME, displayName: "旅人", pinnedPhotoIds: { a: 1 }, songs: "配列でない" });
        render(<ErrorBoundary><UserProfileClient userId={ME} /></ErrorBoundary>);
        await waitFor(() => expect(mockUserPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 30));

        expect(screen.queryByText(/予期しないエラー/), "ページ全体が落ちている").toBeNull();
        expect(await screen.findByText("旅人")).toBeInTheDocument();
    });

    it.each([
        ["本文が null", null],
        ["本文が配列", [{ userId: ME }]],
        ["本文が文字列", "ok"],
    ])("%s の 200 は「未設定の人」ではなく失敗として伝える", async (_name, body) => {
        profileResponse(body);
        render(<ErrorBoundary><UserProfileClient userId={ME} /></ErrorBoundary>);

        expect(await screen.findByText(/プロフィールを読み込めませんでした/)).toBeInTheDocument();
    });

    // 正常系: 形の合った応答はこれまでどおり
    it("形の合った応答はそのまま出る", async () => {
        profileResponse({ userId: ME, displayName: "旅人", bio: "こんにちは" });
        render(<ErrorBoundary><UserProfileClient userId={ME} /></ErrorBoundary>);

        expect(await screen.findByText("旅人")).toBeInTheDocument();
        expect(await screen.findByText("こんにちは")).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });
});
