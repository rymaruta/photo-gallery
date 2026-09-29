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

/**
 * 距離の言い方（iOS の `NearbyPhotos.label` と同じ段の刻み）。
 * 1km 未満は「1km以内」（座標が約1kmに丸めてあるので、それより細かく言わない）、
 * 10km 未満は小数1桁、それ以上は整数。**数値でない・負なら空**（`NaNkm` を出さない）
 */
export function distanceLabel(km: number, isJa: boolean): string {
    if (!Number.isFinite(km) || km < 0) return "";
    if (km < 1) return isJa ? "1km以内" : "within 1 km";
    if (km < 10) return isJa ? `約${km.toFixed(1)}km` : `about ${km.toFixed(1)} km`;
    return isJa ? `約${Math.round(km)}km` : `about ${Math.round(km)} km`;
}

/**
 * 画面へ渡す距離を、**`distanceLabel` が見せる桁ちょうどに**丸める（HTML に焼く桁を減らす）。
 *
 * 🔴 **2回丸めない。** 以前は小数2桁に丸めてから `distanceLabel` がもう一度丸めていたので、
 * 6.445km が「約6.4km」→「約6.5km」、35.498km が「約35km」→「約36km」と変わった
 * （実データ 6,386 行中 98 行）。見せる桁で1回だけ丸めれば、`distanceLabel` の答えは
 * 丸める前と同じ——違うのは 9.95〜10km だけ（「約10.0km」→「約10km」）。
 * 1km 未満は「1km以内」としか言わないので、1 に届かないよう切り捨てる
 */
export function kmForLabel(km: number): number {
    if (!Number.isFinite(km) || km < 0) return km;
    if (km < 1) return Math.floor(km * 100) / 100;
    if (km < 10) return Number(km.toFixed(1));
    return Math.round(km);
}
