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
/**
 * 末尾のゾーン指定子（`Z` / `+09:00`）を落とす。
 *
 * **保存されている `date` は1種類ではない。** `sanitizeDate`
 * （`api-user/src/sanitize.ts`）は日付だけ・ゾーン無しの `T` 形式は
 * そのまま保つが、**それ以外は `toISOString()` で `...Z` にして返す**。
 * 加えて、旧 `sanitizeDate` が日付だけの入力に付けていた
 * `T00:00:00.000Z` が既存データに残っている（`lib/utils/dateInput.ts`
 * にその記録がある）。
 *
 * 混ざったまま生文字列で比べると、**壁時計（その土地の時刻）と
 * 瞬間（UTC）を同じ物差しに載せる**ことになり、同じ日の中で順序が逆に
 * なる（`2024-11-01T00:00:00.000Z` は実際には `2024-11-01T07:30:00`＝
 * JST の朝より後）。
 *
 * ここでは**書かれている数字に揃える**。表示側（`splitStoredDate`）が
 * 指定子を無視して書かれた成分をそのまま出すので、並びと表示が一致する。
 * 逆に「本当の瞬間」に揃えると、表示と並びが食い違う方に倒れる。
 */
function stripZone(value: string): string {
    return value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "");
}

/** 文字列のコードポイント順。`localeCompare` は照合順（ICU）で、
 * `.` と `+` の重みが違うなど**辞書順とは一致しない**——この関数が
 * 前提にしているのは辞書順なので、素の比較を使う。 */
function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function photoTimeKey(p: Pick<Photo, "date" | "createdAt">): string {
    return stripZone((p.date || p.createdAt || "").toString());
}

/**
 * 同キーのときの決着。
 *
 * **id だけで決めると、意味の無い順（UUID の大小）に固定される。**
 * 実データ30枚で同キーになる唯一の組がまさにそれで、id 昇順にすると
 * 「その日いちばん新しく投稿した写真」が下に落ちていた（変更前のホームは
 * 安定ソートで投稿順を保っていた）。撮影日が同じなら**投稿が新しい方**を
 * 先に出す。id はそれも同じときの最後の砦。
 */
function tieBreak(a: Photo, b: Photo, newest: boolean): number {
    const ca = stripZone(String(a.createdAt ?? ""));
    const cb = stripZone(String(b.createdAt ?? ""));
    const byCreated = newest ? cmp(cb, ca) : cmp(ca, cb);
    if (byCreated !== 0) return byCreated;
    return cmp(String(a.id ?? ""), String(b.id ?? ""));
}

/** 新しい順（降順）。同じキーは投稿の新しい順 → id で必ず決める。 */
export function compareNewest(a: Photo, b: Photo): number {
    const diff = cmp(photoTimeKey(b), photoTimeKey(a));
    return diff !== 0 ? diff : tieBreak(a, b, true);
}

/** 古い順（昇順）。同じキーの決め方は新しい順と鏡合わせにする。 */
export function compareOldest(a: Photo, b: Photo): number {
    const diff = cmp(photoTimeKey(a), photoTimeKey(b));
    return diff !== 0 ? diff : tieBreak(a, b, false);
}

/** 新しい順に並べた**新しい配列**を返す（引数は変えない）。 */
export function sortByNewest<T extends Photo>(photos: readonly T[]): T[] {
    return [...photos].sort(compareNewest);
}
