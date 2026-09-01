// 位置情報の計算。
//
// **もとは「足あと再生」（地図の再生UI）用のロジックだったが、その画面は
// 削除済み**で、残っていた `buildJourneyPoints` / `JourneyPoint` は
// **テストからしか呼ばれていなかった**（`grep` で確認）。死にコードは
// 規則が静かにずれる——実際、並びの規則をサイト全体で1本化した
// （`lib/utils/photoOrder.ts`）ときも、ここだけ `Date.parse` のまま
// 取り残されていた。使うときは git の履歴から戻せる。
//
// いま残っているのは、プロフィールの「旅した総移動距離」が使う
// 大円距離の計算だけ。

/** 2点間の大円距離（km）。移動距離の積算に使う。 */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
