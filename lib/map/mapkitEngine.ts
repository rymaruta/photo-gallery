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
/** `mapkit.init` を済ませたか。**1ページに1回だけ**（2回呼ぶと鍵の問い合わせが二重になる） */
let initialized = false;
/** 鍵を断られたときの口を付けたか（付けるのは1回だけ） */
let errorHooked = false;
/**
 * 足した `<script>` の状態。**1ページに1本だけ**——時間切れで約束を断ったあとも、
 * 読み込み中ならその到着を待つ（2本目を足すと、Apple の部品が `window.mapkit` を
 * 差し替えて呼び戻しをもう一度くれるかは Apple 次第）
 */
let scriptState: "none" | "loading" | "loaded" = "none";
/** 読み込み中の `<script>` の到着を待っている人（失敗なら Error を渡す） */
const waiters = new Set<(err?: Error) => void>();
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
 * MapKit JS を読み、鍵を渡して初期化する。**読み込みも初期化も1ページに1回だけ。**
 * 2回目からは同じものを返し、言語だけ合わせる（日本語 ↔ 英語の切り替え）。
 * 読めなかった（配信に届かない・時間切れ）ら reject し、次に呼ばれたらやり直す。
 */
export function loadMapKit(token: string, language: string): Promise<MapKitGlobal> {
    if (loading) {
        return loading.then((mk) => { mk.language = language; return mk; });
    }
    const w = window as unknown as Record<string, unknown>;
    /** 届いた MapKit を初期化する（済んでいれば言語だけ合わせる） */
    const ready = (mk: MapKitGlobal): MapKitGlobal => {
        if (!errorHooked) {
            // **鍵が断られた（401）・1日の上限（429）は、ここではなく後から届く。**
            // 届いたら控えの地図に切り替える（`PhotoMap`）
            mk.addEventListener("error", () => {
                refused = true;
                for (const fn of refusalListeners) fn();
            });
            errorHooked = true;
        }
        if (!initialized) {
            mk.init({ authorizationCallback: (done) => done(token), language });
            // **成功してから立てる**（投げたら次の回でもう一度 init する）
            initialized = true;
        } else {
            mk.language = language;
        }
        return mk;
    };
    loading = new Promise<MapKitGlobal>((resolve, reject) => {
        const finish = () => {
            const mk = w.mapkit as MapKitGlobal | undefined;
            if (!mk || typeof mk.init !== "function") {
                // 届いたと言いながら中身が無い。次の回は足し直す（ずっと断り続けない）
                scriptState = "none";
                reject(new Error("mapkit: missing"));
                return;
            }
            try {
                resolve(ready(mk));
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        };
        // 前の回で時間切れにしたあと、遅れて読み終わっていた
        if (scriptState === "loaded") { finish(); return; }
        const onArrive = (err?: Error) => {
            window.clearTimeout(timer);
            if (err) reject(err); else finish();
        };
        const timer = window.setTimeout(() => {
            waiters.delete(onArrive);
            reject(new Error("mapkit: timeout"));
        }, LOAD_TIMEOUT_MS);
        waiters.add(onArrive);
        if (scriptState === "loading") return;   // 読み込み中の1本の到着を待つ

        scriptState = "loading";
        const settle = (err?: Error) => {
            for (const fn of [...waiters]) fn(err);
            waiters.clear();
        };
        w[CALLBACK] = () => { scriptState = "loaded"; settle(); };
        const s = document.createElement("script");
        s.src = MAPKIT_SRC;
        s.async = true;
        s.crossOrigin = "anonymous";
        s.dataset.callback = CALLBACK;
        // 地図と印だけ（検索・経路は使わない）
        s.dataset.libraries = "map,annotations";
        // 読めなかった。次の回は足し直す（圏外から戻った）
        s.onerror = () => { scriptState = "none"; settle(new Error("mapkit: load failed")); };
        // **読み終えたのに呼び戻しが来ない**まま残ると、このページでは二度とやり直さない
        // （開くたびに10秒待って控えの地図）。待っても来なければ外して、次の回に足し直す
        s.onload = () => {
            window.setTimeout(() => {
                // **部品が自分の名前（`window.mapkit`）を置けていれば待ち続ける。** 呼び戻しは
                // 地図と印の部品を取り寄せてからなので、遅い回線では読み終えてから10秒を超える。
                // ここで外すのは「読めたのは別物だった」（ホテルの Wi-Fi のログイン画面など）とき
                if (scriptState !== "loading" || w.mapkit) return;
                scriptState = "none";
                s.remove();
                settle(new Error("mapkit: no callback"));
            }, LOAD_TIMEOUT_MS);
        };
        document.head.appendChild(s);
    }).catch((e) => {
        // 次の画面でやり直せるようにする
        loading = null;
        throw e;
    });
    return loading;
}

/** テストのためだけに、読み込みの状態を戻す */
export function resetMapKitForTests(): void {
    loading = null;
    initialized = false;
    errorHooked = false;
    scriptState = "none";
    waiters.clear();
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
     * **最初の場所は「動いた」と数えない。** Leaflet は最初の `setView` の `moveend` を
     * 同期で出し終えるので、あとから付けた控えの口には届かない（＝最初の場所は控えに
     * 書かない）。書いてしまうと、写真0枚のときの仮の場所（日本全体）が控えに残り、
     * 次に開いたとき写真へ寄らない。
     *
     * MapKit がその知らせを**何回・いつ**出すか（作った直後の既定の範囲のぶん、
     * 置いた範囲のぶん）は Apple 次第なので、**回数では数えない**。控えるのは
     * 「人が触った」か「こちらが2回目以降に動かした」（束を押した・＋−・現在地・
     * 写真が届いて寄せた）あとだけ。そこまでの知らせは何本来ても控えない
     */
    let viewPlaced = false;   // 最初の場所を置いたか
    let saving = false;       // 動いたら控えるか
    /** こちらが動かす（最初の1回は控えない・2回目からは控える） */
    const placing = (): boolean => {
        const first = !viewPlaced;
        if (first) viewPlaced = true;
        else saving = true;
        return first;
    };
    map.addEventListener("region-change-end", () => {
        const z = currentZoom();
        const zoomed = !Number.isFinite(lastZoom) || Math.abs(z - lastZoom) > 0.01;
        lastZoom = z;
        if (zoomed) for (const fn of zoomHandlers) fn();
        if (!saving) return;
        for (const fn of moveHandlers) fn();
    });
    // 人が触ったら、そこからは控える
    const userMoved = () => { saving = true; };
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
    // **人が地図を触ったかは、地図の箱への入力で決める。** MapKit の scroll-start /
    // zoom-start が、矢印キー・ダブルタップ・トラックパッドのズームでも来るかは
    // 確かめられない。来なければ控えが始まらず、写真を開いて戻ると古い場所へ戻される。
    // 印を押しただけで立っても害は無い（控えるのは場所が変わったときだけ）
    for (const type of ["pointerdown", "wheel", "keydown", "touchstart"] as const) {
        el.addEventListener(type, () => { saving = true; }, { capture: true, passive: true });
    }

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
            const first = placing();
            setView(c, zoom, animate && !first);
        },
        fitBounds: (b, o) => {
            const first = placing();
            const v = fitView(b, width() || 390, height() || 520, o.padding, o.maxZoom);
            setView({ lat: v.lat, lng: v.lng }, v.zoom, o.animate === false ? false : animate && !first);
        },
        zoomIn: () => { placing(); setView(center(), currentZoom() + 1, animate); },
        zoomOut: () => { placing(); setView(center(), currentZoom() - 1, animate); },
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
