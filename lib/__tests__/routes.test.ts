import { describe, it, expect } from "vitest";
import { ROUTES } from "../routes";
import PHOTOS_JSON from "@/app/data/photos.json";

const builtIds = (PHOTOS_JSON as Array<{ id: string }>).map((p) => p.id);

describe("ROUTES", () => {
    it("静的ルートが正しいパスを持つ", () => {
        expect(ROUTES.HOME).toBe("/");
        expect(ROUTES.ABOUT).toBe("/about");
        expect(ROUTES.FAVORITES).toBe("/favorites");
        expect(ROUTES.ADMIN).toBe("/admin");
        expect(ROUTES.LOGIN).toBe("/login");
        expect(ROUTES.UPLOAD).toBe("/user/upload");
        expect(ROUTES.PROFILE_EDIT).toBe("/user/profile");
        expect(ROUTES.MAP).toBe("/map");
    });

    it("ビルド時に存在する写真は /photo/:id を返す", () => {
        if (builtIds.length === 0) return; // photos.json が空の環境ではスキップ
        const id = builtIds[0];
        expect(ROUTES.PHOTO(id)).toBe(`/photo/${id}`);
    });

    it("ビルド後にアップロードされた（JSONにない）写真はモーダル表示のURLにフォールバックする", () => {
        const newId = "not-in-build-00000000-0000-0000-0000-000000000000";
        expect(builtIds).not.toContain(newId);
        expect(ROUTES.PHOTO(newId)).toBe(`/?photo=${newId}`);
    });

    it("フォールバックURLでは id が URL エンコードされる", () => {
        expect(ROUTES.PHOTO("a b/c")).toBe(`/?photo=${encodeURIComponent("a b/c")}`);
    });

    it("投稿があるユーザーは静的生成された /users/:id を返す", () => {
        const userIds = (PHOTOS_JSON as Array<{ userId?: string; published?: boolean }>)
            .filter((p) => p.userId && p.published !== false)
            .map((p) => p.userId as string);
        if (userIds.length === 0) return; // 投稿ユーザーがいない環境ではスキップ
        const id = userIds[0];
        expect(ROUTES.USER_PROFILE(id)).toBe(`/users/${encodeURIComponent(id)}`);
    });

    it("ビルド後に登録された新規ユーザーはクエリ版URLにフォールバックする", () => {
        const newUser = "new-user-00000000-0000-0000-0000-000000000000";
        expect(ROUTES.USER_PROFILE(newUser)).toBe(`/users?id=${newUser}`);
    });
});
