import type { Photo } from "@/lib/data/photos";
import { compareAdmin } from "@/lib/utils/photoOrder";

export type AdminStatus = "all" | "published" | "draft";
export type AdminSort = "new" | "old";

// 検索対象のテキスト（タイトル・場所・カテゴリ・タグ）を1本の文字列にする
export function photoSearchText(p: Photo): string {
    const title = typeof p.title === "string" ? p.title : [p.title?.ja, p.title?.en].filter(Boolean).join(" ");
    return [title, p.location, p.category, ...(p.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
}

/**
 * 管理画面の一覧に出す写真を決める（絞り込み → 並べ替え）。
 *
 * **画面の中に置いたままだと、誰も並びの向きを確かめられない。**
 * `app/admin/page.tsx` は認証・API・トーストが絡んで単体で描けないので、
 * 「`compareAdmin` を呼んでいる」という**綴りを見るガード**しか書けず、
 * 実際に `sort === "new"` を `sort !== "new"` に取り違えても全テストが
 * 緑のままだった（＝「新しい順」ボタンが古い順に並べても気づけない）。
 * ここに出して、向きごと確かめられるようにする。
 */
export function selectVisiblePhotos(
    photos: readonly Photo[],
    opts: { query: string; status: AdminStatus; sort: AdminSort },
): Photo[] {
    const q = opts.query.trim().toLowerCase();
    const filtered = photos.filter((p) => {
        if (opts.status === "published" && p.published === false) return false;
        if (opts.status === "draft" && p.published !== false) return false;
        if (!q) return true;
        return photoSearchText(p).includes(q);
    });
    return [...filtered].sort((a, b) => compareAdmin(a, b, opts.sort === "new"));
}
