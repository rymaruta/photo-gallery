import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isProBadgeKey as serverIsProBadgeKey } from "../../../../api-user/src/badgeKeys";
import { isProBadgeKey } from "../../../../lib/data/badges";

// 設定: 公開プロフィールに Pro の章を出す（2026-10-18 owner・journey.photo-ios #296）
// - サポーターの番号か Pro のメダルを持つ人だけ（やめた人も）。古いサーバー（項目が無い）では出さない
// - 入切は `PUT /user/profile` に `{ proBadgesHidden }` だけを送る（オン＝出す＝false）。失敗したら元に戻す

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import ProBadgesPublicRow, { showsProBadgesRow } from "../ProBadgesPublicRow";

const AT = "2026-10-01T00:00:00.000Z";
const profile = (body: Record<string, unknown>, put: { ok: boolean; status?: number } = { ok: true }) =>
    mockUserFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return { ok: put.ok, status: put.status ?? 200, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
    });
const NAME = "公開プロフィールに Pro の章を出す";

beforeEach(() => { mockUserFetch.mockReset(); });

describe("設定: 公開プロフィールに Pro の章を出す", () => {
    it("Pro の鍵の判定がサーバーと同じ", () => {
        const samples = ["supporter", "supporterYear", "proAutumn2026", "proWinter2031", "proSpring1999", "first", "earlyUser", "prefectures", "proAutumn", "", null, 3];
        for (const k of samples) expect(isProBadgeKey(k), String(k)).toBe(serverIsProBadgeKey(k));
    });

    it("出す人: 番号か Pro のメダルを持ち、サーバーが項目を返している", () => {
        expect(showsProBadgesRow({ proBadgesHidden: false, supporter: { number: 3, since: AT, months: 0 } })).toBe(true);
        expect(showsProBadgesRow({ proBadgesHidden: false, badges: { proAutumn2026: { tier: 1, at: AT } } })).toBe(true);
        expect(showsProBadgesRow({ proBadgesHidden: true, badges: { supporter: { tier: 1, at: AT } } })).toBe(true);
        // Pro と関係ない人
        expect(showsProBadgesRow({ proBadgesHidden: false, badges: { first: { tier: 1, at: AT }, earlyUser: { tier: 1, at: AT } } })).toBe(false);
        // 古いサーバー（項目が無い）——押しても効かない入切を出さない
        expect(showsProBadgesRow({ supporter: { number: 3 } })).toBe(false);
        expect(showsProBadgesRow(null)).toBe(false);
    });

    it("出さない人には何も描かない", async () => {
        profile({ userId: "u1", proBadgesHidden: false, badges: { first: { tier: 1, at: AT } } });
        const { container } = render(<ProBadgesPublicRow locale="ja" />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/profile"));
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe("");
    });

    it("今の値で出し、押すと proBadgesHidden だけを送る", async () => {
        profile({ userId: "u1", proBadgesHidden: false, supporter: { number: 3, since: AT, months: 1 } });
        render(<ProBadgesPublicRow locale="ja" />);
        const sw = await screen.findByRole("switch", { name: NAME });
        expect(sw.getAttribute("aria-checked")).toBe("true");
        expect(sw.style.minHeight).toBe("44px");
        expect(screen.getByText(/オフにすると、Pro のメダル・サポーターの番号と続けた月数を他の人に見せません/)).toBeTruthy();
        await userEvent.click(sw);
        const put = mockUserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
        expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ proBadgesHidden: true });
        expect(sw.getAttribute("aria-checked")).toBe("false");
    });

    it("隠している人はオフで出し、押すと出すに戻す", async () => {
        profile({ userId: "u1", proBadgesHidden: true, badges: { supporter: { tier: 1, at: AT } } });
        render(<ProBadgesPublicRow locale="ja" />);
        const sw = await screen.findByRole("switch", { name: NAME });
        expect(sw.getAttribute("aria-checked")).toBe("false");
        await userEvent.click(sw);
        const put = mockUserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
        expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ proBadgesHidden: false });
    });

    it("送れなければ元に戻して知らせる", async () => {
        profile({ userId: "u1", proBadgesHidden: false, supporter: { number: 3 } }, { ok: false, status: 500 });
        render(<ProBadgesPublicRow locale="ja" />);
        const sw = await screen.findByRole("switch", { name: NAME });
        await userEvent.click(sw);
        await screen.findByRole("alert");
        expect(sw.getAttribute("aria-checked")).toBe("true");
    });
});
