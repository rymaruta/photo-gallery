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

    // **書かれた説明に既に撮影地が入っていたら足さない。**
    // 実データ2枚で「北海道にも春が訪れ…（北海道 / SONY ILCE-7M3）」に
    // なっていた（組み立て文の重複だけ塞いで、こちらは素通りしていた）
    it("説明に撮影地が入っていれば、撮影地は足さない", async () => {
        const m = await meta({
            ...base, location: "北海道",
            description: { ja: ["北海道にも春が訪れ、桜が咲き誇る季節となった。"] },
            exif: { camera: "SONY ILCE-7M3" },
        });
        expect(m.description, "撮影地が二重に出ている").not.toContain("（北海道");
        // 機材は足す（説明に入っていない）
        expect(m.description).toContain("SONY ILCE-7M3");
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

/**
 * **撮影地の方が題を含む回**に、題と撮影地を重ねていた。
 * 実ビルド:「オペラ・ガルニエ｜オペラ・ガルニエ（パリ）」＝サイトで一番長い題。
 * 判定が「題が撮影地を含むか」の片方向だけだった。
 */
describe("題と撮影地が重なるとき", () => {
    it("撮影地の方が題を含むなら、撮影地を出す（重ねない）", async () => {
        const m = await meta({ ...base, title: { ja: "オペラ・ガルニエ" }, location: "オペラ・ガルニエ（パリ）" });
        expect(m.title).toBe("オペラ・ガルニエ（パリ）");
    });

    // **短い題がたまたま撮影地の一部と一致する回を巻き込まない。**
    // 「海」は「…国営ひたち海浜公園」に含まれるが、撮影地は「海」で
    // 始まっていないので足す側のまま（実データで確認）
    it("題が撮影地の途中に現れるだけなら、今までどおり足す", async () => {
        const m = await meta({ ...base, title: { ja: "海" }, location: "茨城県 ひたちなか市 国営ひたち海浜公園" });
        expect(m.title).toBe("海｜茨城県 ひたちなか市 国営ひたち海浜公園");
    });

    it("題と撮影地が同じなら、題を残す", async () => {
        const m = await meta({ ...base, title: { ja: "山中湖" }, location: "山中湖" });
        expect(m.title).toBe("山中湖");
    });
});

/**
 * **説明の改行が `<meta name="description">` の属性値に残っていた**
 * （実ビルドで写真ページ5枚 × 3メタ）。`app/users/[id]` は自己紹介に
 * 同じ処理を前からしていた＝片方だけ素通りしていた。
 */
describe("説明は1行に均す", () => {
    it("説明の中の改行を空白にする", async () => {
        const m = await meta({ ...base, description: { ja: ["一行目。\n二行目。"] } });
        expect(m.description, "生の改行が残っている").not.toContain("\n");
        expect(m.description).toContain("一行目。 二行目。");
    });

    it("段落をまたぐ改行も残さない", async () => {
        const m = await meta({ ...base, description: { ja: ["前\n半", "後\n半"] } });
        expect(m.description).not.toContain("\n");
    });
});
