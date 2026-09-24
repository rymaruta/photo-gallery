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

/** MapTiler's licensed real satellite imagery with map-label overlay.
 * Public browser key required. We do not hard-code, proxy or guess a key. */
export function satelliteHybridStyle(key: string): string | null {
    const clean = key.trim();
    if (!clean || /^(YOUR_|REPLACE_|PLACEHOLDER|undefined|null)/i.test(clean)) return null;
    return `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${encodeURIComponent(clean)}`;
}

/** Hide administrative/maritime boundaries, noisy POIs and minor road labels
 * only in the SATELLITE HYBRID style; keep geographic/place labels visible.
 * Rendered satellite tiles must stay unmodified and visibly attributed.
 */
export function shouldHideSatelliteLayer(layer: { id: string; type: string }): boolean {
    const id = layer.id.toLowerCase();
    if (/boundary|border|admin|maritime|marine|disputed|territorial|country-line|state-line/.test(id)) return true;
    if (layer.type === "symbol" && /(^|[_-])(poi|shop|restaurant|commercial|house_number|housenumber|road_name|highway_name)([_-]|$)/.test(id)) return true;
    // MapTiler satellite style might include street line overlays; imagery
    // already contains roads. Only labels for recognisable places are needed.
    if (layer.type === "line" && /(^|[_-])(highway|road|street|railway|rail)([_-]|$)/.test(id)) return true;
    return false;
}

type VectorMap = {
    once: (event: string, callback: () => void) => void;
    on: (event: string, callback: (event?: unknown) => void) => void;
    off: (event: string, callback: (event?: unknown) => void) => void;
    loaded: () => boolean;
    getStyle: () => { layers?: Array<{ id: string; type: string }> };
    getSource: (id: string) => unknown;
    addSource: (id: string, source: Record<string, unknown>) => void;
    addLayer: (layer: Record<string, unknown>, before?: string) => void;
    setPaintProperty: (layerId: string, property: string, value: unknown) => void;
    setLayoutProperty: (layerId: string, property: string, value: unknown) => void;
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

/** The hide pass runs after MapTiler's hybrid style has loaded.
 * We never alter satellite imagery pixels or remove provider attribution.
 */
function simplifySatelliteLabels(gl: VectorMap): void {
    for (const layer of gl.getStyle().layers ?? []) {
        if (!shouldHideSatelliteLayer(layer)) continue;
        try { gl.setLayoutProperty(layer.id, "visibility", "none"); } catch { /* provider style changed */ }
    }
}

/**
 * Readable midnight-blue palette for the REAL vector basemap.
 *
 * OpenFreeMap "dark" defaults to almost-black land (#0c0c0c), water (#1b1b1d),
 * road lines (#181818) and place names (#656565); on a phone the geography
 * disappears. Change ONLY visual paint in this one shared map instance.
 * Actual coastline/roads/labels remain provider-supplied vector geometry.
 *
 * Explicit IDs were checked against the live OpenFreeMap dark style on
 * 2026-09-24. Ignore absent IDs so provider changes cannot blank the map.
 */
function applyReadableMapPalette(gl: VectorMap): void {
    const layers = new Set(gl.getStyle().layers?.map((layer) => layer.id) ?? []);
    const paint = (id: string, property: string, value: unknown) => {
        if (!layers.has(id)) return;
        try { gl.setPaintProperty(id, property, value); } catch { /* retain source style */ }
    };

    // Geographic contrast: lighter slate-blue land against a deeper blue sea.
    paint("background", "background-color", "#2D455B");
    paint("water", "fill-color", "#113653");
    paint("waterway", "line-color", "#2F6586");
    paint("landcover_ice_shelf", "fill-color", "#667C8F");
    paint("landcover_glacier", "fill-color", "#637789");
    paint("landuse_residential", "fill-color", "#395368");
    paint("landcover_wood", "fill-color", "#355765");
    paint("landuse_park", "fill-color", "#3C625D");
    paint("building", "fill-color", "#365066");
    paint("building", "fill-outline-color", "#54718A");

    // Routes must be visible even where the NASA terrain texture is present.
    // Motorway casing remains darker than the road center for definition.
    paint("highway_path", "line-color", "#8EA6B9");
    paint("highway_minor", "line-color", "#708DA4");
    paint("highway_major_casing", "line-color", "#304B63");
    paint("highway_major_inner", "line-color", "#9AB2C7");
    paint("highway_major_subtle", "line-color", "#8AA4BC");
    paint("highway_motorway_casing", "line-color", "#385A75");
    paint("highway_motorway_inner", "line-color", "#C0D2E3");
    paint("highway_motorway_subtle", "line-color", "#A3BAD0");
    paint("railway", "line-color", "#7E9CB3");
    paint("railway_minor", "line-color", "#7894AA");
    paint("railway_transit", "line-color", "#7894AA");
    paint("railway_dashline", "line-color", "#324C63");
    paint("railway_minor_dashline", "line-color", "#324C63");
    paint("railway_transit_dashline", "line-color", "#324C63");
    paint("boundary_state", "line-color", "#7189A0");
    paint("boundary_country_z0-4", "line-color", "#8DA5BC");
    paint("boundary_country_z5-", "line-color", "#8DA5BC");

    // Explicitly lighten map labels, not Journey Photo's data-driven cards.
    // Dark halos keep long and small Japanese/English names readable.
    for (const layer of gl.getStyle().layers ?? []) {
        if (layer.type !== "symbol") continue;
        if (layer.id.startsWith("place_")) {
            paint(layer.id, "text-color", "#E4EEF8");
            paint(layer.id, "text-halo-color", "#1A2F44");
            paint(layer.id, "text-halo-width", 1.4);
        } else if (layer.id.startsWith("highway_name_")) {
            paint(layer.id, "text-color", "#B8D0E4");
            paint(layer.id, "text-halo-color", "#1A2F44");
            paint(layer.id, "text-halo-width", 1.2);
        } else if (layer.id === "water_name") {
            paint(layer.id, "text-color", "#AFD7ED");
            paint(layer.id, "text-halo-color", "#103451");
            paint(layer.id, "text-halo-width", 1.4);
        }
    }
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
                // Relief should be a texture, not a dark veil over the map.
                "raster-opacity": 0.17,
                "raster-saturation": -0.45,
                "raster-brightness-max": 0.88,
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
    onState: (state: "satellite-ready" | "vector-ready" | "fallback") => void,
    mapTilerKey?: string,
): Promise<void> {
    let vector: VectorLayer | null = null;
    const satelliteUrl = satelliteHybridStyle(mapTilerKey ?? "");
    try {
        const adapter = await loadVectorAdapter(leaflet);
        if (!shouldContinue()) return;
        vector = adapter({
            style: satelliteUrl ?? REAL_DARK_MAP_STYLE,
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
        // Satellite imagery is already real, highly detailed geography.
        // Do not cover it with shaded-relief rasters or dark-blue fill layers.
        // Boundary/territorial lines and noisy POIs are suppressed in hybrid.
        if (satelliteUrl) simplifySatelliteLabels(gl);
        else applyReadableMapPalette(gl);
        const reliefAdded = satelliteUrl ? false : addLowZoomRelief(gl);
        map.removeLayer(fallback);
        if (reliefAdded) map.attributionControl?.addAttribution(
            '<a href="https://gibs.earthdata.nasa.gov/">NASA GIBS / Blue Marble</a>',
        );
        map.attributionControl?.addAttribution(
            '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> '
            + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
            + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        );
        if (satelliteUrl) map.attributionControl?.addAttribution(
            '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">MapTiler</a> &amp; imagery providers',
        );
        onState(satelliteUrl ? "satellite-ready" : "vector-ready");
    } catch {
        if (vector && shouldContinue()) map.removeLayer(vector);
        if (shouldContinue()) {
            if (!map.hasLayer(fallback)) fallback.addTo(map);
            onState("fallback");
        }
    }
}
