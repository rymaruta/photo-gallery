import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, screen, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import type { MapEngine } from "@/lib/map/engine";

// **どちらの地図で描くか。** 鍵（`NEXT_PUBLIC_MAPKIT_JS_TOKEN`）があれば Apple の
// マップ、無い・読めない・断られたなら今までの地図（Leaflet＋OpenStreetMap）。
// 「地図が出ない」より「別の地図が出る」方がよい（`lib/map/engine.ts`）。

const made = vi.hoisted(() => ({ kinds: [] as string[], removed: [] as string[], fits: 0, userMove: null as null | (() => void) }));
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
        setView: () => {}, fitBounds: () => { made.fits++; }, zoomIn: () => {}, zoomOut: () => {},
        onBackgroundClick: () => {}, onViewChange: () => {}, onMoveEnd: () => {},
        onceUserMove: (fn) => { made.userMove = fn; },
        clearMarkers: () => {}, addMarker: () => ({ remove: () => {} }), addHereDot: () => ({ remove: () => {} }), invalidateSize: () => {},
        remove: () => { made.removed.push(kind); },
    };
}

const leafletFails = vi.hoisted(() => ({ on: false, gate: null as null | Promise<void> }));
vi.mock("@/lib/map/leafletEngine", () => ({
    createLeafletEngine: async () => {
        if (leafletFails.on) throw new Error("Failed to fetch dynamically imported module");
        const engine = fakeEngine("leaflet");
        // 作り終えてから呼び出し側に戻るまでの間を作る（その間に片付けが走る形）
        if (leafletFails.gate) await leafletFails.gate;
        return engine;
    },
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
    made.kinds.length = 0; made.removed.length = 0; made.fits = 0; made.userMove = null;
    leafletFails.on = false; leafletFails.gate = null;
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

// 写真0枚で地図を作ると、写真が届いたとき一度だけそこへ寄る。**人が先に動かしたら取り消す。**
// Apple のマップは ＋− の寄せを「人の操作」と数えない（`zoom-start` が来ない）ので、
// ボタンの側で取り消す
describe("写真があとから届いたときの寄せ", () => {
    it("＋ を押したあとなら、写真が届いても引き剥がさない", async () => {
        const PhotoMap = await loadPhotoMap("tok");
        const { rerender } = render(<PhotoMap photos={[]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["mapkit"]));
        fireEvent.click(screen.getByRole("button", { name: "拡大" }));
        rerender(<PhotoMap photos={[photo]} locale="ja" />);
        expect(made.fits).toBe(0);
    });

    it("触っていなければ、写真が届いたら一度だけ寄る", async () => {
        const PhotoMap = await loadPhotoMap("tok");
        const { rerender } = render(<PhotoMap photos={[]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["mapkit"]));
        rerender(<PhotoMap photos={[photo]} locale="ja" />);
        expect(made.fits).toBe(1);
    });
});

describe("どちらの地図も読めない", () => {
    it("Apple にも届かず、控えの地図の部品も読めなければ、そう言う（白い枠のまま黙らない）", async () => {
        mk.load = vi.fn(async () => { throw new Error("mapkit: load failed"); });
        leafletFails.on = true;
        const PhotoMap = await loadPhotoMap("tok");
        render(<PhotoMap photos={[photo]} locale="ja" />);
        expect(await screen.findByTestId("map-load-failed")).toHaveTextContent("地図を読み込めませんでした");
    });
});

describe("作り終えてから戻るまでに要らなくなった", () => {
    it("作った控えの地図を外す（同じ枠に2つ目を建てて落ちない）", async () => {
        let open!: () => void;
        leafletFails.gate = new Promise<void>((r) => { open = r; });
        const PhotoMap = await loadPhotoMap("");
        const { unmount } = render(<PhotoMap photos={[photo]} locale="ja" />);
        await waitFor(() => expect(made.kinds).toEqual(["leaflet"]));
        unmount();
        await act(async () => { open(); await Promise.resolve(); });
        expect(made.removed).toEqual(["leaflet"]);
    });
});
