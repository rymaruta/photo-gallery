import { describe, it, expect } from "vitest";
import { chooseInitialView, formatMapHash, parseMapHash, readSavedView, saveView, MAP_VIEW_KEY, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from "../mapView";

// 撮影地マップの「どこを見ているか」の受け渡し。Leaflet 無しで決め方だけを見る

class MemStorage implements Storage {
    private m = new Map<string, string>();
    get length() { return this.m.size; }
    clear() { this.m.clear(); }
    getItem(k: string) { return this.m.get(k) ?? null; }
    key(i: number) { return [...this.m.keys()][i] ?? null; }
    removeItem(k: string) { this.m.delete(k); }
    setItem(k: string, v: string) { this.m.set(k, v); }
}

describe("ハッシュ", () => {
    it("#z/lat/lng を往復できる", () => {
        expect(formatMapHash({ lat: 35.42, lng: 138.88, zoom: 12 })).toBe("#12/35.42/138.88");
        expect(parseMapHash("#12/35.42/138.88")).toEqual({ lat: 35.42, lng: 138.88, zoom: 12 });
        expect(parseMapHash("12/-33.87/151.21")).toEqual({ lat: -33.87, lng: 151.21, zoom: 12 });
    });

    it("形が違えば null（ページ内リンクなど他のハッシュを座標と読まない）", () => {
        for (const h of ["", "#", "#comments", "#12/35.42", "#12/35.42/138.88/9", "#x/1/2", "#12/abc/1"]) {
            expect(parseMapHash(h), h).toBeNull();
        }
    });

    it("ズームは引ける限界と寄れる限界の間に収める", () => {
        expect(parseMapHash("#0/35/138")!.zoom).toBe(MAP_MIN_ZOOM);
        expect(parseMapHash("#99/35/138")!.zoom).toBe(MAP_MAX_ZOOM);
        expect(formatMapHash({ lat: 35, lng: 138, zoom: 0 })).toBe(`#${MAP_MIN_ZOOM}/35/138`);
    });

    it("緯度はメルカトルの定義域に、経度は ±180 に収める", () => {
        expect(parseMapHash("#5/89/138")!.lat).toBeCloseTo(85.0511, 3);
        expect(parseMapHash("#5/35/190")!.lng).toBe(-170);
        // 範囲内の値は触らない（剰余を通すと 2.18 が 2.1800000000000637 になる）
        expect(parseMapHash("#5/48.86/2.18")!.lng).toBe(2.18);
    });

    it("読めない数は捨てる", () => {
        expect(formatMapHash({ lat: Number.NaN, lng: 1, zoom: 5 })).toBe("");
    });
});

describe("控え", () => {
    it("書いて読める（ハッシュも一緒に）", () => {
        const st = new MemStorage();
        saveView({ lat: 35.42, lng: 138.88, zoom: 6 }, "#12/1/2", st);
        expect(readSavedView(st)).toEqual({ view: { lat: 35.42, lng: 138.88, zoom: 6 }, hash: "#12/1/2" });
    });

    it("壊れた控え・無い控え・使えない保存先は null", () => {
        const st = new MemStorage();
        expect(readSavedView(st)).toBeNull();
        st.setItem(MAP_VIEW_KEY, "{not json");
        expect(readSavedView(st)).toBeNull();
        st.setItem(MAP_VIEW_KEY, JSON.stringify({ lat: "x", lng: 1, zoom: 3 }));
        expect(readSavedView(st)).toBeNull();
        expect(readSavedView(null)).toBeNull();
    });

    it("書けなくても投げない（満杯・プライベートモード）", () => {
        const st = new MemStorage();
        st.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
        expect(() => saveView({ lat: 1, lng: 2, zoom: 3 }, "", st)).not.toThrow();
        st.getItem = () => { throw new Error("denied"); };
        expect(readSavedView(st)).toBeNull();
    });
});

describe("最初に見せる場所", () => {
    const saved = { view: { lat: 48.9, lng: 2.4, zoom: 9 }, hash: "#12/48.86/2.35" };

    it("何も無ければ null（全部のピンが収まる範囲に任せる）", () => {
        expect(chooseInitialView("", null)).toBeNull();
        expect(chooseInitialView("#comments", null)).toBeNull();
    });

    it("新しいハッシュで来たら、そのハッシュの位置", () => {
        expect(chooseInitialView("#10/35.68/139.77", saved)).toEqual({ lat: 35.68, lng: 139.77, zoom: 10 });
        expect(chooseInitialView("#10/35.68/139.77", null)).toEqual({ lat: 35.68, lng: 139.77, zoom: 10 });
    });

    it("控えを取ったときと同じハッシュなら、控え（そのあと動かした場所）", () => {
        // 写真を開いて戻ると URL のハッシュは同じまま。飛んできた直後の位置へ
        // 戻すと、寄ったぶんが毎回消える
        expect(chooseInitialView("#12/48.86/2.35", saved)).toEqual(saved.view);
    });

    it("ハッシュが無ければ控え", () => {
        expect(chooseInitialView("", saved)).toEqual(saved.view);
    });
});
