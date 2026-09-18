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
 * 末尾のゾーン指定子（`Z` / `+09:00`）を落として、キーを「書かれている
 * 数字」に揃える。
 *
 * **訂正（測って確かめた）**: 前のコミット（`9fd6ec3`）は「`Z` 付きと
 * 壁時計が混ざると順序が逆になる」と書いたが、**それは誤り**。
 * `sanitizeDate` が書く3形式（`YYYY-MM-DD` / ゾーン無し `T` 形式 /
 * `...Z`）とオフセット形を総当たり（36組）しても、**指定子を落として
 * 順序が変わる組は0件**だった——`Z` は文字列の末尾にあり、勝負は必ず
 * それより手前で付く。
 *
 * ではこれは何のために在るのか:
 *
 * 1. **同じ時刻を別々に書いた値を、同じキーにする。**
 *    `...T09:00:00+00:00` と `...T09:00:00Z` と `...T09:00:00` は
 *    キーが同じになり、決着は投稿日時（`tieBreak`）に回る。
 *    指定子を残すと、書き方の違いだけで前後が決まる。
 * 2. **表示と同じ成分で比べる。** 写真ページの表示（`splitStoredDate`）は
 *    指定子を無視して書かれた数字を出す。並びのキーも同じにしておくと、
 *    「表示は 00:00 なのに並びは 09:00 扱い」が起きない。
 *
 * **今のデータでは 1 も 2 も発火しない**（`sanitizeDate` はオフセット形を
 * 書かない）。`sanitizeDate` より前に書かれた行が DynamoDB に残っていた
 * 場合の備えで、実効は確かめていない。
 */
const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?$/i;

function stripZone(value: string): string {
    // **全体の形で見る。** 末尾だけを見る正規表現
    // （`/(?:Z|[+-]\d{2}:?\d{2})$/`）だと、`2024-2025` や `2024-1101` の
    // ような値の**日付そのものを食う**（`2024` になる）。今のデータには
    // 無い形だが、キーを作る関数が入力次第で桁を落とすのは危ない。
    return ISO_WITH_ZONE.exec(value)?.[1] ?? value;
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

/**
 * 古い順（昇順）。撮影日・投稿日の決着は新しい順の鏡だが、
 * **id だけは両方向とも昇順**（完全に同じ2枚を必ず同じ順に並べるための
 * 最後の砦で、向きに意味は無い）。
 */
export function compareOldest(a: Photo, b: Photo): number {
    const diff = cmp(photoTimeKey(a), photoTimeKey(b));
    return diff !== 0 ? diff : tieBreak(a, b, false);
}

/**
 * 管理画面（`/admin`）の並び。**キーの優先順位だけが違う**
 * ——撮影日 → **更新日** → 投稿日。
 *
 * 管理の一覧で探すのは「さっき直したやつ」なので、更新日を見る方が要る。
 * 一方で**比べ方（ゾーン指定子を落とす・文字列のまま比べる）は同じ**に
 * しておく。管理画面だけ `Date.parse` のまま残っていて、
 *
 * - `date: ""` が `??` を素通りして**投稿日にも更新日にも落ちない**
 *   （`??` が拾わないのは `null`/`undefined` だけ。実測: 空文字だと
 *   キーが 0 になり、更新日を持っていても最下段へ落ちていた）
 * - ゾーン無しの `T` 形式（EXIF 由来）が混ざると**閲覧者のタイムゾーンで
 *   順が入れ替わる**（実測: `2024-11-01T07:30:00` と `2024-11-01` が
 *   `TZ=Asia/Tokyo` と `TZ=UTC` で逆になる）
 *
 * の2つを持っていた。同じ写真がサイト側と管理側で違う順に見える入口。
 *
 * **同キーを id で決めない。** すぐ上の `tieBreak` が「id だけで決めると
 * 意味の無い順（UUID の大小）に固定される」と書いているのに、最初の版は
 * まさにそれを踏んでいた。実データで測ると、同じ `date: "2026-04-29"` の
 * 2枚が
 *
 *     compareAdmin（id 昇順）  木を覆う苔(07:30) → 白鳥と湖(13:25)
 *     サイト側 compareNewest   白鳥と湖(13:25) → 木を覆う苔(07:30)
 *
 * と**逆**になっていた。「同じ写真がサイトと管理で違う順に見える入口を
 * 塞ぐ」ためのコミットで、新しい入口を開けていたことになる。しかも
 * 旧実装（取得時 updatedAt 降順 + 安定ソート）とも逆で、この関数の
 * 存在理由（さっき直したやつを上に）とも逆だった。
 *
 * 決着は**最後に手を入れた順** → id。日付だけの `date` は珍しくないので、
 * 同じ日に撮った複数枚は全部この経路を通る。
 */
function adminTieBreak(a: Photo, b: Photo, newest: boolean): number {
    const touched = (p: Photo) => stripZone(String(p.updatedAt ?? p.createdAt ?? ""));
    const byTouched = newest ? cmp(touched(b), touched(a)) : cmp(touched(a), touched(b));
    if (byTouched !== 0) return byTouched;
    return cmp(String(a.id ?? ""), String(b.id ?? ""));
}

export function compareAdmin(a: Photo, b: Photo, newest: boolean): number {
    const key = (p: Photo) => stripZone((p.date || p.updatedAt || p.createdAt || "").toString());
    const diff = newest ? cmp(key(b), key(a)) : cmp(key(a), key(b));
    return diff !== 0 ? diff : adminTieBreak(a, b, newest);
}

/** 新しい順に並べた**新しい配列**を返す（引数は変えない）。 */
export function sortByNewest<T extends Photo>(photos: readonly T[]): T[] {
    return [...photos].sort(compareNewest);
}

/**
 * **投稿の新しい順**（タイムライン用）。撮影日は見ない。
 *
 * `compareNewest` は `date || createdAt` で並べる——一覧では「いつ撮ったか」が
 * 主役だから正しい。だがタイムラインは「フォローした人が**いま何を上げたか**」
 * を流す面で、2019年に撮った写真を今日上げたなら**今日の位置**に出ないと
 * 流れてこない（撮影日で並べると、古い旅の写真ほど下に沈んで誰にも見えない）。
 * `createdAt` を持たない古い行だけ `date` に落とす。同じ時刻は id で必ず決める。
 */
export function comparePosted(a: Photo, b: Photo): number {
    const ka = stripZone(String(a.createdAt || a.date || ""));
    const kb = stripZone(String(b.createdAt || b.date || ""));
    const diff = cmp(kb, ka);
    return diff !== 0 ? diff : cmp(String(a.id ?? ""), String(b.id ?? ""));
}
