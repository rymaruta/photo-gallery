import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    MAPKIT_SRC, createMapKitEngine, loadMapKit, mapKitRefused, onMapKitRefused, resetMapKitForTests,
    type MapKitGlobal,
} from "../mapkitEngine";
import { zoomFromSpan } from "../region";

// Apple のマップ（MapKit JS）は jsdom では描けないので、**こちらが MapKit に何を
// 渡しているか**を偽物で見る。本物の地図での見え方は鍵が要るので、ここでは確かめない
// （鍵が入ったら staging で見る）。

type Listener = (e: Record<string, unknown>) => void;

function fakeMapKit() {
    const calls = {
        init: null as null | { token: string; language?: string },
        mapOpts: null as Record<string, unknown> | null,
        regions: [] as Array<{ lat: number; lng: number; latD: number; lngD: number; animate?: boolean }>,
        annotations: [] as FakeAnnotation[],
        removed: 0,
        destroyed: false,
        errorListeners: [] as Array<(e: { status?: string }) => void>,
    };
    type FakeAnnotation = {
        coordinate: { latitude: number; longitude: number };
        element: HTMLElement;
        opts: Record<string, unknown>;
        listeners: Record<string, Listener[]>;
        addEventListener: (t: string, fn: Listener) => void;
    };
    const mapListeners: Record<string, Listener[]> = {};
    let region = {
        center: { latitude: 35, longitude: 139 },
        span: { latitudeDelta: 10, longitudeDelta: 10 },
    };
    const map = {
        get region() {
            return {
                ...region,
                toBoundingRegion: () => ({
                    northLatitude: region.center.latitude + region.span.latitudeDelta / 2,
                    southLatitude: region.center.latitude - region.span.latitudeDelta / 2,
                    eastLongitude: region.center.longitude + region.span.longitudeDelta / 2,
                    westLongitude: region.center.longitude - region.span.longitudeDelta / 2,
                }),
            };
        },
        selectedAnnotation: null as unknown,
        annotations: [] as unknown[],
        setRegionAnimated: (r: { center: { latitude: number; longitude: number }; span: { latitudeDelta: number; longitudeDelta: number } }, animate?: boolean) => {
            region = { center: r.center, span: r.span };
            calls.regions.push({ lat: r.center.latitude, lng: r.center.longitude, latD: r.span.latitudeDelta, lngD: r.span.longitudeDelta, animate });
        },
        addAnnotation: (a: FakeAnnotation) => { calls.annotations.push(a); },
        removeAnnotations: (as: FakeAnnotation[]) => { calls.removed += as.length; calls.annotations = calls.annotations.filter((a) => !as.includes(a)); },
        removeAnnotation: (a: FakeAnnotation) => { calls.removed += 1; calls.annotations = calls.annotations.filter((x) => x !== a); },
        addEventListener: (t: string, fn: Listener) => { (mapListeners[t] ||= []).push(fn); },
        destroy: () => { calls.destroyed = true; },
    };
    const fire = (t: string, e: Record<string, unknown> = {}) => (mapListeners[t] ?? []).forEach((f) => f({ type: t, ...e }));
    const setSpan = (lngD: number) => { region = { ...region, span: { latitudeDelta: lngD, longitudeDelta: lngD } }; };

    const MapCtor = function (this: unknown, _el: HTMLElement, opts: Record<string, unknown>) {
        calls.mapOpts = opts;
        return map;
    } as unknown as MapKitGlobal["Map"];
    Object.assign(MapCtor, { ColorSchemes: { Dark: "dark", Light: "light" }, MapTypes: { Standard: "standard" } });
    const AnnotationCtor = function (this: unknown, c: { latitude: number; longitude: number }, factory: () => HTMLElement, opts: Record<string, unknown>) {
        const a: FakeAnnotation = {
            coordinate: c, element: factory(), opts, listeners: {},
            addEventListener: (t, fn) => { (a.listeners[t] ||= []).push(fn); },
        };
        return a;
    } as unknown as MapKitGlobal["Annotation"];
    Object.assign(AnnotationCtor, { DisplayPriority: { Required: 1000 } });

    const mk = {
        init: (o: { authorizationCallback: (done: (t: string) => void) => void; language?: string }) => {
            o.authorizationCallback((t) => { calls.init = { token: t, language: o.language }; });
        },
        addEventListener: (t: string, fn: (e: { status?: string }) => void) => { if (t === "error") calls.errorListeners.push(fn); },
        Map: MapCtor,
        Coordinate: function (this: unknown, lat: number, lng: number) { return { latitude: lat, longitude: lng }; } as unknown as MapKitGlobal["Coordinate"],
        CoordinateSpan: function (this: unknown, a: number, b: number) { return { latitudeDelta: a, longitudeDelta: b }; } as unknown as MapKitGlobal["CoordinateSpan"],
        CoordinateRegion: function (this: unknown, c: unknown, s: unknown) { return { center: c, span: s }; } as unknown as MapKitGlobal["CoordinateRegion"],
        Annotation: AnnotationCtor,
        FeatureVisibility: { Hidden: "hidden", Adaptive: "adaptive", Visible: "visible" },
    } as unknown as MapKitGlobal;
    return { mk, calls, fire, setSpan, map };
}

/** jsdom には DOMPoint が無い（本物のブラウザにはある） */
class FakeDOMPoint { constructor(public x = 0, public y = 0) {} }

function container(width = 400, height = 600): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
    document.body.appendChild(el);
    return el;
}

/**
 * 足された `<script>`。**本当には繋がない**——happy-dom は繋いだ瞬間に読みに行き、
 * 届かないので error を撃つ（本物のブラウザの「読めなかった」とは別物）
 */
let scripts: HTMLScriptElement[] = [];

beforeEach(() => {
    resetMapKitForTests();
    vi.stubGlobal("DOMPoint", FakeDOMPoint);
    scripts = [];
    vi.spyOn(document.head, "appendChild").mockImplementation(((node: Node) => {
        scripts.push(node as HTMLScriptElement);
        return node;
    }) as typeof document.head.appendChild);
    delete (window as unknown as Record<string, unknown>).mapkit;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("読み込み", () => {
    it("Apple の配信から、地図と印の部品だけを読む", async () => {
        const { mk, calls } = fakeMapKit();
        const p = loadMapKit("tok", "ja");
        const s = scripts[0];
        expect(s.src).toBe(MAPKIT_SRC);
        expect(s.dataset.libraries).toBe("map,annotations");
        // 読み終わると Apple が data-callback の名前の関数を呼ぶ
        (window as unknown as Record<string, unknown>).mapkit = mk;
        (window as unknown as Record<string, () => void>)[s.dataset.callback!]();
        await expect(p).resolves.toBe(mk);
        expect(calls.init).toEqual({ token: "tok", language: "ja" });
    });

    it("2回呼んでも読み込みは1回", () => {
        void loadMapKit("tok", "ja");
        void loadMapKit("tok", "ja");
        expect(scripts).toHaveLength(1);
    });

    it("読めなかったら断り、次はやり直す（圏外から戻ったとき）", async () => {
        const p = loadMapKit("tok", "ja");
        scripts[0].dispatchEvent(new Event("error"));
        await expect(p).rejects.toThrow();
        void loadMapKit("tok", "ja");
        expect(scripts).toHaveLength(2);
    });

    it("読み終えたのに呼び戻しが来なければ、外して次の回に足し直す", async () => {
        vi.useFakeTimers();
        const p = loadMapKit("tok", "ja");
        const check = expect(p).rejects.toThrow();
        scripts[0].dispatchEvent(new Event("load"));
        vi.advanceTimersByTime(10001);
        await check;
        void loadMapKit("tok", "ja").catch(() => {});
        expect(scripts).toHaveLength(2);
    });

    it("部品が読めていれば、呼び戻しが遅くても外さない（遅い回線で二重に読まない）", async () => {
        vi.useFakeTimers();
        const { mk } = fakeMapKit();
        const p = loadMapKit("tok", "ja");
        const check = expect(p).rejects.toThrow(/timeout/);
        (window as unknown as Record<string, unknown>).mapkit = mk;   // 部品は動いて名前を置いた
        scripts[0].dispatchEvent(new Event("load"));
        vi.advanceTimersByTime(10001);
        await check;
        const again = loadMapKit("tok", "ja");
        expect(scripts, "2本目を足して二重に読んでいる").toHaveLength(1);
        (window as unknown as Record<string, () => void>)[scripts[0].dataset.callback!]();
        await expect(again).resolves.toBe(mk);
    });

    it("時間内に届かなければ断る（控えの地図に切り替える合図）", async () => {
        vi.useFakeTimers();
        const p = loadMapKit("tok", "ja");
        const check = expect(p).rejects.toThrow(/timeout/);
        vi.advanceTimersByTime(10001);
        await check;
    });

    /** 読み終わった合図（Apple が data-callback の名前の関数を呼ぶ） */
    const arrive = (mk: MapKitGlobal) => {
        (window as unknown as Record<string, unknown>).mapkit = mk;
        (window as unknown as Record<string, () => void>)[scripts[0].dataset.callback!]();
    };

    it("時間切れのあとに読み終わっていたら、足し直さずに使う（初期化は1回だけ）", async () => {
        vi.useFakeTimers();
        const { mk, calls } = fakeMapKit();
        const init = vi.spyOn(mk, "init");
        const p = loadMapKit("tok", "ja");
        const check = expect(p).rejects.toThrow(/timeout/);
        vi.advanceTimersByTime(10001);
        await check;
        arrive(mk);   // 断ったあとに遅れて読み終わった
        const again = await loadMapKit("tok", "en");
        expect(again).toBe(mk);
        expect(scripts, "2本目の <script> を足している").toHaveLength(1);
        expect(init).toHaveBeenCalledTimes(1);
        expect(calls.init?.language).toBe("en");
        expect(calls.errorListeners).toHaveLength(1);
    });

    it("時間切れのあと、まだ読み込み中なら2本目を足さずに同じ1本の到着を待つ", async () => {
        vi.useFakeTimers();
        const { mk } = fakeMapKit();
        const p = loadMapKit("tok", "ja");
        const check = expect(p).rejects.toThrow(/timeout/);
        vi.advanceTimersByTime(10001);
        await check;
        const again = loadMapKit("tok", "ja");
        expect(scripts).toHaveLength(1);
        arrive(mk);
        await expect(again).resolves.toBe(mk);
    });

    it("読み終えたあとに言語が替わったら、地図の言語も替える", async () => {
        const { mk } = fakeMapKit();
        const p = loadMapKit("tok", "ja");
        arrive(mk);
        await p;
        await loadMapKit("tok", "en");
        expect(mk.language).toBe("en");
    });

    it("初期化で投げたら、次の回でもう一度初期化する", async () => {
        const { mk } = fakeMapKit();
        const init = vi.spyOn(mk, "init").mockImplementationOnce(() => { throw new Error("boom"); });
        const p = loadMapKit("tok", "ja");
        arrive(mk);
        await expect(p).rejects.toThrow("boom");
        await expect(loadMapKit("tok", "ja")).resolves.toBe(mk);
        expect(init).toHaveBeenCalledTimes(2);
    });

    it("鍵が断られたら知らせる（以後この画面では読まない）", async () => {
        const { mk, calls } = fakeMapKit();
        const heard = vi.fn();
        onMapKitRefused(heard);
        const p = loadMapKit("tok", "ja");
        (window as unknown as Record<string, unknown>).mapkit = mk;
        const s = scripts[0];
        (window as unknown as Record<string, () => void>)[s.dataset.callback!]();
        await p;
        expect(mapKitRefused()).toBe(false);
        calls.errorListeners.forEach((fn) => fn({ status: "Unauthorized" }));
        expect(heard).toHaveBeenCalledTimes(1);
        expect(mapKitRefused()).toBe(true);
    });
});

describe("地図の設定（iOS の PhotoMapView にそろえる）", () => {
    it("標準の地図・暗い配色・施設の印あり。Apple の操作部品は出さない", () => {
        const { mk, calls } = fakeMapKit();
        createMapKitEngine(mk, container(), { reduceMotion: false });
        expect(calls.mapOpts).toMatchObject({
            colorScheme: "dark", mapType: "standard", showsPointsOfInterest: true,
            showsZoomControl: false, showsMapTypeControl: false, showsUserLocationControl: false,
            showsCompass: "hidden", showsScale: "hidden",
        });
    });
});

describe("見る場所", () => {
    it("ズームの段は、表示範囲の経度の幅と地図の横幅から出す", () => {
        const { mk, setSpan } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(400, 600), { reduceMotion: false });
        setSpan(360 * 400 / (256 * 2 ** 7));
        expect(engine.getZoom()).toBeCloseTo(7, 9);
    });

    it("段で寄せると、その段の幅の範囲を渡す。最初の1回は動かさずに置く", () => {
        const { mk, calls, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(400, 600), { reduceMotion: false });
        engine.setView({ lat: 35.42, lng: 138.88 }, 12);
        expect(calls.regions[0].animate, "世界全体から滑ってくる").toBe(false);
        expect(calls.regions[0].lat).toBe(35.42);
        expect(zoomFromSpan(calls.regions[0].lngD, 400)).toBeCloseTo(12, 9);
        fire("region-change-end");
        engine.setView({ lat: 35, lng: 139 }, 10);
        expect(calls.regions[1].animate).toBe(true);
    });

    it("「動きを減らす」設定では動かさない", () => {
        const { mk, calls, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: true });
        engine.setView({ lat: 35, lng: 139 }, 8);
        fire("region-change-end");
        engine.zoomIn();
        expect(calls.regions.every((r) => r.animate === false)).toBe(true);
    });

    it("＋で1段寄る", () => {
        const { mk, calls, setSpan } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(400, 600), { reduceMotion: false });
        setSpan(360 * 400 / (256 * 2 ** 5));
        engine.zoomIn();
        expect(zoomFromSpan(calls.regions.at(-1)!.lngD, 400)).toBeCloseTo(6, 9);
    });

    it("落ち着くたびに置き直しの合図を出す（控えは人が触ってから）", () => {
        const { mk, fire, setSpan } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const viewed = vi.fn(), moved = vi.fn();
        engine.onViewChange(viewed);
        engine.onMoveEnd(moved);
        fire("region-change-end");
        expect([viewed.mock.calls.length, moved.mock.calls.length]).toEqual([1, 0]);
        fire("scroll-start");   // 人が触った
        fire("region-change-end");   // 同じ幅のまま動いた（撮影スポットは動いた先で選び直す）
        setSpan(1);
        fire("region-change-end");
        expect([viewed.mock.calls.length, moved.mock.calls.length]).toEqual([3, 2]);
    });

    it("人が動かしたときだけ知らせる（一度だけ）", () => {
        const { mk, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const fn = vi.fn();
        engine.onceUserMove(fn);
        fire("region-change-start");   // こちらが寄せた
        expect(fn).not.toHaveBeenCalled();
        fire("scroll-start");
        fire("zoom-start");
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe("印", () => {
    const pin = () => {
        const el = document.createElement("span");
        el.className = "photo-map-pin";
        return el;
    };

    it("尖りの先（下端の真ん中）が座標の印はずらさない・丸い印は半分下げる", () => {
        const { mk, calls } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "山中湖" });
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [34, 34], anchor: [17, 17], title: "3枚" });
        const [a, b] = calls.annotations.map((x) => x.opts.anchorOffset as FakeDOMPoint);
        expect([a.x, a.y]).toEqual([0, 0]);
        expect([b.x, b.y]).toEqual([0, 17]);
    });

    it("重なっても間引かせない・吹き出しは出さない", () => {
        const { mk, calls } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "x", onActivate: () => {} });
        expect(calls.annotations[0].opts).toMatchObject({ displayPriority: 1000, calloutEnabled: false, enabled: true });
    });

    it("押されたら知らせ、選んだままにしない（同じ印をもう一度押せる）", () => {
        vi.useFakeTimers();
        const { mk, calls, map } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const fn = vi.fn();
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "x", onActivate: fn });
        const a = calls.annotations[0];
        map.selectedAnnotation = a;
        a.listeners.select.forEach((f) => f({}));
        expect(fn).toHaveBeenCalledTimes(1);
        vi.runAllTimers();
        expect(map.selectedAnnotation).toBeNull();
    });

    it("キーボードでも押せる（名前は読み上げに渡す）", () => {
        const { mk, calls } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const fn = vi.fn();
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "山中湖", onActivate: fn });
        const host = calls.annotations[0].element;
        expect(host.getAttribute("role")).toBe("button");
        expect(host.getAttribute("aria-label")).toBe("山中湖");
        expect(host.tabIndex).toBe(0);
        host.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("置いた印は1つずつ外せる（変わった印だけ置き直す）", () => {
        const { mk, calls } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const a = engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "a" });
        engine.addMarker({ lat: 36, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "b" });
        a.remove();
        a.remove();   // 2回外しても落ちない
        expect(calls.annotations.map((x) => x.coordinate.latitude)).toEqual([36]);
    });

    it("入れ替えるときは前の印を全部外す", () => {
        const { mk, calls } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        engine.addMarker({ lat: 35, lng: 139, el: pin(), size: [40, 50], anchor: [20, 50], title: "a" });
        engine.addHereDot({ lat: 35, lng: 139 });
        engine.clearMarkers();
        expect(calls.annotations).toHaveLength(0);
        expect(calls.removed).toBe(2);
    });
});

describe("地図の余白を押す", () => {
    /** MapKit に渡した箱（`container` の中に作る自前の箱） */
    const mapBox = (outer: HTMLElement) => outer.firstElementChild as HTMLElement;

    it("押し始めが印の上なら閉じない（single-tap は遅れて届くので、そのとき押された点は見ない）", () => {
        const { mk, calls, fire } = fakeMapKit();
        const outer = container();
        const engine = createMapKitEngine(mk, outer, { reduceMotion: false });
        const closed = vi.fn();
        engine.onBackgroundClick(closed);
        engine.addMarker({ lat: 35, lng: 139, el: document.createElement("span"), size: [40, 50], anchor: [20, 50], title: "a" });
        const host = calls.annotations[0].element;
        mapBox(outer).appendChild(host);   // 本物は MapKit が地図の箱の中に置く
        host.firstElementChild!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        fire("single-tap");
        expect(closed).not.toHaveBeenCalled();
        mapBox(outer).dispatchEvent(new Event("pointerdown", { bubbles: true }));
        fire("single-tap");
        expect(closed).toHaveBeenCalledTimes(1);
    });
});

describe("最初の場所", () => {
    it("最初に置いた場所は、知らせが何本来ても控えない", () => {
        const { mk, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const moved = vi.fn(), viewed = vi.fn();
        engine.onMoveEnd(moved);
        engine.onViewChange(viewed);
        fire("region-change-end");   // 作った直後の既定の範囲のぶん（出すかは Apple 次第）
        engine.setView({ lat: 36, lng: 138 }, 4);
        fire("region-change-end");
        fire("region-change-end");
        expect(moved, "写真0枚のときの仮の場所が控えに残る").not.toHaveBeenCalled();
        expect(viewed, "置き直しは要る").toHaveBeenCalled();
    });

    it("こちらが2回目に動かしたら（束を押した・写真が届いて寄せた）、そこからは控える", () => {
        const { mk, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const moved = vi.fn();
        engine.onMoveEnd(moved);
        engine.setView({ lat: 36, lng: 138 }, 4);
        fire("region-change-end");
        engine.fitBounds({ south: 35, west: 138, north: 36, east: 140 }, { padding: 48, maxZoom: 18 });
        fire("region-change-end");
        expect(moved).toHaveBeenCalledTimes(1);
    });

    it("＋− で動かしたら控える（人の操作の合図が来ない口）", () => {
        const { mk, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const moved = vi.fn();
        engine.onMoveEnd(moved);
        engine.setView({ lat: 36, lng: 138 }, 4);
        engine.zoomIn();
        fire("region-change-end");
        expect(moved).toHaveBeenCalledTimes(1);
    });

    it("地図の箱への入力（矢印キー・ホイール・指）でも控え始める（MapKit の合図に頼らない）", () => {
        for (const type of ["keydown", "wheel", "pointerdown", "touchstart"]) {
            const { mk, fire } = fakeMapKit();
            const outer = container();
            const engine = createMapKitEngine(mk, outer, { reduceMotion: false });
            const moved = vi.fn();
            engine.onMoveEnd(moved);
            engine.setView({ lat: 36, lng: 138 }, 4);
            (outer.firstElementChild as HTMLElement).dispatchEvent(new Event(type, { bubbles: true }));
            fire("region-change-end");
            expect(moved, type).toHaveBeenCalledTimes(1);
        }
    });

    it("人が触ったら控える", () => {
        const { mk, fire } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(), { reduceMotion: false });
        const moved = vi.fn();
        engine.onMoveEnd(moved);
        engine.fitBounds({ south: 35, west: 138, north: 36, east: 140 }, { padding: 32, maxZoom: 12 });
        fire("region-change-end");
        expect(moved).not.toHaveBeenCalled();
        fire("scroll-start");
        fire("region-change-end");
        expect(moved).toHaveBeenCalledTimes(1);
    });
});

describe("ズームの段の読み取り", () => {
    it("整数の段のすぐ近くは整数に寄せる（上限との比べを誤らない）", () => {
        const { mk, setSpan } = fakeMapKit();
        const engine = createMapKitEngine(mk, container(400, 600), { reduceMotion: false });
        setSpan(360 * 400 / (256 * 2 ** 17.995));
        expect(engine.getZoom()).toBe(18);
        setSpan(360 * 400 / (256 * 2 ** 17.5));
        expect(engine.getZoom()).toBeCloseTo(17.5, 9);
    });
});

describe("片付け", () => {
    it("MapKit には自前の箱を渡し、外すときは箱ごと消す（控えの地図が同じ枠に建てられる）", () => {
        const { mk, calls } = fakeMapKit();
        const outer = container();
        const engine = createMapKitEngine(mk, outer, { reduceMotion: false });
        expect(outer.children).toHaveLength(1);
        engine.remove();
        expect(calls.destroyed).toBe(true);
        expect(outer.children, "MapKit の跡が残った枠に Leaflet を建てる").toHaveLength(0);
        expect(outer.isConnected, "React の枠まで消している").toBe(true);
    });
});
