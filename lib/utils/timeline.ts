import type { Photo } from "@/lib/data/photos";
import { comparePosted } from "./photoOrder";

/**
 * トップの「フォロー中」タブ（`TimelineFeed`）に流す写真。
 *
 * owner の「今だと自分のとフォローしてる人の混ざってるみたいな感じになって
 * しまう。インスタみたいに投稿タブがあって、そこにタイムラインで流れてくる
 * みたいのがいい」への答え。
 *
 * - **フォローしている人の写真だけ**（`followingIds` に `userId` がある行）。
 *   自分の写真は入らない——自分はフォローできない（サーバーが 400）ので
 *   集合に自分の id は無く、自分の投稿はマイページが持ち場
 * - 公開されているものだけ（`published !== false`。`/photos` は公開分しか
 *   返さないが、静的スナップショットと混ざる経路なので念のため）
 * - **投稿の新しい順**（`comparePosted`。撮影日ではない——理由はそちら）
 *
 * 誰もフォローしていなければ空（`has()` が全部落とす。早期 return は置かない
 * ——置いても答えが変わらず、変異で観測できない二重の守りになる）。
 * 引数の配列は変えない。
 */
export function timelinePhotos<T extends Photo>(
    photos: readonly T[],
    followingIds: ReadonlySet<string>,
): T[] {
    return photos
        .filter((p) => !!p.userId && followingIds.has(p.userId) && p.published !== false)
        .sort(comparePosted);
}
