import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **年表の見出しが、写真ページの表示とずれることがあった。**
//
// 撮影日は EXIF から `2024-11-01T07:30:00`（ゾーン無し＝その土地の時計）で
// 保存される。`Date.parse` はこれを**ローカル時刻**として読むので、JST では
// 前日 22:30 UTC になり、UTC で切った見出しは「2024年10月」。一方で写真
// ページ（`formatStoredDateTime`）は書かれている成分をそのまま出すので
// 「2024年11月1日 07:30」。同じ写真について2つの画面が違うことを言う。
//
// 並び順も `Date.parse` の数値で決めていたため、閲覧者のゾーンで変わっていた。

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
vi.mock("../../data/photos.json", () => ({ default: [] }));

import UserProfileClient from "../UserProfileClient";

const OWNER = "33333333-3333-4333-8333-333333333333";

/** EXIF 由来の撮影日（ゾーン無しの T 形式）を持つ写真 */
const shot = (id: string, date: string) => ({
    id, userId: OWNER, src: `https://cdn/${id}.jpg`, title: id,
    category: "travel", tags: [], date, createdAt: "2026-01-01T00:00:00.000Z", published: true,
});

beforeEach(() => {
    process.env.TZ = "Asia/Tokyo";   // このサイトの主な閲覧者
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockUserPublicFetch.mockReset().mockResolvedValue({
        ok: true, json: async () => ({ userId: OWNER, displayName: "旅人" }),
    });
    mockGetCurrentSession.mockReset().mockResolvedValue(null);   // 訪問者
});
afterEach(() => { delete process.env.TZ; });

async function openTimeline(photos: unknown[]) {
    mockPublicFetch.mockResolvedValue({ ok: true, json: async () => photos });
    render(<UserProfileClient userId={OWNER} />);
    await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /年表/ }));
}

describe("年表の見出しと並び", () => {
    it("撮影日は書かれている月に入る（閲覧者のゾーンで動かない）", async () => {
        await openTimeline([shot("p1", "2024-11-01T07:30:00")]);

        expect(await screen.findByText("2024年11月"), "JST で前月の見出しに入っている").toBeInTheDocument();
        expect(screen.queryByText("2024年10月")).toBeNull();
    });

    // **日付だけの値と、時刻つきの値が混ざる。** `Date.parse` で並べると
    // JST では時刻つきだけが前日側へずれるので、同じ日の 07:30 が
    // 「日付だけ（＝0時のつもり）」より**古い**扱いになる。
    it("同じ日なら、時刻つきの写真が日付だけの写真より新しい", async () => {
        await openTimeline([
            shot("dayOnly", "2024-11-01"),
            shot("morning", "2024-11-01T07:30:00"),
        ]);

        await screen.findByText("2024年11月");
        const order = screen.getAllByRole("img").map((el) => el.getAttribute("alt"))
            .filter((a) => a === "dayOnly" || a === "morning");
        expect(order, "閲覧者のゾーンで並びが変わっている").toEqual(["morning", "dayOnly"]);
    });

    // 日付だけの値（今の本番データはこちら）は今までどおり
    it("日付だけの撮影日も今までどおり", async () => {
        await openTimeline([shot("d1", "2024-10-12")]);
        expect(await screen.findByText("2024年10月")).toBeInTheDocument();
    });
});
