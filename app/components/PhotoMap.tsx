"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { Photo } from "../../lib/data/photos";
import { clusterPoints, boundsOf, type GeoPoint } from "../../lib/utils/mapClusters";
import type { SpotPin } from "../../lib/data/spotLink";
import { upgradeToRealVectorBasemap } from "../map/loadVectorBasemap";

/** 既定の空配列。**毎回作らない**（作ると ref の更新が毎描画で走る） */
const EMPTY_SPOTS: readonly SpotPin[] = [];
import {
    MAP_MIN_ZOOM, MAP_MAX_ZOOM, chooseInitialView, readSavedView, saveView, clearSavedView,
} from "../../lib/utils/mapView";
import { normalizeBounds, type MapBounds } from "../../lib/utils/mapFilter";
import { publicImageUrl } from "../../lib/utils/seo";

/** 位置情報を持つ写真だけ（`coords` が有限の数であること） */
export type MapPhoto = Photo & { coords: { lat: number; lng: number } };
export function photosWithCoords(photos: readonly Photo[]): MapPhoto[] {
    return photos.filter((p): p is MapPhoto =>
        !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng));
}

/** ピンを押したときに親へ渡すもの。`null` は「閉じる」 */
export type MapSelection = { photos: MapPhoto[]; index: number };

type Point = GeoPoint & { photo: MapPhoto };

/**
 * ピンの大きさ（px）。**モックの画素から測った値**（`docs/mockups/06-map.jpg`・
 * 端末の画面幅 364画素 ＝ 393 CSS px ＝ 1画素 ≈ 1.08 CSS px）:
 *
 *     写真の丸        36画素 → 39 CSS px（選択中は 62画素 → 67）
 *     尖りまでの高さ  55画素 → 59 CSS px
 *     束の丸          30画素 → 32 CSS px
 *
 * 丸は 40、尖りを足した高さは 50 に丸めた。**束の升（`CELL_PX`）はピンの
 * 直径より大きく取る**——小さいと隣り合うピンの絵が重なって、下のピンが
 * 押せなくなる。
 */
const PIN_PX = 40;
const PIN_H = 50;
/**
 * 公式スポットのピン。**写真のピンより小さくする**——写真が主役のサイトで、
 * 運営が置いた印が写真より大きいと主客が入れ替わる。
 * 指で押す的は Leaflet の当たり判定がアイコン全体なので、28×36 で足りる
 * （WCAG 2.5.8 の24px を超え、隣のピンとは升で離れている）。
 */
const SPOT_PIN_PX = 28;
const SPOT_PIN_H = 36;
const CELL_PX = 56;

/** 「現在地」で寄るズーム。写真の座標は約1km に丸めてあるので、これ以上寄せない */
const LOCATE_ZOOM = 12;

/**
 * 撮影地の地図。**Leaflet は effect の中で読む**——`window` に依存するので、
 * トップレベルで import すると静的書き出し（`next build` の事前描画）で落ちる。
 * CSS は window に依存しないので普通に import する。
 *
 * ## ピンは写真の絵で出す（2026-09-22・最終版モック）
 *
 * 以前は青い点（`circleMarker`）だった。モックは**写真入りの丸いピン**で、
 * 地図の上で「どこに何が在るか」が絵で分かる形。中身は `divIcon` に
 * **DOM を組んで渡す**（`L.DivIcon` は `html` に `Element` を受け取る）——
 * 文字列の HTML を組むと、写真の URL を通した差し込みの口になる。
 *
 * **画像には px の幅と高さを必ず書く。** Leaflet の
 * `.leaflet-container .leaflet-marker-pane img` は `max-width: none !important`
 * ＋ **`width: auto`**（詳細度 0,2,1）で、Tailwind の preflight
 * （`img { max-width: 100%; height: auto }`）ごと潰す。こちらの指定は
 * `.photo-map-shell .leaflet-marker-pane .photo-map-pin__img`（0,3,0）で
 * 上回る必要がある（`app/globals.css`）。
 *
 * 束ね方は `lib/utils/mapClusters.ts`（純関数）。ズームが変わるたびに
 * 束ね直す（ズームだけで束が決まる格子なので、移動では変えない）。
 *
 * **写真の中身は地図の中に描かない。** 以前は Leaflet のポップアップに
 * サムネと題を組んでいたが、
 *
 *   - 高さが地図の中に収まらず、低い画面では枠の外へ出ていた
 *     （実測 390x844 で3枚 465px・地図の上へ 183px はみ出し）
 *   - 画像が遅れて入ると測り直しが要り、その測り直しが横送りの位置と
 *     フォーカスを巻き戻していた（送る操作そのものが送れなくなる）
 *   - 束の枚数だけ中身を作るので、枚数に比例して重くなる
 *
 * 今は**押されたことだけ**を `onSelect` で親へ渡し、中身は画面下の
 * シート（`app/map/MapPhotoSheet.tsx`）が描く。地図の高さに縛られない。
 *
 * ## 操作のボタンは Leaflet のコントロールにしない
 *
 * ズーム・現在地・「このエリアを検索」は**地図の容器の外側**に置いた
 * 素の `<button>`。Leaflet の `L.control.zoom` は白い26px四方の `<a>` で、
 * 色も大きさもこのサイトと合わないうえ、`<a href="#">` なので読み上げに
 * 「リンク」と伝わる。容器の外に置けば Leaflet のドラッグ・ホイールにも
 * 触られない（`DomEvent.disableClickPropagation` を足す必要もない）。
 */
export default function PhotoMap({
    photos, locale, onSelect, selectedId, onSearchArea, areaActive = false, sheetOpen = false, className = "",
    spots = EMPTY_SPOTS, onSelectSpot, selectedSpotSlug = null,
}: {
    photos: readonly MapPhoto[];
    locale: "ja" | "en";
    /**
     * 公式撮影地ガイドのスポット（運営が台帳に書いたもの）。
     *
     * **写真の束（`clusterPoints`）には混ぜない。** 混ぜると束の数字が
     * 「N枚」と名乗ったまま写真でないものを数える。別の層として、
     * **別の形のピン**で立てる——「ここに写真がある」と読ませない
     * （現在地の点を丸にしてあるのと同じ判断）。
     */
    spots?: readonly SpotPin[];
    /** 公式スポットのピンが押された */
    onSelectSpot?: (slug: string) => void;
    /** いま選ばれている公式スポット（そのピンを目立たせる） */
    selectedSpotSlug?: string | null;
    /** ピンが押された（`null` は地図の余白が押された＝閉じる） */
    onSelect?: (selection: MapSelection | null) => void;
    /** いま選ばれている写真（そのピンを大きく出す） */
    selectedId?: string | null;
    /** 「このエリアを検索」。`null` は指定の解除 */
    onSearchArea?: (bounds: MapBounds | null) => void;
    /** 範囲の指定が効いているか（ボタンの文言が変わる） */
    areaActive?: boolean;
    /**
     * 押したピンのシートが開いているか。**開いている間、操作のボタンを
     * 地図の上端へ逃がす**（1024px 未満だけ）。
     *
     * 実測（Chromium）: シートは画面の下に固定で出て、地図の下 275px を覆う。
     * そこに「このエリアを検索」（左下）と操作のボタン（右・上下中央）が
     * 在ると、**シートの面は 95% の不透明なので薄く透けて見えたまま押せない**
     * ——このリポジトリが何度も踏んでいる形（`2922526f`）。
     * 320x844 では現在地のボタンも、390x844 では「このエリアを検索」も
     * `elementFromPoint` がシートを返していた。
     *
     * 1024px 以上ではシートが左の列の板になるので、動かさない。
     */
    sheetOpen?: boolean;
    /** 外枠の見た目（高さなど）。既定はスマホの1画面ぶん */
    className?: string;
}) {
    const en = locale === "en";
    const [basemapState, setBasemapState] = useState<"loading" | "vector-ready" | "fallback">("loading");
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LeafletMap | null>(null);
    const layerRef = useRef<LayerGroup | null>(null);
    /** ピンの DOM（id → 要素）。選択が変わっても描き直さず、クラスだけ付け替える */
    const pinElsRef = useRef(new Map<string, HTMLElement>());
    // 最新の写真を effect の外から読む（ズームのたびに束ね直すため）
    const photosRef = useRef(photos);
    photosRef.current = photos;
    // **ref に持つ。** 依存に入れると、親が関数を作り直すたびに地図ごと
    // 建て直すことになる（見ていた場所もズームも消える）
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    /** 公式スポットのピンの DOM（スラッグ → 要素）。写真のピンと同じ扱い */
    const spotElsRef = useRef(new Map<string, HTMLElement>());
    const spotsRef = useRef(spots);
    spotsRef.current = spots;
    const onSelectSpotRef = useRef(onSelectSpot);
    onSelectSpotRef.current = onSelectSpot;
    const selectedSpotRef = useRef(selectedSpotSlug);
    selectedSpotRef.current = selectedSpotSlug;
    /** 現在地。**state に置くだけで、保存も送信もしない** */
    const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
    const hereRef = useRef(here);
    hereRef.current = here;
    const [locating, setLocating] = useState(false);
    const [locateError, setLocateError] = useState("");
    /**
     * 控えを書かない印。**「現在地」を一度でも使ったら立てる**——書き続けると
     * 端末のだいたいの位置が sessionStorage に残る（`clearSavedView` を参照）。
     */
    const suppressSaveRef = useRef(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let cancelled = false;

        void (async () => {
            const L = await import("leaflet");
            if (cancelled || !containerRef.current) return;

            // **「動きを減らす」設定を尊重する。** Leaflet は既定でズームも移動も
            // 慣性も動かす（実測: ズーム 321ms・ホイール 344ms・指を離してから
            // 464ms 滑る）。Leaflet 自身は `prefers-reduced-motion` を見ない
            // （1.9.4 のソースに参照 0 件）ので、こちらで渡す。
            // `fitBounds` だけ止めても、ズームボタン・ホイール・慣性が残る
            const reduceMotion = typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            // `minZoom`: 引ききると世界1周が地図の高さより短くなり、上下に
            // 下地の黒が出る（実測 390x844: ズーム0 で上 211px・1 で 39px）。
            // 2 なら 1024px で、スマホの 70vh（≒590px）にも収まる。
            // **`zoomControl: false`**——ズームは容器の外の `<button>`（上の説明）
            const map = L.map(el, {
                zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: MAP_MIN_ZOOM,
                zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion,
                markerZoomAnimation: !reduceMotion, inertia: !reduceMotion,
            });
            mapRef.current = map;
            // OSM is a legible fallback while the REAL OpenFreeMap vector tiles
            // load. The keyless vector provider draws coastline, roads and labels.
            // No inverted screenshot/pseudo-map, and no second Leaflet instance.
            const fallback = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: MAP_MAX_ZOOM,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            }).addTo(map);
            setBasemapState("loading");
            void upgradeToRealVectorBasemap(
                L, map, fallback,
                () => !cancelled && mapRef.current === map,
                setBasemapState,
            );
            const layer = L.layerGroup().addTo(map);
            layerRef.current = layer;

            const select = (sel: MapSelection) => onSelectRef.current?.(sel);
            // 地図の余白を押したら閉じる。
            // **ピンの click はここへ来ない。** Leaflet はレイヤーの DOM イベントを
            // 地図にも伝えるが、`bubblingMouseEvents: false` のレイヤーだけは
            // 止める（`leaflet-src.js:4567`）。`Marker` は既定で false、
            // `Path`（circleMarker）は既定で **true** なので、単独のピンにだけ
            // 明示して渡す（下）。最初は「ピンの直後 200ms は閉じない」と
            // 時刻で弾いていたが、それは Leaflet が用意している選択肢の
            // 言い換えで、壁時計に依存するぶん脆い
            map.on("click", () => onSelectRef.current?.(null));

            /** Enter でも押せるようにする（ピンは `keyboard: true` で Tab で
             *  来られるが、Leaflet は Enter を click に**変換しない**。
             *  以前は `bindPopup` が `keypress` を拾って開いていた） */
            const onActivate = (marker: import("leaflet").Layer, fn: () => void) => {
                marker.on("click", fn);
                marker.on("keypress", (e) => { if ((e as { originalEvent?: KeyboardEvent }).originalEvent?.key === "Enter") fn(); });
            };

            /**
             * 写真1枚ぶんのピンの DOM。**文字列の HTML を組まない**
             * ——写真の URL を通した差し込みの口になる。
             */
            const pinElement = (photo: MapPhoto): HTMLElement => {
                const wrap = document.createElement("span");
                wrap.className = "photo-map-pin";
                const thumb = photo.thumbSm || photo.thumbSrc || photo.src;
                if (thumb) {
                    const img = document.createElement("img");
                    img.className = "photo-map-pin__img";
                    // 出す URL はサイトのドメインに揃える（`Thumb` と同じ理由）
                    img.src = publicImageUrl(thumb);
                    img.alt = "";           // 名前は marker の `title`/`alt` が持つ
                    img.decoding = "async";
                    // **px を書く。** Leaflet の `width: auto` が効くと、読み込み前は
                    // 幅0・読み込み後は元画像の幅（256px）になり、ピンが化ける
                    img.width = PIN_PX;
                    img.height = PIN_PX;
                    // 読めなかったら壊れた画像の枠を出さない（丸だけ残す）
                    img.addEventListener("error", () => { img.remove(); }, { once: true });
                    wrap.appendChild(img);
                }
                const tail = document.createElement("span");
                tail.className = "photo-map-pin__tail";
                wrap.appendChild(tail);
                return wrap;
            };

            const draw = () => {
                layer.clearLayers();
                pinElsRef.current.clear();
                spotElsRef.current.clear();
                const points: Point[] = photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng, photo: p }));
                for (const c of clusterPoints(points, map.getZoom(), CELL_PX)) {
                    if (c.items.length === 1) {
                        const { photo } = c.items[0];
                        const el = pinElement(photo);
                        if (photo.id === selectedIdRef.current) el.classList.add("is-selected");
                        pinElsRef.current.set(photo.id, el);
                        const name = (photo.location ?? "").trim()
                            || (typeof photo.title === "string" ? photo.title : photo.title?.[locale] || photo.title?.ja || "")
                            || (en ? "Photo" : "写真");
                        const marker = L.marker([c.lat, c.lng], {
                            icon: L.divIcon({
                                html: el,
                                className: "photo-map-pin-icon",
                                iconSize: [PIN_PX, PIN_H],
                                // 尖りの先が座標。**下端を合わせる**（中心だと
                                // 実際の位置よりピン半分ぶん上にずれる）
                                iconAnchor: [PIN_PX / 2, PIN_H],
                            }),
                            title: name,
                            alt: name,
                            keyboard: true,
                        });
                        onActivate(marker, () => select({ photos: [photo], index: 0 }));
                        marker.addTo(layer);
                    } else {
                        const icon = L.divIcon({
                            html: `<span>${c.items.length}</span>`,   // 数字だけ（利用者の入力は入らない）
                            className: "photo-map-cluster",
                            iconSize: [34, 34],
                        });
                        const marker = L.marker([c.lat, c.lng], {
                            icon,
                            title: en ? `${c.items.length} photos` : `${c.items.length}枚`,
                            keyboard: true,
                        });
                        // **押したら、その束が収まる範囲まで一気に寄る。**
                        // 「2段ずつ寄る」だと、4km 離れた2枚を割るのに5回押す
                        // ことになった（実ブラウザで実測）。
                        // 同じ升（約1km に丸めた同じ座標）の写真は**どこまで寄っても
                        // 割れない**ので、寄れないときは束ごとシートに渡す
                        // （シートが「1/5」で送れるようにする）
                        const inner = boundsOf(c.items);
                        const splittable = !!inner && (inner.north !== inner.south || inner.east !== inner.west) && map.getZoom() < MAP_MAX_ZOOM;
                        if (splittable) {
                            // **`animate: true` は渡さない。** Leaflet の
                            // `options.animate !== true && !this.getSize().contains(offset)`
                            // （`leaflet-src.js:4787`）は「1画面より遠い行き先は
                            // 動かさない」という安全弁で、`true` を渡すと**外れる**。
                            // 設定を入れていない人にまで「画面端の束を押すと約1秒
                            // かけて滑る」が起きる（実測）。止めたいときだけ false
                            onActivate(marker, () => {
                                map.fitBounds([[inner.south, inner.west], [inner.north, inner.east]], { padding: [48, 48], maxZoom: MAP_MAX_ZOOM, animate: reduceMotion ? false : undefined });
                            });
                        } else {
                            // これ以上は割れない束。**枚数ぶんまとめてシートに渡し、
                            // 「1/5」で送ってもらう。** 地図の中に横並びのカードを
                            // 作っていた頃は、画像が遅れて入るたびに測り直しが走り、
                            // その測り直しが横送りの位置を先頭へ巻き戻していた
                            // （実測: 10枚の束で5回送って5回とも先頭へ戻された）
                            onActivate(marker, () => select({ photos: c.items.map((it) => it.photo), index: 0 }));
                        }
                        marker.addTo(layer);
                    }
                }
                /**
                 * 公式撮影地ガイドのピン。**写真の束には混ぜない。**
                 *
                 * 混ぜると束の数字が「N枚」と名乗ったまま写真でないものを
                 * 数える。**形も別**（写真入りの丸ではなく、印の入った小さい
                 * ピン）にして、「ここに写真がある」と読ませない
                 * ——現在地の点を丸にしてあるのと同じ判断。
                 *
                 * **束ねない。** 台帳は人が書くもので数が少なく（公開条件を
                 * 満たすものだけ）、束ねると押した先が「どのスポットか」を
                 * 決められない（写真は束ねてもシートで送れるが、スポットは
                 * 1件ずつページが違う）。
                 */
                for (const sp of spotsRef.current) {
                    const el = document.createElement("span");
                    el.className = "spot-map-pin";
                    if (sp.slug === selectedSpotRef.current) el.classList.add("is-selected");
                    // **中身は印だけ。** 利用者の入力は入らない（名前は
                    // marker の `title` / `alt` が持つ＝読み上げにも届く）
                    const dot = document.createElement("span");
                    dot.className = "spot-map-pin__dot";
                    dot.setAttribute("aria-hidden", "true");
                    el.appendChild(dot);
                    spotElsRef.current.set(sp.slug, el);
                    const label = en ? `${sp.name} (official spot)` : `${sp.name}（公式撮影スポット）`;
                    const marker = L.marker([sp.lat, sp.lng], {
                        icon: L.divIcon({
                            html: el,
                            className: "spot-map-pin-icon",
                            iconSize: [SPOT_PIN_PX, SPOT_PIN_H],
                            iconAnchor: [SPOT_PIN_PX / 2, SPOT_PIN_H],
                        }),
                        title: label,
                        alt: label,
                        keyboard: true,
                        // **写真のピンより手前に置く。** 同じ升に写真の束が
                        // 在ると、下に隠れて押せない
                        zIndexOffset: 1000,
                    });
                    onActivate(marker, () => onSelectSpotRef.current?.(sp.slug));
                    marker.addTo(layer);
                }

                // 現在地の点。**写真のピンとは別の形**（丸い点）にして、
                // 「ここに写真がある」と読ませない
                const h = hereRef.current;
                if (h) {
                    L.circleMarker([h.lat, h.lng], {
                        radius: 7, color: "#ffffff", weight: 3, fillColor: "#2080f6", fillOpacity: 1,
                        interactive: false,
                    }).addTo(layer);
                }
            };

            // **最初に見せる場所。** 写真ページから飛んできた（URL のハッシュ）か、
            // このタブで前に見ていた場所（控え）があればそこ。無ければ全部の
            // ピンが収まる範囲。決め方は `chooseInitialView` を参照——
            // 「写真を開いて戻るたびに全体へ戻される」を止めるのが目的
            const initial = chooseInitialView(window.location.hash, readSavedView());
            // Photo and published official spots share the initial geographic extent.
            // A map with zero photo posts must NOT default to Japan when its
            // first published official guide is elsewhere in the world.
            const points = [
                ...photosRef.current.map((p) => ({ id: p.id, lat: p.coords.lat, lng: p.coords.lng })),
                ...spotsRef.current.map((sp) => ({ id: `official:${sp.slug}`, lat: sp.lat, lng: sp.lng })),
            ];
            const b = boundsOf(points);
            if (initial) {
                map.setView([initial.lat, initial.lng], initial.zoom);
            } else if (points.length === 1) {
                map.setView([points[0].lat, points[0].lng], 10);
            } else if (b) {
                map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [32, 32], maxZoom: 12 });
            } else {
                map.setView([36, 138], 4);   // No published map data: Japan overview.
            }
            draw();
            map.on("zoomend", draw);
            // 動かすたびに控える。URL は触らない（mapView.ts の冒頭を参照）。
            // **最初の場所は控えに入らない**——上の `setView`/`fitBounds` は
            // `moveend` を同期で出し終えている（Leaflet 1.9.4 を実行して確認:
            // 後付けの listener には 0 回）。それで困らない: 動かしていなければ
            // 控えの有無に関わらずハッシュ／全体表示に戻るので着地は同じ。
            // **「現在地」を使ったあとは書かない**（`suppressSaveRef`）
            map.on("moveend", () => {
                if (suppressSaveRef.current) return;
                const c = map.getCenter();
                saveView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }, window.location.hash);
            });
        })();

        // 後片付けで読む ref は effect の中で控える（片付けの時点では
        // 別の中身に差し替わっているかもしれない）
        const pinEls = pinElsRef.current;
        return () => {
            cancelled = true;
            layerRef.current = null;
            pinEls.clear();
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // 写真が増えたら描き直す（`photosRef` を読むのは draw。ここは初期化だけ）
    }, [locale, en]);

    /**
     * **枠の大きさが変わったら Leaflet に測り直させる。**
     *
     * この地図は「地図／リスト」の切り替えで `display: none` になる列の中に
     * 在る。隠れている間に画面が回る・URL バーが畳まれると `resize` が飛び、
     * Leaflet は `_onResize` → `invalidateSize` で **0x0 を掴んだまま
     * `_sizeChanged = false`** にする（`leaflet-src.js:4007`）。戻しても
     * タイルを取りに行かず、白い枠のまま残る。
     *
     * `ResizeObserver` は「隠れている間は 0、戻った瞬間に実寸」を通知するので、
     * 表示・回転・列幅の変化を1つの口でまとめて拾える。
     */
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => {
            const map = mapRef.current;
            // 0x0（＝隠れている）ときは測り直さない。その値を覚えさせない
            if (!map || el.clientWidth === 0 || el.clientHeight === 0) return;
            map.invalidateSize({ debounceMoveend: true });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 写真の配列が変わったら、地図を作り直さずにピンだけ描き直す
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        map.fire("zoomend");
    }, [photos]);

    // 現在地が付いた／消えたときも点を描き直す。
    // 公式スポットが増減したときも同じ（描き直しの入口を2つ作らない）
    useEffect(() => {
        mapRef.current?.fire("zoomend");
    }, [here, spots]);

    // **選ばれたピンは描き直さずにクラスだけ付け替える。** 描き直すと
    // 画像の要求がやり直しになり、押すたびにピンが一瞬消える
    useEffect(() => {
        for (const [id, el] of pinElsRef.current) {
            el.classList.toggle("is-selected", id === selectedId);
        }
    }, [selectedId, photos]);

    // 公式スポットも同じ（描き直さずクラスだけ）
    useEffect(() => {
        for (const [slug, el] of spotElsRef.current) {
            el.classList.toggle("is-selected", slug === selectedSpotSlug);
        }
    }, [selectedSpotSlug, spots]);

    const zoomBy = useCallback((delta: number) => {
        const map = mapRef.current;
        if (!map) return;
        if (delta > 0) map.zoomIn();
        else map.zoomOut();
    }, []);

    /**
     * 現在地へ寄る。**位置はどこにも送らず、どこにも保存しない。**
     * 使った瞬間に地図の控え（sessionStorage）も消し、以後書かない。
     */
    const locate = useCallback(() => {
        const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
        if (!geo) {
            setLocateError(en ? "Location isn't available on this device." : "この端末では現在地を使えません。");
            return;
        }
        setLocateError("");
        setLocating(true);
        // **控えを消すのは、位置が実際に来たときだけ。** 押した時点で消すと、
        // 許可のダイアログで「ブロック」を押しただけで——位置は一度も
        // 取れていないのに——控えが消え、以後この画面は控えを書かなくなる
        // （戻ったとき同じ場所に着地する挙動がセッション中ずっと失われる）
        geo.getCurrentPosition(
            (pos) => {
                setLocating(false);
                const { latitude, longitude } = pos.coords;
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
                // **`setView` より前に立てる。** Leaflet は `setView` の中で
                // `moveend` を同期で出すので、あとから立てると現在地が
                // 1回ぶん控えに書かれる
                suppressSaveRef.current = true;
                clearSavedView();
                setHere({ lat: latitude, lng: longitude });
                mapRef.current?.setView([latitude, longitude], LOCATE_ZOOM);
            },
            () => {
                setLocating(false);
                // 断られた理由は分けない（拒否・失敗・時間切れのどれでも
                // 人ができることは同じ＝ブラウザの許可を見直す）
                setLocateError(en
                    ? "Couldn't get your location. Check the location permission in your browser."
                    : "現在地を取得できませんでした。ブラウザの位置情報の許可をご確認ください。");
            },
            // **高精度は要らない。** 写真の座標は約1km に丸めてあるので、
            // 細かく測っても地図の上では同じ。電池と待ち時間だけ増える
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
        );
    }, [en]);

    const searchArea = useCallback(() => {
        const map = mapRef.current;
        if (!onSearchArea) return;
        if (areaActive) { onSearchArea(null); return; }
        if (!map) return;
        // **Leaflet は経度を ±180 に丸めない**（`worldCopyJump` で世界を跨ぐと
        // `west=169 / east=189` が返る）。畳んでから渡す（`normalizeBounds`）
        const b = map.getBounds();
        onSearchArea(normalizeBounds({
            south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
        }));
    }, [onSearchArea, areaActive]);

    // 操作ボタンの共通の見た目。**px で書く**（640px 未満で root が 14px に
    // 落ちるので `w-11` は 38.5px に縮む＝指の的 44px を割る）
    const ctrl = "flex items-center justify-center rounded-full bg-surface-2/90 backdrop-blur-sm text-white ring-1 ring-white/15 shadow-lg shadow-black/40 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50";
    const ctrlSize = { width: "44px", height: "44px", touchAction: "manipulation" } as const;

    return (
        <div
            // **`isolate` は外枠にも要る。** 下の地図の容器だけに付けると、
            // 操作ボタンの `z-[1001]`（Leaflet のコントロール層より前に出すための値）
            // が**ページ全体の土俵に出て**、`z-50` の固定ヘッダーを追い越す
            // ——`2922526f` で直したのと同じ形（あのときは Leaflet のペインだった）。
            // 外枠でスタッキングコンテキストを作れば、地図の中の重なり順は
            // どれだけ大きい値でもこの枠から出ない。
            className={`photo-map-frame journey-photo-map relative isolate w-full rounded-2xl overflow-hidden ring-1 ring-white/10 ${className || "h-[70vh] min-h-[320px]"}`}
            data-basemap={basemapState}
        >
            <div
                ref={containerRef}
                role="region"
                aria-label={en ? "Map of shooting locations" : "撮影地マップ"}
                // **`isolate`（isolation: isolate）を外さない。** Leaflet はペインに
                // z-index 400〜1000 を振る。ここでスタッキングコンテキストを作らないと
                // その値がページ全体の土俵に出て、`z-50` のヘッダーとメニューを追い越す
                // ——実測（Chromium・390x844・300px スクロール）: ヘッダー帯の画素が
                // 地図のタイル色になり、ロゴもハンバーガーも見えないまま押せる状態だった。
                // 外枠にも付いているが、**両方に要る**: こちらが Leaflet のペインを
                // 閉じ込め、外枠が操作ボタンの `z-[1001]` を閉じ込める。
                //
                // 下地の色は globals.css（`.photo-map-shell`）。ここに `bg-white/5` と
                // 書いても Leaflet の `.leaflet-container { background: #ddd }` と
                // 同じ強さで、読み込み順で負けて効かない（実測 rgb(221,221,221)）
                className="photo-map-shell isolate absolute inset-0"
                data-testid="photo-map"
            />

            {basemapState === "fallback" && (
                <p role="status" className="journey-map-basemap-warning pointer-events-none absolute left-3 top-2 z-[1001] max-w-[calc(100%-80px)] rounded-lg bg-surface-2/95 px-3 py-2 text-xs leading-5 text-white/85">
                    {en ? "High-detail map unavailable. Standard map shown." : "高精細な地図を読み込めませんでした。標準地図を表示しています。"}
                </p>
            )}

            {/* 操作のボタン。**地図の容器の外**に置くので Leaflet のドラッグ・
                ホイールに触られない。`z-[1001]` は Leaflet のコントロール層
                （`.leaflet-top` = 1000）より前。`isolate` の中なのでページには出ない */}
            <div
                // シートが開いている間は**1段の横並びで上端へ逃がす**（1024px 未満）。
                // 縦積みのままだと 144px あり、320x640 のような低い画面では
                // 上端へ寄せてもシートの下に入る（実測: 現在地のボタンが
                // `elementFromPoint` でシートの本文を返していた）
                className={`absolute right-4 z-[1001] flex items-center ${
                    sheetOpen
                        ? "top-2 flex-row-reverse lg:top-1/2 lg:-translate-y-1/2 lg:flex-col"
                        : "top-1/2 -translate-y-1/2 flex-col"
                }`}
                data-testid="map-controls-stack"
                style={{ gap: "12px" }}
            >
                {/* ＋ と − は1つの丸にまとめる（モックと同じ）。シートが開いて
                    いる間だけ横に寝かせる */}
                <div className={`flex overflow-hidden rounded-full bg-surface-2/90 backdrop-blur-sm ring-1 ring-white/15 shadow-lg shadow-black/40 ${
                    sheetOpen ? "flex-row-reverse lg:flex-col" : "flex-col"
                }`}>
                    <button
                        type="button" onClick={() => zoomBy(1)}
                        aria-label={en ? "Zoom in" : "拡大"}
                        className="flex items-center justify-center text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
                        style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                    >
                        <svg viewBox="0 0 20 20" aria-hidden="true" style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M10 4v12M4 10h12" />
                        </svg>
                    </button>
                    <span className={sheetOpen ? "w-px self-stretch bg-white/15 lg:w-auto lg:h-px" : "h-px bg-white/15"} aria-hidden="true" />
                    <button
                        type="button" onClick={() => zoomBy(-1)}
                        aria-label={en ? "Zoom out" : "縮小"}
                        className="flex items-center justify-center text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
                        style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                    >
                        <svg viewBox="0 0 20 20" aria-hidden="true" style={{ width: "20px", height: "20px" }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M4 10h12" />
                        </svg>
                    </button>
                </div>

                <button
                    type="button" onClick={locate} disabled={locating}
                    aria-label={en ? "Go to my location" : "現在地へ移動"}
                    className={ctrl} style={ctrlSize}
                    data-testid="map-locate"
                >
                    {/* 照準の印。現在地の「点」とは別の絵にする */}
                    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "22px", height: "22px" }} fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="12" cy="12" r="6" />
                        <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
                    </svg>
                </button>
            </div>

            {/* 「このエリアを検索」。モックでは地図の左下 */}
            {onSearchArea && (
                <button
                    type="button" onClick={searchArea}
                    className={`absolute left-4 z-[1001] inline-flex items-center rounded-full bg-surface-2/90 backdrop-blur-sm text-white ring-1 ring-accent/60 shadow-lg shadow-black/40 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                        // **操作のボタンの下の段に置く。** 同じ段だと 320px 幅で
                        // 横に並びきらず、後から描くこちらがボタンを覆っていた
                        // （実測: 現在地のボタンが `elementFromPoint` でこの
                        // ボタンを返していた）
                        sheetOpen ? "top-14 lg:top-auto lg:bottom-11" : "bottom-11"
                    }`}
                    style={{ height: "36px", paddingLeft: "12px", paddingRight: "14px", gap: "6px", fontSize: "13px", touchAction: "manipulation" }}
                    data-testid="map-search-area"
                >
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="text-accent" style={{ width: "16px", height: "16px" }} fill="currentColor">
                        <path d="M10 2a5 5 0 0 0-5 5c0 3.6 4.3 10.1 4.5 10.4a.6.6 0 0 0 1 0C10.7 17.1 15 10.6 15 7a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
                    </svg>
                    {areaActive
                        ? (en ? "Clear this area" : "範囲の指定を解除")
                        : (en ? "Search this area" : "このエリアを検索")}
                </button>
            )}

            {/* 現在地が取れなかったときの断り。**読み上げにも届ける** */}
            {locateError && (
                <p
                    role="status"
                    className="absolute left-4 z-[1001] rounded-xl bg-surface-2/95 backdrop-blur-sm ring-1 ring-white/15 text-white/90"
                    // **右は空けておく。** 操作のボタン（44px ＋ 余白）が右上へ
                    // 逃げている場合があるので、そこへ潜り込ませない
                    style={{ top: "64px", maxWidth: "calc(100% - 88px)", padding: "8px 12px", fontSize: "13px", lineHeight: "18px" }}
                >
                    {locateError}
                </p>
            )}
        </div>
    );
}
