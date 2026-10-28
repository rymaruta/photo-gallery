/**
 * 撮影地マップの「地図の土台」の差し替え口。
 *
 * **地図は Apple のマップ（MapKit JS）で出す**（2026-10-28・owner:「iOS と同じに
 * 揃えたい」）。iOS のアプリは MapKit で、Web だけが OpenStreetMap の地図だった。
 * ただし MapKit JS は Apple の発行する鍵（トークン）が無いと1枚も描けず、
 * Apple の配信が落ちた・鍵が失効した・1日の上限に当たった、のどれでも
 * 地図ごと消える。そのときは**今までの地図（Leaflet＋OpenStreetMap）に落とす**
 * ——地図が出ないより、別の地図が出る方がよい（`PhotoMap` の `engineKind`）。
 *
 * ピンの束ね方・選び方・控え・現在地は `PhotoMap` に1つだけ書き、ここは
 * 「どこを見ているか」「印を置く」「押された」だけを2つの土台で同じ形にする。
 * 2組書くと、片方だけ直す事故が起きる。
 *
 * 経緯度はどちらの土台でも `{ lat, lng }`、ズームは **Web メルカトルの段**
 * （1段で2倍・0 で世界1周が 256px）にそろえる。MapKit には段が無いので、
 * 表示範囲の経度の幅と地図の横幅から換算する（`lib/map/region.ts`）。
 */

export type LatLng = { lat: number; lng: number };

/** 表示範囲。**経度は ±180 に畳まれているとは限らない**（呼ぶ側で `normalizeBounds`） */
export type Bounds = { south: number; west: number; north: number; east: number };

export type MarkerSpec = {
    lat: number;
    lng: number;
    /** 印の中身。**DOM で渡す**（文字列の HTML を組むと、URL や名前を通した差し込みの口になる） */
    el: HTMLElement;
    /** 印の箱に付けるクラス（見た目は `app/globals.css`） */
    className?: string;
    /** 印の箱の大きさ（px）と、座標に合わせる点（箱の左上からの px） */
    size: [number, number];
    anchor: [number, number];
    /** 読み上げとツールチップに出す名前 */
    title: string;
    /**
     * 重なり順の上げ下げ（大きいほど手前）。**Leaflet だけ**——MapKit JS の印には
     * 重なり順を決める口が無い（足した順・Apple の判断で重なる）
     */
    zIndexOffset?: number;
    /** 押された（Enter を含む） */
    onActivate?: () => void;
};

/** 置いた印。外すときに使う（描き直しで全部を作り直さない＝画像を読み直さない） */
export type MarkerHandle = { remove(): void };

export interface MapEngine {
    readonly kind: "leaflet" | "mapkit";
    getZoom(): number;
    getCenter(): LatLng;
    getBounds(): Bounds;
    setView(center: LatLng, zoom: number): void;
    /** `animate: false` は「動きを減らす」設定のとき。省けば土台に任せる */
    fitBounds(b: Bounds, opts: { padding: number; maxZoom: number; animate?: false }): void;
    zoomIn(): void;
    zoomOut(): void;
    /** 地図の余白（印ではない所）が押された */
    onBackgroundClick(fn: () => void): void;
    /**
     * 見ている範囲が落ち着いた（ズーム・移動のどちらも）。**印を置き直す合図**——
     * 置く印は見えている範囲で決まる（撮影スポットは寄せたときだけ・多いときは束ねる）
     */
    onViewChange(fn: () => void): void;
    /** 動き終わった（見ている場所を控える合図） */
    onMoveEnd(fn: () => void): void;
    /** 人が地図を動かし始めた（一度だけ呼ぶ） */
    onceUserMove(fn: () => void): void;
    clearMarkers(): void;
    addMarker(spec: MarkerSpec): MarkerHandle;
    /** 現在地の点。**写真のピンとは別の形**（丸い点） */
    addHereDot(p: LatLng): MarkerHandle;
    /** 枠の大きさが変わった（隠れていた列が戻った・回転した） */
    invalidateSize(): void;
    remove(): void;
}
