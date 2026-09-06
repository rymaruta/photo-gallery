/**
 * 地図ページ（/map）のピンの束ね方。**ライブラリを足さずに**格子で束ねる。
 *
 * 写真は数十枚で、束ねの目的は「同じ街の写真が重なって押せない」を
 * 防ぐことだけ。`leaflet.markercluster` を足すと依存が1つ増えるうえ、
 * その挙動（アニメーション・蜘蛛の巣状の展開）は今のサイトには過剰。
 * ズームごとに Web メルカトルのピクセル座標へ写し、`cellPx` 四方の格子で
 * 同じ升に入ったものを1つにする——それだけ。
 *
 * **純関数**にしてあるのは、Leaflet を jsdom で動かさずに束ね方だけを
 * テストするため（Leaflet は `window` に依存し、描画側は別に見る）。
 */

export type GeoPoint = { id: string; lat: number; lng: number };

export type Cluster<T extends GeoPoint = GeoPoint> = {
    /** 束の中心（メンバーの平均） */
    lat: number;
    lng: number;
    items: T[];
};

const TILE_PX = 256;

/** 緯度経度 → そのズームでの Web メルカトルのピクセル座標 */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const scale = TILE_PX * 2 ** zoom;
    // 緯度は ±85.05° で頭打ち（メルカトルの定義域）
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sin = Math.sin((clamped * Math.PI) / 180);
    const x = ((lng + 180) / 360) * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    return { x, y };
}

/**
 * 同じ升に入った点を1つに束ねる。
 *
 * @param points  位置を持つ点（`lat`/`lng` は有限であること。呼び出し側で除く）
 * @param zoom    今のズーム（整数でなくてよい）
 * @param cellPx  升の一辺（px）。ピンの大きさより少し大きく
 */
export function clusterPoints<T extends GeoPoint>(points: readonly T[], zoom: number, cellPx = 56): Cluster<T>[] {
    if (cellPx <= 0) throw new RangeError(`cellPx must be positive: ${cellPx}`);
    const cells = new Map<string, T[]>();
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const { x, y } = project(p.lat, p.lng, zoom);
        const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(p);
        else cells.set(key, [p]);
    }
    const out: Cluster<T>[] = [];
    for (const items of cells.values()) {
        let lat = 0, lng = 0;
        for (const p of items) { lat += p.lat; lng += p.lng; }
        out.push({ lat: lat / items.length, lng: lng / items.length, items });
    }
    // 描画順を安定させる（Map の順は挿入順＝入力順に依存する）
    out.sort((a, b) => (a.lat - b.lat) || (a.lng - b.lng));
    return out;
}

/** 全部が入る矩形。点が無ければ null */
export function boundsOf(points: readonly GeoPoint[]): { south: number; west: number; north: number; east: number } | null {
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        south = Math.min(south, p.lat); north = Math.max(north, p.lat);
        west = Math.min(west, p.lng); east = Math.max(east, p.lng);
    }
    if (!Number.isFinite(south)) return null;
    return { south, west, north, east };
}
