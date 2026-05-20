import { describe, it, expect } from "vitest";
import { ROUTES } from "../routes";

describe("ROUTES", () => {
    it("静的ルートが正しいパスを持つ", () => {
        expect(ROUTES.HOME).toBe("/");
        expect(ROUTES.ABOUT).toBe("/about");
        expect(ROUTES.FAVORITES).toBe("/favorites");
        expect(ROUTES.HISTORY).toBe("/history");
        expect(ROUTES.ADMIN).toBe("/admin");
        expect(ROUTES.LOGIN).toBe("/login");
        expect(ROUTES.UPLOAD).toBe("/user/upload");
        expect(ROUTES.PROFILE_EDIT).toBe("/user/profile");
    });

    it("ROUTES.PHOTO(id) は /photo/:id の形式を返す", () => {
        expect(ROUTES.PHOTO("abc-123")).toBe("/photo/abc-123");
        expect(ROUTES.PHOTO("xyz")).toBe("/photo/xyz");
    });

    it("ROUTES.PHOTO は UUID 形式の id でも動作する", () => {
        const uuid = "3efd3a7c-a625-473e-9622-8daaffca1cf8";
        expect(ROUTES.PHOTO(uuid)).toBe(`/photo/${uuid}`);
    });
});
