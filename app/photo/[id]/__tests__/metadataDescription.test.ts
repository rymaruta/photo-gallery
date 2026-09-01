import { describe, it, expect, vi, afterEach } from "vitest";

// **説明が無い写真の meta description。**
//
// 最初の版は「撮影地・カテゴリ・撮影年」を「・」で連ねて
// `${facts.join("・")}で撮影した写真。` と書いていた。実ビルドで測ると:
//
//   東京・landscape・2024年で撮影した写真。   ← カテゴリの生スラッグが出る
//   風景で撮影した写真。                      ← カテゴリを撮影地のように述べる
//   2024年で撮影した写真。                    ← 「に」であるべき
//
// 実データ30枚中19枚がカテゴリを英語スラッグで持っており（画面は
// `app/i18n/labels.ts` の日本語ラベルを出す）、`a287ee3` で潰した
// 「日本語UIに残る英語」を作っていた。

const photos = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/server/photos", () => ({
    loadAllPhotos: async () => photos,
    resolveOgImage: async () => "https://cdn/og.jpg",
}));
vi.mock("../../../../lib/server/staticParams", () => ({ withPlaceholderParam: (v: unknown) => v }));

afterEach(() => { photos.length = 0; });

async function describeOf(photo: Record<string, unknown>): Promise<string> {
    photos.length = 0;
    photos.push({ id: "p1", src: "https://cdn/p1.jpg", published: true, ...photo });
    const { generateMetadata } = await import("../page");
    const meta = await generateMetadata({ params: Promise.resolve({ id: "p1" }) });
    return String(meta.description ?? "");
}

describe("説明が無い写真の meta description", () => {
    it("カテゴリは日本語ラベルにする（生スラッグを出さない）", async () => {
        const d = await describeOf({ location: "東京", category: "landscape", date: "2024-05-03" });
        expect(d, "英語のスラッグがそのまま出ている").not.toContain("landscape");
        expect(d).toBe("東京で2024年に撮影した風景の写真。");
    });

    it("日付だけなら「に」でつなぐ", async () => {
        const d = await describeOf({ date: "2024-05-03" });
        expect(d).toBe("2024年に撮影した写真。");
    });

    it("カテゴリだけなら「撮影した」を付けない", async () => {
        const d = await describeOf({ category: "nature" });
        expect(d).toBe("自然の写真。");
    });

    it("日本語のカテゴリはそのまま使う", async () => {
        const d = await describeOf({ location: "京都", category: "祭り" });
        expect(d).toBe("京都で撮影した祭りの写真。");
    });

    // 何も分からなければ、初めてサイトの説明に落とす
    it("材料が無ければサイトの説明", async () => {
        const d = await describeOf({});
        expect(d).toContain("旅");
    });

    // 正常系: 自分の説明があればそちらを出す
    it("説明があればそれを出す", async () => {
        const d = await describeOf({ description: { ja: ["静かな朝だった。"] }, location: "東京" });
        expect(d).toBe("静かな朝だった。");
    });
});
