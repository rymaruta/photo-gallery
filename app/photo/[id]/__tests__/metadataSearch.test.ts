import { describe, it, expect, vi } from "vitest";

// **写真ページのメタ情報が、実際に打たれる検索語に当たるか。**
//
// 実データ30枚のうち**29枚は題だけ**で、「白鳥と湖」「紅白」「Cafe」のように
// それだけでは検索語に当たらない（撮影地が題に入っているのは1枚）。
// 写真ページは索引に出せるページの約6割なので、ここが当たらないと他は誤差。
//
// ここで固定するのは:
//   - 撮影地を題に添えること（**既に入っていれば足さない**）
//   - 機材を説明に添えること（**書かれた説明は消さない**）
//   - 長い説明には足さないこと（切られて括弧が開いたまま終わる）

const photos = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock("@/lib/server/photos", () => ({
    loadAllPhotos: async () => photos.current,
    getPhotoById: async (id: string) => photos.current.find((p) => p.id === id) ?? null,
}));

const mod = await import("../page");
const generateMetadata = (mod as { generateMetadata: (a: { params: Promise<{ id: string }> }) => Promise<{ title?: string; description?: string }> }).generateMetadata;

const meta = async (photo: Record<string, unknown>) => {
    photos.current = [photo];
    return generateMetadata({ params: Promise.resolve({ id: String(photo.id) }) });
};

const base = {
    id: "p1", src: "https://cdn/1.jpg", published: true,
    title: { ja: "未完の大聖堂" },
};

describe("題に撮影地を添える", () => {
    it("撮影地があれば題に足す", async () => {
        const m = await meta({ ...base, location: "バルセロナ" });
        expect(m.title).toBe("未完の大聖堂｜バルセロナ");
    });

    // **同じ言葉を二度書かない**（「山中湖の朝｜山中湖」を作らない）
    it("題に既に入っていれば足さない", async () => {
        const m = await meta({ ...base, title: { ja: "山中湖の朝" }, location: "山中湖" });
        expect(m.title).toBe("山中湖の朝");
    });

    it("撮影地が無ければ題のまま", async () => {
        expect((await meta({ ...base })).title).toBe("未完の大聖堂");
    });
});

describe("説明に機材を添える", () => {
    it("撮影地と機材を括弧で足す", async () => {
        const m = await meta({
            ...base, location: "パリ", description: { ja: ["静かな朝でした。"] },
            exif: { camera: "SONY ILCE-7M3" },
        });
        // **書かれた説明は消さない**
        expect(m.description).toContain("静かな朝でした。");
        expect(m.description).toContain("SONY ILCE-7M3");
        expect(m.description).toContain("パリ");
    });

    // 二重のメーカー名は畳んでから出す（保存済みの値には残っている）
    it("二重のメーカー名は畳む", async () => {
        const m = await meta({
            ...base, description: { ja: ["朝。"] },
            exif: { camera: "Hasselblad Hasselblad X2D II 100C" },
        });
        expect(m.description).toContain("Hasselblad X2D II 100C");
        expect(m.description).not.toContain("Hasselblad Hasselblad");
    });

    // **長い説明には足さない。** 検索結果で切られて、括弧が開いたまま終わる
    it("長い説明には足さない", async () => {
        const long = "あ".repeat(100);
        const m = await meta({ ...base, location: "パリ", description: { ja: [long] }, exif: { camera: "SONY ILCE-7M3" } });
        expect(m.description).toBe(long);
    });

    it("機材も撮影地も無ければ、説明はそのまま", async () => {
        const m = await meta({ ...base, description: { ja: ["朝。"] } });
        expect(m.description).toBe("朝。");
    });

    // 説明が無い写真は、既存の組み立て（場所・年・カテゴリ）に機材が乗る
    it("説明が無くても、事実だけで組み立てる", async () => {
        const m = await meta({ ...base, location: "パリ", category: "landscape", exif: { camera: "SONY ILCE-7M3" } });
        expect(m.description).toContain("パリ");
        expect(m.description).toContain("SONY ILCE-7M3");
        // **サイトのキャッチコピーを名乗らない**（説明を空にした写真が全部
        // 同じ meta description を持つ形にしない）
        expect(m.description).not.toContain("旅フォトギャラリー");
    });
});
