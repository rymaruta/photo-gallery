import { useCallback, useEffect, useRef, useState } from "react";
import { useFavorites } from "./useFavorites";
import { publicFetch, userFetch } from "../utils/api";
import { log } from "../utils/log";

// 写真の「いいね」。ハート1つで2つの役割を担う:
//   - liked（塗りつぶし状態）と /favorites への収集 … 端末ローカル（useFavorites）
//   - likes（全員に見える数）… サーバー（ユーザーAPI）
//
// 未ログインでもローカルのお気に入りは動くが、サーバーカウントは
// 認証済みのときだけ増減する（userFetch が失敗しても UI は壊さない）。
export function usePhotoLikes(photoId: string, initialLikes: number, isAuthenticated: boolean) {
    const { isFavorite, toggleFavorite } = useFavorites();
    const liked = isFavorite(photoId);
    const [count, setCount] = useState(initialLikes);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 最新のサーバーカウントを取得（表示のため）
    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await publicFetch(`/photos/${encodeURIComponent(photoId)}/like`, { signal: controller.signal });
                if (!res.ok) return;
                const data = await res.json() as { likes?: number };
                if (!aborted && typeof data.likes === "number") setCount(data.likes);
            } catch { /* 初期値のまま */ }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId]);

    const toggle = useCallback(async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setPending(true);

        const wasLiked = liked;
        // 楽観更新: ローカルのお気に入りとカウントを即時反映
        toggleFavorite(photoId);
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
                toggleFavorite(photoId);
                setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
            }
        } catch (e) {
            log.warn("like toggle error:", e);
            toggleFavorite(photoId);
            setCount((c) => Math.max(0, c + (wasLiked ? 1 : -1)));
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [liked, photoId, isAuthenticated, toggleFavorite]);

    return { liked, count, pending, toggle };
}
