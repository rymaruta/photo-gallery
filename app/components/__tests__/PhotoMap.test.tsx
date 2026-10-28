import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// 地図そのもの（描画・タイル）は jsdom では出せないので Leaflet を差し替え、
// **こちらが Leaflet に何を渡しているか**を見る。
// ここに置いたのは、実ブラウザでしか見えない壊れを踏んだため:
//   コンテナがスタッキングコンテキストを作らず、Leaflet の z-index 400 が
//   ページ全体の土俵に出て `z-50` のヘッダー・メニューを覆っていた。
// CSS と実測が要る話だが、**こちら側の指定が消えたら気づける**ようにする。
//
// **ポップアップはもう作らない**（写真の中身は `app/map/MapPhotoSheet.tsx` が
// 描く）。以前ここに「ポップアップの画像に高さが無く、Leaflet が収まっていると
// 誤って測る」という項目があったが、その作りごと無くなったので落とした
// ——`bindPopup` を呼ばないことは「押されたピンを親へ渡す」の1件が見張っている。

type FakeMarker = {
    kind: string; latlng: unknown; opts: Record<string, unknown>;
    /**
     * `bindPopup` が呼ばれたら入る。**`null` のままであること**を見張る
     * ためだけに在る（ポップアップはもう作らない）。`popupOpts` /
     * `getPopup` / `update` も持っていたが、**誰も見ていない偽物**
     * だったので落とした
     */
    popup: HTMLElement | null;
    clickHandler?: () => void;
    keypressHandler?: (e: { originalEvent?: { key: string } }) => void;
    on: (ev: string, fn: (e?: unknown) => void) => void; addTo: () => FakeMarker;
    bindPopup: (el: HTMLElement) => FakeMarker;
};
const state = vi.hoisted(() => ({
    markers: [] as FakeMarker[], zoom: 4, center: [36, 138] as [number, number],
    zoomControl: null as unknown, mapOpts: null as Record<string, unknown> | null,
    fitOpts: null as Record<string, unknown> | null, fitCalls: 0,
    fitBounds: null as number[][] | null,
    setViewArgs: [] as Array<{ center: [number, number]; zoom: number }>,
    bounds: { south: 35, west: 139, north: 36, east: 140 },
    fireMap: (() => {}) as (ev: string) => void,
}));
const fireMap = (ev: string) => state.fireMap(ev);

vi.mock("leaflet", () => {
    const handlers: Record<string, Array<() => void>> = {};
    const map = {
        getZoom: () => state.zoom,
        getCenter: () => ({ lat: state.center[0], lng: state.center[1] }),
        // 操作のボタン（容器の外の `<button>`）から呼ぶぶん
        zoomIn: vi.fn(() => { state.zoom += 1; }),
        zoomOut: vi.fn(() => { state.zoom -= 1; }),
        getBounds: () => ({
            getSouth: () => state.bounds.south, getWest: () => state.bounds.west,
            getNorth: () => state.bounds.north, getEast: () => state.bounds.east,
        }),
        fitBounds: vi.fn((b: number[][], o: Record<string, unknown>) => { state.fitBounds = b; state.fitOpts = o; state.fitCalls++; (handlers.moveend ?? []).forEach((f) => f()); }),
        setView: vi.fn((center: [number, number], zoom: number) => {
            state.setViewArgs.push({ center, zoom }); state.center = center; state.zoom = zoom;
            (handlers.moveend ?? []).forEach((f) => f());   // 本物も setView の直後に moveend を出す
        }),
        // アンマウントで listener を捨てる（溜めるとテストをまたいで前の
        // コンポーネントの moveend が走る）
        remove: vi.fn(() => { for (const k of Object.keys(handlers)) delete handlers[k]; }),
        on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
        // 本物と同じく、空白区切りの各名前に一回限りの listener を付ける
        once: (evs: string, fn: () => void) => {
            for (const ev of evs.split(/\s+/)) {
                const wrap = () => { handlers[ev] = (handlers[ev] ?? []).filter((f) => f !== wrap); fn(); };
                (handlers[ev] ||= []).push(wrap);
            }
        },
        fire: (ev: string) => (handlers[ev] ?? []).forEach((f) => f()),
    };
    state.fireMap = map.fire;
    const group = {
        addTo: () => group,
        clearLayers: () => { state.markers.length = 0; },
        removeLayer: (m: FakeMarker) => { const i = state.markers.indexOf(m); if (i >= 0) state.markers.splice(i, 1); },
    };
    const make = (kind: string) => (latlng: unknown, opts: Record<string, unknown> = {}) => {
        const m: FakeMarker = {
            kind, latlng, opts, popup: null,
            on: (ev: string, fn: (e?: unknown) => void) => {
                if (ev === "click") m.clickHandler = fn as () => void;
                if (ev === "keypress") m.keypressHandler = fn as FakeMarker["keypressHandler"];
            },
            addTo: () => m,
            bindPopup: (el) => { m.popup = el; return m; },
        };
        state.markers.push(m);
        return m;
    };
    return {
        map: (_el: unknown, opts: Record<string, unknown>) => { state.mapOpts = opts; return map; },
        tileLayer: () => ({ addTo: () => ({}) }),
        layerGroup: () => group,
        circleMarker: make("circle"),
        marker: make("marker"),
        divIcon: (o: unknown) => o,
        control: { zoom: (o: unknown) => { state.zoomControl = o; return { addTo: () => ({}) }; } },
    };
});

const PhotoMap = (await import("../PhotoMap")).default;

type MapPhoto = Photo & { coords: { lat: number; lng: number } };
const photo = (id: string, extra: Partial<Photo> = {}): MapPhoto => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u1", title: { ja: `写真${id}` },
    location: "山中湖", coords: { lat: 35.42, lng: 138.88 }, published: true,
    createdAt: "2026-01-01T00:00:00.000Z", ...extra,
} as MapPhoto);

const draw = async (photos: MapPhoto[], onSelect?: (s: unknown) => void) => {
    render(<PhotoMap photos={photos} locale="ja" onSelect={onSelect} />);
    await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
};

/** 「動きを減らす」設定を模す（jsdom には matchMedia が無い） */
function setReducedMotion(reduce: boolean) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true, writable: true,
        value: (q: string) => ({ matches: reduce && q.includes("reduced-motion"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
    });
}

beforeEach(() => {
    state.markers.length = 0; state.zoom = 4; state.center = [36, 138]; state.zoomControl = null;
    state.mapOpts = null; state.fitOpts = null; state.fitCalls = 0; state.setViewArgs.length = 0;
    state.bounds = { south: 35, west: 139, north: 36, east: 140 };
    setReducedMotion(false);
    window.location.hash = "";
    sessionStorage.clear();
});

// 最初に見せる場所と、動かしたあとの控え。決め方は lib/utils/mapView.ts
describe("見る場所", () => {
    it("引ききれる限界を 2 にする（世界1周が地図の高さより短いと上下に下地が出る）", async () => {
        await draw([photo("a")]);
        // 実測 390x844: ズーム0 で上に 211px・1 で 39px の黒帯
        expect(state.mapOpts?.minZoom).toBe(2);
    });

    it("何も無ければ、全部のピンが収まる範囲に合わせる", async () => {
        await draw([photo("a")]);
        expect(state.fitCalls).toBe(1);
        expect(state.setViewArgs).toEqual([]);
    });

    // iOS の `MapFraming`: 全部を収めると日本とヨーロッパで地球儀の縮尺になり、1枚も探せない
    // 札とバッジは座標の上へ伸び、地図の上と左下にはボタンが重なる。余白0だと端のピンが切れる
    it("寄せるときは余白を取る", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 35.6, lng: 139.6 } })]);
        expect(state.fitOpts?.padding).toEqual([32, 32]);
    });

    it("いちばん写真の多い塊に合わせる（日本3か所とパリ1か所なら日本）", async () => {
        await draw([
            photo("a", { coords: { lat: 35.68, lng: 139.76 } }), photo("b", { coords: { lat: 37.63, lng: 138.94 } }),
            photo("c", { coords: { lat: 36.2, lng: 139.0 } }), photo("d", { coords: { lat: 48.86, lng: 2.35 } }),
        ]);
        const [[south, west], [north, east]] = state.fitBounds!;
        expect(west, "パリまで収めている").toBeGreaterThan(130);
        expect(north - south).toBeLessThan(10);
        expect(east).toBeLessThan(150);
    });

    it("URL の #z/lat/lng があればそこを見せる（写真ページからの導線）", async () => {
        window.location.hash = "#12/48.86/2.35";
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [48.86, 2.35], zoom: 12 }]);
        expect(state.fitCalls, "ハッシュの位置に寄せたあと全体へ戻している").toBe(0);
    });

    it("このタブで前に見ていた場所があれば、そこから始める（戻るたびに全体へ戻さない）", async () => {
        // 実測: ズーム 6 まで寄って写真を開き、戻ると 1 に戻っていた
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 35.42, lng: 138.88, zoom: 6, hash: "" }));
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [35.42, 138.88], zoom: 6 }]);
        expect(state.fitCalls).toBe(0);
    });

    it("ハッシュが控えを取ったときと同じなら、控え（そのあと動かした場所）を優先する", async () => {
        window.location.hash = "#12/48.86/2.35";
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 48.9, lng: 2.4, zoom: 9, hash: "#12/48.86/2.35" }));
        await draw([photo("a")]);
        expect(state.setViewArgs).toEqual([{ center: [48.9, 2.4], zoom: 9 }]);
    });

    it("動かすたびに、見ている場所を控える", async () => {
        window.location.hash = "#12/48.86/2.35";
        await draw([photo("a")]);
        state.center = [41.38, 2.18]; state.zoom = 7;
        // 本物の Leaflet は移動が終わると moveend を出す
        fireMap("moveend");
        const saved = JSON.parse(sessionStorage.getItem("photo-map:view")!);
        expect(saved).toEqual({ lat: 41.38, lng: 2.18, zoom: 7, hash: "#12/48.86/2.35" });
    });
});

describe("地図の枠", () => {
    it("スタッキングコンテキストを作る（Leaflet の z-index をページに出さない）", async () => {
        await draw([photo("a")]);
        // `isolate` = isolation: isolate。これが無いと Leaflet のペイン（400）と
        // コントロール（1000）が `z-50` のヘッダー・メニューを追い越す
        // ——実測（Chromium 390x844・300pxスクロール）: ヘッダー帯の画素が
        // タイル色になり、見えないハンバーガーが押せる状態だった
        expect(screen.getByTestId("photo-map").className).toContain("isolate");
    });

    it("下地の色は専用クラスに寄せる（Tailwind の bg-* は Leaflet に負ける）", async () => {
        await draw([photo("a")]);
        const cls = screen.getByTestId("photo-map").className;
        expect(cls).toContain("photo-map-shell");
        // `bg-white/5` は `.leaflet-container { background: #ddd }` と同じ強さで、
        // 読み込み順で負けて一度も効いていなかった（実測 rgb(221,221,221)）
        expect(cls, "効かない指定を戻している").not.toContain("bg-white/5");
    });
});

// **写真の中身は地図の中に描かない。** 押されたことだけを `onSelect` で
// 親へ渡し、中身は画面下のシート（`app/map/MapPhotoSheet.tsx`）が描く。
//
// 地図の中（Leaflet のポップアップ）に組んでいた頃は2つ壊れていた:
//   - 高さが地図に収まらず、低い画面では枠の外へ出ていた（実測 390x844 で
//     3枚 465px・地図の上へ 183px はみ出し、うち1枚は表示も操作もできなかった）
//   - 画像が遅れて入るたびに測り直しが走り、その測り直しが横送りの位置を
//     先頭へ巻き戻していた（実測: 10枚の束で5回送って5回とも先頭へ戻された）
/** 0.01 度おき（約1km）の格子に n 地点。iOS と同じく 60 地点を超えると束になる */
const gridPhotos = (n: number, lat0 = 35.4, lng0 = 139.4): MapPhoto[] =>
    Array.from({ length: n }, (_, k) => photo(`g${k}`, {
        coords: { lat: lat0 + Math.floor(k / 20) * 0.01, lng: lng0 + (k % 20) * 0.01 }, location: `場所${k}`,
    }));

/** 束が見える範囲に寄せておく（束ねるかどうかは見えている枠で決まる） */
const lookAtGrid = () => {
    state.center = [35.45, 139.5];
    state.bounds = { south: 35.2, west: 139.2, north: 35.7, east: 139.8 };
};

const isCluster = (m: FakeMarker) => String(m.opts.title ?? "").includes("押すと寄ります");

describe("押されたピンを親へ渡す", () => {
    it("ポップアップはもう作らない（地図の高さに縛られないため）", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 10, lng: 10 } })]);
        for (const m of state.markers) expect(m.popup).toBeNull();
    });

    it("ピンを押すと、その撮影地の写真が渡る", async () => {
        const onSelect = vi.fn();
        await draw([photo("a")], onSelect);
        state.markers[0].clickHandler?.();
        expect(onSelect).toHaveBeenCalledTimes(1);
        const sel = onSelect.mock.calls[0][0] as { photos: MapPhoto[]; index: number };
        expect(sel.photos.map((p) => p.id)).toEqual(["a"]);
        expect(sel.index).toBe(0);
    });

    // iOS の `MapPin.group`: 同じ座標（約1km に丸めた）の写真は1本のピンにまとめ、枚数のバッジを付ける
    it("同じ撮影地の写真は1本のピンにまとめ、押すと全部が渡る", async () => {
        const at = { lat: 35.42, lng: 138.88 };
        const onSelect = vi.fn();
        await draw([photo("a", { coords: at }), photo("b", { coords: at }), photo("c", { coords: at })], onSelect);
        expect(state.markers).toHaveLength(1);
        const html = (state.markers[0].opts.icon as { html: HTMLElement }).html;
        expect(html.querySelector(".map-count-badge")?.textContent).toBe("3");
        state.markers[0].clickHandler?.();
        expect((onSelect.mock.calls[0][0] as { photos: MapPhoto[] }).photos.map((p) => p.id)).toEqual(["a", "b", "c"]);
    });

    it("1枚だけの撮影地にはバッジを付けない", async () => {
        await draw([photo("a")]);
        expect((state.markers[0].opts.icon as { html: HTMLElement }).html.querySelector(".map-count-badge")).toBeNull();
    });

    // iOS の `MapPinClusters`: 60 地点以下なら束ねない（離れていても、重なっていても）
    it("60 地点までは束ねない", async () => {
        lookAtGrid();
        await draw(gridPhotos(60));
        expect(state.markers).toHaveLength(60);
        expect(state.markers.some(isCluster)).toBe(false);
    });

    it("60 地点を超えたら束ね、押すとその束が収まる枠まで寄る（選びはしない）", async () => {
        lookAtGrid();
        const onSelect = vi.fn();
        await draw(gridPhotos(200), onSelect);
        expect(state.markers.length).toBeLessThanOrEqual(60);
        const cluster = state.markers.find(isCluster);
        expect(cluster, "束が無い").toBeTruthy();
        const before = state.fitCalls;
        cluster!.clickHandler?.();
        expect(state.fitCalls).toBe(before + 1);
        expect(onSelect, "束を押して札を出している").not.toHaveBeenCalled();
    });

    it("束は札を2枚重ね、写真の合計枚数のバッジを付ける", async () => {
        lookAtGrid();
        await draw(gridPhotos(200));
        const cluster = state.markers.find(isCluster)!;
        const html = (cluster.opts.icon as { html: HTMLElement }).html;
        expect(html.querySelector(".photo-map-pin__back")).toBeTruthy();
        const n = Number(html.querySelector(".map-count-badge")?.textContent);
        expect(n).toBeGreaterThan(1);
        expect(String(cluster.opts.title)).toMatch(new RegExp(`^\\d+地点の写真 ${n}枚。押すと寄ります$`));
    });

    it("地図の余白を押すと `null`（＝閉じる）が渡る", async () => {
        const onSelect = vi.fn();
        await draw([photo("a")], onSelect);
        fireMap("click");
        expect(onSelect).toHaveBeenCalledWith(null);
    });

    // Leaflet はレイヤーの DOM イベントを**地図にも伝える**。止めるのは
    // `bubblingMouseEvents: false` のレイヤーだけで、`Marker` は既定 false。
    // `circleMarker` に戻すなら `bubblingMouseEvents: false` を明示すること
    it("ピンは Marker で描く（click が地図へ伝わらない側）", async () => {
        await draw([photo("a")]);
        expect(state.markers[0].kind).toBe("marker");
        expect(state.markers[0].opts.bubblingMouseEvents, "Path に戻すなら false を明示する").toBeUndefined();
    });

    // iOS の板 Map の `.pin`: 44 の白い角丸に写真 40。**下端の真ん中が座標**
    it("ピンは白い札に写真のサムネ（幅と高さを px で書く）・下端の真ん中が座標", async () => {
        await draw([photo("a", { thumbSm: "https://cdn.example.com/uploads/a_sm.webp" })]);
        const icon = state.markers[0].opts.icon as { html: HTMLElement; iconSize: number[]; iconAnchor: number[] };
        const img = icon.html.querySelector(".photo-map-pin__card img");
        expect(img, "サムネが入っていない").toBeTruthy();
        expect(img!.getAttribute("src")).toContain("a_sm.webp");
        expect(img!.getAttribute("width")).toBe("40");
        expect(img!.getAttribute("height")).toBe("40");
        expect(icon.iconSize).toEqual([44, 44]);
        expect(icon.iconAnchor).toEqual([22, 44]);
    });

    // **文字列の HTML を組まない。** 写真の URL を通した差し込みの口になる
    it("ピンの中身は DOM で渡す（HTML の文字列を組まない）", async () => {
        await draw([photo("a")]);
        const icon = state.markers[0].opts.icon as { html: unknown };
        expect(typeof icon.html, "文字列で組んでいる").not.toBe("string");
    });

    it("サムネが無い写真でも描ける（白い札だけ残す）", async () => {
        await draw([photo("a", { src: "" } as Partial<Photo>)]);
        const icon = state.markers[0].opts.icon as { html: HTMLElement };
        expect(icon.html.querySelector("img")).toBeNull();
        expect(icon.html.querySelector(".photo-map-pin__card")).toBeTruthy();
    });

    // ピンは `keyboard: true` で Tab で来られるが、Leaflet は Enter を click に**変換しない**
    it("ピンは Enter でも押せる", async () => {
        const onSelect = vi.fn();
        await draw([photo("a")], onSelect);
        state.markers[0].keypressHandler?.({ originalEvent: { key: "a" } });
        expect(onSelect).not.toHaveBeenCalled();
        state.markers[0].keypressHandler?.({ originalEvent: { key: "Enter" } });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("`onSelect` を渡さなくても落ちない", async () => {
        await draw([photo("a")]);
        expect(() => { state.markers[0].clickHandler?.(); fireMap("click"); }).not.toThrow();
    });

    // 名前は撮影地。HTML ではなく文字として入る
    it("撮影地の名前を印の下に出す（文字として入れる）", async () => {
        await draw([photo("a", { location: "<img onerror=x>" })]);
        const label = (state.markers[0].opts.icon as { html: HTMLElement }).html.querySelector(".map-pin-label");
        expect(label?.textContent).toBe("<img onerror=x>");
        expect(label?.querySelector("img")).toBeNull();
    });

    // **地図が動いても、変わらない印は作り直さない**（画像を読み直して一瞬消える・フォーカスが落ちる）
    it("地図が動いても、変わらないピンは置き直さない", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 10, lng: 10 } })]);
        const before = state.markers.slice();
        fireMap("moveend");
        expect(state.markers.length).toBe(before.length);
        expect(state.markers.every((m, i) => m === before[i])).toBe(true);
    });

    // ビルドの控えから API の一覧に置き換わると、写真の id は同じまま撮影地が増えることがある
    it("写真の撮影地が後から書かれたら、ピンの名前と読み上げ名を描き直す", async () => {
        const { rerender } = render(<PhotoMap photos={[photo("a", { location: "" })]} locale="ja" />);
        await waitFor(() => expect(state.markers).toHaveLength(1));
        rerender(<PhotoMap photos={[photo("a", { location: "パリ" })]} locale="ja" />);
        expect(state.markers).toHaveLength(1);
        expect(state.markers[0].opts.title).toBe("パリ、写真 1枚");
        expect((state.markers[0].opts.icon as { html: HTMLElement }).html.querySelector(".map-pin-label")?.textContent).toBe("パリ");
    });

    it("束の中の撮影地の写真が減ったら、束のバッジを描き直す", async () => {
        lookAtGrid();
        const at = { lat: 35.4, lng: 139.4 };
        const extra = [photo("x1", { coords: at }), photo("x2", { coords: at })];
        const base = gridPhotos(200);
        const { rerender } = render(<PhotoMap photos={[...base, ...extra]} locale="ja" />);
        await waitFor(() => expect(state.markers.some(isCluster)).toBe(true));
        const holding = () => state.markers.filter(isCluster).map((m) => String(m.opts.title)).find((t) => t.length > 0)!;
        const total = () => state.markers.filter(isCluster)
            .reduce((n, m) => n + Number(/写真 (\d+)枚/.exec(String(m.opts.title))![1]), 0);
        expect(holding()).toBeTruthy();
        expect(total()).toBe(202);
        rerender(<PhotoMap photos={base} locale="ja" />);
        expect(total(), "束の枚数が古いまま").toBe(200);
    });

    // iOS: 選んでいた撮影地が束に吸われたら選びを外す（札が見えない場所を指し続けない）
    it("選んでいた撮影地が束に吸われたら、選びを外す", async () => {
        lookAtGrid();
        const onSelect = vi.fn();
        const photos = gridPhotos(200);
        render(<PhotoMap photos={photos} locale="ja" onSelect={onSelect} selectedId="g0" />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        const absorbed = state.markers.filter(isCluster).length > 0;
        expect(absorbed).toBe(true);
        expect(onSelect).toHaveBeenCalledWith(null);
    });
});

// **操作のボタンは Leaflet のコントロールにしない**（2026-09-22・最終版モック）。
// `L.control.zoom` は白い26px四方の `<a href="#">` で、色も大きさもこのサイトと
// 合わず、読み上げには「リンク」と伝わる。地図の容器の**外**に素の `<button>` を
// 置けば、Leaflet のドラッグ・ホイールにも触られない
describe("操作のボタン", () => {
    it("Leaflet のズームコントロールは作らない", async () => {
        await draw([photo("a")]);
        expect(state.zoomControl, "Leaflet 側のコントロールが復活している").toBeNull();
        expect(state.mapOpts?.zoomControl).toBe(false);
    });

    it("＋ と − で地図を寄せ引きする", async () => {
        await draw([photo("a")]);
        const before = state.zoom;
        fireEvent.click(screen.getByRole("button", { name: "拡大" }));
        expect(state.zoom).toBe(before + 1);
        fireEvent.click(screen.getByRole("button", { name: "縮小" }));
        expect(state.zoom).toBe(before);
    });

    // **`z-[1001]` は Leaflet のコントロール層（1000）より前**。そのぶん、
    // 外枠が `isolate` でスタッキングコンテキストを作っていないと、
    // この値がページの土俵に出て固定ヘッダー（z-50）を覆う（`2922526f` と同じ形）
    it("ボタンは地図の枠の中に閉じ込める（外枠が isolate）", async () => {
        await draw([photo("a")]);
        const frame = document.querySelector(".photo-map-frame") as HTMLElement;
        expect(frame, "外枠が無い").toBeTruthy();
        expect(frame.className).toContain("isolate");
        expect(frame.querySelector('[data-testid="map-locate"]'), "ボタンが枠の外にある").toBeTruthy();
    });

    // 「このエリアを検索」。範囲は素の数で親へ渡す（Leaflet の型を外に出さない）
    it("「このエリアを検索」で今の表示範囲を親へ渡す", async () => {
        const onSearchArea = vi.fn();
        render(<PhotoMap photos={[photo("a")]} locale="ja" onSearchArea={onSearchArea} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        fireEvent.click(screen.getByTestId("map-search-area"));
        expect(onSearchArea).toHaveBeenCalledWith({ south: 35, west: 139, north: 36, east: 140 });
    });

    it("範囲が効いているときは、押すと解除になる", async () => {
        const onSearchArea = vi.fn();
        render(<PhotoMap photos={[photo("a")]} locale="ja" onSearchArea={onSearchArea} areaActive />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        const btn = screen.getByTestId("map-search-area");
        expect(btn.textContent).toContain("範囲の指定を解除");
        fireEvent.click(btn);
        expect(onSearchArea).toHaveBeenCalledWith(null);
    });

    it("親が受け取らないなら「このエリアを検索」は出さない", async () => {
        await draw([photo("a")]);
        expect(screen.queryByTestId("map-search-area")).toBeNull();
    });
});

/**
 * **現在地は送らない・保存しない**（owner の指示 2026-09-22）。
 *
 * 地図は動かすたびに中心を `sessionStorage` に控えている。現在地へ寄せた
 * あと控え続けると、**端末のだいたいの位置が残る**（小数4桁＝約11m）。
 * 写真の座標は約1km に丸めて出しているのに、閲覧者自身の位置だけそれより
 * 細かく残るのは筋が通らないので、使った瞬間に消して以後書かない。
 */
describe("現在地", () => {
    const stubGeolocation = (impl: Partial<Geolocation>) => {
        Object.defineProperty(navigator, "geolocation", {
            configurable: true, writable: true, value: impl as Geolocation,
        });
    };

    it("押すと、その位置へ寄る", async () => {
        stubGeolocation({
            getCurrentPosition: (ok) => ok({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition),
        });
        await draw([photo("a")]);
        state.setViewArgs.length = 0;
        fireEvent.click(screen.getByTestId("map-locate"));
        expect(state.setViewArgs).toEqual([{ center: [48.86, 2.35], zoom: 12 }]);
    });

    it("押した時点で控えを消し、以後は見ている場所を控えない", async () => {
        stubGeolocation({
            getCurrentPosition: (ok) => ok({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition),
        });
        sessionStorage.setItem("photo-map:view", JSON.stringify({ lat: 1, lng: 2, zoom: 5, hash: "" }));
        await draw([photo("a")]);
        fireEvent.click(screen.getByTestId("map-locate"));
        expect(sessionStorage.getItem("photo-map:view"), "現在地が控えに残っている").toBeNull();

        // そのあと地図を動かしても書かない
        state.center = [48.86, 2.35]; state.zoom = 12;
        fireEvent.click(screen.getByRole("button", { name: "拡大" }));
        fireMap("moveend");
        expect(sessionStorage.getItem("photo-map:view"), "現在地の近くを控えている").toBeNull();
    });

    it("現在地の点は、地図が動くたびに付け直さない", async () => {
        stubGeolocation({
            getCurrentPosition: (ok) => ok({ coords: { latitude: 48.86, longitude: 2.35 } } as GeolocationPosition),
        });
        await draw([photo("a")]);
        fireEvent.click(screen.getByTestId("map-locate"));
        await waitFor(() => expect(state.markers.some((m) => m.kind === "circle")).toBe(true));
        const dot = state.markers.find((m) => m.kind === "circle");
        fireMap("moveend");
        expect(state.markers.find((m) => m.kind === "circle"), "現在地の点を作り直している").toBe(dot);
    });

    it("断られたら、その旨を出す（読み上げにも届ける）", async () => {
        stubGeolocation({
            getCurrentPosition: (_ok, err) => err?.({ code: 1 } as GeolocationPositionError),
        });
        await draw([photo("a")]);
        fireEvent.click(screen.getByTestId("map-locate"));
        const msg = await screen.findByRole("status");
        expect(msg.textContent).toContain("現在地を取得できませんでした");
    });
});

// Leaflet は既定でズームも移動も慣性も動かし、自分では
// `prefers-reduced-motion` を見ない（1.9.4 のソースに参照0件）。
// 実測: ズーム 321ms・ホイール 344ms・指を離してから 464ms 滑る
describe("動きを減らす設定", () => {
    it("既定では今までどおり動かす", async () => {
        await draw([photo("a")]);
        expect(state.mapOpts).toMatchObject({ zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: true, inertia: true });
    });

    it("設定が入っていたら、ズーム・淡色・慣性を止める", async () => {
        setReducedMotion(true);
        await draw([photo("a")]);
        expect(state.mapOpts).toMatchObject({ zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false });
    });

    // 束を押したときの寄せも同じ（`fitBounds` だけ止めても、ズームボタン・
    // ホイール・慣性が残る＝上の4つと両方が要る）
    it("束を押したときの寄せも止める", async () => {
        setReducedMotion(true);
        lookAtGrid();
        await draw(gridPhotos(200));
        state.markers.find(isCluster)?.clickHandler?.();
        expect(state.fitOpts).toMatchObject({ animate: false });
    });

    // **設定が無いときに `animate: true` を渡してはいけない。** Leaflet の
    // `options.animate !== true && !getSize().contains(offset)`（leaflet-src.js:4787）は
    // 「1画面より遠い行き先は動かさない」安全弁で、`true` はそれを外す。
    // 設定を入れていない人にまで「画面端の束を押すと約1秒かけて滑る」が起きる
    it("設定が無いときは寄せ方を Leaflet に任せる（true を渡さない）", async () => {
        lookAtGrid();
        await draw(gridPhotos(200));
        const before = state.fitCalls;
        state.markers.find(isCluster)?.clickHandler?.();
        expect(state.fitCalls, "束を押していない").toBe(before + 1);
        expect(state.fitOpts?.animate, "true を渡すと Leaflet の安全弁が外れる").toBeUndefined();
    });
});


/**
 * 撮影スポットのピン（`/spots/<slug>`）。**iOS の `OfficialPins` と同じ決まり**:
 *
 *  1. **寄せたとき（緯度の幅 0.5° 未満）だけ**、枠の中を近い順に最大60本。名前で絞って
 *     いるときは倍率に関係なく当たったものを出す
 *  2. **形を分ける**——写真の札（白い角丸）ではなく丸（真鍮）
 *  3. **押すと親へスラッグが渡る**（中身は画面側のシートが描く）
 */
describe("撮影スポットのピン", () => {
    const SPOT = { slug: "takaya-jinja", name: "高屋神社", region: "香川県 観音寺市", lat: 34.1, lng: 133.6, cover: null, stage: "published" as const };
    /** スポットのそばに寄せておく（緯度の幅 0.2°） */
    const nearSpot = () => {
        state.center = [34.1, 133.6];
        state.bounds = { south: 34.0, west: 133.5, north: 34.2, east: 133.7 };
        // 最初に見せる場所もスポットのそば（偽物の地図は setView で中心を書き換える）
        window.location.hash = "#12/34.1/133.6";
    };

    const drawWithSpot = async (photos: MapPhoto[], onSelectSpot?: (slug: string) => void, extra: Record<string, unknown> = {}) => {
        render(<PhotoMap photos={photos} locale="ja" spots={[SPOT]} onSelectSpot={onSelectSpot} {...extra} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
    };

    const spotMarker = () => state.markers.find((m) => String(m.opts.title ?? "").includes("高屋神社"));

    it("寄せていれば、写真が1枚も無くてもピンが立つ", async () => {
        nearSpot();
        await drawWithSpot([]);
        expect(spotMarker()).toBeTruthy();
    });

    // 1,000件を常に置かない（日本全体では重なって塊になるだけ）
    it("引いているときは立てない（名前で絞っていなければ）", async () => {
        state.bounds = { south: 30, west: 128, north: 42, east: 146 };
        render(<PhotoMap photos={[photo("a")]} locale="ja" spots={[SPOT]} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        expect(spotMarker()).toBeUndefined();
    });

    it("名前で絞っているときは、引いていても立てる", async () => {
        state.bounds = { south: 30, west: 128, north: 42, east: 146 };
        await drawWithSpot([], undefined, { spotQueryActive: true });
        expect(spotMarker()).toBeTruthy();
    });

    it("地図を寄せたら立つ（動いたら置き直す）", async () => {
        state.bounds = { south: 30, west: 128, north: 42, east: 146 };
        render(<PhotoMap photos={[photo("a")]} locale="ja" spots={[SPOT]} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        expect(spotMarker()).toBeUndefined();
        nearSpot();
        fireMap("moveend");
        expect(spotMarker()).toBeTruthy();
    });

    it("写真のピンとは別の形（丸）で描く・押せる範囲は 44", async () => {
        nearSpot();
        await drawWithSpot([]);
        const icon = spotMarker()?.opts.icon as { html?: HTMLElement; className?: string; iconSize?: number[] };
        expect(icon?.className).toBe("spot-map-pin-icon");
        expect(icon?.html?.className).toContain("spot-map-pin");
        expect(icon?.html?.className, "写真のピンと同じ見た目にしない").not.toContain("photo-map-pin");
        expect(icon?.iconSize).toEqual([44, 44]);
    });

    it("写真が無ければ真鍮の丸にカメラ、あれば写真の丸", async () => {
        nearSpot();
        render(<PhotoMap photos={[]} locale="ja" spots={[SPOT, { ...SPOT, slug: "b", name: "写真のある場所", thumb: "/images/spots/thumb/b.jpg" }]} />);
        await waitFor(() => expect(state.markers.length).toBe(2));
        const html = (name: string) => (state.markers.find((m) => String(m.opts.title).includes(name))!.opts.icon as { html: HTMLElement }).html;
        expect(html("高屋神社").querySelector(".spot-map-pin__mark--plain svg")).toBeTruthy();
        expect(html("写真のある場所").querySelector(".spot-map-pin__mark--photo img")?.getAttribute("src")).toBe("/images/spots/thumb/b.jpg");
    });

    // ページ本体を軽くするため、決まった場所のサムネは「在る」の印だけで届く
    it("サムネが「在る」の印だけなら、決まった場所から読む", async () => {
        nearSpot();
        render(<PhotoMap photos={[]} locale="ja" spots={[{ ...SPOT, thumb: true }]} />);
        await waitFor(() => expect(spotMarker()).toBeTruthy());
        expect((spotMarker()!.opts.icon as { html: HTMLElement }).html.querySelector("img")?.getAttribute("src"))
            .toBe("/images/spots/thumb/takaya-jinja.jpg");
    });

    it("名前を読み上げに渡し、印の下にも出す", async () => {
        nearSpot();
        await drawWithSpot([]);
        expect(spotMarker()?.opts.title).toBe("高屋神社");
        expect(spotMarker()?.opts.alt).toBe("高屋神社");
        const html = (spotMarker()?.opts.icon as { html?: HTMLElement }).html;
        expect(html?.querySelector(".map-pin-label")?.textContent).toBe("高屋神社");
    });

    it("下書きのピンは読み上げに「下書き」を渡す", async () => {
        nearSpot();
        render(<PhotoMap photos={[]} locale="ja" spots={[{ ...SPOT, stage: "review" }]} />);
        await waitFor(() => expect(state.markers.length).toBeGreaterThan(0));
        expect(spotMarker()?.opts.title).toBe("高屋神社（下書き）");
    });

    it("押すとスラッグが親へ渡る（Enter でも）", async () => {
        nearSpot();
        const onSelectSpot = vi.fn();
        await drawWithSpot([], onSelectSpot);
        spotMarker()?.clickHandler?.();
        spotMarker()?.keypressHandler?.({ originalEvent: { key: "Enter" } });
        expect(onSelectSpot).toHaveBeenCalledTimes(2);
        expect(onSelectSpot).toHaveBeenCalledWith("takaya-jinja");
    });

    it("写真のピンより手前に置く（Leaflet）", async () => {
        nearSpot();
        await drawWithSpot([photo("a", { coords: { lat: 34.1, lng: 133.6 } })]);
        expect(Number(spotMarker()?.opts.zIndexOffset ?? 0)).toBeGreaterThan(0);
    });

    it("選んだスポットは大きく光らせる。選び替えてもピンを作り直さない", async () => {
        nearSpot();
        const far = { ...SPOT, slug: "far", name: "近くの別の場所", lat: 34.15, lng: 133.65 };
        const spots = [SPOT, far];
        const none: MapPhoto[] = [];
        const { rerender } = render(<PhotoMap photos={none} locale="ja" spots={spots} selectedSpotSlug={null} />);
        await waitFor(() => expect(state.markers.length).toBe(2));
        const before = state.markers.slice();
        rerender(<PhotoMap photos={none} locale="ja" spots={spots} selectedSpotSlug="takaya-jinja" />);
        expect((spotMarker()!.opts.icon as { html: HTMLElement }).html.className).toContain("is-selected");
        rerender(<PhotoMap photos={none} locale="ja" spots={spots} selectedSpotSlug="far" />);
        expect((spotMarker()!.opts.icon as { html: HTMLElement }).html.className).not.toContain("is-selected");
        expect(state.markers.every((m, i) => m === before[i]), "選び替えでピンが作り直された").toBe(true);
    });

    // 札だけ残って、どこを選んでいるか分からない、を作らない
    it("選んだスポットは、引いて見えなくなっても立てておく", async () => {
        state.bounds = { south: 30, west: 128, north: 42, east: 146 };
        render(<PhotoMap photos={[photo("a")]} locale="ja" spots={[SPOT]} selectedSpotSlug="takaya-jinja" />);
        await waitFor(() => expect(spotMarker()).toBeTruthy());
    });

    it("`onSelectSpot` を渡さなくても落ちない", async () => {
        nearSpot();
        await drawWithSpot([]);
        expect(() => spotMarker()?.clickHandler?.()).not.toThrow();
    });

    it("スポットを渡さなければ立たない", async () => {
        nearSpot();
        await draw([photo("a")]);
        expect(state.markers).toHaveLength(1);
    });
});

// 写真のピンの読み上げ名（iOS の `pinSpokenLabel`: 「パリ、写真 3枚」・撮影地が無ければ「場所の名前なし」）
describe("写真のピンの読み上げ名", () => {
    const pinName = () => {
        const m = state.markers.find((x) => x.kind === "marker");
        return [m?.opts.title, m?.opts.alt];
    };
    it("撮影地と枚数", async () => {
        await draw([photo("a")]);
        expect(pinName()).toEqual(["山中湖、写真 1枚", "山中湖、写真 1枚"]);
    });
    it("撮影地が無ければ「場所の名前なし」（題は名乗らない）", async () => {
        await draw([photo("a", { location: "  " })]);
        expect(pinName()).toEqual(["場所の名前なし、写真 1枚", "場所の名前なし、写真 1枚"]);
    });
    it("同じ撮影地のうち、撮影地を書いてある写真の名前を使う", async () => {
        const at = { lat: 35, lng: 139 };
        await draw([photo("a", { coords: at, location: "" }), photo("b", { coords: at, location: "パリ" })]);
        expect(pinName()[0]).toBe("パリ、写真 2枚");
    });
});
