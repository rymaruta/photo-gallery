/**
 * 撮影地マップのピンの決め方。**iOS のアプリ（`PhotoMapView`）と同じ決まり**にそろえる
 * （2026-10-28・owner:「iOS と同じに揃えたい」）。元の Swift は
 *
 *     写真のピン          `MapPin.group`（PhotoMapView.swift）
 *     多すぎるときの束    `MapPinClusters.layout`
 *     撮影スポットのピン  `OfficialPins.visible`
 *     最初に見せる範囲    `MapFraming.frame`
 *
 * で、ここはその写し。**数字（60本・0.5°・1.4倍・0.08°…）も同じ**。片方だけ変えると
 * 同じ写真の地図が Web とアプリで違って見えるので、変えるときは両方を直す。
 *
 * 画面を持たない純関数にしてあるのは、地図を動かさずに決め方だけを確かめるため。
 */

/** 表示範囲（中心と経緯度の幅・度）。iOS の `MapFraming.Frame` と同じ形 */
export type Frame = { lat: number; lng: number; latSpan: number; lngSpan: number };

/* ───────── 写真のピン（同じ座標の写真を1本に） ───────── */

export type PinPhoto = { id: string; coords: { lat: number; lng: number }; location?: string | null };

export type MapPin<P extends PinPhoto = PinPhoto> = {
    /** 座標を文字にしたもの（座標は約1km に丸めてあるので、そのまま鍵にできる） */
    id: string;
    lat: number;
    lng: number;
    /** 撮影地の文字列。**無ければ null**（iOS は仮の語「撮影地」を入れて `hasPlaceName` で見分ける） */
    place: string | null;
    photos: P[];
};

/** 同じ座標の写真をまとめる（`MapPin.group`）。並びは id 順 */
export function groupPins<P extends PinPhoto>(photos: readonly P[]): MapPin<P>[] {
    const buckets = new Map<string, P[]>();
    for (const p of photos) {
        const { lat, lng } = p.coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const key = `${lat},${lng}`;
        const b = buckets.get(key);
        if (b) b.push(p); else buckets.set(key, [p]);
    }
    const out: MapPin<P>[] = [];
    for (const [id, ps] of buckets) {
        const named = ps.find((p) => (p.location ?? "").trim() !== "");
        out.push({ id, lat: ps[0].coords.lat, lng: ps[0].coords.lng, place: named ? named.location!.trim() : null, photos: ps });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ───────── 多すぎるときだけ束ねる ───────── */

/** 一度に置く印の上限（撮影スポットと同じ） */
export const PIN_LIMIT = 60;
/** 枠のまわりに足す幅（枠の幅に対する割合・片側） */
const MARGIN = 0.5;
/** 枠の長い辺を何升に割るところから始めるか */
const GRID_DIVISIONS = 8;

export type PinCluster<P extends PinPhoto = PinPhoto> = {
    id: string;
    lat: number;
    lng: number;
    /** 束ねた撮影地（写真の多い順） */
    pins: MapPin<P>[];
};

export type PinLayout<P extends PinPhoto = PinPhoto> = { pins: MapPin<P>[]; clusters: PinCluster<P>[] };

export const clusterPhotoCount = (c: PinCluster): number => c.pins.reduce((n, p) => n + p.photos.length, 0);

/** 印に出す1枚（いちばん写真の多い撮影地の先頭） */
export const clusterCover = <P extends PinPhoto>(c: PinCluster<P>): P | undefined => c.pins[0]?.photos[0];

/** 押したときに寄る枠（束の全部が入る矩形 × 余白・最小の幅つき） */
export function clusterFrame(c: PinCluster): Frame {
    const lats = c.pins.map((p) => p.lat), lngs = c.pins.map((p) => p.lng);
    const south = Math.min(...lats), north = Math.max(...lats);
    const west = Math.min(...lngs), east = Math.max(...lngs);
    return {
        lat: (south + north) / 2, lng: (west + east) / 2,
        latSpan: Math.max((north - south) * FRAME_PADDING, MINIMUM_SPAN),
        lngSpan: Math.max((east - west) * FRAME_PADDING, MINIMUM_SPAN),
    };
}

/** 枠として使えるか（幅0・数でない枠は「まだ枠が無い」と同じ扱い） */
export function usableFrame(f: Frame | null | undefined): Frame | null {
    if (!f) return null;
    const ok = [f.lat, f.lng, f.latSpan, f.lngSpan].every(Number.isFinite) && f.latSpan > 0 && f.lngSpan > 0;
    return ok ? f : null;
}

export function frameContains(f: Frame, lat: number, lng: number): boolean {
    return Math.abs(lat - f.lat) <= f.latSpan / 2 && Math.abs(lng - f.lng) <= f.lngSpan / 2;
}

/**
 * 地図に置くもの（`MapPinClusters.layout`）。
 *
 * - 全部で `limit` 本以下なら**そのまま**（枠を見ない——動かしても描き直さない）
 * - 超えたら、見えている枠（周りに半分ずつ足す）の中だけを置く。それでも超えたら
 *   **世界に固定した格子**（2 の冪の度）で同じ升のピンを1つの束にし、`limit` 以下に
 *   なるまで升を倍にする
 */
export function layoutPins<P extends PinPhoto>(pins: readonly MapPin<P>[], frame: Frame | null, limit = PIN_LIMIT): PinLayout<P> {
    if (pins.length <= limit || limit <= 0) return { pins: [...pins], clusters: [] };
    const f = usableFrame(frame);
    let area: Frame;
    let inArea: MapPin<P>[];
    if (f) {
        area = { lat: f.lat, lng: f.lng, latSpan: f.latSpan * (1 + 2 * MARGIN), lngSpan: f.lngSpan * (1 + 2 * MARGIN) };
        inArea = pins.filter((p) => frameContains(area, p.lat, p.lng));
    } else {
        const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
        const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lngs), e = Math.max(...lngs);
        area = { lat: (s + n) / 2, lng: (w + e) / 2, latSpan: n - s, lngSpan: e - w };
        inArea = [...pins];
    }
    if (inArea.length <= limit) return { pins: inArea, clusters: [] };

    const longest = Math.max(area.latSpan, area.lngSpan, 1e-6);
    let cell = 2 ** Math.floor(Math.log2(longest / GRID_DIVISIONS));
    let cells = group(inArea, cell);
    let rounds = 0;
    while (cells.size > limit && rounds < 32) {
        cell *= 2;
        cells = group(inArea, cell);
        rounds++;
    }
    const out: PinLayout<P> = { pins: [], clusters: [] };
    for (const [key, members] of cells) {
        if (members.length === 1) { out.pins.push(members[0]); continue; }
        const ordered = [...members].sort((a, b) =>
            a.photos.length !== b.photos.length ? b.photos.length - a.photos.length : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        // 束の位置は写真の枚数で重みを付けた中心（写真の多い撮影地に寄る）
        let total = 0, lat = 0, lng = 0;
        for (const p of ordered) {
            const w = Math.max(p.photos.length, 1);
            total += w; lat += p.lat * w; lng += p.lng * w;
        }
        out.clusters.push({ id: `cluster:${cell}:${key}`, lat: lat / total, lng: lng / total, pins: ordered });
    }
    out.pins.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.clusters.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}

/**
 * 選んでいるピンが**結果には居るのに地図に置かれていない**（束に吸われた・枠の外）か。
 * true なら選びを外す。結果から外れたピン（絞り込み）は false——選びを持ち続ける（iOS と同じ）
 */
export function layoutHides(layout: PinLayout, selectedPinId: string | null, resultIds: ReadonlySet<string>): boolean {
    if (!selectedPinId || !resultIds.has(selectedPinId)) return false;
    return !layout.pins.some((p) => p.id === selectedPinId);
}

function group<P extends PinPhoto>(pins: readonly MapPin<P>[], cell: number): Map<string, MapPin<P>[]> {
    const buckets = new Map<string, MapPin<P>[]>();
    for (const p of pins) {
        const key = `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
        const b = buckets.get(key);
        if (b) b.push(p); else buckets.set(key, [p]);
    }
    return buckets;
}

/* ───────── 撮影スポットのピン ───────── */

/** これより引いているときは置かない（緯度の幅・度。約55km） */
export const SPOT_MAX_LAT_SPAN = 0.5;

/** 2点の距離（km）。地図の上の「近い順」に使うだけなので、球面の大円で足りる */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 地図に置く撮影スポット（`OfficialPins.visible`）。**1,000件を常に置かない。**
 *
 * - **名前で絞っているとき**は倍率に関係なく、当たったもの（`spots` に渡ってきたもの）を
 *   枠の中を先に・中心から近い順で最大 `limit` 本
 * - そうでなければ**寄せたとき**（緯度の幅 0.5° 未満）だけ、枠の中を中心に近い順に最大 `limit` 本
 * - 枠が無ければ置かない（名前で絞っているときは渡ってきた順のまま）
 */
export function visibleSpots<S extends { slug: string; lat: number; lng: number }>(
    spots: readonly S[], frame: Frame | null, opts: { queryActive: boolean; limit?: number },
): S[] {
    const limit = opts.limit ?? PIN_LIMIT;
    const f = usableFrame(frame);
    const usable = spots.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const bySlug = (a: S, b: S) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    if (opts.queryActive) {
        if (!f) return usable.slice(0, limit);
        const center = { lat: f.lat, lng: f.lng };
        return usable
            .map((s) => ({ s, inside: frameContains(f, s.lat, s.lng), d: distanceKm(center, s) }))
            .sort((a, b) => (a.inside !== b.inside ? (a.inside ? -1 : 1) : a.d !== b.d ? a.d - b.d : bySlug(a.s, b.s)))
            .slice(0, limit)
            .map((x) => x.s);
    }
    if (!f || f.latSpan >= SPOT_MAX_LAT_SPAN) return [];
    const center = { lat: f.lat, lng: f.lng };
    return usable
        .filter((s) => frameContains(f, s.lat, s.lng))
        .map((s) => ({ s, d: distanceKm(center, s) }))
        .sort((a, b) => (a.d !== b.d ? a.d - b.d : bySlug(a.s, b.s)))
        .slice(0, limit)
        .map((x) => x.s);
}

/* ───────── 最初に見せる範囲 ───────── */

/** 同じ塊と見なす距離（度）。約300km */
const CLUSTER_DEGREES = 2.7;
/** 余白（枠ぴったりだと端のピンが画面の縁に貼り付く） */
export const FRAME_PADDING = 1.4;
/** いちばん狭いときの幅（度）。1点しか無いときに地面まで寄りすぎない */
export const MINIMUM_SPAN = 0.08;

type Pt = { lat: number; lng: number };

/**
 * 最初に見せる範囲（`MapFraming.frame`）。**いちばん写真の多い塊に寄せる**——
 * 全部を収める枠は、日本とヨーロッパの写真があると地球儀の縮尺になり、1枚も探せない。
 * `weights` は点ごとの写真の枚数。点が無ければ null。
 */
export function frameForPoints(points: readonly Pt[], weights?: readonly number[]): Frame | null {
    const cluster = largestCluster(points, weights);
    if (cluster.length === 0) return null;
    const lats = cluster.map((p) => p.lat), lngs = cluster.map((p) => p.lng);
    const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lngs), e = Math.max(...lngs);
    return {
        lat: (s + n) / 2, lng: (w + e) / 2,
        latSpan: Math.max(MINIMUM_SPAN, (n - s) * FRAME_PADDING),
        lngSpan: Math.max(MINIMUM_SPAN, (e - w) * FRAME_PADDING),
    };
}

/**
 * いちばん重い（写真の多い）塊。同じ重さなら北、それも同じなら西（毎回同じ結果）。
 * 写真を約30km の升目に落とし、ある升を中心に上下左右 9升の窓に入る重さが最大の所を選ぶ。
 * 窓の重さは升目の累積和で引く（点の数と升目の数に比例する時間）。
 */
export function largestCluster(points: readonly Pt[], weights?: readonly number[]): Pt[] {
    const idx = points.map((_, i) => i).filter((i) => {
        const p = points[i];
        return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
    });
    if (idx.length === 0) return [];
    const pts = idx.map((i) => points[i]);
    const ws = idx.map((i) => Math.max(1, weights?.[i] ?? 1));
    const size = CLUSTER_DEGREES / 10;
    const reach = 9;
    const rows = squeezed(pts.map((p) => Math.floor(p.lat / size)), reach + 1);
    const cols = squeezed(pts.map((p) => Math.floor(p.lng / size)), reach + 1);
    const minRow = Math.min(...rows), minCol = Math.min(...cols);
    const height = Math.max(...rows) - minRow + 1, width = Math.max(...cols) - minCol + 1;
    const W = width + 1;
    const sum = new Float64Array((height + 1) * W);
    const at = (r: number, c: number) => r * W + c;
    pts.forEach((_, i) => { sum[at(rows[i] - minRow + 1, cols[i] - minCol + 1)] += ws[i]; });
    for (let r = 1; r <= height; r++) {
        for (let c = 1; c <= width; c++) sum[at(r, c)] += sum[at(r - 1, c)] + sum[at(r, c - 1)] - sum[at(r - 1, c - 1)];
    }
    const windowWeight = (row: number, col: number) => {
        const r0 = Math.max(0, row - reach), r1 = Math.min(height - 1, row + reach);
        const c0 = Math.max(0, col - reach), c1 = Math.min(width - 1, col + reach);
        return sum[at(r1 + 1, c1 + 1)] - sum[at(r0, c1 + 1)] - sum[at(r1 + 1, c0)] + sum[at(r0, c0)];
    };
    let best: { row: number; col: number; weight: number } | null = null;
    pts.forEach((_, i) => {
        const row = rows[i] - minRow, col = cols[i] - minCol;
        const total = windowWeight(row, col);
        if (best && !(total > best.weight
            || (total === best.weight && (row > best.row || (row === best.row && col < best.col))))) return;
        best = { row, col, weight: total };
    });
    const b = best as { row: number; col: number } | null;
    if (!b) return [];
    return pts
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => Math.abs(rows[i] - minRow - b.row) <= reach && Math.abs(cols[i] - minCol - b.col) <= reach)
        .sort((x, y) => y.p.lat - x.p.lat)
        .map(({ p }) => p);
}

/** 升の番号の並びを保ったまま、隣り合う値の間を `gap` までに詰める */
export function squeezed(values: readonly number[], gap: number): number[] {
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    const index = new Map<number, number>();
    let next = 0;
    distinct.forEach((v, i) => {
        if (i > 0) next += Math.min(gap, v - distinct[i - 1]);
        index.set(v, next);
    });
    return values.map((v) => index.get(v)!);
}
