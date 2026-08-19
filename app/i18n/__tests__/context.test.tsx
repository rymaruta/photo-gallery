import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider, useLocale } from "../context";

// localStorage のモック
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

function LocaleDisplay() {
    const { locale, setLocale } = useLocale();
    return (
        <div>
            <span data-testid="locale">{locale}</span>
            <button onClick={() => setLocale("en")}>English</button>
            <button onClick={() => setLocale("ja")}>日本語</button>
        </div>
    );
}

describe("LocaleProvider", () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    it("デフォルト locale は ja", () => {
        render(
            <LocaleProvider>
                <LocaleDisplay />
            </LocaleProvider>
        );
        expect(screen.getByTestId("locale").textContent).toBe("ja");
    });

    it("setLocale('en') で locale が en に変わる", async () => {
        const user = userEvent.setup();
        render(
            <LocaleProvider>
                <LocaleDisplay />
            </LocaleProvider>
        );
        await user.click(screen.getByText("English"));
        expect(screen.getByTestId("locale").textContent).toBe("en");
    });

    it("setLocale で localStorage に保存される", async () => {
        const user = userEvent.setup();
        render(
            <LocaleProvider>
                <LocaleDisplay />
            </LocaleProvider>
        );
        await user.click(screen.getByText("English"));
        // storageSet は JSON.stringify するので値は `"en"` (JSON-encoded string)
        expect(JSON.parse(localStorageMock.getItem("locale")!)).toBe("en");
    });

    // 言語切替UIは廃止済み。過去に en を選んだ端末が英語のまま戻せなくなるのを防ぐ
    it("localStorage に en が残っていても日本語で表示し、その設定を消す", async () => {
        localStorageMock.setItem("locale", JSON.stringify("en"));
        render(
            <LocaleProvider>
                <LocaleDisplay />
            </LocaleProvider>
        );
        await act(async () => {});
        expect(screen.getByTestId("locale").textContent).toBe("ja");
        expect(localStorageMock.getItem("locale")).toBeNull();
    });

    it("useLocale を Provider 外で呼ぶとエラー", () => {
        // console.error を抑制
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => render(<LocaleDisplay />)).toThrow("useLocale must be used within a LocaleProvider");
        spy.mockRestore();
    });
});
