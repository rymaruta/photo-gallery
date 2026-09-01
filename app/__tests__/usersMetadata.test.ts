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

// **レイアウトの noindex が、子のプロフィールページにも降りていた。**
//
// Next のメタデータ結合は「子がそのキーを書いたときだけ上書きし、
// 書かなければ親を継ぐ」。`/users/[id]` は title/description/OGP は書くが
// `robots` を書いていなかったので、**sitemap.xml に載せている静的な
// プロフィールページが全部 `noindex`** で出ていた（実ビルドで確認）。
// 「見に来い」と呼んでおいて「載せるな」と言う形で、Search Console では
// 「送信された URL が noindex です」になる。
//
// このテストが無かったのは、上の2本が**レイアウト単体**しか見ていなかった
// ため。ここでは子のページの `generateMetadata` を実際に呼ぶ。
describe("/users/<id>（プロフィール）のメタデータ", () => {
    // `app/data/photos.json` に実在する userId（ここが実在しないと
    // 「見つからない」側の早期 return を測ることになる）
    const OWNER = "67d49a68-80f1-7083-b0e0-c767886ef868";

    it("検索結果に出す（親の noindex を継がない）", async () => {
        const { generateMetadata } = await import("../users/[id]/page");
        const meta = await generateMetadata({ params: Promise.resolve({ id: OWNER }) });
        expect(meta.robots, "sitemap に載せているのに noindex で出している")
            .toMatchObject({ index: true });
    });

    // **サイト名は親のレイアウトが渡す `template` が付ける。**
    // 親が `title` を素の文字列で置いていた間はテンプレートがそこで
    // 消費され、`/users/<id>` と `/users/search` だけ `<title>` から
    // サイト名が落ちていた（実ビルドで確認。`og:title` は各ページが
    // 自分で足すので、同じページの中で食い違っていた）。
    it("親のレイアウトが子へ template を渡す", async () => {
        const { metadata } = await import("../users/layout");
        const title = metadata.title as { absolute?: string; template?: string };
        expect(title.template, "テンプレートを子へ渡していない（子の <title> からサイト名が落ちる）")
            .toContain("Journey Photo");
        // 自分のぶんは absolute。`default` だとルートの template が
        // 重ねて掛かり、サイト名が2回入る（実ビルドで確認）
        expect(title.absolute).toBe("ユーザー | Journey Photo 旅フォトギャラリー");
    });

    // 代表画像はその人の最新投稿で縦横比はまちまち。実寸は持っていない
    // （`photos.json` の30枚は 0/30）ので、寸法を申告しない
    it("OGP 画像に決め打ちの寸法を付けない", async () => {
        const { generateMetadata } = await import("../users/[id]/page");
        const meta = await generateMetadata({ params: Promise.resolve({ id: OWNER }) });
        const images = meta.openGraph?.images;
        if (Array.isArray(images) && images.length > 0 && typeof images[0] === "object") {
            expect(images[0], "実寸を知らないのに 1200x800 を名乗っている").not.toHaveProperty("width");
        }
    });
});
