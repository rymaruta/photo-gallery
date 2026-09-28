import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **押した結果を読み上げる。**
 *
 * 曲検索の失敗は「探す」を押した直後に出る一時的な手応えなのに、
 * 3か所とも `role="alert"` も `aria-live` も持っていなかった
 * ——読み上げ環境では**押しても何も起きなかったように見える**
 * （WCAG 4.1.3 状態メッセージ・AA）。同じ `StoryViewer` の `keepError` は
 * `role="alert"` を持っており、扱いが割れていた。
 */
const locale = { value: "ja" as "ja" | "en" };
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: locale.value, labels: {} }) }));

const SongSearchError = (await import("../SongSearchError")).default;

describe("曲検索の失敗の一行", () => {
    it("読み上げに届く（role=alert）", () => {
        locale.value = "ja";
        render(<SongSearchError />);
        const el = screen.getByRole("alert");
        expect(el, "押した結果が読み上げられない").toBeInTheDocument();
        expect(el).toHaveTextContent("検索に失敗しました。もう一度お試しください。");
    });

    it("英語でも同じ扱い", () => {
        locale.value = "en";
        render(<SongSearchError />);
        expect(screen.getByRole("alert")).toHaveTextContent("Search failed. Try again.");
    });

    // **見た目を縛る**（`role` は描画に出ない属性）。色は失敗の文言の色
    // （`danger`・デザインシステム「黒塗りの真鍮」2026-09-27 に琥珀から変えた）
    it("見た目は失敗の文言の色", () => {
        locale.value = "ja";
        const { container } = render(<SongSearchError />);
        expect(container.querySelector("p")?.className).toBe("text-xs text-danger");
    });
});
