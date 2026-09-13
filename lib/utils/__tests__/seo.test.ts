import { describe, it, expect } from "vitest";
import {
    siteConfig,
    generateStructuredData,
    generatePhotoStructuredData,
    generateBreadcrumbStructuredData,
    generateOrganizationStructuredData,
    generateWebSiteStructuredData,
} from "../seo";

describe("siteConfig", () => {
    it("必須フィールドが揃っている", () => {
        expect(siteConfig.name).toBeTruthy();
        expect(siteConfig.description).toBeTruthy();
        expect(siteConfig.url).toBeTruthy();
    });
});

describe("generateStructuredData", () => {
    it("ImageGallery スキーマを生成する", () => {
        const data = generateStructuredData([
            { id: "1", src: "https://cdn.example.com/1.jpg", title: { ja: "タイトル", en: "Title" } },
        ]);
        expect(data["@type"]).toBe("ImageGallery");
        expect((data.image as unknown[]).length).toBe(1);
    });

    it("id や src が空のエントリは除外する", () => {
        const data = generateStructuredData([
            { id: "", src: "x.jpg" },
            { id: "2", src: "" },
            { id: "3", src: "https://cdn.example.com/3.jpg" },
        ]);
        expect((data.image as unknown[]).length).toBe(1);
    });

    it("相対 src には siteConfig.url を付与する", () => {
        const data = generateStructuredData([{ id: "1", src: "/img/1.jpg" }]);
        const img = (data.image as Array<{ contentUrl: string }>)[0];
        expect(img.contentUrl).toContain(siteConfig.url);
        expect(img.contentUrl).toContain("/img/1.jpg");
    });
});

describe("generatePhotoStructuredData", () => {
    const base = { id: "abc", src: "https://cdn.example.com/abc.jpg" };

    it("ImageObject スキーマを生成する", () => {
        const data = generatePhotoStructuredData(base);
        expect(data["@type"]).toBe("ImageObject");
        expect(data["@id"]).toContain("abc");
    });

    it("photographer がある場合 creator を含む", () => {
        const data = generatePhotoStructuredData({ ...base, photographer: "山田太郎" });
        expect((data.creator as { name: string }).name).toBe("山田太郎");
    });

    // **人名で探されたときのため。** 保存されている表示名は「丸田 竜平」
    // （空白入り）だが、探す側は「丸田竜平」とも打つ。`/users/<id>` の
    // `Person` と**同じ規則**で別表記を出す（30枚の写真ページと
    // プロフィールが違う名前の集合を名乗ると、同定の手がかりにならない）
    /**
     * **本番が通るのは `displayName` の側。** `credit` は
     * `photo.photographer || photo.displayName` で、実データ30枚は
     * `photographer` が **0/30**・`displayName` が **30/30**（実測）。
     * `photographer` だけでテストを書くと、`credit` を `photographer` に
     * 変える変異が**素通りしたまま本番30ページの別表記が消える**
     */
    it("displayName（本番が通る側）でも別表記を出す", () => {
        const data = generatePhotoStructuredData({ ...base, displayName: "丸田 竜平" });
        const creator = data.creator as { name: string; alternateName?: string };
        expect(creator.name).toBe("丸田 竜平");
        expect(creator.alternateName, "本番の経路で別表記が出ていない").toBe("丸田竜平");
    });

    it("日本語の名前は、空白を詰めた別表記も名乗る", () => {
        const data = generatePhotoStructuredData({ ...base, photographer: "丸田 竜平" });
        const creator = data.creator as { name: string; alternateName?: string };
        expect(creator.name).toBe("丸田 竜平");
        expect(creator.alternateName, "空白を詰めた別表記が出ていない").toBe("丸田竜平");
        expect((data.author as { alternateName?: string }).alternateName).toBe("丸田竜平");
    });

    it("ラテン文字の名前には別表記を作らない", () => {
        const data = generatePhotoStructuredData({ ...base, photographer: "John Smith" });
        expect("alternateName" in (data.creator as object)).toBe(false);
    });

    /**
     * **説明はこのページの言語で1本だけ。**
     *
     * 以前は日英を `" / "` で併記していた。同じページの
     * `<meta name="description">` は日本語だけを出しているので、
     * **機械向けの経路にだけ英語が残っていた**。schema.org の
     * `description` は「そのものの説明」で、2言語を `/` で繋いだ文字列は
     * どちらの言語としても読めない。
     */
    it("説明は日本語だけ（英語を併記しない）", () => {
        const data = generatePhotoStructuredData({
            ...base,
            description: { ja: ["静かな朝でした。"], en: ["It was a quiet morning."] },
        }, "ja");
        expect(data.description).toBe("静かな朝でした。");
        expect(data.caption).toBe("静かな朝でした。");
        expect(JSON.stringify(data), "英語が併記されている").not.toContain("quiet morning");
    });

    it("日本語の説明が無ければ英語に落ちる", () => {
        const data = generatePhotoStructuredData({
            ...base, description: { en: ["Only English."] },
        }, "ja");
        expect(data.description).toBe("Only English.");
    });

    // **題の別言語は捨てていない**——`alternateName` が持つ
    // （「別の呼び名」を置く正しい場所で、混ぜ物にならない）
    it("題の英語は alternateName に残る", () => {
        const data = generatePhotoStructuredData({
            ...base, title: { ja: "北海道の桜", en: "Cherry Blossoms" },
        }, "ja");
        expect(data.name).toBe("北海道の桜");
        expect(data.alternateName).toBe("Cherry Blossoms");
    });

    it("location + coords がある場合 contentLocation に geo を含む", () => {
        const data = generatePhotoStructuredData({
            ...base,
            location: "東京",
            coords: { lat: 35.68, lng: 139.69 },
        });
        const loc = data.contentLocation as { "@type": string; geo: { latitude: number } };
        expect(loc["@type"]).toBe("Place");
        expect(loc.geo.latitude).toBe(35.68);
    });

    // 地名から引いたおおよその座標（街の中心）は「撮影地点」として出さない。
    // 画面では「地図で見る」を消したのに、構造化データにだけ座標を書くと
    // 検索エンジンにはそこで撮ったと伝わる（レビュー指摘）
    it("おおよその座標（geoApprox）では geo を出さず、地名だけ残す", () => {
        const data = generatePhotoStructuredData({
            ...base,
            location: "東京",
            coords: { lat: 35.68, lng: 139.69 },
            geoApprox: true,
        });
        const loc = data.contentLocation as { "@type": string; name: string; geo?: unknown };
        expect(loc.name).toBe("東京");
        expect(loc.geo, "街の中心を撮影地点として出している").toBeUndefined();
    });

    it("title が LocalizedText の場合 locale に応じたテキストを使う", () => {
        const data = generatePhotoStructuredData(
            { ...base, title: { ja: "日本語タイトル", en: "English Title" } },
            "en"
        );
        expect(data.name).toBe("English Title");
    });

    it("もう一方の言語タイトルを alternateName に入れる（日英露出）", () => {
        const data = generatePhotoStructuredData(
            { ...base, title: { ja: "白鳥", en: "Swan" } },
            "ja"
        );
        expect(data.name).toBe("白鳥");
        expect(data.alternateName).toBe("Swan");
    });

    /**
     * **かつては日英併記だった**（「両言語のクエリで拾えるように」）。
     * その前提——英語UIが選べること——は `6d72bfb` で消えている
     * （`locale` は `ja` 固定・切替の呼び出しはテスト以外に0件）。
     * 台帳は同じ理由で `og:locale:alternate` も撤去した（I18N-2）。
     */
    it("説明はこのページの言語で1本・caption も同じ", () => {
        const data = generatePhotoStructuredData({
            ...base,
            description: { ja: ["湖の白鳥"], en: ["Swans on the lake"] },
        });
        expect(data.description).toBe("湖の白鳥");
        expect(data.caption).toBe(data.description);
        expect(String(data.description), "英語が併記されている").not.toContain("Swans on the lake");
    });

    it("thumbnailUrl / keywords / datePublished / representativeOfPage を含む", () => {
        const data = generatePhotoStructuredData({
            ...base,
            thumbSrc: "https://cdn.example.com/abc_thumb.webp",
            tags: ["白鳥", "swan"],
            createdAt: "2026-05-01T00:00:00.000Z",
        });
        expect(data.thumbnailUrl).toBe("https://cdn.example.com/abc_thumb.webp");
        expect(data.keywords).toBe("白鳥, swan");
        expect(data.datePublished).toBe("2026-05-01T00:00:00.000Z");
        expect(data.representativeOfPage).toBe(true);
    });

    it("license は URL のみ有効。自由文は copyrightNotice に回す", () => {
        const url = generatePhotoStructuredData({ ...base, license: "https://creativecommons.org/licenses/by/4.0/" });
        expect(url.license).toBe("https://creativecommons.org/licenses/by/4.0/");
        expect(url.acquireLicensePage).toContain("/photo/abc");
        const text = generatePhotoStructuredData({ ...base, license: "All rights reserved" });
        expect(text.license).toBeUndefined();
        expect(text.copyrightNotice).toBe("All rights reserved");
    });

    it("photographer/displayName は creditText に入る", () => {
        const data = generatePhotoStructuredData({ ...base, displayName: "丸田" });
        expect(data.creditText).toBe("丸田");
    });
});

describe("generateBreadcrumbStructuredData", () => {
    it("BreadcrumbList に position が連番で入る", () => {
        const data = generateBreadcrumbStructuredData([
            { name: "Home", url: "https://example.com" },
            { name: "Photo", url: "https://example.com/photo/1" },
        ]);
        expect(data["@type"]).toBe("BreadcrumbList");
        const items = data.itemListElement as Array<{ position: number }>;
        expect(items[0].position).toBe(1);
        expect(items[1].position).toBe(2);
    });
});

describe("generateOrganizationStructuredData", () => {
    it("Organization スキーマを返す", () => {
        const data = generateOrganizationStructuredData();
        expect(data["@type"]).toBe("Organization");
        expect(data.url).toBe(siteConfig.url);
    });
});

describe("generateWebSiteStructuredData", () => {
    it("WebSite スキーマを返す", () => {
        const data = generateWebSiteStructuredData();
        expect(data["@type"]).toBe("WebSite");
        expect(data.url).toBe(siteConfig.url);
    });
});

// タグ・撮影地・カテゴリのページも同じ関数を使っている。引数を渡していなかった
// ため、**約35個のURLが「自分はトップページだ」と申告していた**
// （name も description も url も siteConfig 直書き）。
describe("generateStructuredData: コレクションページ", () => {
    const photos = [{ id: "1", src: "/img/1.jpg" }];

    it("渡された名前・説明・URLを名乗る", () => {
        const data = generateStructuredData(photos, {
            name: "バルセロナの写真",
            description: "バルセロナで撮影した旅の写真",
            url: "https://journey-photo.com/location/barcelona",
        }) as Record<string, unknown>;
        expect(data.name).toBe("バルセロナの写真");
        expect(data.description).toBe("バルセロナで撮影した旅の写真");
        expect(data.url).toBe("https://journey-photo.com/location/barcelona");
    });

    it("渡さなければ従来どおりトップページとして名乗る（トップの動きを壊さない）", () => {
        const data = generateStructuredData(photos) as Record<string, unknown>;
        expect(data.url).toBe("https://journey-photo.com");
    });
});

// 撮影日を持つのは30枚中8枚。残りは「撮った日」としてアップロード日を
// 申告していた（本文側と同じ嘘を機械可読でも配っていた）。
describe("写真の構造化データ: 撮影日", () => {
    const base = { id: "p1", src: "https://cdn/p1.jpg", createdAt: "2026-04-12T14:24:05.104Z" };

    it("撮影日があれば dateCreated に入れる", () => {
        const d = generatePhotoStructuredData({ ...base, date: "2024-10-12" }) as Record<string, unknown>;
        expect(d.dateCreated).toBe("2024-10-12");
    });

    it("撮影日が無ければ dateCreated を出さない（登録日で代用しない）", () => {
        const d = generatePhotoStructuredData(base) as Record<string, unknown>;
        expect(d).not.toHaveProperty("dateCreated");
        // 公開日は登録日時のままでよい
        expect(d.datePublished).toBe(base.createdAt);
    });
});

// **JSON-LD の description / caption も1行に均す**（実ビルドで8件が
// 生の改行を含んでいた）。画像サイトマップの caption もここから出る
describe("写真の構造化データ: 説明は1行", () => {
    it("説明の改行を空白にする", () => {
        const d = generatePhotoStructuredData(
            { id: "p1", src: "https://cdn/1.jpg", description: { ja: ["一行目。\n二行目。"] } } as unknown as Parameters<typeof generatePhotoStructuredData>[0],
        ) as Record<string, unknown>;
        expect(String(d.description), "生の改行が残っている").not.toContain("\n");
        expect(d.description).toBe("一行目。 二行目。");
        expect(d.caption).toBe("一行目。 二行目。");
    });
});
