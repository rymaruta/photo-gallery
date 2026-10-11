import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **光と天気の知らせ**（Pro・板 LightAlert・2026-10-11 owner）。
// - 403（Pro でない）は「Pro の方の機能です」とだけ言い、**購入へ案内しない**（Web では何も売らない）
// - 応答の `attribution`（Apple Weather の表記とリンク）を**必ず**出す（Apple の求め・0件でも）
// - 読み込み中・403・503・0件を分ける

const mockUserFetch = vi.hoisted(() => vi.fn());
let mockLocale = "ja";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: mockLocale }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

const Page = (await import("../page")).default;

const ATTR = { serviceName: "Apple Weather", legalUrl: "https://weatherkit.apple.com/legal-attribution.html" };
const clock = (c: string) => ({ at: "2100-01-01T00:00:00.000Z", clock: c });
const day = (date: string, extra: Record<string, unknown> = {}) => ({
    date, sunrise: clock("05:42"), sunset: clock("17:22"),
    morningBlue: { start: null, end: null }, eveningBlue: { start: null, end: null },
    morning: null, evening: null, night: null, ...extra,
});
const respond = (status: number, body: unknown) =>
    mockUserFetch.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
    mockUserFetch.mockReset();
    mockLocale = "ja";
});

describe("光と天気の知らせ: 読めなかったとき", () => {
    it("403 は「Pro の方の機能」とだけ言い、購入の案内・一覧・もう一度を出さない", async () => {
        respond(403, { error: "Pro の機能です" });
        render(<Page />);
        expect(await screen.findByTestId("light-failed-notPro")).toBeTruthy();
        expect(screen.getByText("Pro の方の機能です")).toBeTruthy();
        // 売らない: 購入・案内へのリンクやボタンが無い（戻るの1本だけ）
        const links = screen.queryAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["/user/settings"]);
        expect(screen.queryAllByRole("button")).toEqual([]);
        expect(document.body.textContent).not.toMatch(/購入|アップグレード|Pro について|About Pro|Subscribe/);
        expect(screen.queryByTestId("light-card")).toBeNull();
        expect(mockUserFetch).toHaveBeenCalledWith("/user/light-forecast");
    });

    it("503 は予報を読めないと言い、もう一度読み込める", async () => {
        respond(503, { error: "x" });
        render(<Page />);
        expect(await screen.findByTestId("light-failed-unavailable")).toBeTruthy();
        respond(200, { places: [], attribution: ATTR });
        await userEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        await waitFor(() => expect(screen.getByTestId("light-attribution")).toBeTruthy());
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });

    it("読み込み中は回る印だけ", () => {
        mockUserFetch.mockReturnValue(new Promise(() => {}));
        render(<Page />);
        expect(screen.getByRole("status", { name: "読み込み中" })).toBeTruthy();
    });
});

describe("光と天気の知らせ: 一覧", () => {
    it("場所の札・注記・Apple Weather の出典（真鍮のリンク・新しいタブ）を出す", async () => {
        respond(200, {
            places: [{
                key: "SPOT-a", slug: "a", name: "撮影スポットA", timeZone: "Asia/Tokyo", forecast: true,
                days: [day("2099-12-31", { morning: { weather: "clear", chance: "high" } })],
            }],
            note: "天気は外部の予報から。光の時刻はアプリで計算。見込みは目安で、外れることがあります。",
            attribution: ATTR,
        });
        render(<Page />);
        const card = await screen.findByTestId("light-card");
        expect(card.textContent).toContain("撮影スポットA");
        expect(card.textContent).toContain("晴れ");
        expect(card.textContent).toContain("朝焼け 見込み高");
        expect(card.getAttribute("data-best")).toBe("true");
        const a = screen.getByTestId("light-attribution");
        expect(a.getAttribute("href")).toBe(ATTR.legalUrl);
        expect(a.textContent).toContain("Apple Weather");
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toContain("noopener");
        expect(a.className).toContain("text-accent");
        expect(screen.getByText(/見込みは目安で/)).toBeTruthy();
    });

    it("0件でも出典は出す（空の案内と一緒に）", async () => {
        respond(200, { places: [], attribution: ATTR });
        render(<Page />);
        expect(await screen.findByText("行きたい撮影スポットがまだありません")).toBeTruthy();
        expect(screen.getByTestId("light-attribution").getAttribute("href")).toBe(ATTR.legalUrl);
    });

    it("英語の画面ではサーバーの日本語の注記を出さない", async () => {
        mockLocale = "en";
        respond(200, { places: [], note: "天気は外部の予報から。", attribution: ATTR });
        render(<Page />);
        const a = await screen.findByTestId("light-attribution");
        expect(a.textContent).toBe("Weather: Apple Weather · Data sources");
        expect(document.body.textContent).not.toContain("天気は外部の予報から。");
    });
});
