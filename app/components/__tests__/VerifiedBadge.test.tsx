import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VerifiedBadge from "../VerifiedBadge";

/** 認証済みの印（真鍮の封印・板 08・A） */
describe("VerifiedBadge", () => {
    it("立っている人にだけ出す（読み上げは「認証済み」）", () => {
        render(<VerifiedBadge verified />);
        expect(screen.getByRole("img", { name: "認証済み" })).toBeTruthy();
    });
    it("🔴 立っていない・未設定なら何も出さない（誰にでも出ると印の意味が無くなる）", () => {
        const { container } = render(<>
            <VerifiedBadge verified={false} />
            <VerifiedBadge />
        </>);
        expect(container.querySelector("[data-testid=verified-badge]")).toBeNull();
    });
    it("英語のページでは Verified と読む", () => {
        render(<VerifiedBadge verified locale="en" />);
        expect(screen.getByRole("img", { name: "Verified" })).toBeTruthy();
    });
    it("真鍮の封印（12山）と墨のチェック", () => {
        const { container } = render(<VerifiedBadge verified />);
        expect(container.querySelector("polygon")?.getAttribute("fill")).toBe("#C9A66B");
        expect(container.querySelector("polygon")?.getAttribute("points")?.split(" ")).toHaveLength(24);
        expect(container.querySelector("path")?.getAttribute("stroke")).toBe("#1A140A");
    });
});
