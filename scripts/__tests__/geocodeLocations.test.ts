import { describe, it, expect, beforeAll, vi } from "vitest";

// 地名→おおよその座標の補填（地図ページの材料）。
// 本番の写真32枚に座標が1枚も無く（`diagnose` 実測）、地名は半分強に付いている。
// **GPS 由来の正確な座標は絶対に上書きしない**——それだけは書き込みの条件式
// （`attribute_not_exists(coords)`）と、対象の選び方の両方で守る。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let normalizeLocationName: any, pickCoords: any, planTargets: any, geocodeAll: any, looksRelated: any, skipSet: any, INTERVAL_MS: number;
beforeAll(() => {
    process.env.PHOTOS_TABLE = "photos-test";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ normalizeLocationName, pickCoords, planTargets, geocodeAll, looksRelated, skipSet, INTERVAL_MS } = require("../geocode-locations.js"));
});

describe("normalizeLocationName", () => {
    it("前後・連続・全角の空白を整える（同じ地名を1回しか引かないための鍵）", () => {
        expect(normalizeLocationName("  パリ,   フランス ")).toBe("パリ, フランス");
        expect(normalizeLocationName("東京　渋谷")).toBe("東京 渋谷");
    });
    it("大文字小文字は畳まない（表記どおり渡す方が当たる）", () => {
        expect(normalizeLocationName("Paris")).toBe("Paris");
    });
    it("文字列でなければ空", () => {
        expect(normalizeLocationName(undefined)).toBe("");
        expect(normalizeLocationName(42)).toBe("");
    });
});

describe("pickCoords", () => {
    it("約1kmに丸める（アップロード側の sanitizeCoords と同じ精度）", () => {
        expect(pickCoords([{ lat: "48.8588897", lon: "2.3200410", display_name: "パリ" }]))
            .toEqual({ lat: 48.86, lng: 2.32, label: "パリ" });
    });
    // 本番の最初のドライランで「福岡」が富山県の福岡町に当たった（先頭を
    // 採っていた）。Nominatim は文字の一致を優先するので、有名な同名の街より
    // 小さい町が先頭に来ることがある。知名度（importance）で選ぶ
    it("先頭ではなく importance が最大の結果を採る（福岡町ではなく福岡市）", () => {
        const json = [
            { lat: "36.71", lon: "136.93", importance: 0.31, display_name: "福岡町, 高岡市, 富山県" },
            { lat: "33.59", lon: "130.40", importance: 0.72, display_name: "福岡市, 福岡県" },
            { lat: "33.60", lon: "130.42", importance: 0.55, display_name: "福岡県" },
        ];
        expect(pickCoords(json)).toEqual({ lat: 33.59, lng: 130.4, label: "福岡市, 福岡県" });
    });
    it("importance が無い結果は最後に回す（読める座標があれば必ず何かは返す）", () => {
        expect(pickCoords([{ lat: "1", lon: "2" }, { lat: "3", lon: "4", importance: 0.1 }]))
            .toEqual({ lat: 3, lng: 4, label: "" });
    });
    it("空・読めない・範囲外は null", () => {
        expect(pickCoords([])).toBeNull();
        expect(pickCoords(null)).toBeNull();
        expect(pickCoords([{ lat: "abc", lon: "2" }])).toBeNull();
        expect(pickCoords([{ lat: "91", lon: "2" }])).toBeNull();
        // 配列に null が混じっても投げない（旧実装は `r.importance` の参照で TypeError を投げていた）
        expect(pickCoords([null, { lat: "1", lon: "2" }])).toEqual({ lat: 1, lng: 2, label: "" });
        expect(pickCoords([null])).toBeNull();
        // 読めない行が importance 最大でも、それは飛ばして読める行を採る
        expect(pickCoords([{ lat: "91", lon: "2", importance: 0.9 }, { lat: "1", lon: "2", importance: 0.1 }]))
            .toEqual({ lat: 1, lng: 2, label: "" });
    });
});

describe("planTargets（対象の選び方）", () => {
    const rows = [
        { id: "a", src: "https://x/a.jpg", location: "パリ" },                       // 対象
        { id: "b", src: "https://x/b.jpg", location: "パリ", coords: { lat: 48.86, lng: 2.35 } }, // 正確な座標あり → 触らない
        { id: "c", src: "https://x/c.jpg" },                                         // 地名なし
        { id: "d", src: "https://x/d.jpg", location: "   " },                        // 空の地名
        { id: "e", src: "https://x/e.mp4", story: true, location: "パリ" },          // ストーリー
        { id: "like#p1#u1", location: "パリ" },                                      // 管理用文書（src なし）
        { id: "f", src: "https://x/f.jpg", location: " パリ " },                    // 表記ゆれ → 同じ地名
    ];
    it("写真で・地名があり・座標が無いものだけ", () => {
        expect(planTargets(rows).map((t: { id: string }) => t.id)).toEqual(["a", "f"]);
    });
    it("**座標のある行は対象にしない**（GPS 由来の正確な値を上書きしない）", () => {
        expect(planTargets(rows).some((t: { id: string }) => t.id === "b")).toBe(false);
    });
    it("表記ゆれは同じ地名に寄せる（1回しか引かない）", () => {
        const names = new Set(planTargets(rows).map((t: { name: string }) => t.name));
        expect([...names]).toEqual(["パリ"]);
    });
});

describe("geocodeAll", () => {
    it("同じ地名は1回だけ引き、User-Agent を名乗り、1秒以上あける", async () => {
        vi.useFakeTimers();
        const calls: { url: string; ua: string | undefined }[] = [];
        const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
            calls.push({ url, ua: init?.headers?.["User-Agent"] });
            return { ok: true, json: async () => [{ lat: "35.68", lon: "139.77" }] };
        });
        const p = geocodeAll(["東京", "パリ"], fetchImpl);
        await vi.advanceTimersByTimeAsync(0);
        expect(calls, "2件目を1秒待たずに投げている").toHaveLength(1);
        await vi.advanceTimersByTimeAsync(INTERVAL_MS);
        const out = await p;
        vi.useRealTimers();

        expect(calls).toHaveLength(2);
        expect(calls[0].url).toContain("q=%E6%9D%B1%E4%BA%AC");
        expect(calls[0].url, "知名度で選ぶには複数件が要る").toContain("limit=5");
        expect(calls[0].ua, "Nominatim の規約: 識別できる UA が要る").toMatch(/journey-photo/);
        expect(out.get("東京")).toEqual({ lat: 35.68, lng: 139.77, label: "" });
    });

    it("HTTP エラーや例外は null にして先へ進む（1つで全部を止めない）", async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429 })
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce({ ok: true, json: async () => [{ lat: "1", lon: "2" }] });
        const p = geocodeAll(["a", "b", "c"], fetchImpl);
        await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
        const out = await p;
        vi.useRealTimers();
        expect(out.get("a")).toBeNull();
        expect(out.get("b")).toBeNull();
        expect(out.get("c")).toEqual({ lat: 1, lng: 2, label: "" });
    });
});

// 2回目の本番ドライランで「土谷棚田」（長崎県松浦市）が名古屋市瑞穂図書館に
// 当たった。Nominatim は知らない地名でも何かを返す。表示名に地名の語が
// 1つも無ければ「引けなかった」にする
describe("looksRelated（別の場所に当たっていないか）", () => {
    it("表示名に地名の語が無ければ弾く", () => {
        expect(looksRelated("土谷棚田", "名古屋市瑞穂図書館, 29番地, 豊岡通三丁目, 瑞穂区, 名古屋市, 愛知県, 日本")).toBe(false);
    });
    it("語が1つでも入っていれば通す（補足の括弧・空白区切り・中黒）", () => {
        expect(looksRelated("オペラ・ガルニエ（パリ）", "ガルニエ宮, Place de l'Opéra, 9区, パリ, フランス")).toBe(true);
        expect(looksRelated("フランス ヴェルサイユ", "ヴェルサイユ, イヴリーヌ, イル＝ド＝フランス地域圏, フランス")).toBe(true);
        expect(looksRelated("パリ/フランス", "パリ, イル＝ド＝フランス地域圏, フランス")).toBe(true);
        // 英数字は大小を同一視（表示名が英語で返るとき）
        expect(looksRelated("paris", "Paris, Île-de-France, France")).toBe(true);
        expect(looksRelated("茨城県 ひたちなか市 国営ひたち海浜公園", "国営ひたち海浜公園, 4, ひたちなか市, 茨城県, 日本")).toBe(true);
    });
    it("同名の別の場所は見分けられない（福岡→福岡町も通る。GEOCODE_SKIP で外す）", () => {
        expect(looksRelated("福岡", "福岡, 福岡停車場線, 福岡町福岡, 高岡市, 富山県, 日本")).toBe(true);
    });
    it("1文字の語だけ・表示名が無い場合は判定しない（正しい結果を弾く側に倒さない）", () => {
        expect(looksRelated("東 京", "Tokyo")).toBe(true);
        expect(looksRelated("土谷棚田", "")).toBe(true);
    });

    it("geocodeAll は別の場所に当たった結果を null にする（書き込み対象から外れる）", async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [{ lat: "35.12", lon: "136.94", display_name: "名古屋市瑞穂図書館, 名古屋市, 愛知県" }] }));
        const p = geocodeAll(["土谷棚田"], fetchImpl);
        await vi.advanceTimersByTimeAsync(0);
        const out = await p;
        vi.useRealTimers();
        expect(out.get("土谷棚田")).toBeNull();
    });
});

describe("skipSet（GEOCODE_SKIP）", () => {
    it("セミコロン区切りを地名の鍵に寄せる（空白の表記ゆれも同じ鍵）", () => {
        expect([...skipSet("福岡; 土谷棚田 ;;")]).toEqual(["福岡", "土谷棚田"]);
        expect(skipSet("").size).toBe(0);
        expect(skipSet(undefined).size).toBe(0);
    });
    // 本番の地名に「パリ, フランス」がある。カンマで割ると**それは残り、
    // 無関係な「パリ」「フランス」が飛ぶ**（レビュー指摘）
    it("地名の中のカンマで割らない", () => {
        expect([...skipSet("パリ, フランス")]).toEqual(["パリ, フランス"]);
    });
});
