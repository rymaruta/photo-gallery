import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **画面を通しても、撮影時刻が落ちないこと。**
// `lib/utils/__tests__/dateInput.test.ts` は `mergeDate` を単体で見ているが、
// この画面が `mergeDate` を経由しなくなる回帰（`buildFields` の date を
// 素通しにする等）はそれでは止まらない。**PUT の中身**で見る。
//
// 日本（UTC+9）では 00:00〜08:59 に撮った写真が UTC で前日になる。
// EXIF 由来の撮影日時は `exifWallClock` が「書いてあるとおりの壁時計」
// （ゾーン指定なし）で保存するので、その形が既定。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const WALL_CLOCK = "2024-11-01T07:30:00";   // 日本の朝＝UTC では前日

function mount(date: string) {
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") {
            return Promise.resolve({ ok: true, json: async () => [{
                id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", location: "江ノ島", date, published: true,
            }] });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    render(<EditPage />);
}

async function savedBody() {
    fireEvent.click(await screen.findByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/photos/p1")).toBe(true));
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/photos/p1")!;
    return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
}

const prevTZ = process.env.TZ;
beforeEach(() => { process.env.TZ = "Asia/Tokyo"; });
afterEach(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

describe("/user/edit: 撮影時刻を端末のゾーンで落とさない（日本の朝の写真）", () => {
    it("欄には撮影日がそのまま出る（前日にならない）", async () => {
        mount(WALL_CLOCK);
        expect(await screen.findByDisplayValue("2024-11-01")).toBeInTheDocument();
    });

    it("日付を触らずに保存したら、date は送らない（＝時刻が落ちない）", async () => {
        mount(WALL_CLOCK);
        await screen.findByDisplayValue("2024-11-01");
        expect(await savedBody(), "撮影時刻を落として送っている").not.toHaveProperty("date");
    });

    it("日付を直したら、その日付だけを送る", async () => {
        mount(WALL_CLOCK);
        const el = await screen.findByDisplayValue("2024-11-01");
        fireEvent.change(el, { target: { value: "2024-11-02" } });
        expect(await savedBody()).toHaveProperty("date", "2024-11-02");
    });

    it("捏造の UTC 0時は、触らなくても日付だけに直して送る（C-12 の移行）", async () => {
        mount("2024-11-01T00:00:00.000Z");
        await screen.findByDisplayValue("2024-11-01");
        expect(await savedBody(), "移行が走っていない").toHaveProperty("date", "2024-11-01");
    });
});
