import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 自分のメダルの棚と名前の横の設定（`/user/badges`・2026-10-11 owner の決定）

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import BadgesPage from "../page";

const AT = "2026-10-01T00:00:00.000Z";
const BADGES = { first: { tier: 1, at: AT }, prefectures: { tier: 1, at: AT }, morning: { tier: 2, at: AT } };
const PROGRESS = {
    first: { count: 3, tier: 1, next: null },
    prefectures: { count: 13, tier: 1, next: 30 },
    morning: { count: 60, tier: 2, next: 200 },
    night: { count: 5, tier: 0, next: 10 },
};

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
const fail = () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) });

function serve(profile: unknown, opts: { badges?: "ok" | "fail"; profile?: "ok" | "fail"; put?: unknown; putRes?: () => Promise<unknown> } = {}) {
    mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (url === "/user/profile" && init?.method === "PUT") return opts.putRes ? opts.putRes() : ok(opts.put ?? profile);
        if (url === "/user/profile") return opts.profile === "fail" ? fail() : ok(profile);
        if (url === "/user/badges") return opts.badges === "fail" ? fail() : ok({ badges: BADGES, progress: PROGRESS });
        return ok({});
    });
}
const puts = () => mockUserFetch.mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT")
    .map((c) => JSON.parse((c[1] as { body: string }).body));

beforeEach(() => {
    mockUserFetch.mockReset();
    mockShowToast.mockReset();
});

async function openSheet() {
    await userEvent.click(await screen.findByTestId("name-side-open"));
    return screen.getByRole("dialog", { name: "名前の横" });
}

describe("名前の横の設定", () => {
    it("🔴 初期値は生の値: proMarkStyle none は「外す」、verifiedMarkOff true は「外す」で開く", async () => {
        serve({ userId: "me", displayName: "旅人", pro: true, proMarkStyle: "none", verified: true, verifiedMarkOff: true, badges: BADGES, displayBadge: "morning" });
        render(<BadgesPage />);
        const dialog = await openSheet();
        const pro = within(dialog).getByRole("group", { name: "Pro マークの形" });
        expect(within(pro).getByRole("radio", { name: "外す" })).toBeChecked();
        const ver = within(dialog).getByRole("group", { name: "公式の印" });
        expect(within(ver).getByRole("radio", { name: "外す" })).toBeChecked();
        expect(within(dialog).getByRole("button", { name: "朝の光（銀）" })).toHaveAttribute("aria-pressed", "true");
        // 下見: 外している印は出さない
        const preview = within(dialog).getByTestId("name-side-preview");
        expect(preview.querySelector("[data-testid=pro-mark]")).toBeNull();
        expect(preview.querySelector("[data-testid=verified-badge]")).toBeNull();
        expect(preview.querySelector("[data-testid=name-side-preview-badge]")?.getAttribute("src")).toBe("/badges/medal-morning-2-s.webp");
    });

    it("何も変えずに決めても送らない", async () => {
        serve({ userId: "me", pro: true, proMarkStyle: "none", verified: true, badges: BADGES, displayBadge: "first" });
        render(<BadgesPage />);
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(puts()).toEqual([]);
    });

    it("変えた項目だけ送る: メダルを替え、Pro の印を外し、公式の印を外す", async () => {
        serve({ userId: "me", pro: true, proMarkStyle: "iris", verified: true, badges: BADGES, displayBadge: "first" });
        render(<BadgesPage />);
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "都道府県（銅）" }));
        await userEvent.click(within(within(dialog).getByRole("group", { name: "Pro マークの形" })).getByRole("radio", { name: "外す" }));
        await userEvent.click(within(within(dialog).getByRole("group", { name: "公式の印" })).getByRole("radio", { name: "外す" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(puts()).toEqual([{ displayBadge: "prefectures", proMarkStyle: "none", verifiedMarkOff: true }]));
    });

    it("公式の印を付け直すと verifiedMarkOff: false だけ。押し直したメダルは null で外す", async () => {
        serve({ userId: "me", pro: false, verified: true, verifiedMarkOff: true, badges: BADGES, displayBadge: "first" });
        render(<BadgesPage />);
        const dialog = await openSheet();
        // Pro でない人には形の選択を出さない
        expect(within(dialog).queryByRole("group", { name: "Pro マークの形" })).toBeNull();
        await userEvent.click(within(within(dialog).getByRole("group", { name: "公式の印" })).getByRole("radio", { name: "付ける" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "最初の一枚" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(puts()).toEqual([{ displayBadge: null, verifiedMarkOff: false }]));
    });

    it("公式でない人には「公式の印」を出さない", async () => {
        serve({ userId: "me", verified: false, badges: BADGES });
        render(<BadgesPage />);
        const dialog = await openSheet();
        expect(within(dialog).queryByRole("group", { name: "公式の印" })).toBeNull();
    });
});

describe("保存のあと・失敗", () => {
    const base = { userId: "me", pro: true, proMarkStyle: "iris", verified: false, badges: BADGES, displayBadge: "first" };

    it("保存できたら、札がサーバーの返した姿になる（替えたメダルの名前）", async () => {
        serve(base, { put: { ...base, displayBadge: "prefectures" } });
        render(<BadgesPage />);
        expect((await screen.findByTestId("name-side-open")).textContent).toContain("最初の一枚");
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "都道府県（銅）" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByTestId("name-side-open").textContent).toContain("都道府県（銅）");
        expect(mockShowToast).toHaveBeenCalledWith("保存しました", "success");
    });

    it("外して保存すると「メダルを選んでいません」", async () => {
        serve(base, { put: { ...base, displayBadge: null } });
        render(<BadgesPage />);
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "最初の一枚" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(screen.getByTestId("name-side-open").textContent).toContain("メダルを選んでいません"));
    });

    it("応答の本文が読めないときは、送った分を手元で重ねる", async () => {
        serve(base, { putRes: () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }) });
        render(<BadgesPage />);
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "朝の光（銀）" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(screen.getByTestId("name-side-open").textContent).toContain("朝の光（銀）"));
    });

    it("断られたら（400）サーバーの文言をエラーで出し、シートは閉じない", async () => {
        serve(base, { putRes: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "まだ手に入れていないメダルは選べません" }) }) });
        render(<BadgesPage />);
        const dialog = await openSheet();
        await userEvent.click(within(dialog).getByRole("button", { name: "都道府県（銅）" }));
        await userEvent.click(within(dialog).getByRole("button", { name: "決める" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("まだ手に入れていないメダルは選べません", "error"));
        expect(screen.getByRole("dialog", { name: "名前の横" })).toBeInTheDocument();
        // 札は元のまま
        expect(screen.getByTestId("name-side-open").textContent).toContain("最初の一枚");
    });

    it("PRO の札は横長の枠で描く（選択肢・下見とも）", async () => {
        serve({ ...base, proMarkStyle: "plate" });
        render(<BadgesPage />);
        const dialog = await openSheet();
        const preview = within(dialog).getByTestId("name-side-preview").querySelector("[data-testid=pro-mark]") as HTMLElement;
        expect([preview.style.width, preview.style.height]).toEqual(["35px", "20px"]);
        const group = within(dialog).getByRole("group", { name: "Pro マークの形" });
        const option = within(group).getByRole("radio", { name: /PRO の札/ }).closest("label")!.querySelector("img") as HTMLElement;
        expect([option.style.width, option.style.height]).toEqual(["28px", "16px"]);
    });
});

describe("自分の棚", () => {
    it("持っているものに「あと◯で次」、まだのものは灰色で「あと◯枚」", async () => {
        serve({ userId: "me", badges: BADGES });
        render(<BadgesPage />);
        const shelf = await screen.findByTestId("medal-shelf");
        const items = within(shelf).getAllByTestId("medal-shelf-item");
        const pref = items.find((li) => li.textContent?.includes("都道府県（銅）"))!;
        expect(pref).toHaveAttribute("data-owned", "true");
        expect(pref.textContent).toContain("あと17で次");
        const night = items.find((li) => li.textContent?.includes("夜の光"))!;
        expect(night).toHaveAttribute("data-owned", "false");
        expect(night.textContent).toContain("あと5枚");
        expect(screen.getByTestId("badges-count").textContent).toBe("3 / 8");
    });

    it("読み込みに失敗したら棚だけ失敗と出す（名前の横は使える）", async () => {
        serve({ userId: "me", badges: BADGES }, { badges: "fail" });
        render(<BadgesPage />);
        expect(await screen.findByText("メダルを読み込めませんでした。")).toBeInTheDocument();
        expect(screen.getByTestId("name-side-open")).toBeInTheDocument();
    });

    it("プロフィールが読めなければ名前の横だけ失敗と出す", async () => {
        serve({}, { profile: "fail" });
        render(<BadgesPage />);
        expect(await screen.findByText("プロフィールを読み込めませんでした。")).toBeInTheDocument();
        expect(await screen.findByTestId("medal-shelf")).toBeInTheDocument();
    });
});
