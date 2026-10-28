import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import type { MapEngine } from "@/lib/map/engine";

// **どちらの地図で描くか。** 鍵（`NEXT_PUBLIC_MAPKIT_JS_TOKEN`）があれば Apple の
// マップ、無い・読めない・断られたなら今までの地図（Leaflet＋OpenStreetMap）。
// 「地図が出ない」より「別の地図が出る」方がよい（`lib/map/engine.ts`）。

const made = vi.hoisted(() => ({ kinds: [] as string[], removed: [] as string[] }));
const mk = vi.hoisted(() => ({
    load: null as null | ((token: string, lang: string) => Promise<unknown>),
    refused: false,
    listeners: new Set<() => void>(),
}));

function fakeEngine(kind: "leaflet" | "mapkit"): MapEngine {
    made.kinds.push(kind);
    return {
        kind,
        getZoom: () => 4, getCenter: () => ({ lat: 36, lng: 138 }),
        getBounds: () => ({ south: 35, west: 139, north: 36, east: 140 }),
        setView: () => {}, fitBounds: () => {}, zoomIn: () => {}, zoomOut: () => {},
        onBackgroundClick: () => {}, onZoomEnd: () => {}, onMoveEnd: () => {}, onceUserMove: () => {},
        clearMarkers: () => {}, addMarker: () => {}, addHereDot: () => {}, invalidateSize: () => {},
        remove: () => { made.removed.push(kind); },
    };
}

vi.mock("@/lib/map/leafletEngine", () => ({
    createLeafletEngine: async () => fakeEngine("leaflet"),
}));
vi.mock("@/lib/map/mapkitEngine", () => ({
    loadMapKit: (t: string, l: string) => mk.load!(t, l),
    createMapKitEngine: () => fakeEngine("mapkit"),
    mapKitRefused: () => mk.refused,
    onMapKitRefused: (fn: () => void) => { mk.listeners.add(fn); return () => mk.listeners.delete(fn); },
}));

const photo = { id: "a", src: "https://cdn/a.jpg", userId: "u", title: { ja: "a" }, location: "山中湖",
    coords: { lat: 35.42, lng: 138.88 }, published: true, createdAt: "2026-01-01T00:00:00.000Z" } as Photo & { coords: { lat: number; lng: number } };

async function loadPhotoMap(token: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MAPKIT_JS_TOKEN", token);
    return (await import("../PhotoMap")).default;
}

beforeEach(() => {
    made.kinds.length = 0; made.removed.length = 0;
    mk.refused = false; mk.listeners.clear();
    mk.load = vi.fn(async () => ({}));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("どちらの地図で描くか", () => {
    it("鍵があれば Apple のマップ（言語は画面に合わせる）", async () => {
        const PhotoMap = await loadPhotoMap("tok");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["mapkit"]));
        expect(mk.load).toHaveBeenCalledWith("tok", "ja");
    });

    it("鍵が無ければ Apple に読みに行かず、今までの地図", async () => {
        const PhotoMap = await loadPhotoMap("");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["leaflet"]));
        expect(mk.load).not.toHaveBeenCalled();
    });

    it("Apple に届かなければ、今までの地図に切り替える", async () => {
        mk.load = vi.fn(async () => { throw new Error("mapkit: load failed"); });
        const PhotoMap = await loadPhotoMap("tok");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["leaflet"]));
    });

    it("鍵が後から断られたら（期限切れ・1日の上限）、Apple の地図を外して今までの地図にする", async () => {
        const PhotoMap = await loadPhotoMap("tok");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["mapkit"]));
        act(() => { mk.refused = true; for (const fn of mk.listeners) fn(); });
        await waitFor(() => expect(made.kinds).toEqual(["mapkit", "leaflet"]));
        expect(made.removed).toEqual(["mapkit"]);
    });

    it("前に断られていたら、最初から今までの地図（読み直さない）", async () => {
        mk.refused = true;
        const PhotoMap = await loadPhotoMap("tok");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["leaflet"]));
        expect(mk.load).not.toHaveBeenCalled();
    });
});
