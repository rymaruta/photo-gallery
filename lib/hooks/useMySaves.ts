import { useMyPhotoIdList, type MyPhotoIdList } from "./useMyPhotoIdList";

/**
 * 自分が保存（ブックマーク）した写真のID一覧。
 *
 * サーバーは `saves#<uid>` に新しい順のIDを1行で持つ
 * （`api-user/src/saves.ts`）。引くのは GetItem 1回。
 *
 * **端末側（localStorage）の控えは持たない。** いいねの `useFavorites` は
 * 「未ログインでもハートが動く」ための仕組みだが、保存はログインしている
 * 人だけの機能なので、真値をサーバー1つに置く——2つ持つと、いいねが
 * 踏んだ「端末とサーバーで食い違う」をそのまま作り直すことになる。
 */
export type MySaves = MyPhotoIdList;

export function useMySaves(isAuthenticated: boolean, authLoading: boolean): MySaves {
    return useMyPhotoIdList("/user/saves", "保存した写真の一覧", isAuthenticated, authLoading);
}
