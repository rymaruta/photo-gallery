import { useCallback, useEffect, useRef, useState } from "react";
import { useFavorites } from "./useFavorites";
import { userPublicFetch, userFetch } from "../utils/api";
import { log } from "../utils/log";

// 写真の「いいね」。ハート1つで2つの役割を担う:
//   - liked（塗りつぶし状態）と /favorites への収集 … 端末ローカル（useFavorites）
//   - likes（全員に見える数）… サーバー（ユーザーAPI）
//
// 未ログインでもローカルのお気に入りは動くが、サーバーカウントは
// 認証済みのときだけ増減する（userFetch が失敗しても UI は壊さない）。
//
// authLoading は「まだログイン状態が分からない」期間。ここを見ないと、
// 共有リンクを開いた直後（セッション復元の往復中）に押したいいねが
// 「未ログイン」と判定されてローカル保存だけで終わり、サーバーには
// 何も送られない。リロードすると数が戻り、通知も飛ばない。
export function usePhotoLikes(
    photoId: string,
    initialLikes: number,
    isAuthenticated: boolean,
    authLoading = false,
) {
    const { isFavorite, toggleFavorite } = useFavorites();
    // サーバー側の「いいね済みか」。ログイン中だけ引く（未ログインは端末のみ）。
    //
    // 以前は端末のお気に入り（localStorage）だけで判断していた。
    // 未ログインでハートを押した状態のままログインすると、次の一押しが
    // DELETE になり「取り消し」として扱われる——投稿者にいいねも通知も
    // 届かないまま、押した本人は「押せた」と思っている。
    // 別の端末では逆に、いいね済みの写真が未いいねに見える。
    const [serverLiked, setServerLiked] = useState<boolean | null>(null);
    // 本人がもう押したあとかどうか。サーバーの初期値の到着が遅れると、
    // せっかく押したハートを古い値で上書きしてしまう。
    const touchedRef = useRef(false);
    const liked = serverLiked ?? isFavorite(photoId);
    const [count, setCount] = useState(initialLikes);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 最新のサーバーカウントを取得（表示のため）
    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userPublicFetch(`/photos/${encodeURIComponent(photoId)}/like`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { likes?: number };
                if (!aborted && typeof data.likes === "number") setCount(data.likes);
            } catch { /* 初期値のまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId]);

    // 写真が変わったら状態を捨てる。
    // モーダルは同じフックのまま次の写真へ進む（コンポーネントを作り直さない）ので、
    // これが無いと1枚目に付けたいいねが2枚目以降にも付いて見え、
    // しかも touchedRef が立ったままなので本当の状態を聞き直しても捨ててしまう。
    // 結果、2枚目のハートを押すと DELETE が飛んで「いいねが付かない」。
    useEffect(() => {
        touchedRef.current = false;
        setServerLiked(null);
    }, [photoId]);

    // ログイン中は自分のいいね状態をサーバーに聞く
    useEffect(() => {
        if (!isAuthenticated || authLoading || !photoId) { setServerLiked(null); return; }
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch(`/user/likes/${encodeURIComponent(photoId)}`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { liked?: boolean };
                if (!aborted && !touchedRef.current && typeof data.liked === "boolean") setServerLiked(data.liked);
            } catch { /* 端末のお気に入りのまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId, isAuthenticated, authLoading]);

    const toggle = useCallback(async () => {
        if (busyRef.current) return;
        // ログイン状態が確定するまで待つ。確定前に処理すると、ログイン済みでも
        // 「未ログイン」扱いになってサーバーへ届かない。
        if (authLoading) return;
        touchedRef.current = true;
        busyRef.current = true;
        setPending(true);

        const wasLiked = liked;
        // 楽観更新: ローカルのお気に入りとカウントを即時反映。
        //
        // お気に入り（/favorites への収集）はサーバーの状態とずれていることが
        // ある（未ログインで押した分・別端末で押した分）。押したあとの姿に
        // 合わせるので、既にその状態ならトグルしない。巻き戻しのために
        // 「実際に動かしたか」を覚えておく——巻き戻し時に現在値を読み直すと、
        // この関数が閉じ込めている古い値を見てしまい戻せない。
        const didToggleFavorite = isFavorite(photoId) !== !wasLiked;
        if (didToggleFavorite) toggleFavorite(photoId);
        setServerLiked(!wasLiked);
        setCount((c) => Math.max(0, c + (wasLiked ? -1 : 1)));

        if (!isAuthenticated) {
            // 未ログインはローカルのみ（サーバーカウントは動かさない）
            busyRef.current = false;
            setPending(false);
            return;
        }

        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/like`, {
                method: wasLiked ? "DELETE" : "POST",
            });
            if (res.ok) {
                const data = await res.json() as { likes?: number };
                if (typeof data.likes === "number") setCount(data.likes); // サーバーの真値で確定
            } else {
                // 失敗 → 楽観更新を巻き戻す
                if (didToggleFavorite) toggleFavorite(photoId);
                setServerLiked(wasLiked);
                setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
            }
        } catch (e) {
            log.warn("like toggle error:", e);
            if (didToggleFavorite) toggleFavorite(photoId);
            setServerLiked(wasLiked);
            setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [liked, photoId, isAuthenticated, authLoading, isFavorite, toggleFavorite]);

    return { liked, count, pending: pending || authLoading, toggle };
}
