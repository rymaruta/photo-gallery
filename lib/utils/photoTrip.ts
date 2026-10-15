// lib/utils/photoTrip.ts
//
// **写真から、次の旅へ**（写真の詳細の「NEXT TRIP · 次の旅へ」の段・2026-10-15）。
//
// アプリ（journey.photo-ios の `PhotoTrip.swift`）と同じ考えを Web に移したもの。
// 画面（`app/photo/[id]/PhotoPageClient.tsx`）の判断をここに集め、値で試せる形にする。
//
// **通信しない。** 光の時刻は座標と日付から端末で計算する（`sunTimes.ts`）。
// API は1行も変えていない。

import { sunTimes, clockIn, todayIn } from "./sunTimes";
import { ROUTES } from "../routes";

type Coords = { lat: number; lng: number };

const finite = (c: Coords | null | undefined): c is Coords =>
    !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

/**
 * 写真の撮影地が**日本の中**とおおよそ言えるか（光の時刻を「日本の時計」で言ってよいか）。
 *
 * 写真は台帳のスポットと違って時刻帯を持たない。**時刻帯が分からない土地では時刻を出さない**
 * （`sunTimes.ts` の `timeZoneForCountry` と同じ立場——推測で時計を決めない）。日本だけは
 * 時刻帯が1つなので、座標が日本の範囲にあれば `Asia/Tokyo` で言える。
 *
 * 範囲は粗い箱（北緯24〜45.6°・東経122.9〜146°＝与那国島から根室まで）から、
 * **時計の違う隣の土地を外す**:
 *   - 北緯41.3°より北で東経139.3°より西（沿海州・中国東北部。北海道の西の端は 139.4° あたり）
 *   - 北緯38°より北で東経126°より西（遼寧の海沿い。中国は UTC+8）
 * 朝鮮半島の南は箱に入るが、時計は日本と同じ（UTC+9・夏時間なし）なので時刻は合う。
 * 台湾（東経122°より西）・上海は箱の外。
 */
export function isLikelyJapan(c: Coords | null | undefined): boolean {
    if (!finite(c)) return false;
    const { lat, lng } = c;
    if (lat < 24 || lat > 45.6 || lng < 122.9 || lng > 146) return false;
    if (lat > 41.3 && lng < 139.3) return false;
    if (lat > 38 && lng < 126) return false;
    return true;
}

/**
 * 光の時刻を言う時計（IANA の時刻帯）。分からなければ `null`（段に時刻を出さない）。
 *
 *  1. 写真が台帳のスポットに紐づいていて、そのスポットの時刻帯が分かれば、それ（サーバーで解いて渡す）
 *  2. 写真の座標が**正確**（`geoApprox` でない）で、日本の中なら `Asia/Tokyo`
 *  3. それ以外は `null`
 *
 * **おおよその座標（地名から引いた街の中心）では出さない**——地図のピンと同じ理由
 * （`PhotoPageClient` の `fallbackHref`）。
 */
export function photoLightZone(
    photo: { coords?: Coords | null; geoApprox?: boolean } | null | undefined,
    spotZone: string | null | undefined,
): string | null {
    if (spotZone) return spotZone;
    if (!photo || photo.geoApprox || !finite(photo.coords)) return null;
    return isLikelyJapan(photo.coords) ? "Asia/Tokyo" : null;
}

/** "YYYY-MM-DD" に日数を足す（暦の計算だけ。時刻帯は関わらない） */
export function addDays(ymd: string, days: number): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
    return d.toISOString().slice(0, 10);
}

export type NextGolden = {
    /** その土地の暦で、始まる日が今日か明日か */
    day: "today" | "tomorrow";
    /** その土地の時計の "HH:MM" */
    start: string;
    end: string;
    /** 見ている端末の時計と、その土地の時計が違う（「（現地）」と添える） */
    local: boolean;
};

/**
 * **次のゴールデンアワー**（アプリの `PhotoTrip.nextGolden` と同じ考え）。
 *
 * 今日の朝・夕、無ければ明日の朝・夕のうち、**まだ終わっていない最初のもの**。
 * 今まさにゴールデンアワーの最中なら、それを「今日」として出す。
 *
 * 🔴 **「今日・明日」は、始まる時刻をその土地の暦で見て決める。** `sunTimes` の日付は経度で
 * 決まる太陽の日なので、経度と時刻帯が日付変更線をまたぐ土地では、その土地の「今日」の日付で
 * 計算した朝が翌朝になる。前後の日も計算して、最も早いものを選ぶ（アプリと同じ・トンガの試験）。
 *
 * 白夜・極夜で太陽がその高さを通らない日は飛ばす。明後日以降しか無ければ `null`（行ごと出さない）。
 *
 * @param deviceZone 見ている端末の時刻帯（試験で固定できるように受け取る）
 */
export function nextGoldenHour(
    coords: Coords | null | undefined,
    zone: string | null | undefined,
    now: Date,
    deviceZone?: string,
): NextGolden | null {
    if (!finite(coords) || !zone) return null;
    const today = todayIn(zone, now);
    if (!today) return null;
    const tomorrow = addDays(today, 1);
    const spans: { start: Date; end: Date }[] = [];
    for (let offset = -1; offset <= 2; offset++) {
        const ymd = addDays(today, offset);
        const times = ymd ? sunTimes(ymd, coords) : null;
        if (!times) continue;
        for (const span of [times.morningGolden, times.eveningGolden]) {
            if (!span.start || !span.end) continue;
            if (span.end.getTime() <= now.getTime()) continue;
            spans.push({ start: span.start, end: span.end });
        }
    }
    if (spans.length === 0) return null;
    const next = spans.reduce((a, b) => (b.start.getTime() < a.start.getTime() ? b : a));
    const startDay = todayIn(zone, next.start);
    const start = clockIn(zone, next.start);
    const end = clockIn(zone, next.end);
    if (!startDay || !start || !end) return null;
    let day: NextGolden["day"];
    if (startDay <= today) day = "today";
    else if (startDay === tomorrow) day = "tomorrow";
    else return null;
    // 端末の時計で同じ時刻・同じ日に見えるなら「現地」と添えない
    const device = deviceZone ?? safeDeviceZone();
    const local = !!device && (clockIn(device, next.start) !== start || todayIn(device, next.start) !== startDay);
    return { day, start, end, local };
}

function safeDeviceZone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

/**
 * 「次のゴールデンアワー · 明日」と「16:12–16:48（現地）」（板 `PhotoDetail.dc.html` の1行）。
 * 時刻は画面が等幅の数字で太く出すので、2つに分けて返す
 */
export function goldenLineParts(g: NextGolden, isJa: boolean): { label: string; time: string } {
    const day = g.day === "today" ? (isJa ? "今日" : "today") : (isJa ? "明日" : "tomorrow");
    const local = g.local ? (isJa ? "（現地）" : " (local)") : "";
    return {
        label: isJa ? `次のゴールデンアワー · ${day}` : `Next golden hour · ${day}`,
        time: `${g.start}–${g.end}${local}`,
    };
}

/**
 * 経路（Google マップの経路の画面）。行き先だけ渡し、出発地は相手に任せる（現在地になる）。
 * **小数6桁より細かくは渡さない**（座標は約1km に丸めてある・`sanitizeCoords`）
 */
export function directionsUrl(c: Coords | null | undefined): string | null {
    if (!finite(c)) return null;
    const r = (n: number) => Number(n.toFixed(6));
    return `https://www.google.com/maps/dir/?api=1&destination=${r(c.lat)},${r(c.lng)}`;
}

/**
 * 経路の行き先。**台帳のスポットの座標が先**（被写体の場所）、無ければ写真の**正確な**座標。
 * おおよその座標（地名から引いた街の中心）には経路を出さない——そこへ案内しても撮った場所ではない
 */
export function directionsTarget(
    photo: { coords?: Coords | null; geoApprox?: boolean } | null | undefined,
    spotCoords: Coords | null | undefined,
): Coords | null {
    if (finite(spotCoords)) return spotCoords;
    if (!photo || photo.geoApprox || !finite(photo.coords)) return null;
    return photo.coords;
}

/**
 * 「この写真を見て撮りに行く」の行き先（投稿画面に元の写真を渡す）。
 * **受け側（投稿画面が `inspiredBy` を読む）は別の担当。** ここはリンクを作るだけ
 */
export function inspiredUploadHref(photoId: string): string {
    return `${ROUTES.UPLOAD}?inspiredBy=${encodeURIComponent(photoId)}`;
}

/**
 * 「この写真を見て撮りに行く」を出すか。**公開の写真で、自分の写真ではないとき**だけ
 * （自分の写真を見て撮りに行く、は言い方として成り立たない）
 */
export function offersInspiredShoot(
    photo: { id?: string; published?: boolean; userId?: string } | null | undefined,
    viewerId: string | null | undefined,
): boolean {
    if (!photo?.id || photo.published === false) return false;
    return !(viewerId && photo.userId && viewerId === photo.userId);
}
