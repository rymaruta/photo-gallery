import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

// **OGP 画像が、存在しないファイルを指していた。**
//
// `siteConfig.ogImage = "/images/og-image.jpg"` は `public/images/` にも
// ビルド成果物にも無く、git の全履歴にも一度も現れない。それでも16ページが
// この URL を OGP 画像として出していたので、**トップページを SNS・LINE・
// Slack に貼っても画像が出ない**（写真が主役のサイトとしては痛い）。
// `Organization` の `logo` も同じ URL を指していた。
//
// 新しく画像を作るのはデザインの判断なので、サイトが既に持っているもの
// ——一番新しい公開写真——をビルド時に選ぶ。

const SITE = "https://journey-photo.com";

async function resolveWith(photos: unknown[]) {
    const mod = await import("../photos");
    return mod.resolveOgImage(SITE, async () => photos as never);
}

describe("OGP 画像をビルド時に決める", () => {
    it("一番新しい公開写真を指す", async () => {
        const url = await resolveWith([
            { id: "old", src: "https://cdn/old.jpg", published: true, date: "2024-01-01" },
            { id: "new", src: "https://cdn/new.jpg", published: true, date: "2026-05-01" },
        ]);
        expect(url).toBe("https://cdn/new.jpg");
    });

    it("非公開の写真は選ばない（新しくても）", async () => {
        const url = await resolveWith([
            { id: "pub", src: "https://cdn/pub.jpg", published: true, date: "2024-01-01" },
            { id: "draft", src: "https://cdn/draft.jpg", published: false, date: "2026-05-01" },
        ]);
        expect(url, "非公開の写真を全世界の共有カードに出している").toBe("https://cdn/pub.jpg");
    });

    it("相対パスなら絶対URLにする", async () => {
        const url = await resolveWith([{ id: "a", src: "/uploads/a.jpg", published: true, date: "2026-01-01" }]);
        expect(url).toBe(`${SITE}/uploads/a.jpg`);
    });

    // 公開写真が1枚も無いときだけ、**実在する**アイコンに落ちる
    it("写真が無ければアイコン（実在するファイル）に落とす", async () => {
        const url = await resolveWith([]);
        expect(url).toBe(`${SITE}/icon-512.png`);
        expect(existsSync(join(process.cwd(), "public/icon-512.png")),
            "落とし先のファイルが無い（また存在しない画像を指している）").toBe(true);
    });
});

// 既定値そのものが実在することを見張る。ここが緩むと、また
// 「無いファイルを16ページが指す」状態に戻せてしまう。
describe("siteConfig の既定 OGP 画像", () => {
    it("public に実在するファイルを指す", async () => {
        const { siteConfig } = await import("@/lib/utils/seo");
        expect(siteConfig.ogImage.startsWith("/"), "相対パスであること").toBe(true);
        expect(existsSync(join(process.cwd(), "public", siteConfig.ogImage)),
            `public${siteConfig.ogImage} が存在しない`).toBe(true);
    });
});
