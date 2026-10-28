import type { Bounds, LatLng, MapEngine, MarkerSpec } from "./engine";
import { fitView, spanForView, zoomFromSpan } from "./region";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from "../utils/mapView";

/**
 * Apple のマップ（MapKit JS）の土台。**iOS のアプリと同じ地図**を出す
 * （iOS の `PhotoMapView` は MapKit・標準の地図・暗い配色・施設の印あり）。
 *
 * ## 鍵（トークン）
 *
 * `NEXT_PUBLIC_MAPKIT_JS_TOKEN`。Apple Developer の「Maps IDs & Tokens」で作る
 * **ドメインを限った鍵**で、ページに埋めて配るための鍵（秘密ではない）。
 * 空のビルドでは読みに行かず、最初から控えの地図（`leafletEngine.ts`）を出す。
 *
 * ## 型は自前で最小限だけ書く
 *
 * 使うのは地図・印・範囲・イベントだけなので、型の包み（`@types/...`）は足さない。
 * 名前と形は Apple の型定義（5.78）に合わせてある。
 */

/* ───────── 使うぶんだけの型 ───────── */

type MkCoordinate = { latitude: number; longitude: number };
type MkSpan = { latitudeDelta: number; longitudeDelta: number };
type MkRegion = {
    center: MkCoordinate;
    span: MkSpan;
    toBoundingRegion(): { northLatitude: number; eastLongitude: number; southLatitude: number; westLongitude: number };
};
type MkEvent = { type: string; target?: unknown; pointOnPage?: { x: number; y: number } };
type MkAnnotation = {
    addEventListener(type: "select" | "deselect", fn: (e: MkEvent) => void): void;
};
type MkMap = {
    region: MkRegion;
    selectedAnnotation: MkAnnotation | null;
    annotations: MkAnnotation[];
    setRegionAnimated(region: MkRegion, animate?: boolean): unknown;
    addAnnotation(a: MkAnnotation): unknown;
    removeAnnotations(a: MkAnnotation[]): unknown;
    addEventListener(type: string, fn: (e: MkEvent) => void): void;
    destroy(): void;
};
export type MapKitGlobal = {
    init(opts: { authorizationCallback: (done: (token: string) => void) => void; language?: string }): void;
    addEventListener(type: "error" | "configuration-change", fn: (e: { status?: string }) => void): void;
    language?: string;
    Map: (new (el: HTMLElement, opts: Record<string, unknown>) => MkMap) & {
        ColorSchemes: { Dark: string; Light: string };
        MapTypes: { Standard: string };
    };
    Coordinate: new (lat: number, lng: number) => MkCoordinate;
    CoordinateSpan: new (latDelta: number, lngDelta: number) => MkSpan;
    CoordinateRegion: new (center: MkCoordinate, span: MkSpan) => MkRegion;
    Annotation: (new (c: MkCoordinate, factory: () => Element, opts: Record<string, unknown>) => MkAnnotation) & {
        DisplayPriority: { Required: number };
    };
    FeatureVisibility: { Hidden: string; Adaptive: string; Visible: string };
};

/* ───────── 読み込み ───────── */

/** Apple の配信。`5.x.x` は Apple が勧める書き方（互換を保ったまま最新を配る） */
export const MAPKIT_SRC = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js";
/** 読み込みを待つ上限。超えたら控えの地図にする（圏外・配信の不調） */
const LOAD_TIMEOUT_MS = 10000;
const CALLBACK = "__journeyMapKitReady";

let loading: Promise<MapKitGlobal> | null = null;
/** `mapkit.init` を済ませたか。**1ページに1回だけ**（2回呼ぶと鍵の問い合わせと error の口が二重になる） */
let initialized = false;
/** 鍵が断られた・上限に当たった、を一度でも聞いたか（以後この画面では読まない） */
let refused = false;
const refusalListeners = new Set<() => void>();

/** 鍵が断られたら呼ぶ（地図を控えに切り替える）。戻り値で外す */
export function onMapKitRefused(fn: () => void): () => void {
    refusalListeners.add(fn);
    return () => { refusalListeners.delete(fn); };
}

export function mapKitRefused(): boolean {
    return refused;
}

/**
 * MapKit JS を読み、鍵を渡して初期化する。**1ページに1回だけ**（2回目からは同じ約束を返す）。
 * 読めなかった（配信に届かない・時間切れ）ら reject し、次に呼ばれたらやり直す。
 */
export function loadMapKit(token: string, language: string): Promise<MapKitGlobal> {
    if (loading) return loading;
    const w = window as unknown as Record<string, unknown>;
    /** 読めた MapKit を初期化する（済んでいれば言語だけ合わせる） */
    const ready = (mk: MapKitGlobal): MapKitGlobal => {
        if (!initialized) {
            initialized = true;
            // **鍵が断られた（401）・1日の上限（429）は、ここではなく後から届く。**
            // 届いたら控えの地図に切り替える（`PhotoMap`）
            mk.addEventListener("error", () => {
                refused = true;
                for (const fn of refusalListeners) fn();
            });
            mk.init({ authorizationCallback: (done) => done(token), language });
        } else {
            mk.language = language;
        }
        return mk;
    };
    // **前の回で時間切れにしたあと、遅れて読み終わっていた**ら、足し直さずに使う
    // （2本目の `<script>` を足すと、Apple の部品が呼び戻しをもう一度くれる保証が無い）
    const already = w.mapkit as MapKitGlobal | undefined;
    if (already && typeof already.init === "function" && initialized) {
        loading = Promise.resolve(ready(already));
        return loading;
    }
    loading = new Promise<MapKitGlobal>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("mapkit: timeout")), LOAD_TIMEOUT_MS);
        w[CALLBACK] = () => {
            window.clearTimeout(timer);
            const mk = w.mapkit as MapKitGlobal | undefined;
            if (!mk) { reject(new Error("mapkit: missing")); return; }
            try {
                // 時間切れのあとに届いた回も初期化だけはしておく（次の画面で使う）。
                // 約束はもう断ってあるので、resolve しても誰にも届かない
                resolve(ready(mk));
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        };
        const s = document.createElement("script");
        s.src = MAPKIT_SRC;
        s.async = true;
        s.crossOrigin = "anonymous";
        s.dataset.callback = CALLBACK;
        // 地図と印だけ（検索・経路は使わない）
        s.dataset.libraries = "map,annotations";
        s.onerror = () => { window.clearTimeout(timer); reject(new Error("mapkit: load failed")); };
        document.head.appendChild(s);
    }).catch((e) => {
        // 次の画面でやり直せるようにする（圏外から戻った）。読み込みの札は残っても害は無い
        loading = null;
        throw e;
    });
    return loading;
}

/** テストのためだけに、読み込みの状態を戻す */
export function resetMapKitForTests(): void {
    loading = null;
    initialized = false;
    refused = false;
    refusalListeners.clear();
}

/* ───────── 土台 ───────── */

/** 印の箱に付けるクラス。地図の余白が押されたかどうかを見分けるのに使う */
const MARKER_HOST = "jp-map-marker";

export function createMapKitEngine(
    mk: MapKitGlobal, container: HTMLElement, opts: { reduceMotion: boolean },
): MapEngine {
    const animate = !opts.reduceMotion;
    // **MapKit には自前の箱を渡す。** `destroy()` は「地図の要素を DOM から外す」ので、
    // React の箱をそのまま渡すと、鍵が断られて控えの地図へ切り替えるときに
    // 箱ごと消える・MapKit の跡が残った箱に Leaflet を建てることになる
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.inset = "0";
    container.appendChild(el);
    try {
        return build(mk, el, container, animate);
    } catch (e) {
        el.remove();
        throw e;
    }
}

/** `box` は大きさを測る枠（`el` と同じ大きさ・React の枠） */
function build(mk: MapKitGlobal, el: HTMLElement, box: HTMLElement, animate: boolean): MapEngine {
    // **iOS と同じ設定にそろえる**（`PhotoMapView` は `.mapStyle` を書かない＝標準の地図・
    // 施設の印あり、アプリ全体が暗い配色）。Apple の標準の操作部品は出さない
    // ——ズーム・現在地は `PhotoMap` の丸いボタン（iOS も自前のボタン）。
    // **回転は切る。** iOS は回転でき、常に出る方位磁針で北へ戻せるが、MapKit JS の
    // 方位磁針は地図の右上に出て、こちらの操作のボタンと重なる
    const map = new mk.Map(el, {
        colorScheme: mk.Map.ColorSchemes.Dark,
        mapType: mk.Map.MapTypes.Standard,
        showsZoomControl: false,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        showsCompass: mk.FeatureVisibility.Hidden,
        showsScale: mk.FeatureVisibility.Hidden,
        isRotationEnabled: false,
        showsPointsOfInterest: true,
    });

    const zoomHandlers: Array<() => void> = [];
    const moveHandlers: Array<() => void> = [];
    let lastZoom = NaN;

    const width = () => box.clientWidth || box.getBoundingClientRect().width || 0;
    const height = () => box.clientHeight || box.getBoundingClientRect().height || 0;

    const currentZoom = (): number => {
        const raw = zoomFromSpan(map.region.span.longitudeDelta, width());
        // 隠れている（幅0）間は前の値を返す（その値を覚えさせない）
        if (!Number.isFinite(raw)) return Number.isFinite(lastZoom) ? lastZoom : MAP_MIN_ZOOM;
        // **整数の段のすぐ近くは整数に寄せる。** 範囲から逆算するので 17.99… のように
        // 返ってきうる。上限（`MAP_MAX_ZOOM`）との比べで「まだ寄れる」と誤り、
        // 束を押すたびに同じ場所へ寄り直してシートが開かなくなる
        const near = Math.round(raw);
        return Math.abs(raw - near) < 0.01 ? near : raw;
    };

    const setView = (c: LatLng, zoom: number, anim: boolean) => {
        const z = Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, zoom));
        const w = width(), h = height();
        // 大きさがまだ決まっていない（隠れた列の中）なら、スマホの1画面ぶんで仮に決める
        const span = spanForView(c, z, w || 390, h || 520);
        const region = new mk.CoordinateRegion(
            new mk.Coordinate(c.lat, c.lng),
            new mk.CoordinateSpan(span.latitudeDelta, span.longitudeDelta),
        );
        map.setRegionAnimated(region, anim);
    };

    const center = (): LatLng => ({ lat: map.region.center.latitude, lng: map.region.center.longitude });

    /**
     * **最初の場所を置いた回は「動いた」と数えない。** Leaflet は最初の `setView` の
     * `moveend` を同期で出し終えるので、あとから付けた控えの口には届かない（＝最初の
     * 場所は控えに書かない）。MapKit は後から届きうるので、ここで1回ぶん捨てる。
     * 書いてしまうと、写真0枚のときの仮の場所（日本全体）が控えに残り、次に開いたとき
     * 写真へ寄らない
     */
    let initialPending = false;
    map.addEventListener("region-change-end", () => {
        const z = currentZoom();
        const zoomed = !Number.isFinite(lastZoom) || Math.abs(z - lastZoom) > 0.01;
        lastZoom = z;
        if (zoomed) for (const fn of zoomHandlers) fn();
        if (initialPending) { initialPending = false; return; }
        for (const fn of moveHandlers) fn();
    });
    // 人が先に触ったら、その動きは控える（最初の回を待たない）
    const userMoved = () => { initialPending = false; };
    map.addEventListener("scroll-start", userMoved);
    map.addEventListener("zoom-start", userMoved);

    /**
     * 押し始めが印の上だったか。**地図の余白を押したか**の見分けに使う。
     * 地図の single-tap はダブルタップを待ってから届くので、その時点で押された点を
     * 調べ直すと、印を押して開いたシートの上を指していることがある（＝開いた直後に閉じる）。
     * 押し始め（pointerdown）で決めておけば時刻に頼らない
     */
    let pressOnMarker = false;
    el.addEventListener("pointerdown", (e) => {
        const t = e.target as Element | null;
        pressOnMarker = !!t?.closest?.(`.${MARKER_HOST}`);
    }, true);

    /** いま置いている印（入れ替えのたびに全部外す） */
    let placed: MkAnnotation[] = [];

    return {
        kind: "mapkit",
        getZoom: currentZoom,
        getCenter: center,
        getBounds: (): Bounds => {
            const r = map.region.toBoundingRegion();
            return { south: r.southLatitude, west: r.westLongitude, north: r.northLatitude, east: r.eastLongitude };
        },
        // **最初の場所は動かさずに置く**（`PhotoMap` は初期表示にも `setView` を使う。
        // 動かすと世界全体から滑ってくる）。以後は「動きを減らす」設定に従う
        setView: (c, zoom) => {
            const first = !Number.isFinite(lastZoom);
            if (first) initialPending = true;
            setView(c, zoom, animate && !first);
        },
        fitBounds: (b, o) => {
            const first = !Number.isFinite(lastZoom);
            if (first) initialPending = true;
            const v = fitView(b, width() || 390, height() || 520, o.padding, o.maxZoom);
            setView({ lat: v.lat, lng: v.lng }, v.zoom, o.animate === false ? false : animate && !first);
        },
        zoomIn: () => { setView(center(), currentZoom() + 1, animate); },
        zoomOut: () => { setView(center(), currentZoom() - 1, animate); },
        onBackgroundClick: (fn) => {
            map.addEventListener("single-tap", () => {
                // **印の上で押されたら閉じない**（押し始めで決めた `pressOnMarker`）
                if (pressOnMarker) return;
                fn();
            });
        },
        onZoomEnd: (fn) => { zoomHandlers.push(fn); },
        onMoveEnd: (fn) => { moveHandlers.push(fn); },
        // **人の操作だけ**（指・ホイールで動かした）。こちらが寄せた分は届かない
        onceUserMove: (fn) => {
            let done = false;
            const once = () => { if (done) return; done = true; fn(); };
            map.addEventListener("scroll-start", once);
            map.addEventListener("zoom-start", once);
        },
        clearMarkers: () => {
            if (placed.length) map.removeAnnotations(placed);
            placed = [];
        },
        addMarker: (s: MarkerSpec) => {
            // 印の箱。**キーボードでも押せる**ように、箱をボタンとして扱う
            // （MapKit の印は Tab で回れない）
            const host = document.createElement("div");
            host.className = `${MARKER_HOST}${s.className ? ` ${s.className}` : ""}`;
            host.style.width = `${s.size[0]}px`;
            host.style.height = `${s.size[1]}px`;
            host.title = s.title;
            host.setAttribute("aria-label", s.title);
            host.appendChild(s.el);
            if (s.onActivate) {
                const fn = s.onActivate;
                host.tabIndex = 0;
                host.setAttribute("role", "button");
                host.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
                });
            }
            const ann = new mk.Annotation(new mk.Coordinate(s.lat, s.lng), () => host, {
                size: { width: s.size[0], height: s.size[1] },
                // 既定は「箱の下端の真ん中が座標」。こちらの `anchor`（箱の左上からの点）に合わせて動かす
                anchorOffset: new DOMPoint(s.size[0] / 2 - s.anchor[0], s.size[1] - s.anchor[1]),
                calloutEnabled: false,
                // **重なっても隠させない**（MapKit は重なった印を間引く。写真のピンが消えると困る）
                displayPriority: mk.Annotation.DisplayPriority.Required,
                accessibilityLabel: s.title,
                enabled: !!s.onActivate,
            });
            if (s.onActivate) {
                const fn = s.onActivate;
                ann.addEventListener("select", () => {
                    fn();
                    // **選んだままにしない。** 選んだ印を同じ印でもう一度押しても
                    // select が来ないので、すぐ外す（選んでいる見た目は `PhotoMap` が描く）
                    window.setTimeout(() => { if (map.selectedAnnotation === ann) map.selectedAnnotation = null; }, 0);
                });
            }
            map.addAnnotation(ann);
            placed.push(ann);
        },
        addHereDot: (p) => {
            const dot = document.createElement("span");
            dot.className = "photo-map-here";
            dot.setAttribute("aria-hidden", "true");
            const ann = new mk.Annotation(new mk.Coordinate(p.lat, p.lng), () => dot, {
                size: { width: 18, height: 18 },
                anchorOffset: new DOMPoint(0, 9),
                calloutEnabled: false,
                enabled: false,
                displayPriority: mk.Annotation.DisplayPriority.Required,
            });
            map.addAnnotation(ann);
            placed.push(ann);
        },
        // MapKit は枠の大きさの変化を自分で拾う
        invalidateSize: () => {},
        remove: () => { map.destroy(); el.remove(); },
    };
}
