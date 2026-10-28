"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { isIOS, isIOSSafari } from "@/lib/utils/pwa";
import "leaflet/dist/leaflet.css";
import type { MapEngine, MarkerHandle, MarkerSpec } from "../../lib/map/engine";
import { createLeafletEngine } from "../../lib/map/leafletEngine";
import { createMapKitEngine, loadMapKit, mapKitRefused, onMapKitRefused } from "../../lib/map/mapkitEngine";
import {
    clusterCover, clusterFrame, clusterPhotoCount, frameForPoints, groupPins, layoutHides, layoutPins,
    visibleSpots, type Frame, type MapPin, type PinCluster,
} from "../../lib/map/mapPins";
import type { Photo } from "../../lib/data/photos";
import type { SpotPin } from "../../lib/data/spotLink";
import { spotPinThumbSrc } from "../../lib/utils/spotPinThumb";

/** 既定の空配列。**毎回作らない**（作ると ref の更新が毎描画で走る） */
const EMPTY_SPOTS: readonly SpotPin[] = [];
import {
    MAP_MAX_ZOOM, chooseInitialView, readSavedView, saveView, clearSavedView,
} from "../../lib/utils/mapView";
import { normalizeBounds, type MapBounds } from "../../lib/utils/mapFilter";
import { publicImageUrl } from "../../lib/utils/seo";
import { useLatestRef } from "../../lib/hooks/useLatestRef";

/** 位置情報を持つ写真だけ（`coords` が有限の数であること） */
export type MapPhoto = Photo & { coords: { lat: number; lng: number } };
export function photosWithCoords(photos: readonly Photo[]): MapPhoto[] {
    return photos.filter((p): p is MapPhoto =>
        !!p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng));
}

/** ピンを押したときに親へ渡すもの。`null` は「閉じる」 */
export type MapSelection = { photos: MapPhoto[]; index: number };

/**
 * 印の大きさ（px）。**iOS の `PhotoMapView` と同じ数**（v2 の板 Map・2026-10-14）:
 *
 *     写真のピン    44 の白い角丸（角 12）に 2 の余白で写真 40（角 10）
 *     枚数のバッジ  真鍮の丸 20・黒の縁 2・右上へ（8+2, -(6+2)）
 *     撮影スポット  押せる範囲 44 の真ん中に、写真の丸 40（真鍮の縁 3）か
 *                   真鍮の丸 32（墨のカメラ・白の縁 2）
 *
 * どれも**箱の下端の真ん中が座標**（SwiftUI の `Annotation` の既定と同じ）。
 */
const PIN_PX = 44;
const SPOT_HIT_PX = 44;

/**
 * 枠へ寄せるときの余白（px）。iOS の枠（1.4倍の余白つき）に**さらに足す**——Web の地図は
 * 上と左下にボタンが重なり、札とバッジは座標の上へ約54px 伸びる。余白0だと端のピンが
 * 切れる・ボタンに隠れる（iOS は地図の上にボタンが重ならない）
 */
const FIT_PADDING = 32;

/**
 * 写真のピンの中身を表す鍵。**名前と表紙のサムネまで入れる**——写真の id が同じでも、
 * ビルドの控えから API の一覧へ置き換わったときに撮影地・サムネが変わることがある
 * （撮影地を後から書いた）。鍵が同じだと作り直さないので、古い名前のまま残る
 */
function pinContentKey(pin: MapPin<MapPhoto>): string {
    const cover = pin.photos[0];
    const thumb = cover ? (cover.thumbSm || cover.thumbSrc || cover.src || "") : "";
    return `${pin.id}:${pin.photos.map((p) => p.id).join(",")}:${pin.place ?? ""}:${thumb}`;
}

/** iOS の `MapFraming.Frame`（中心と幅）→ 地図に渡す矩形 */
function frameBounds(f: Frame): { south: number; west: number; north: number; east: number } {
    return { south: f.lat - f.latSpan / 2, north: f.lat + f.latSpan / 2, west: f.lng - f.lngSpan / 2, east: f.lng + f.lngSpan / 2 };
}

/** 最初に見せる範囲（いちばん写真の多い塊。重みは撮影地ごとの枚数） */
function photosFrame(photos: readonly MapPhoto[]): Frame | null {
    const pins = groupPins(photos);
    return frameForPoints(pins.map((p) => ({ lat: p.lat, lng: p.lng })), pins.map((p) => p.photos.length));
}

/** 写真のピンの読み上げ名（「パリ、写真 3枚」・iOS の `pinSpokenLabel`） */
function pinSpokenLabel(place: string | null, count: number, en: boolean): string {
    const shown = place || (en ? "No place name" : "場所の名前なし");
    return en ? `${shown}, ${count} photo${count === 1 ? "" : "s"}` : `${shown}、写真 ${count}枚`;
}

/** 白い角丸の札に写真（読めなくても白い札は残る）。**DOM で組む**（URL を文字列の HTML に入れない） */
function cardElement(photo: MapPhoto | undefined): HTMLElement {
    const card = document.createElement("span");
    card.className = "photo-map-pin__card";
    const thumb = photo ? (photo.thumbSm || photo.thumbSrc || photo.src) : "";
    if (thumb) {
        const img = document.createElement("img");
        img.className = "photo-map-pin__img";
        // 出す URL はサイトのドメインに揃える（`Thumb` と同じ理由）。44 の印に 256px で足りる
        img.src = publicImageUrl(thumb);
        img.alt = "";           // 名前は印の `title` が持つ
        img.decoding = "async";
        // **px を書く。** Leaflet の `width: auto` が効くと、読み込み前は幅0・読み込み後は
        // 元画像の幅（256px）になり、ピンが化ける
        img.width = 40;
        img.height = 40;
        img.addEventListener("error", () => { img.remove(); }, { once: true });
        card.appendChild(img);
    }
    return card;
}

/** 枚数のバッジ（真鍮の塗り・墨の数字・黒の縁）。**数字だけ**（利用者の入力は入らない） */
function badgeElement(count: number): HTMLElement {
    const b = document.createElement("span");
    b.className = "map-count-badge";
    b.setAttribute("aria-hidden", "true");
    b.textContent = String(count);
    return b;
}

/** 印の下の名前（MapKit が `Annotation` の題として描くのと同じ位置） */
function labelElement(text: string): HTMLElement {
    const l = document.createElement("span");
    l.className = "map-pin-label";
    l.setAttribute("aria-hidden", "true");   // 名前は印の `title` が持つ
    l.textContent = text;
    return l;
}

/** 墨のカメラ（写真の無い撮影スポットの印） */
function cameraIcon(): SVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M9.4 4.5a1.5 1.5 0 0 0-1.27.7L7.2 6.6H5A2.5 2.5 0 0 0 2.5 9.1v8.4A2.5 2.5 0 0 0 5 20h14a2.5 2.5 0 0 0 2.5-2.5V9.1A2.5 2.5 0 0 0 19 6.6h-2.2l-.93-1.4a1.5 1.5 0 0 0-1.27-.7H9.4ZM12 9a4.25 4.25 0 1 1 0 8.5A4.25 4.25 0 0 1 12 9Z");
    svg.appendChild(path);
    return svg;
}

/** 「現在地」で寄るズーム。写真の座標は約1km に丸めてあるので、これ以上寄せない */
const LOCATE_ZOOM = 12;

/**
 * Apple のマップ（MapKit JS）の鍵。**空なら最初から控えの地図**（`lib/map/engine.ts`）。
 * ドメインを限った鍵で、ページに埋めて配る前提のもの（秘密ではない）
 */
const MAPKIT_TOKEN = process.env.NEXT_PUBLIC_MAPKIT_JS_TOKEN ?? "";

/**
 * 撮影地の地図。**地図は Apple のマップ（MapKit JS）**——iOS のアプリと同じ地図。
 * 鍵が無い・Apple に届かない・鍵が断られたときは今までの地図（Leaflet＋
 * OpenStreetMap）に落とす。土台の違いは `lib/map/*Engine.ts` に閉じ込め、ここは
 * 束ね方・選び方・控え・現在地だけを1つ書く。
 *
 * **どちらの土台も effect の中で読む**——`window` に依存するので、
 * トップレベルで読むと静的書き出し（`next build` の事前描画）で落ちる。
 * Leaflet の CSS は window に依存しないので普通に import する。
 *
 * ## ピンは iOS と同じ形・同じ決まり（2026-10-28）
 *
 * 白い角丸の札に写真（同じ撮影地の写真は1本にまとめて枚数のバッジ）、多すぎる
 * ときだけ束（札を2枚重ねる）、撮影スポットは丸（寄せたとき・名前で絞ったときだけ）。
 * 決め方は `lib/map/mapPins.ts`（iOS の `MapPinClusters` / `OfficialPins` /
 * `MapFraming` の写し）。中身は **DOM を組んで渡す**——文字列の HTML を組むと、
 * 写真の URL を通した差し込みの口になる。
 *
 * **画像には px の幅と高さを必ず書く。** Leaflet の
 * `.leaflet-container .leaflet-marker-pane img` は `max-width: none !important`
 * ＋ **`width: auto`**（詳細度 0,2,1）で、Tailwind の preflight
 * （`img { max-width: 100%; height: auto }`）ごと潰す。こちらの指定は
 * `.photo-map-shell .leaflet-marker-pane .photo-map-pin__img`（0,3,0）で
 * 上回る必要がある（`app/globals.css`）。
 *
 * 置く印は見えている範囲で決まるので、地図が落ち着くたびに置き直す。**変わった印
 * だけ**を外して足す（全部を作り直すと画像を読み直して印が一瞬消える）。
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
    spots = EMPTY_SPOTS, onSelectSpot, selectedSpotSlug = null, spotQueryActive = false,
}: {
    photos: readonly MapPhoto[];
    locale: "ja" | "en";
    /**
     * 公式撮影地ガイドのスポット（運営が台帳に書いたもの）。
     *
     * **写真の束には混ぜない。** 混ぜると束の数字が
     * 「N枚」と名乗ったまま写真でないものを数える。別の層として、
     * **別の形のピン**で立てる——「ここに写真がある」と読ませない
     * （現在地の点を丸にしてあるのと同じ判断）。
     */
    spots?: readonly SpotPin[];
    /**
     * 名前で撮影スポットを絞っているか。**絞っているときは倍率に関係なく**当たった
     * スポットを置く（iOS の `OfficialPins`）。絞っていなければ寄せたときだけ
     */
    spotQueryActive?: boolean;
    /** 公式スポットのピンが押された */
    onSelectSpot?: (slug: string) => void;
    /** いま選ばれている公式スポット（そのピンを目立たせる） */
    selectedSpotSlug?: string | null;
    /** ピンが押された（`null` は地図の余白が押された＝閉じる） */
    onSelect?: (selection: MapSelection | null) => void;
    /**
     * いま選ばれている写真。**ピンの見た目は変えない**（iOS も選んだピンを目立たせない）。
     * その撮影地が束に吸われた・枠の外へ出たら選びを外すのに使う
     */
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
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MapEngine | null>(null);
    /** 印を描き直す（ズーム・写真・スポット・現在地が変わったとき） */
    const redrawRef = useRef<(() => void) | null>(null);
    /**
     * どちらの地図で描くか。鍵があれば Apple のマップから始め、読めなかった・
     * 断られたら控えの地図に切り替える（切り替えたらこの画面では戻さない）
     */
    const [engineKind, setEngineKind] = useState<"mapkit" | "leaflet">(
        () => (MAPKIT_TOKEN && !mapKitRefused() ? "mapkit" : "leaflet"),
    );
    /** どちらの地図も読めなかった（圏外） */
    const [mapFailed, setMapFailed] = useState(false);
    // 最新の写真を effect の外から読む（地図が動くたびに置き直すため）。
    // **描画の途中では書かない**（`useLatestRef`。描き終えた直後に書く）
    const photosRef = useLatestRef(photos);
    // **ref に持つ。** 依存に入れると、親が関数を作り直すたびに地図ごと
    // 建て直すことになる（見ていた場所もズームも消える）
    const onSelectRef = useLatestRef(onSelect);
    const selectedIdRef = useLatestRef(selectedId);
    const spotsRef = useLatestRef(spots);
    const spotQueryActiveRef = useLatestRef(spotQueryActive);
    const onSelectSpotRef = useLatestRef(onSelectSpot);
    const selectedSpotRef = useLatestRef(selectedSpotSlug);
    /** 写真0枚で地図を作った（あとから写真が届いたら一度だけ寄る・人が動かしたら取り消す） */
    const autoFitPendingRef = useRef(false);
    const areaActiveRef = useLatestRef(areaActive);
    /** 現在地。**state に置くだけで、保存も送信もしない** */
    const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
    const hereRef = useLatestRef(here);
    const [locating, setLocating] = useState(false);
    const [locateError, setLocateError] = useState("");
    /**
     * 控えを書かない印。**「現在地」を一度でも使ったら立てる**——書き続けると
     * 端末のだいたいの位置が sessionStorage に残る（`clearSavedView` を参照）。
     */
    const suppressSaveRef = useRef(false);

    // 鍵が断られた・1日の上限に当たった（Apple から後で届く）→ 控えの地図へ
    useEffect(() => {
        if (engineKind !== "mapkit") return;
        return onMapKitRefused(() => setEngineKind("leaflet"));
    }, [engineKind]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let cancelled = false;
        let made: MapEngine | null = null;

        void (async () => {
            // **「動きを減らす」設定を尊重する**（ズーム・移動・慣性・束を押したときの寄せ）
            const reduceMotion = typeof window.matchMedia === "function"
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            let map: MapEngine;
            if (engineKind === "mapkit") {
                try {
                    const mk = await loadMapKit(MAPKIT_TOKEN, en ? "en" : "ja");
                    if (cancelled || !containerRef.current) return;
                    map = createMapKitEngine(mk, el, { reduceMotion });
                } catch {
                    // 読めなかった（圏外・配信の不調・時間切れ）。控えの地図で描き直す
                    if (!cancelled) setEngineKind("leaflet");
                    return;
                }
            } else {
                let leaflet: MapEngine | null;
                try {
                    leaflet = await createLeafletEngine(el, { reduceMotion, isCancelled: () => cancelled || !containerRef.current });
                } catch {
                    // 控えの地図の部品も読めなかった（圏外で、まだ一度も読んでいない）。
                    // 白い枠のまま黙らない
                    if (!cancelled) setMapFailed(true);
                    return;
                }
                if (!leaflet) return;
                // 作り終えてから戻ってくるまでの間に要らなくなった（両方で見る）
                if (cancelled || !containerRef.current) { leaflet.remove(); return; }
                map = leaflet;
                setMapFailed(false);
            }
            made = map;
            mapRef.current = map;

            // 地図の余白を押したら閉じる（印を押したときは来ない＝各土台が見分ける）
            map.onBackgroundClick(() => onSelectRef.current?.(null));

            /** 枠へ寄せる。**寄せたら「写真が届いたら全体へ」を取り消す**（人の操作の結果） */
            const zoomInto = (f: Frame) => {
                autoFitPendingRef.current = false;
                map.fitBounds(frameBounds(f), { padding: FIT_PADDING, maxZoom: MAP_MAX_ZOOM, animate: reduceMotion ? false : undefined });
            };

            /** いま見えている枠（iOS の `MapFraming.Frame` の形）。決まらなければ null */
            const visibleFrame = (): Frame | null => {
                const b = map.getBounds();
                const c = map.getCenter();
                let lngSpan = b.east - b.west;
                if (lngSpan < 0) lngSpan += 360;   // 日付変更線を跨いだ（MapKit は東が西より小さくなる）
                const f = { lat: c.lat, lng: c.lng, latSpan: b.north - b.south, lngSpan };
                return [f.lat, f.lng, f.latSpan, f.lngSpan].every(Number.isFinite) && f.latSpan > 0 && f.lngSpan > 0 ? f : null;
            };

            /**
             * 置いている印（鍵 → 印）。**変わらない印は置き直さない**——地図が動くたびに
             * 全部を作り直すと、画像を読み直して印が一瞬消え、押した印のフォーカスも落ちる。
             * 鍵には中身（写真の並び・代表の画像）を入れ、変わったら作り直す
             */
            const placed = new Map<string, MarkerHandle>();
            /** 撮影スポットの印の DOM（選んだ形を付け替えるため） */
            const spotEls = new Map<string, HTMLElement>();

            const draw = () => {
                const frame = visibleFrame();
                const want = new Map<string, () => MarkerSpec>();

                // 写真のピン（同じ座標の写真を1本に・多すぎるときだけ束ねる）
                const pins = groupPins(photosRef.current);
                const layout = layoutPins(pins, frame);
                for (const pin of layout.pins) {
                    const key = `p:${pinContentKey(pin)}`;
                    want.set(key, () => ({
                        lat: pin.lat, lng: pin.lng, el: photoPinElement(pin), className: "photo-map-pin-icon",
                        size: [PIN_PX, PIN_PX], anchor: [PIN_PX / 2, PIN_PX],
                        title: pinSpokenLabel(pin.place, pin.photos.length, en),
                        onActivate: () => onSelectRef.current?.({ photos: pin.photos, index: 0 }),
                    }));
                }
                for (const c of layout.clusters) {
                    // 中の撮影地ごとの写真まで鍵に入れる（絞り込みで枚数が減ったらバッジを描き直す）
                    const key = `c:${c.id}:${c.pins.map(pinContentKey).join("|")}`;
                    want.set(key, () => ({
                        lat: c.lat, lng: c.lng, el: clusterElement(c), className: "photo-map-pin-icon",
                        size: [PIN_PX, PIN_PX], anchor: [PIN_PX / 2, PIN_PX],
                        title: en
                            ? `${clusterPhotoCount(c)} photos at ${c.pins.length} places. Tap to zoom in`
                            // iOS の `clusterSpokenLabel`（「3地点の写真 12枚。押すと寄ります」）
                            : `${c.pins.length}地点の写真 ${clusterPhotoCount(c)}枚。押すと寄ります`,
                        // 束は選ばない。その束が収まる枠まで寄るだけ（iOS と同じ）
                        onActivate: () => zoomInto(clusterFrame(c)),
                    }));
                }
                // **選んでいた撮影地が束に吸われた・枠の外へ出た**なら選びを外す（iOS と同じ）。
                // 絞り込みで結果から外れたときは外さない
                const chosen = selectedIdRef.current;
                if (chosen) {
                    const owner = pins.find((p) => p.photos.some((ph) => ph.id === chosen));
                    if (owner && layoutHides(layout, owner.id, new Set(pins.map((p) => p.id)))) {
                        onSelectRef.current?.(null);
                    }
                }

                // 撮影スポット。**寄せたとき・名前で絞ったときだけ**最大60本（iOS の `OfficialPins`）。
                // 選んでいるスポットは見えなくなっても置く（札だけ残る、を作らない）
                const shownSpots = visibleSpots(spotsRef.current, frame, { queryActive: spotQueryActiveRef.current });
                const sel = selectedSpotRef.current;
                if (sel && !shownSpots.some((s) => s.slug === sel)) {
                    const kept = spotsRef.current.find((s) => s.slug === sel);
                    if (kept) shownSpots.push(kept);
                }
                for (const sp of shownSpots) {
                    const key = `s:${sp.slug}:${spotPinThumbSrc(sp) ?? ""}:${sp.name}:${sp.stage}`;
                    want.set(key, () => ({
                        lat: sp.lat, lng: sp.lng, el: spotElement(sp), className: "spot-map-pin-icon",
                        size: [SPOT_HIT_PX, SPOT_HIT_PX], anchor: [SPOT_HIT_PX / 2, SPOT_HIT_PX],
                        title: sp.stage === "published" ? sp.name : (en ? `${sp.name} (draft)` : `${sp.name}（下書き）`),
                        // 写真のピンより手前（Leaflet だけ効く。`MarkerSpec.zIndexOffset`）
                        zIndexOffset: 1000,
                        onActivate: () => onSelectSpotRef.current?.(sp.slug),
                    }));
                }

                // 置き直す（要らない印を外し、無い印だけ置く）
                for (const [key, handle] of placed) {
                    // 現在地の点は下で別に扱う（毎回外して付け直さない）
                    if (want.has(key) || key.startsWith("h:")) continue;
                    handle.remove();
                    placed.delete(key);
                    if (key.startsWith("s:")) spotEls.delete(key.split(":")[1]);
                }
                for (const [key, spec] of want) {
                    if (placed.has(key)) continue;
                    placed.set(key, map.addMarker(spec()));
                }
                for (const [slug, el] of spotEls) el.classList.toggle("is-selected", slug === sel);

                // 現在地の点。**写真のピンとは別の形**（丸い点）
                const h = hereRef.current;
                const hereKey = h ? `h:${h.lat},${h.lng}` : null;
                for (const [key, handle] of placed) {
                    if (key.startsWith("h:") && key !== hereKey) { handle.remove(); placed.delete(key); }
                }
                if (h && hereKey && !placed.has(hereKey)) placed.set(hereKey, map.addHereDot(h));
            };

            /** 写真のピン（白い角丸の札に写真・枚数のバッジ・撮影地の名前） */
            const photoPinElement = (pin: MapPin<MapPhoto>): HTMLElement => {
                const wrap = document.createElement("span");
                wrap.className = "photo-map-pin";
                wrap.appendChild(cardElement(pin.photos[0]));
                if (pin.photos.length > 1) wrap.appendChild(badgeElement(pin.photos.length));
                if (pin.place) wrap.appendChild(labelElement(pin.place));
                return wrap;
            };
            /** 束（後ろに白い札をもう1枚ずらして重ね、1つの撮影地と見分ける） */
            const clusterElement = (c: PinCluster<MapPhoto>): HTMLElement => {
                const wrap = document.createElement("span");
                wrap.className = "photo-map-pin photo-map-pin--stack";
                const back = document.createElement("span");
                back.className = "photo-map-pin__back";
                back.setAttribute("aria-hidden", "true");
                wrap.appendChild(back);
                wrap.appendChild(cardElement(clusterCover(c)));
                wrap.appendChild(badgeElement(clusterPhotoCount(c)));
                return wrap;
            };
            /** 撮影スポット（写真の丸・真鍮の縁、または真鍮の丸に墨のカメラ）と名前 */
            const spotElement = (sp: SpotPin): HTMLElement => {
                const wrap = document.createElement("span");
                wrap.className = "spot-map-pin";
                const mark = document.createElement("span");
                mark.setAttribute("aria-hidden", "true");
                const thumb = spotPinThumbSrc(sp);
                if (thumb) {
                    mark.className = "spot-map-pin__mark spot-map-pin__mark--photo";
                    const img = document.createElement("img");
                    img.className = "spot-map-pin__img";
                    img.src = thumb;
                    img.alt = "";
                    img.decoding = "async";
                    img.width = 40; img.height = 40;
                    // 読めなかったら真鍮の地が見える（空の枠にしない）
                    img.addEventListener("error", () => { img.remove(); }, { once: true });
                    mark.appendChild(img);
                } else {
                    mark.className = "spot-map-pin__mark spot-map-pin__mark--plain";
                    mark.appendChild(cameraIcon());
                }
                wrap.appendChild(mark);
                wrap.appendChild(labelElement(sp.name));
                spotEls.set(sp.slug, wrap);
                return wrap;
            };

            // **最初に見せる場所。** 写真ページから飛んできた（URL のハッシュ）か、
            // このタブで前に見ていた場所（控え）があればそこ。無ければ**いちばん写真の多い
            // 塊**（iOS の `MapFraming`。全部を収めると日本とヨーロッパで地球儀になる）
            const initial = chooseInitialView(window.location.hash, readSavedView());
            const start = photosFrame(photosRef.current);
            if (initial) {
                map.setView({ lat: initial.lat, lng: initial.lng }, initial.zoom);
            } else if (start) {
                map.fitBounds(frameBounds(start), { padding: FIT_PADDING, maxZoom: MAP_MAX_ZOOM });
            } else {
                map.setView({ lat: 36, lng: 138 }, 4);   // 写真が無ければ日本全体
                // **写真があとから届いたら、一度だけそこへ寄る。** 公式スポットがあると
                // 写真0枚でも地図を作るので（`MapPageClient` の `nothingToShow`）、
                // 作った時点で写真が無いと日本全体のまま止まっていた（2026-09-30 のレビュー）
                autoFitPendingRef.current = true;
                // **人が地図を動かしたら取り消す**（束を押して寄った・パンした・現在地へ飛んだ
                // あとで、写真が届いたからと引き剥がさない）。束と現在地はこちらでも取り消す
                map.onceUserMove(() => { autoFitPendingRef.current = false; });
            }
            redrawRef.current = draw;
            draw();
            map.onViewChange(draw);
            // 動かすたびに控える。URL は触らない（mapView.ts の冒頭を参照）。
            // **「現在地」を使ったあとは書かない**（`suppressSaveRef`）
            map.onMoveEnd(() => {
                if (suppressSaveRef.current) return;
                const c = map.getCenter();
                saveView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }, window.location.hash);
            });
        })();

        return () => {
            cancelled = true;
            redrawRef.current = null;
            made?.remove();
            if (mapRef.current === made) mapRef.current = null;
        };
        // 写真が増えたら描き直す（`photosRef` を読むのは draw。ここは初期化だけ）。
        // `*Ref` は同じ入れ物のまま中身だけ替わる（依存に書いても作り直しは起きない）
    }, [locale, en, engineKind, photosRef, onSelectRef, selectedIdRef, spotsRef, spotQueryActiveRef, onSelectSpotRef, selectedSpotRef, hereRef]);

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
            map.invalidateSize();
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 写真の配列が変わったら、地図を作り直さずにピンだけ置き直す
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        // 「このエリアを検索」で範囲を決めたら取り消す（解除したときに急に飛ばない）
        if (areaActiveRef.current) autoFitPendingRef.current = false;
        if (autoFitPendingRef.current && photos.length > 0) {
            autoFitPendingRef.current = false;
            const f = photosFrame(photos);
            if (f) map.fitBounds(frameBounds(f), { padding: FIT_PADDING, maxZoom: MAP_MAX_ZOOM });
        }
        redrawRef.current?.();
    }, [photos, areaActiveRef]);

    // 現在地・スポット・選んだもの・語の有無が変わったときも置き直す
    // （置き直しは変わった印だけなので、押した印のフォーカスは落ちない）
    useEffect(() => {
        redrawRef.current?.();
    }, [here, spots, spotQueryActive, selectedSpotSlug, selectedId]);

    const zoomBy = useCallback((delta: number) => {
        const map = mapRef.current;
        if (!map) return;
        // 人の操作で動かした（写真が届いても全体へ引き剥がさない）。Leaflet は
        // `zoomstart` で取り消せていたが、Apple のマップはボタンの寄せを人の操作と数えない
        autoFitPendingRef.current = false;
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
                // 人の操作で寄った（写真が届いても全体へ引き剥がさない）
                autoFitPendingRef.current = false;
                mapRef.current?.setView({ lat: latitude, lng: longitude }, LOCATE_ZOOM);
            },
            (err) => {
                setLocating(false);
                // 断られた理由はおおむね分けない（拒否・失敗・時間切れのどれでも
                // 人ができることは同じ＝許可を見直す）。**ただし iPhone / iPad で
                // 拒否されたときは、見直す場所を具体的に言う**——「ブラウザの許可」
                // では、どこを開けばよいか分からない（#32）
                const ua = navigator.userAgent;
                const touch = navigator.maxTouchPoints ?? 0;
                const denied = err?.code === 1 && isIOS(ua, touch);
                // Safari と、iOS の Chrome などでは設定の場所が違う。ホーム画面から
                // 起動したアプリは UA に Safari を含まないが、許可の場所は Safari 側
                const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
                const deniedOnIOS = denied && (standalone || isIOSSafari(ua, touch));
                const deniedOnIOSOther = denied && !deniedOnIOS;
                setLocateError(deniedOnIOS
                    ? (en
                        ? "Location is turned off for this site. Open Settings → Privacy & Security → Location Services → Safari Websites and allow it."
                        : "位置情報が許可されていません。「設定」→「プライバシーとセキュリティ」→「位置情報サービス」→「Safari の Web サイト」で許可してください。")
                    : deniedOnIOSOther
                    ? (en
                        ? "Location is turned off for this browser. Open Settings → this browser's app (e.g. Chrome) → Location and allow it."
                        : "位置情報が許可されていません。「設定」→ このブラウザのアプリ（Chrome など）→「位置情報」で許可してください。")
                    : (en
                        ? "Couldn't get your location. Check the location permission in your browser."
                        : "現在地を取得できませんでした。ブラウザの位置情報の許可をご確認ください。"));
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
        // MapKit も世界を跨ぐと東が西より小さくなる。どちらも同じ口で畳む
        onSearchArea(normalizeBounds(map.getBounds()));
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
            className={`photo-map-frame relative isolate w-full rounded-2xl overflow-hidden ring-1 ring-line ${className || "h-[70vh] min-h-[320px]"}`}
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

            {/* 地図そのものを読めなかった（Apple のマップも控えの地図も）。白い枠のまま黙らない。
                **右は空けておく**（操作のボタンの列と同じ高さなので、覆うと押せなくなる） */}
            {mapFailed && (
                <p
                    role="status"
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-[1001] rounded-xl bg-surface-2/95 ring-1 ring-white/15 text-white/90"
                    style={{ right: "88px", padding: "12px 16px", fontSize: "14px", lineHeight: "20px" }}
                    data-testid="map-load-failed"
                >
                    {en
                        ? "Couldn't load the map. Check your connection and reload the page."
                        : "地図を読み込めませんでした。通信を確かめて、ページを読み込み直してください。"}
                </p>
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
