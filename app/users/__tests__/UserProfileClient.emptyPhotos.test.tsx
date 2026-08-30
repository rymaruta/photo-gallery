import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **全部非公開にしたのに、訪問者にはビルド時の写真が出続けていた。**
//
// `GET /photos?userId=` は**公開ぶんだけ**を返すので、その人が全部
// 非公開にした／全部消したときの**正解は空**。ところがクライアントは
// それを「怪しい空応答」として捨て（`if (fresh.length > 0)`）、
// ビルド時のスナップショットを描き続けていた。訪問者には画像・
// タイトル・`/photo/<id>` へのリンクがそのまま見える。
//
// 一方で「取得に失敗したときに写真が消えて見える」のは避けたい。
// そこは `photosRes.ok` が false ならこの分岐に来ないので分けられる
// ——潰すのは「聞けて、答えが空だった」ときだけ。

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

// ビルド時のスナップショット（この人の写真が1枚載っている状態）。
// `vi.mock` の工場は巻き上げられるので、外の定数を参照しない
const OWNER = "22222222-2222-4222-8222-222222222222";
vi.mock("../../data/photos.json", () => ({
    default: [{
        id: "stale-1", userId: "22222222-2222-4222-8222-222222222222",
        src: "https://cdn.example.com/uploads/a.jpg",
        title: "ビルド時に公開されていた写真", category: "travel", tags: [],
        date: "2026-01-01", createdAt: "2026-01-01", published: true,
    }],
}));

import UserProfileClient from "../UserProfileClient";

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);   // 訪問者（未ログイン）
});

describe("全部非公開にしたプロフィール", () => {
    it("API が空を返したら、ビルド時の写真も消す", async () => {
        render(<UserProfileClient userId={OWNER} />);

        // まずスナップショットが出る（API 待ちの間の表示は今までどおり）
        expect(screen.getByAltText("ビルド時に公開されていた写真")).toBeInTheDocument();

        await waitFor(() => expect(
            screen.queryByAltText("ビルド時に公開されていた写真"),
            "非公開にしたはずの写真が訪問者に出続けている",
        ).toBeNull());
    });

    it("取得に失敗したときは消さない（見えていたものを消して驚かせない）", async () => {
        // **本文は配列にする。** `{}` にしていたので `Array.isArray` で
        // 止まってしまい、`photosRes.ok` の分岐を一度も踏んでいなかった
        // （`if (photosRes.ok)` を `if (true)` に変えても緑のままだった）
        mockPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => [] });

        render(<UserProfileClient userId={OWNER} />);

        await new Promise((r) => setTimeout(r, 30));
        expect(screen.getByAltText("ビルド時に公開されていた写真"),
            "失敗しただけなのに写真を消している").toBeInTheDocument();
    });

    it("API が写真を返せば、そちらで置き換える（正常系）", async () => {
        mockPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => [{
                id: "fresh-1", userId: OWNER, src: "https://cdn.example.com/uploads/b.jpg",
                title: "いま公開されている写真", category: "travel", tags: [],
                date: "2026-02-01", createdAt: "2026-02-01", published: true,
            }],
        });

        render(<UserProfileClient userId={OWNER} />);

        await waitFor(() => expect(screen.getByAltText("いま公開されている写真")).toBeInTheDocument());
        expect(screen.queryByAltText("ビルド時に公開されていた写真")).toBeNull();
    });
});
