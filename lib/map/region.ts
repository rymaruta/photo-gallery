/**
 * ズームの「段」と、Apple のマップ（MapKit JS）の表示範囲の換算。
 *
 * `PhotoMap` は Leaflet の頃から**ズームの段**（1段で2倍・0 で世界1周が 256px の
 * Web メルカトル）で考えている——URL の `#12/35.42/138.88`、控え、「現在地」で寄る
 * 段、束ねる升。MapKit JS には段が無く、中心と経緯度の幅（`CoordinateRegion`）で
 * 動かすので、地図の大きさ（px）を使って行き来する。
 *
 * **純関数**にしてあるのは、MapKit を jsdom で動かさずに換算だけを確かめるため。
 */

const TILE_PX = 256;
const LAT_MAX = 85.05112878;   // メルカトルの定義域

/** 緯度経度 → そのズームでの Web メルカトルのピクセル座標 */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const scale = TILE_PX * 2 ** zoom;
    const clamped = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat));
    const sin = Math.sin((clamped * Math.PI) / 180);
    const x = ((lng + 180) / 360) * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    return { x, y };
}

/** `project` の逆（y → 緯度だけ要る） */
export function unprojectLat(y: number, zoom: number): number {
    const scale = TILE_PX * 2 ** zoom;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** 経度の幅（度）と地図の横幅（px）→ ズームの段 */
export function zoomFromSpan(longitudeDelta: number, widthPx: number): number {
    if (!(longitudeDelta > 0) || !(widthPx > 0)) return NaN;
    return Math.log2((360 * widthPx) / (TILE_PX * longitudeDelta));
}

/**
 * 中心とズームの段 → 地図に渡す経緯度の幅。
 * 緯度の幅はメルカトルで縦に半分ずつ写してから戻す（緯度が高いほど同じ px で狭い）。
 */
export function spanForView(
    center: { lat: number; lng: number }, zoom: number, widthPx: number, heightPx: number,
): { latitudeDelta: number; longitudeDelta: number } {
    const longitudeDelta = Math.min(360, (360 * widthPx) / (TILE_PX * 2 ** zoom));
    const { y } = project(center.lat, center.lng, zoom);
    const north = unprojectLat(y - heightPx / 2, zoom);
    const south = unprojectLat(y + heightPx / 2, zoom);
    return { latitudeDelta: Math.min(180, Math.max(0, north - south)), longitudeDelta };
}

/**
 * 矩形が余白つきで収まる中心とズームの段（Leaflet の `fitBounds` と同じ決め方）。
 * 1点だけ（幅0）の矩形は `maxZoom` まで寄る。
 */
export function fitView(
    b: { south: number; west: number; north: number; east: number },
    widthPx: number, heightPx: number, padding: number, maxZoom: number,
): { lat: number; lng: number; zoom: number } {
    const nw = project(b.north, b.west, 0);
    const se = project(b.south, b.east, 0);
    const dx = Math.abs(se.x - nw.x);
    const dy = Math.abs(se.y - nw.y);
    const w = Math.max(1, widthPx - 2 * padding);
    const h = Math.max(1, heightPx - 2 * padding);
    const fit = Math.min(dx > 0 ? Math.log2(w / dx) : Infinity, dy > 0 ? Math.log2(h / dy) : Infinity);
    const zoom = Math.min(maxZoom, fit);
    // 中心は写した座標の真ん中（緯度の平均ではない＝メルカトルで上下の余白がそろう）
    const midY = (nw.y + se.y) / 2;
    return { lat: unprojectLat(midY, 0), lng: (b.west + b.east) / 2, zoom };
}
