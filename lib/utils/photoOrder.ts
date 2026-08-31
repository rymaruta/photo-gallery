import type { Photo } from "../data/photos";

/**
 * 写真の並び順を、サイト全体で1か所に決める。
 *
 * **同じ集合が、見る場所で違う順に出ていた。** 実データ30枚での実測:
 *
 * | 場所 | 使っていた規則 | `#風景` の3枚 |
 * |---|---|---|
 * | `/tag/風景`（集約ページ） | 並べ替えなし＝入力配列の順（`createdAt` 降順） | 秋のグラデーション → 紅白 → 森の呼吸 |
 * | `/?tags=風景`（ホーム） | `date \|\| createdAt` 降順 | 森の呼吸 → 秋のグラデーション → 紅白 |
 *
 * 30枚中28枚が別の位置に来る（`date` を持つ写真は撮影日と投稿日がずれるため）。
 * どちらも「新しい順」を名乗るので、利用者には「さっき上にあった写真が下にある」
 * としか見えない。
 *
 * ## 決めごと
 *
 * 1. **キーは `date`（撮影日）→ 無ければ `createdAt`（投稿日）。**
 *    ホーム・写真ページの前後・年表が既にこの優先順位なので、そちらに揃える。
 *
 * 2. **`new Date()` を通さない。** ゾーンの無い `2024-11-01T07:30:00` を
 *    JS は**ローカル時刻**として、日付だけの `2024-11-01` を **UTC** として
 *    解釈する——同じ配列の中で規則が混ざり、**並びが閲覧者のタイムゾーンで
 *    変わる**。実測（`date` が上の2つの写真）:
 *      TZ=Asia/Tokyo … `new Date()` 経由だと 日付だけ→時刻つき の順
 *      TZ=UTC        … 時刻つき→日付だけ の順（逆になる）
 *    静的HTMLはビルド時（UTC）の順で焼かれるので、JST の閲覧者では
 *    ハイドレーションの前後で並びが変わることになる。
 *    `YYYY-MM-DD[THH:MM:SS]` は**辞書順がそのまま時系列順**なので、
 *    文字列のまま比べれば解釈は要らない。
 *    （EXIF 由来の `date` は `exifWallClock` がゾーン無しの `T` 形式で送る。
 *      現データ30件にはまだ1件も無いが、`3c81c6d` 以降の写真から入る。）
 *
 * 3. **キーが同じなら id で決める。** `Array#sort` は安定だが、安定なのは
 *    「入力の順を保つ」ことであって、**入力の順は面ごとに違う**。同じ日付の
 *    2枚が、ホームと集約ページで前後入れ替わるのはそのため。
 */
export function photoTimeKey(p: Pick<Photo, "date" | "createdAt">): string {
    return (p.date || p.createdAt || "").toString();
}

/** 新しい順（降順）。同じキーは id の昇順で必ず決める。 */
export function compareNewest(a: Photo, b: Photo): number {
    const diff = photoTimeKey(b).localeCompare(photoTimeKey(a));
    return diff !== 0 ? diff : (a.id ?? "").localeCompare(b.id ?? "");
}

/** 古い順（昇順）。同じキーの決め方は新しい順と揃える。 */
export function compareOldest(a: Photo, b: Photo): number {
    const diff = photoTimeKey(a).localeCompare(photoTimeKey(b));
    return diff !== 0 ? diff : (a.id ?? "").localeCompare(b.id ?? "");
}

/** 新しい順に並べた**新しい配列**を返す（引数は変えない）。 */
export function sortByNewest<T extends Photo>(photos: readonly T[]): T[] {
    return [...photos].sort(compareNewest);
}
