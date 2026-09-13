import { categoryLabel } from "./collections";

/**
 * 一覧のサムネの下に出すカテゴリ名の地図（写真から作る分）。
 *
 * **鍵は写真が持っている値そのもの。** 読む側（`GalleryGrid`）は
 * `categoryDisplayMap?.[photo.category ?? ""]` と**生の値**で引き、
 * しかも**落とし先を持たない**ので、鍵が外れると**文字が丸ごと消える**。
 * 実際、鍵をスラッグに変えた回で `/favorites` のカテゴリ行が
 * 実データ30枚中9枚（風景4・自然2・建築2・建物1）で空欄になった
 * ——英語スラッグで保存した写真だけ出るので、**一覧の中で出る写真と
 * 出ない写真が混ざる**形だった。
 *
 * **名前を引くときだけスラッグにする。** `labels.category.names` は
 * スラッグで引く表なので、生の値で引くと別名（`建物`）が表に当たらず、
 * 飛び先の集約ページ（「建築の写真」）と違う言葉が出る。
 *
 * **名前の決め方は `categoryLabel`（`lib/utils/collections.ts`）1つ。**
 * 以前はここだけ落とし先が `capitalize(スラッグ)` だった——同じカテゴリが
 * 一覧では `Travel`、写真ページでは `travel` になり、`a0f59239` で潰した
 * 「同じ行き先に違う文言」を別の形で作っていた。しかも `capitalize` は
 * **後ろを小文字に潰す**ので `NYC` → `Nyc`・`new-york` → `New york` と
 * 本人が書いた言葉を書き換えてしまう。表に無いカテゴリは**生のまま**出す。
 *
 * @param names `app/i18n/labels.ts` の `category.names`（スラッグ → 表示名）
 */
export function photoCategoryMap(
    photos: ReadonlyArray<{ category?: string }>,
    names: Record<string, string>,
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const p of photos) {
        const raw = (p.category ?? "").toString().trim();
        if (!raw || map[raw]) continue;
        map[raw] = categoryLabel(raw, names);
    }
    return map;
}
