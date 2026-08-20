import { useCallback, useEffect, useRef, useState } from "react";
import { userPublicFetch, userFetch } from "../utils/api";
import { log } from "../utils/log";

// 写真コメント。公開読み取り + 認証投稿/削除。楽観更新は最小限（投稿は成功後に反映）。

export type CommentItem = {
    id: string;
    uid: string;
    name: string;
    text: string;
    t: string;
};

export function useComments(photoId: string, isAuthenticated: boolean, initialCount = 0) {
    const [items, setItems] = useState<CommentItem[]>([]);
    const [count, setCount] = useState(initialCount);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    // 直近の投稿が断られた理由（サーバーの文言をそのまま出す）
    const [lastError, setLastError] = useState<string | null>(null);
    const busyRef = useRef(false);

    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userPublicFetch(`/photos/${encodeURIComponent(photoId)}/comments`, { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json() as { items?: CommentItem[]; count?: number };
                    if (!aborted) {
                        setItems(Array.isArray(data.items) ? data.items : []);
                        if (typeof data.count === "number") setCount(data.count);
                    }
                }
            } catch { /* 表示は空のまま */ } finally {
                if (!aborted) setLoading(false);
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId]);

    /**
 * 投稿の結果。`error` のときは `lastError` に理由が入る。
 *
 * サーバーは断る理由を日本語で返している（「同じ写真へのコメントは
 * 10件までです」など）が、本文を捨てて「投稿に失敗しました」とだけ
 * 出していたので、利用者は障害だと思って何度も送り直していた
 * （そのたびに写真と200件のコメント文書を読み直す）。
 */
    const add = useCallback(async (text: string): Promise<"ok" | "auth-required" | "empty" | "error"> => {
        const trimmed = text.trim().slice(0, 500);
        if (!trimmed) return "empty";
        if (!isAuthenticated) return "auth-required";
        if (busyRef.current) return "error";
        busyRef.current = true;
        setPending(true);
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/comments`, {
                method: "POST",
                body: JSON.stringify({ text: trimmed }),
            });
            if (!res.ok) {
                const { readApiError } = await import("../utils/api");
                setLastError(await readApiError(res, "投稿に失敗しました"));
                return "error";
            }
            setLastError(null);
            const data = await res.json() as { comment?: CommentItem };
            if (data.comment) {
                setItems((prev) => [data.comment as CommentItem, ...prev]);
                setCount((c) => c + 1);
            }
            return "ok";
        } catch (e) {
            log.error("comment add error:", e);
            return "error";
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [photoId, isAuthenticated]);

    const remove = useCallback(async (commentId: string): Promise<boolean> => {
        // 楽観削除 + 失敗時ロールバック。
        // 件数は「元の件数」を覚えて戻す。items.length で戻していた頃は、
        // 表示件数（上限200）と実際の件数がずれている写真で、削除に失敗した
        // 瞬間にヘッダーの件数が 200 に書き換わり、再読込まで直らなかった。
        const prevItems = items;
        const prevCount = count;
        setItems((prev) => prev.filter((c) => c.id !== commentId));
        setCount((c) => Math.max(0, c - 1));
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error(String(res.status));
            return true;
        } catch (e) {
            log.error("comment delete error:", e);
            setItems(prevItems);
            setCount(prevCount);
            return false;
        }
    }, [photoId, items, count]);

    return { items, count, loading, pending, lastError, add, remove };
}
