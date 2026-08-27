import { describe, it, expect } from "vitest";

// /users は "use client" なので metadata を持てず、**ルートのメタデータを
// そのまま継承していた**——canonical がトップページを指し（out/users.html を
// 実測: canonical = https://journey-photo.com、robots = index, follow）、
// 「このページはトップページです」と申告していた。
// 兄弟（/users/search・/favorites・/login・/signup・/user/*・/admin/*）は
// 全部 layout で手当て済みで、ここだけ抜けていた。
describe("/users のメタデータ", () => {
    it("canonical が自分を指し、検索結果には出さない", async () => {
        const { metadata } = await import("../users/layout");
        expect(metadata.alternates?.canonical).toMatch(/\/users$/);
        // トップページを名乗らない
        expect(metadata.alternates?.canonical).not.toMatch(/\.com$/);
        expect(metadata.robots).toMatchObject({ index: false, follow: true });
    });

    it("兄弟の /users/search と同じ扱いにする", async () => {
        const mine = (await import("../users/layout")).metadata;
        const sibling = (await import("../users/search/layout")).metadata;
        expect(mine.robots).toEqual(sibling.robots);
    });
});
