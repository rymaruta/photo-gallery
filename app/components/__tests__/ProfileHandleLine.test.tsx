import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ProfileHandleLine from "../ProfileHandleLine";

// 2026-10-11: 自分のページで、名前の行の右に「プロフィールを編集」が在るため
// 「@tabi_photographer · 京都府 …」と居住地が切れていた。
// 1行に詰めて末尾を切るのをやめ、入らなければ居住地を次の行に回す。

describe("ProfileHandleLine: 居住地は切らずに次の行へ回す", () => {
    it("行は折り返せる（flex-wrap）。行ごとの truncate はしない", () => {
        const { getByTestId } = render(<ProfileHandleLine username="tabi_photographer" homeLocation="京都府 京都市" locale="ja" />);
        const line = getByTestId("profile-handle-line");
        expect(line.className).toContain("flex-wrap");
        expect(line.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    });

    it("@名と居住地はそれぞれ1かたまり（長すぎるときだけ、それぞれの末尾を切る）", () => {
        const { getByTestId } = render(<ProfileHandleLine username="tabi_photographer" homeLocation="京都府 京都市" locale="ja" />);
        const handle = getByTestId("profile-handle");
        const home = getByTestId("profile-home");
        expect(handle.textContent).toBe("@tabi_photographer");
        expect(home.textContent).toBe("居住地 京都府 京都市");
        for (const el of [handle, home]) {
            expect(el.className).toContain("max-w-full");
            expect(el.className).toContain("truncate");
        }
        // 区切りの「·」は読み上げに出さない（CSS の代わりの文を空に）
        expect(home.className).toContain("before:content-['·'_/_'']");
        // 行の頭に来た区切りを隠す枠
        expect(getByTestId("profile-handle-line").parentElement?.className).toContain("overflow-hidden");
    });

    it("片方だけでも出す・両方無ければ描かない", () => {
        const { container, rerender, getByTestId } = render(<ProfileHandleLine homeLocation="Lisbon" locale="en" />);
        expect(getByTestId("profile-home").textContent).toBe("Based in Lisbon");
        expect(container.querySelector("[data-testid=profile-handle]")).toBeNull();
        rerender(<ProfileHandleLine username=" " homeLocation="" locale="ja" />);
        expect(container.innerHTML).toBe("");
    });
});
