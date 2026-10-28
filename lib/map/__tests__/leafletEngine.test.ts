import { describe, it, expect, vi } from "vitest";

// **読み終えた時点で要らなくなっていたら、地図を作らない。**
// StrictMode の作り直し（開発中は必ず起きる）では、1回目の読み込みが終わる前に
// 2回目が始まる。1回目が地図を作ってから捨てると、2回目は前の地図が消える前の
// 同じ箱に `L.map` を呼び、"Map container is already initialized" で落ちて
// 地図が真っ白になる（本物の Leaflet 1.9.4 で再現した）
const made = vi.hoisted(() => ({ maps: 0 }));
vi.mock("leaflet", () => ({
    map: () => {
        made.maps++;
        return { on: () => {}, once: () => {}, remove: () => {} };
    },
    tileLayer: () => ({ addTo: () => ({}) }),
    layerGroup: () => ({ addTo: () => ({}) }),
}));

const { createLeafletEngine } = await import("../leafletEngine");

describe("控えの地図（Leaflet）を作る", () => {
    it("もう要らなくなっていたら作らずに null を返す", async () => {
        const engine = await createLeafletEngine(document.createElement("div"), { reduceMotion: false, isCancelled: () => true });
        expect(engine).toBeNull();
        expect(made.maps).toBe(0);
    });

    it("要るなら作る", async () => {
        const engine = await createLeafletEngine(document.createElement("div"), { reduceMotion: false, isCancelled: () => false });
        expect(engine?.kind).toBe("leaflet");
        expect(made.maps).toBe(1);
    });
});
