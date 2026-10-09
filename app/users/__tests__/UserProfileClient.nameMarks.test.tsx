import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **名前の横の並び**（owner の決定）: 名前 → 認証済みの封印 → Pro の印 → 選んだメダル。
// メダルは持っているものだけ、Pro の印は `pro: true` の人だけ。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="dynamic-stub" /> }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
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
        ...actual,
        publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
        userFetch: (...a: unknown[]) => mockUserFetch(...a),
        userPublicFetch: (...a: unknown[]) => mockUserPublicFetch(...a),
    };
});
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import UserProfileClient from "../UserProfileClient";

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

const AT = "2026-10-01T00:00:00.000Z";

describe("名前の横の印", () => {
    it("名前 → 封印 → Pro の印 → 選んだメダル の順に並ぶ", async () => {
        profileResponse({
            userId: ME, displayName: "旅人", verified: true, pro: true, proMarkStyle: "plate",
            badges: { morning: { tier: 3, at: AT } }, displayBadge: "morning",
        });
        render(<UserProfileClient userId={ME} />);
        const heading = await screen.findByRole("heading", { level: 1 });
        await waitFor(() => expect(heading.querySelector("[data-testid=name-badge]")).not.toBeNull());
        const order = [...heading.querySelectorAll("span.truncate, [data-testid=verified-badge], [data-testid=pro-mark], [data-testid=name-badge]")]
            .map((el) => el.getAttribute("data-testid") ?? "name");
        expect(order).toEqual(["name", "verified-badge", "pro-mark", "name-badge"]);
        expect(heading.querySelector("[data-testid=pro-mark]")?.getAttribute("src")).toBe("/badges/pro-mark-plate.svg");
        expect(heading.querySelector("[data-testid=name-badge] img")?.getAttribute("src")).toBe("/badges/medal-morning-3-s.webp");
    });

    it("持っていないメダル・pro でない人には何も足さない", async () => {
        profileResponse({ userId: ME, displayName: "旅人", pro: false, badges: { first: { tier: 1, at: AT } }, displayBadge: "wish" });
        render(<UserProfileClient userId={ME} />);
        const heading = await screen.findByRole("heading", { level: 1 });
        await waitFor(() => expect(heading.textContent).toContain("旅人"));
        expect(heading.querySelector("[data-testid=pro-mark]")).toBeNull();
        expect(heading.querySelector("[data-testid=name-badge]")).toBeNull();
    });
});
