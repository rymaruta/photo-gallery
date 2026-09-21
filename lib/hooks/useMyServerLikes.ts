import { useMyPhotoIdList, type MyPhotoIdList } from "./useMyPhotoIdList";

/**
 * 自分がいいねした写真のID一覧（サーバー側）。
 *
 * ## なぜ要るか
 *
 * 「いいねした写真」のページは**この端末の localStorage しか見ていなかった**
 * （`useFavorites`）。スマホで押して PC で開くと0件で、しかも同じ写真の
 * ページは**マーカーを見る**ので「いいね済み」と出る——同じアカウントで
 * 画面どうしが食い違っていた（owner の報告）。
 *
 * サーバーは `likes#<uid>` に新しい順のIDを1行で持つ（`api-user/src/likes.ts`）。
 * 引くのは GetItem 1回。
 *
 * **中身は `useMyPhotoIdList` 1つ**——保存（`saves#<uid>`）が同じ形なので、
 * 写して2つ目を作らずに切り出した。「まだ／失敗／0件」を混ぜない扱いも
 * あちらに1つだけ置いてある。
 */
export type MyServerLikes = MyPhotoIdList;

export function useMyServerLikes(isAuthenticated: boolean, authLoading: boolean): MyServerLikes {
    return useMyPhotoIdList("/user/likes", "いいねした写真の一覧", isAuthenticated, authLoading);
}
