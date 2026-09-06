import { describe, it, expect } from "vitest";
import { clusterPoints, boundsOf, project } from "../mapClusters";

// 地図ページのピンの束ね方（格子）。Leaflet は jsdom で動かさないので、
// 束ねの規則だけをここで縛る。

const tokyo = { id: "t", lat: 35.68, lng: 139.77 };
const shibuya = { id: "s", lat: 35.66, lng: 139.70 };   // 東京から約7km
const paris = { id: "p", lat: 48.86, lng: 2.35 };

describe("clusterPoints", () => {
    it("引いた地図（低ズーム）では近い点が1つに束なる", () => {
        const out = clusterPoints([tokyo, shibuya, paris], 4);
        expect(out).toHaveLength(2);
        const tk = out.find((c) => c.items.some((i) => i.id === "t"))!;
        expect(tk.items.map((i) => i.id).sort()).toEqual(["s", "t"]);
        // 中心はメンバーの平均
        expect(tk.lat).toBeCloseTo((35.68 + 35.66) / 2, 6);
        expect(tk.lng).toBeCloseTo((139.77 + 139.70) / 2, 6);
    });

    it("寄った地図（高ズーム）では同じ点がばらける", () => {
        const out = clusterPoints([tokyo, shibuya, paris], 12);
        expect(out).toHaveLength(3);
        for (const c of out) expect(c.items).toHaveLength(1);
    });

    // **升の一辺を変えると束なり方が変わる**（ピンの大きさに合わせるつまみ）。
    // 同じズームでも升を大きくすれば束なる
    it("升を大きくすると、同じズームでも束なる", () => {
        expect(clusterPoints([tokyo, shibuya], 10, 56).length).toBe(2);
        expect(clusterPoints([tokyo, shibuya], 10, 4000).length).toBe(1);
    });

    it("座標が読めない点は落とす（NaN を平均に混ぜない）", () => {
        const out = clusterPoints([tokyo, { id: "x", lat: NaN, lng: 1 }], 4);
        expect(out).toHaveLength(1);
        expect(out[0].items.map((i) => i.id)).toEqual(["t"]);
        expect(Number.isFinite(out[0].lat)).toBe(true);
    });

    it("入力の順に依存しない（描画順が安定する）", () => {
        // **升の登場順が入れ替わる並びにする。** `[tokyo, paris, shibuya]` と
        // `[shibuya, paris, tokyo]` では、東京と渋谷が同じ升なので Map の
        // 挿入順がどちらも「東京の升 → パリの升」になり、並べ替えを消しても
        // 通ってしまう（レビュー指摘）。パリを先頭に置いた並びと比べる
        const a = clusterPoints([paris, tokyo, shibuya], 4).map((c) => c.items.map((i) => i.id).sort().join());
        const b = clusterPoints([tokyo, shibuya, paris], 4).map((c) => c.items.map((i) => i.id).sort().join());
        expect(a).toEqual(b);
    });

    it("空なら空", () => {
        expect(clusterPoints([], 4)).toEqual([]);
    });

    it("升の一辺が 0 以下なら投げる（無限ループや NaN のキーにしない）", () => {
        expect(() => clusterPoints([tokyo], 4, 0)).toThrow(RangeError);
    });
});

describe("project", () => {
    it("原点（0,0）はズーム0で 128,128（256px タイルの中心）", () => {
        const { x, y } = project(0, 0, 0);
        expect(x).toBeCloseTo(128, 6);
        expect(y).toBeCloseTo(128, 6);
    });

    it("北へ行くと y が小さくなる（画面の上）", () => {
        expect(project(35, 0, 2).y).toBeLessThan(project(0, 0, 2).y);
    });

    it("極付近は頭打ちにして NaN にしない", () => {
        expect(Number.isFinite(project(90, 0, 3).y)).toBe(true);
        expect(Number.isFinite(project(-90, 0, 3).y)).toBe(true);
    });
});

describe("boundsOf", () => {
    it("全部が入る矩形", () => {
        expect(boundsOf([tokyo, paris])).toEqual({ south: 35.68, west: 2.35, north: 48.86, east: 139.77 });
    });

    it("点が無ければ null（`fitBounds` に空を渡さない）", () => {
        expect(boundsOf([])).toBeNull();
        expect(boundsOf([{ id: "x", lat: NaN, lng: NaN }])).toBeNull();
    });
});
