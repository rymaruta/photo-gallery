import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LocaleToggle from "../LocaleToggle";

const labels = { ja: "日本語", en: "English" };

describe("LocaleToggle", () => {
    it("現在のロケールに aria-pressed が付く", () => {
        render(<LocaleToggle locale="ja" setLocale={() => {}} labels={labels} />);
        expect(screen.getByRole("button", { name: "日本語" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
    });

    it("クリックで setLocale が呼ばれる", () => {
        const setLocale = vi.fn();
        render(<LocaleToggle locale="ja" setLocale={setLocale} labels={labels} />);
        fireEvent.click(screen.getByRole("button", { name: "English" }));
        expect(setLocale).toHaveBeenCalledWith("en");
        fireEvent.click(screen.getByRole("button", { name: "日本語" }));
        expect(setLocale).toHaveBeenCalledWith("ja");
    });

    it("ラベル未指定でもデフォルト表記で描画される", () => {
        render(<LocaleToggle locale="en" setLocale={() => {}} labels={{}} />);
        expect(screen.getByRole("button", { name: "日本語" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    });
});
