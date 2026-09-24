"use client";

import type { Map as LeafletMap, Layer as LeafletLayer } from "leaflet";

/**
 * Actual vector cartography for the single existing Leaflet map.
 *
 * Preview-only dependency strategy: fixed-version MapLibre GL JS v5 UMD +
 * official Leaflet bridge loaded from HTTPS CDN; no second Leaflet map or
 * fake/image-based basemap. For production, install audited npm dependencies
 * and ship their JS/CSS with the app instead of depending on runtime CDN.
 *
 * Background style is the REAL OpenFreeMap Dark vector style: coastline,
 * streets, place labels and geographic coordinates from OpenStreetMap.
 * https://openfreemap.org/quick_start/
 */
const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.css";
const LEAFLET_BRIDGE = "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.js";
/** NASA's actual geographic shaded-relief tiles; no fabricated coastline.
 * Only used as a subtle LOW-ZOOM texture atop real OpenFreeMap vector geography.
 * Public GIBS WMTS EPSG3857 GoogleMapsCompatible_Level8 static basemap.
 */
const NASA_RELIEF = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";

// "dark" is the restrained editorial/vector style. Fiord's bright contour
// outlines overpower photo pins at the Greece/Japan travel zoom levels.
export const REAL_DARK_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

type VectorMap = {
    once: (event: string, callback: () => void) => void;
    on: (event: string, callback: (event?: unknown) => void) => void;
    off: (event: string, callback: (event?: unknown) => void) => void;
    loaded: () => boolean;
    getStyle: () => { layers?: Array<{ id: string; type: string }> };
    getSource: (id: string) => unknown;
    addSource: (id: string, source: Record<string, unknown>) => void;
    addLayer: (layer: Record<string, unknown>, before?: string) => void;
};
type VectorLayer = LeafletLayer & {
    getMaplibreMap: () => VectorMap;
};
type Adapter = (options: { style: string; interactive: boolean; attributionControl: boolean }) => VectorLayer;
type BridgeWindow = Window & {
    L?: Record<string, unknown>;
    maplibregl?: object;
    MaplibreGLLeaflet?: { maplibreGL?: Adapter };
};
let adapterPromise: Promise<Adapter> | null = null;

function scriptOnce(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-journey-vector="${src}"]`);
        if (existing?.dataset.ready === "true") { resolve(); return; }
        const script = existing ?? document.createElement("script");
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            script.removeEventListener("load", onLoad);
            script.removeEventListener("error", onError);
            if (ok) { script.dataset.ready = "true"; resolve(); }
            else { script.remove(); reject(new Error(`Could not load vector map runtime: ${src}`)); }
        };
        const onLoad = () => finish(true);
        const onError = () => finish(false);
        const timeout = window.setTimeout(() => finish(false), 16000);
        script.addEventListener("load", onLoad);
        script.addEventListener("error", onError);
        if (!existing) {
            script.src = src;
            script.async = true;
            script.crossOrigin = "anonymous";
            script.dataset.journeyVector = src;
            document.head.appendChild(script);
        }
    });
}

/** Leaflet uses an ESM module namespace; the UMD adapter expects window.L. */
export function loadVectorAdapter(leaflet: typeof import("leaflet")): Promise<Adapter> {
    if (typeof window === "undefined") return Promise.reject(new Error("Browser-only map adapter"));
    if (adapterPromise) return adapterPromise;
    adapterPromise = (async () => {
        const w = window as BridgeWindow;
        // Copy the exports into a writable plain object. Classes and map() keep
        // their identity; the UMD adapter can register its L.maplibreGL factory.
        w.L = { ...leaflet };
        if (!document.querySelector('link[data-journey-maplibre-css]')) {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = MAPLIBRE_CSS;
            css.dataset.journeyMaplibreCss = "true";
            document.head.appendChild(css);
        }
        await scriptOnce(MAPLIBRE_JS);
        if (!w.maplibregl) throw new Error("MapLibre GL JS did not initialize");
        await scriptOnce(LEAFLET_BRIDGE);
        const adapter = w.MaplibreGLLeaflet?.maplibreGL
            ?? w.L?.maplibreGL as Adapter | undefined;
        if (typeof adapter !== "function") throw new Error("Leaflet vector bridge did not initialize");
        return adapter;
    })().catch((error: unknown) => {
        adapterPromise = null;
        throw error;
    });
    return adapterPromise;
}

/**
 * The screenshot reference has geographical relief instead of a flat black sea.
 * Overlay real NASA shaded-relief imagery *below place-name symbol layers*
 * (not a CSS graphic or fake geographic texture). Stop at zoom 8 where the
 * source lacks finer data; the OpenFreeMap real roads and labels remain.
 * A NASA tile outage must never hide the live vector basemap.
 */
function addLowZoomRelief(gl: VectorMap): boolean {
    if (gl.getSource("journey-nasa-relief")) return true;
    try {
        gl.addSource("journey-nasa-relief", {
            type: "raster",
            tiles: [NASA_RELIEF],
            tileSize: 256,
            maxzoom: 8,
            attribution: "Imagery: NASA GIBS / Blue Marble",
        });
        const firstLabel = gl.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
        gl.addLayer({
            id: "journey-nasa-relief-overlay",
            type: "raster",
            source: "journey-nasa-relief",
            minzoom: 0,
            maxzoom: 8.5,
            paint: {
                "raster-opacity": 0.43,
                "raster-saturation": -0.5,
                "raster-brightness-max": 0.64,
                "raster-fade-duration": 180,
            },
        }, firstLabel);
        return true;
    } catch {
        return false;
    }
}

/**
 * Switches the base layer only AFTER actual vector tiles rendered.
 * Keep the readable OSM fallback in place on script/style failure.
 * Caller owns map lifecycle; cleanup is registered by the caller's effect.
 */
export async function upgradeToRealVectorBasemap(
    leaflet: typeof import("leaflet"),
    map: LeafletMap,
    fallback: LeafletLayer,
    shouldContinue: () => boolean,
    onState: (state: "vector-ready" | "fallback") => void,
): Promise<void> {
    let vector: VectorLayer | null = null;
    try {
        const adapter = await loadVectorAdapter(leaflet);
        if (!shouldContinue()) return;
        vector = adapter({
            style: REAL_DARK_MAP_STYLE,
            interactive: false,
            attributionControl: false,
        });
        vector.addTo(map);
        const gl = vector.getMaplibreMap();
        const activeLayer = vector;
        await new Promise<void>((resolve, reject) => {
            let finished = false;
            const finish = (ok: boolean) => {
                if (finished) return;
                finished = true;
                window.clearTimeout(timeout);
                gl.off("error", onError);
                if (ok) resolve();
                else reject(new Error("Vector map style/tiles did not load"));
            };
            const onError = () => finish(false);
            const timeout = window.setTimeout(() => finish(false), 18000);
            gl.on("error", onError);
            gl.once("idle", () => finish(true));
            if (gl.loaded()) finish(true);
        });
        if (!shouldContinue()) { map.removeLayer(activeLayer); return; }
        const reliefAdded = addLowZoomRelief(gl);
        map.removeLayer(fallback);
        if (reliefAdded) map.attributionControl?.addAttribution(
            '<a href="https://gibs.earthdata.nasa.gov/">NASA GIBS / Blue Marble</a>',
        );
        map.attributionControl?.addAttribution(
            '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> '
            + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
            + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        );
        onState("vector-ready");
    } catch {
        if (vector && shouldContinue()) map.removeLayer(vector);
        if (shouldContinue()) {
            if (!map.hasLayer(fallback)) fallback.addTo(map);
            onState("fallback");
        }
    }
}
