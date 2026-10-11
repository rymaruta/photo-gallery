import { describe, it, expect } from "vitest";

// 撮影地マップ（/map）は "use client" なので metadata を持てず、layout で当てる。
// 兄弟の `/users` は「トップページを名乗っていた」（canonical がルート）ので、
// 同じ穴を新しいページで開けないよう固定する。
describe("/map のメタデータ", () => {
    it("canonical が自分を指し、検索結果に出す（noindex にしない）", async () => {
        const { metadata } = await import("../map/layout");
        expect(metadata.alternates?.canonical).toMatch(/\/map$/);
        expect(metadata.title).toBe("撮影地マップ");
        // **公開の入口なので index。** `appPageMetadata`（ログイン後の画面用）は
        // noindex を付けるので、それを使い回してはいけない。robots を書かなければ
        // ルートの `index: true` を継ぐ
        expect(metadata.robots, "公開ページに noindex が付いている").toBeUndefined();
    });

    it("sitemap に載る（lastmod はトップと同じ規則）", async () => {
        const sitemap = (await import("../sitemap")).default;
        const entries = await sitemap();
        const map = entries.find((e) => e.url.endsWith("/map"));
        expect(map, "sitemap に /map が無い").toBeTruthy();
        const top = entries.find((e) => !e.url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, ""));
        expect(top, "トップの行が無い").toBeTruthy();
        expect(map!.lastModified).toEqual(top!.lastModified);
        // 2026-10-11 判断: サイトマップ全体（スポット 1,782件・写真）を組むので、単独でも約 4.7 秒かかる
        // （origin/develop でも同じ）。全体のテストと並ぶと既定の 5 秒を超えて落ちるので、時間だけ延ばす。
        // 代表写真を足した spot-images.json（+約 0.6MB）で読み込みがさらに重くなった（spot-cover-seo）
    }, 30_000);
});
