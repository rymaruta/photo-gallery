import { describe, it, expect } from "vitest";
import {
    FRAME_PADDING, MINIMUM_SPAN, PIN_LIMIT, SPOT_MAX_LAT_SPAN,
    clusterCover, clusterFrame, clusterPhotoCount, frameContains, frameForPoints, groupPins,
    largestCluster, layoutHides, layoutPins, squeezed, visibleSpots,
    type Frame, type MapPin, type PinPhoto,
} from "../mapPins";

// iOS のアプリと同じ決まり（`MapPinClusters` / `OfficialPins` / `MapFraming`）。
// ここの試験は iOS の `MapPinClustersTests` / `OfficialPinsTests` / `MapFramingTests` の写し。
// **数字を変えるときは両方を直す**（同じ写真の地図が Web とアプリで違って見える）

const photo = (id: string, lat: number, lng: number, location: string | null = null): PinPhoto =>
    ({ id, coords: { lat, lng }, location });

const pin = (lat: number, lng: number, photos = 1): MapPin => {
    const id = `${lat},${lng}`;
    return { id, lat, lng, place: "p", photos: Array.from({ length: photos }, (_, k) => photo(`${id}-${k}`, lat, lng)) };
};

/** 0.01 度おきの格子に count 本（約1km おき＝撮影地の丸めと同じ細かさ） */
const grid = (count: number, lat0 = 35, lng0 = 139): MapPin[] =>
    Array.from({ length: count }, (_, k) => pin(lat0 + Math.floor(k / 20) * 0.01, lng0 + (k % 20) * 0.01));

const japan: Frame = { lat: 36, lng: 138, latSpan: 12, lngSpan: 12 };

describe("写真のピン（同じ座標の写真を1本に）", () => {
    it("同じ座標の写真は1本にまとめ、枚数を持つ", () => {
        const pins = groupPins([photo("a", 35.42, 138.88, "山中湖"), photo("b", 35.42, 138.88), photo("c", 48.86, 2.35)]);
        expect(pins.map((p) => [p.id, p.photos.length])).toEqual([["35.42,138.88", 2], ["48.86,2.35", 1]]);
    });

    it("撮影地はまとめた中で最初に書いてある写真の文字列。無ければ null", () => {
        const pins = groupPins([photo("a", 35, 139), photo("b", 35, 139, " 山中湖 "), photo("c", 10, 10)]);
        expect(pins.find((p) => p.id === "35,139")?.place).toBe("山中湖");
        expect(pins.find((p) => p.id === "10,10")?.place).toBeNull();
    });
});

describe("多すぎるときだけ束ねる（MapPinClusters）", () => {
    it("上限以下は枠を見ずに全部そのまま", () => {
        const pins = grid(PIN_LIMIT);
        const far: Frame = { lat: -30, lng: -60, latSpan: 1, lngSpan: 1 };
        for (const frame of [null, japan, far]) {
            const layout = layoutPins(pins, frame);
            expect(layout.pins.map((p) => p.id)).toEqual(pins.map((p) => p.id));
            expect(layout.clusters).toEqual([]);
        }
    });

    it("多いときは束ねて上限以下。写真は1枚も消えない・1本だけの束は作らない", () => {
        const layout = layoutPins(grid(400), japan);
        expect(layout.pins.length + layout.clusters.length).toBeLessThanOrEqual(PIN_LIMIT);
        expect(layout.clusters.length).toBeGreaterThan(0);
        expect(layout.pins.length + layout.clusters.reduce((n, c) => n + c.pins.length, 0)).toBe(400);
        expect(layout.clusters.every((c) => c.pins.length >= 2)).toBe(true);
    });

    it("枠がまだ無い（最初の描画）ときも上限を守る", () => {
        const pins = Array.from({ length: 300 }, (_, k) => pin((k % 60) - 30, Math.floor(k / 60) * 30 - 70));
        const layout = layoutPins(pins, null);
        expect(layout.pins.length + layout.clusters.length).toBeLessThanOrEqual(PIN_LIMIT);
        expect(layout.pins.length + layout.clusters.reduce((n, c) => n + c.pins.length, 0)).toBe(300);
    });

    it("寄せて枠の中が上限以下なら、枠の中のピンだけを束ねずに置く", () => {
        const tokyo = grid(30, 35.6, 139.6);
        const osaka = grid(200, 34.6, 135.4);
        const layout = layoutPins([...tokyo, ...osaka], { lat: 35.65, lng: 139.7, latSpan: 0.3, lngSpan: 0.3 });
        expect(layout.clusters).toEqual([]);
        expect(new Set(layout.pins.map((p) => p.id))).toEqual(new Set(tokyo.map((p) => p.id)));
    });

    it("少し動かしただけでは組み方が変わらない（格子は世界に固定）", () => {
        const pins = grid(400);
        const ids = (f: Frame) => {
            const l = layoutPins(pins, f);
            return [l.pins.map((p) => p.id), l.clusters.map((c) => [c.id, c.pins.map((p) => p.id)])];
        };
        expect(ids({ lat: 35.1, lng: 139.1, latSpan: 1, lngSpan: 1 }))
            .toEqual(ids({ lat: 35.11, lng: 139.12, latSpan: 1, lngSpan: 1 }));
    });

    it("束を押したら寄る枠は、束の全部の撮影地を含む", () => {
        for (const c of layoutPins(grid(400), japan).clusters) {
            const f = clusterFrame(c);
            for (const m of c.pins) expect(frameContains(f, m.lat, m.lng)).toBe(true);
            expect(clusterPhotoCount(c)).toBeGreaterThan(1);
            expect(clusterCover(c)).toBeDefined();
            expect(f.latSpan).toBeGreaterThanOrEqual(MINIMUM_SPAN);
        }
    });

    it("束の印は写真のいちばん多い撮影地の1枚", () => {
        const pins = grid(100);
        pins[0] = pin(35, 139, 5);
        const holding = layoutPins(pins, null).clusters.find((c) => c.pins.some((p) => p.id === "35,139"))!;
        expect(holding.pins[0].id).toBe("35,139");
        expect(clusterCover(holding)?.id).toBe("35,139-0");
    });

    it("使えない枠（幅0・数でない）は枠が無いのと同じに扱う（ピンが1本も出ない、を防ぐ）", () => {
        const pins = grid(400);
        for (const f of [{ lat: 35, lng: 139, latSpan: 0, lngSpan: 0 }, { lat: NaN, lng: 139, latSpan: 1, lngSpan: 1 }]) {
            const layout = layoutPins(pins, f);
            expect(layout.pins.length + layout.clusters.reduce((n, c) => n + c.pins.length, 0)).toBe(400);
        }
    });

    it("選んだピンが束に吸われたら選びを外す。絞り込みで結果から外れたピンは外さない", () => {
        const pins = grid(400);
        const results = new Set(pins.map((p) => p.id));
        const layout = layoutPins(pins, japan);
        const absorbed = layout.clusters[0].pins[0];
        expect(layoutHides(layout, absorbed.id, results)).toBe(true);
        if (layout.pins[0]) expect(layoutHides(layout, layout.pins[0].id, results)).toBe(false);
        expect(layoutHides(layout, null, results)).toBe(false);
        expect(layoutHides(layoutPins(grid(10), null), "10,10", new Set(grid(10).map((p) => p.id)))).toBe(false);
    });
});

describe("撮影スポットのピン（OfficialPins）", () => {
    const spot = (slug: string, lat: number, lng: number) => ({ slug, lat, lng });
    const frame = (lat: number, lng: number, span: number): Frame => ({ lat, lng, latSpan: span, lngSpan: span });

    it("枠が届く前は何も置かない", () => {
        expect(visibleSpots([spot("a", 35, 135)], null, { queryActive: false })).toEqual([]);
    });

    it("引いているときは置かない（線の上は「引いている」側）", () => {
        const spots = [spot("a", 35, 135)];
        expect(visibleSpots(spots, frame(35, 135, 0.6), { queryActive: false })).toEqual([]);
        expect(visibleSpots(spots, frame(35, 135, SPOT_MAX_LAT_SPAN), { queryActive: false })).toEqual([]);
        expect(visibleSpots(spots, frame(35, 135, 0.4), { queryActive: false })).toHaveLength(1);
    });

    it("枠の中だけ・近い順・同じ距離は slug 順", () => {
        const spots = [spot("far", 35.10, 135), spot("outside", 36, 135), spot("near-b", 35.01, 135), spot("near-a", 35.01, 135)];
        expect(visibleSpots(spots, frame(35, 135, 0.4), { queryActive: false }).map((s) => s.slug))
            .toEqual(["near-a", "near-b", "far"]);
    });

    it("上限で止める（近い順に切る）", () => {
        const spots = Array.from({ length: 80 }, (_, i) => spot(`s${String(i).padStart(3, "0")}`, 35 + i * 0.001, 135));
        const pins = visibleSpots(spots, frame(35, 135, 0.4), { queryActive: false });
        expect(pins).toHaveLength(PIN_LIMIT);
        expect(pins[0].slug).toBe("s000");
    });

    it("名前で絞っているときは引いていても・枠が無くても出す", () => {
        const spots = [spot("takaya-jinja", 34.14, 133.68)];
        expect(visibleSpots(spots, null, { queryActive: true }).map((s) => s.slug)).toEqual(["takaya-jinja"]);
        expect(visibleSpots(spots, frame(40, 140, 30), { queryActive: true }).map((s) => s.slug)).toEqual(["takaya-jinja"]);
    });

    it("語で絞っても枠は捨てない（枠の中を近い順に先、そのあと枠の外を近い順）", () => {
        const spots = [spot("asakusa", 35.71, 139.80), spot("kiyomizu", 34.99, 135.78), spot("zenkoji", 36.66, 138.19), spot("kinkaku", 35.04, 135.73)];
        expect(visibleSpots(spots, frame(35.01, 135.76, 0.3), { queryActive: true }).map((s) => s.slug))
            .toEqual(["kiyomizu", "kinkaku", "zenkoji", "asakusa"]);
        expect(visibleSpots(spots, null, { queryActive: true }).map((s) => s.slug))
            .toEqual(["asakusa", "kiyomizu", "zenkoji", "kinkaku"]);
    });

    it("名前で絞っても上限で止める", () => {
        const spots = Array.from({ length: 80 }, (_, i) => spot(`s${i}`, 35 + i * 0.001, 135));
        expect(visibleSpots(spots, null, { queryActive: true })).toHaveLength(PIN_LIMIT);
    });
});

describe("最初に見せる範囲（MapFraming）", () => {
    const tokyo = { lat: 35.68, lng: 139.76 };
    const niigata = { lat: 37.63, lng: 138.94 };
    const helsinki = { lat: 60.17, lng: 24.94 };
    const paris = { lat: 48.86, lng: 2.35 };

    it("離れた塊は混ぜない（日本3枚とヨーロッパ2枚なら日本）", () => {
        const f = frameForPoints([tokyo, niigata, { lat: 36.2, lng: 139.0 }, helsinki, paris])!;
        expect(Math.abs(f.lat - 36.65)).toBeLessThan(1);
        expect(f.latSpan).toBeLessThan(10);
    });

    it("1点だけなら、その点を中心に寄りすぎない幅で", () => {
        const f = frameForPoints([tokyo])!;
        expect(f.lat).toBeCloseTo(tokyo.lat, 3);
        expect(f.latSpan).toBeCloseTo(MINIMUM_SPAN, 3);
    });

    it("点が無ければ枠も無い", () => {
        expect(frameForPoints([])).toBeNull();
    });

    it("つながる点はぜんぶ1つの塊", () => {
        const pts = [{ lat: 50, lng: 0 }, { lat: 50, lng: 0.1 }, { lat: 40, lng: 0 }, { lat: 40, lng: 4 }, { lat: 38, lng: 2 }];
        expect(largestCluster(pts)).toHaveLength(3);
        expect(Math.abs(frameForPoints(pts)!.lat - 39)).toBeLessThan(0.5);
    });

    it("数えるのは写真の枚数（東京1地点に40枚・パリ2地点に1枚ずつなら東京）", () => {
        expect(frameForPoints([tokyo, paris, { lat: 48.87, lng: 2.36 }], [40, 1, 1])!.lat).toBeCloseTo(tokyo.lat, 2);
    });

    it("点が多くても塊の広さに上限があり、速い", () => {
        let seed = 1;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const pts = Array.from({ length: 20000 }, () => ({ lat: -60 + rnd() * 130, lng: -180 + rnd() * 360 }));
        const t = performance.now();
        const f = frameForPoints(pts)!;
        expect(performance.now() - t).toBeLessThan(1000);
        expect(f.latSpan).toBeLessThan(3 * 2.7 * FRAME_PADDING + 0.01);
    });

    it("離れた1枚で枠を広げない（東京40枚に大阪1枚）", () => {
        const f = frameForPoints([tokyo, { lat: 34.69, lng: 135.50 }], [40, 1])!;
        expect(f.lng).toBeCloseTo(tokyo.lng, 2);
        expect(f.lngSpan).toBeCloseTo(MINIMUM_SPAN, 3);
    });

    it("重みの中心が2つの群の間に落ちても、間の1枚に寄らない（同じ重さなら北）", () => {
        const f = frameForPoints([tokyo, { lat: 34.39, lng: 132.46 }, { lat: 35.18, lng: 136.90 }], [20, 20, 1])!;
        expect(f.lat).toBeCloseTo(tokyo.lat, 2);
        expect(f.lng).toBeCloseTo(tokyo.lng, 2);
    });

    it("詰めても「届く範囲か」と並びは変わらない", () => {
        const values = [-500, -491, -490, 0, 9, 10, 30, 31, 1000];
        const sq = squeezed(values, 10);
        for (let i = 0; i < values.length; i++) {
            for (let j = 0; j < values.length; j++) {
                expect(Math.abs(values[i] - values[j]) <= 9).toBe(Math.abs(sq[i] - sq[j]) <= 9);
                expect(values[i] < values[j]).toBe(sq[i] < sq[j]);
            }
        }
    });

    it("ありえない座標は数えない", () => {
        expect(frameForPoints([tokyo, { lat: 1e4, lng: 1e4 }, { lat: NaN, lng: 0 }])!.lat).toBeCloseTo(tokyo.lat, 3);
        expect(frameForPoints([{ lat: 1e4, lng: 1e4 }])).toBeNull();
    });

    it("近い点は1つの塊・遠い点は別の塊（同数なら北）", () => {
        expect(largestCluster([tokyo, niigata])).toHaveLength(2);
        const c = largestCluster([tokyo, helsinki]);
        expect(c).toHaveLength(1);
        expect(c[0].lat).toBeCloseTo(helsinki.lat, 2);
    });

    it("枠には余白を入れる", () => {
        expect(frameForPoints([tokyo, niigata])!.latSpan).toBeGreaterThan(Math.abs(tokyo.lat - niigata.lat));
    });
});
