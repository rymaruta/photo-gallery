import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";

// 地図そのもの（描画・タイル）は jsdom では出せないので Leaflet を差し替え、
// **こちらが Leaflet に何を渡しているか**を見る。
// ここに置いたのは、実ブラウザでしか見えない壊れを2件踏んだため:
//   (1) コンテナがスタッキングコンテキストを作らず、Leaflet の z-index 400 が
//       ページ全体の土俵に出て `z-50` のヘッダー・メニューを覆っていた
//   (2) ポップアップの画像に高さが無く、Leaflet が「収まっている」と誤って測って
//       スクロールにしないまま、あとから画像が入って地図の外まで伸びていた
// どちらも CSS と実測が要る話だが、**こちら側の指定が消えたら気づける**ようにする。

type FakeMarker = {
    kind: string; latlng: unknown; opts: Record<string, unknown>;
    popup: HTMLElement | null; popupOpts: Record<string, unknown> | null;
    update: ReturnType<typeof vi.fn>;
    clickHandler?: () => void;
    on: (ev: string, fn: () => void) => void; addTo: () => FakeMarker;
    bindPopup: (el: HTMLElement, o: Record<string, unknown>) => FakeMarker;
    getPopup: () => { update: ReturnType<typeof vi.fn> };
};
const state = vi.hoisted(() => ({
    markers: [] as FakeMarker[], zoom: 4, center: [36, 138] as [number, number],
    zoomControl: null as unknown, mapOpts: null as Record<string, unknown> | null,
    fitOpts: null as Record<string, unknown> | null, fitCalls: 0,
    setViewArgs: [] as Array<{ center: [number, number]; zoom: number }>,
    fireMap: (() => {}) as (ev: string) => void,
}));
const fireMap = (ev: string) => state.fireMap(ev);

vi.mock("leaflet", () => {
    const handlers: Record<string, Array<() => void>> = {};
    const map = {
        getZoom: () => state.zoom,
        getCenter: () => ({ lat: state.center[0], lng: state.center[1] }),
        fitBounds: vi.fn((_b: unknown, o: Record<string, unknown>) => { state.fitOpts = o; state.fitCalls++; (handlers.moveend ?? []).forEach((f) => f()); }),
        setView: vi.fn((center: [number, number], zoom: number) => {
            state.setViewArgs.push({ center, zoom }); state.center = center; state.zoom = zoom;
            (handlers.moveend ?? []).forEach((f) => f());   // 本物も setView の直後に moveend を出す
        }),
        // アンマウントで listener を捨てる（溜めるとテストをまたいで前の
        // コンポーネントの moveend が走る）
        remove: vi.fn(() => { for (const k of Object.keys(handlers)) delete handlers[k]; }),
        on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
        fire: (ev: string) => (handlers[ev] ?? []).forEach((f) => f()),
    };
    state.fireMap = map.fire;
    const group = { addTo: () => group, clearLayers: () => { state.markers.length = 0; } };
    const make = (kind: string) => (latlng: unknown, opts: Record<string, unknown> = {}) => {
        const update = vi.fn();
        const m: FakeMarker = {
            kind, latlng, opts, popup: null, popupOpts: null, update,
            on: (ev: string, fn: () => void) => { if (ev === "click") m.clickHandler = fn; },
            addTo: () => m,
            bindPopup: (el, o) => { m.popup = el; m.popupOpts = o; return m; },
            getPopup: () => ({ update }),
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

const draw = async (photos: MapPhoto[]) => {
    render(<PhotoMap photos={photos} locale="ja" />);
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

describe("ポップアップ", () => {
    it("サムネに幅と高さを入れる（Leaflet が開いた瞬間に測れるように）", async () => {
        await draw([photo("a", { width: 4000, height: 3000 })]);
        const img = state.markers[0].popup!.querySelector("img")!;
        expect(img.getAttribute("width")).toBe("160");
        // 実寸が分かればその比（160 * 3000/4000 = 120）
        expect(img.getAttribute("height")).toBe("120");
    });

    it("実寸を持たない写真は 3:2 で見積もる（高さ無しにしない）", async () => {
        await draw([photo("a")]);
        const img = state.markers[0].popup!.querySelector("img")!;
        expect(img.getAttribute("height"), "高さが無いと Leaflet は高さ0で測る").toBe("107");
    });

    it("極端な比でも収まる範囲に丸める", async () => {
        await draw([photo("a", { width: 100, height: 9000 })]);
        expect(state.markers[0].popup!.querySelector("img")!.getAttribute("height")).toBe("240");
    });

    it("同じ升の束は、写真ごとのカードを並べて全部に辿れるようにする", async () => {
        await draw([photo("a"), photo("b"), photo("c")]);
        const cluster = state.markers.find((m) => m.kind === "marker")!;
        expect(cluster, "同じ座標なのに束になっていない").toBeTruthy();
        const links = [...cluster.popup!.querySelectorAll("a")];
        // **href まで見る。** 長さだけだと、3枚とも同じ写真を指していても通る
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["/?photo=a", "/?photo=b", "/?photo=c"]);
        // はみ出したぶんはスクロールで届く（高さの上限を渡している）
        expect(typeof cluster.popupOpts?.maxHeight).toBe("number");
    });

    // **単独のピンにも上限が要る。** 縦長の写真1枚でも、低い画面
    // （`min-h-[320px]` が効く高さ）では地図の下へはみ出す
    // 同じ升の写真は横に送る。縦に積むと枚数ぶん背が伸びて地図の外へ出た
    // （実測 5枚で 771px）。並べ方は globals.css の `.photo-map-list`
    it("束のポップアップは横に送れる並び（役割と枚数を伝える）", async () => {
        await draw([photo("a"), photo("b"), photo("c")]);
        const list = state.markers.find((m) => m.kind === "marker")!.popup!;
        expect(list.className).toContain("photo-map-list");
        // 読み上げに「リスト・N項目」と伝える（`group` だと何枚目かが読まれない）
        expect(list.getAttribute("role")).toBe("list");
        expect([...list.querySelectorAll(":scope > .photo-map-card")].map((c) => c.getAttribute("role")))
            .toEqual(["listitem", "listitem", "listitem"]);
        expect(list.getAttribute("aria-label")).toBe("この場所の写真 3枚");
        // カードは横並びの子（1枚ずつが送る単位）
        expect(list.querySelectorAll(":scope > .photo-map-card")).toHaveLength(3);
    });

    it("単独のピンのポップアップにも高さの上限を渡す", async () => {
        await draw([photo("a")]);
        expect(typeof state.markers[0].popupOpts?.maxHeight).toBe("number");
    });

    it("画像が入ったら測り直す（見積もりより伸びたぶんを枠の外に残さない）", async () => {
        await draw([photo("a")]);
        const marker = state.markers[0];
        const img = marker.popup!.querySelector("img")!;
        expect(marker.update).not.toHaveBeenCalled();
        img.dispatchEvent(new Event("load"));
        // 実測: 見積もり 107px に対し 3:4 の写真は 213px で描かれる。
        // Leaflet は開いた瞬間にしか測らないので、伸びたぶんは枠の外に残る
        expect(marker.update, "画像が入っても測り直していない").toHaveBeenCalled();
    });

    // **測り直しで送った位置を失わない。** Leaflet の `update()` は中身の DOM を
    // 外して付け直すので `scrollLeft` が 0 に戻る。サムネは lazy なので
    // 「送る → 画像が届く → 測り直し → 先頭へ戻る」になり、送る操作そのものが
    // 送れなくする（実測: 10枚の束で5回送って5回とも先頭へ戻された）
    it("測り直しても、送った位置を戻す", async () => {
        await draw([photo("a"), photo("b"), photo("c")]);
        const marker = state.markers.find((m) => m.kind === "marker")!;
        const list = marker.popup!;
        // jsdom はレイアウトを持たないので scrollLeft は常に 0。読み書きを覗く
        let scroll = 334;
        const writes: number[] = [];
        Object.defineProperty(list, "scrollLeft", {
            configurable: true,
            get: () => scroll,
            set: (v: number) => { writes.push(v); scroll = v; },
        });
        list.querySelectorAll("img")[1].dispatchEvent(new Event("load"));
        expect(marker.update).toHaveBeenCalled();
        expect(writes, "測り直しのあとに位置を戻していない").toEqual([334]);
    });

    it("測り直しても、当たっていた焦点を戻す", async () => {
        await draw([photo("a"), photo("b")]);
        const marker = state.markers.find((m) => m.kind === "marker")!;
        const list = marker.popup!;
        document.body.appendChild(list);   // フォーカスは文書の中でしか当たらない
        const link = list.querySelectorAll("a")[1] as HTMLAnchorElement;
        link.focus();
        expect(document.activeElement).toBe(link);
        const spy = vi.spyOn(link, "focus");
        list.querySelectorAll("img")[0].dispatchEvent(new Event("load"));
        expect(spy, "測り直しのあとにフォーカスを戻していない").toHaveBeenCalled();
        list.remove();
    });

    // Tab で来たカードは端まで送る。一部でも見えているとブラウザは送らないので、
    // 偶数枚目は 34px しか見えないままフォーカスだけが当たる（実測）
    it("Tab でカードに来たら、そのカードを端まで送る", async () => {
        await draw([photo("a"), photo("b"), photo("c")]);
        const list = state.markers.find((m) => m.kind === "marker")!.popup!;
        const card = list.querySelectorAll(".photo-map-card")[1] as HTMLElement;
        const spy = vi.fn();
        card.scrollIntoView = spy;   // jsdom には実装が無い
        list.querySelectorAll("a")[1].dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(spy).toHaveBeenCalledWith({ inline: "start", block: "nearest" });
    });

    it("サムネもリンクの中に入れる（一番大きい当たりを押して何も起きない、を無くす）", async () => {
        await draw([photo("a")]);
        const card = state.markers[0].popup!;
        expect(card.querySelector("a img"), "サムネがリンクの外にある").not.toBeNull();
        // リンクの読み上げ名は題名（画像の alt は空）
        expect(card.querySelector("a")!.textContent).toBe("写真a");
        expect(card.querySelector("a")!.getAttribute("href")).toBe("/?photo=a");
    });

    it("サムネが preflight に潰されないよう、カードに目印を付ける", async () => {
        await draw([photo("a")]);
        // globals.css の `.photo-map-card img { max-width: none }` が当たる先。
        // 無いと Leaflet の幅の計算でサムネの幅寄与が0になり、160px 指定が
        // 96px で描かれた（実測）
        expect(state.markers[0].popup!.className).toContain("photo-map-card");
    });

    it("タイトルは文字として入れる（利用者の入力を HTML として解釈しない）", async () => {
        await draw([photo("a", { title: { ja: "<b>注入</b>" } })]);
        const link = state.markers[0].popup!.querySelector("a")!;
        expect(link.textContent).toBe("<b>注入</b>");
        expect(link.querySelector("b"), "利用者の入力が要素になっている").toBeNull();
    });

    // ピン1つずつに「（おおよそ）」と断るとうるさいので、断りは地図の下に
    // 1行だけ出す（`app/map/page.tsx`。そちらのテストで固定している）
    it("ピンの中では地名だけ出す（1枚ずつ断りを付けない）", async () => {
        await draw([photo("a", { geoApprox: true })]);
        const text = state.markers[0].popup!.textContent!;
        expect(text).toContain("山中湖");
        expect(text, "ピンごとに断りを付けている").not.toContain("おおよそ");
    });
});

describe("ズームの位置", () => {
    // 左上に置くと、少しスクロールした帯で固定ヘッダーの下に入り、
    // 半透明のヘッダー越しに「＋」が見えているのに押せない
    // （押すとヘッダーのロゴが反応してトップへ飛ぶ）——実測で確認
    it("左下に置く（固定ヘッダーの下に入らない）", async () => {
        await draw([photo("a")]);
        expect(state.zoomControl).toMatchObject({ position: "bottomleft" });
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
        await draw([photo("a"), photo("b", { coords: { lat: 35.6, lng: 139.9 } })]);
        state.markers.find((m) => m.kind === "marker")?.clickHandler?.();
        expect(state.fitOpts).toMatchObject({ animate: false });
    });

    // **設定が無いときに `animate: true` を渡してはいけない。** Leaflet の
    // `options.animate !== true && !getSize().contains(offset)`（leaflet-src.js:4787）は
    // 「1画面より遠い行き先は動かさない」安全弁で、`true` はそれを外す。
    // 設定を入れていない人にまで「画面端の束を押すと約1秒かけて滑る」が起きる
    it("設定が無いときは寄せ方を Leaflet に任せる（true を渡さない）", async () => {
        await draw([photo("a"), photo("b", { coords: { lat: 35.6, lng: 139.9 } })]);
        state.markers.find((m) => m.kind === "marker")?.clickHandler?.();
        expect(state.fitOpts?.animate, "true を渡すと Leaflet の安全弁が外れる").toBeUndefined();
    });
});
