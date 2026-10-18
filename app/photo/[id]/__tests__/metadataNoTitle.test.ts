import { describe, it, expect, vi } from "vitest";

// **題が無い写真の `<title>`・og:title・twitter:title**（2026-10-18）。
//
// 題が無い（欄が無い・空白だけ・旧い既定値 `{ ja: "無題", en: "Untitled" }`）と、
// 検索結果と SNS に「無題｜板橋区 | Journey Photo…」と出ていた。
// owner:「撮影地を使って『板橋区の写真』のように出す。画面の見た目は変えない。
// 検索結果と SNS に出る題だけ良くする」

const photos = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock("@/lib/server/photos", () => ({
    loadAllPhotos: async () => photos.current,
    getPhotoById: async (id: string) => photos.current.find((p) => p.id === id) ?? null,
}));

type Meta = {
    title?: string;
    openGraph?: { title?: string; images?: { alt?: string }[] };
    twitter?: { title?: string };
};
const mod = await import("../page");
const generateMetadata = (mod as unknown as { generateMetadata: (a: { params: Promise<{ id: string }> }) => Promise<Meta> }).generateMetadata;

const meta = async (photo: Record<string, unknown>) => {
    photos.current = [photo];
    return generateMetadata({ params: Promise.resolve({ id: String(photo.id) }) });
};

const base = { id: "p1", src: "https://cdn/1.jpg", published: true };

/** 3か所が同じ題を名乗る（og と twitter だけ「無題」のまま、を作らない） */
const titles = (m: Meta) => [m.title, m.openGraph?.title, m.twitter?.title];

const NO_TITLES: [string, Record<string, unknown>][] = [
    ["title の欄が無い", {}],
    ["空", { title: "" }],
    ["空白だけ", { title: { ja: "   " } }],
    ["旧い既定値 { ja: 無題, en: Untitled }", { title: { ja: "無題", en: "Untitled" } }],
];

describe("題が無い写真のページ題", () => {
    for (const [name, t] of NO_TITLES) {
        it(`${name} ＋ 撮影地あり → 「<撮影地>の写真」（｜撮影地 を二重に足さない）`, async () => {
            const m = await meta({ ...base, ...t, location: "板橋区" });
            expect(titles(m)).toEqual(["板橋区の写真", "板橋区の写真", "板橋区の写真"]);
        });

        it(`${name} ＋ 撮影地なし → 「写真」`, async () => {
            const m = await meta({ ...base, ...t });
            expect(titles(m)).toEqual(["写真", "写真", "写真"]);
        });
    }

    it("どの形でも「無題」「Untitled」を名乗らない（共有カードの alt も）", async () => {
        for (const [, t] of NO_TITLES) {
            for (const loc of [{}, { location: "板橋区" }]) {
                const m = await meta({ ...base, ...t, ...loc });
                expect(JSON.stringify(m)).not.toMatch(/無題|Untitled/);
            }
        }
    });

    // 撮影地は最初の区切りまで。題を撮影地から作ったときは「｜撮影地」を足さない
    // （「板橋区の写真｜板橋区, 日本」を作らない）
    it("撮影地「板橋区, 日本」→「板橋区の写真」（二重にしない）", async () => {
        for (const [, t] of NO_TITLES) {
            const m = await meta({ ...base, ...t, location: "板橋区, 日本" });
            expect(titles(m)).toEqual(["板橋区の写真", "板橋区の写真", "板橋区の写真"]);
        }
    });

    it("題があれば今までどおり「題｜撮影地」", async () => {
        const m = await meta({ ...base, title: { ja: "朝の湖" }, location: "板橋区" });
        expect(titles(m)).toEqual(["朝の湖｜板橋区", "朝の湖｜板橋区", "朝の湖｜板橋区"]);
        expect(titles(await meta({ ...base, title: { ja: "朝の湖" } }))).toEqual(["朝の湖", "朝の湖", "朝の湖"]);
    });
});
