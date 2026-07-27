import { useCallback, useEffect, useRef, useState } from "react";
import { publicFetch, userFetch } from "../utils/api";
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
    const busyRef = useRef(false);

    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await publicFetch(`/photos/${encodeURIComponent(photoId)}/comments`, { signal: controller.signal });
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
            if (!res.ok) throw new Error(String(res.status));
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
        // 楽観削除 + 失敗時ロールバック
        const prevItems = items;
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
            setCount(prevItems.length);
            return false;
        }
    }, [photoId, items]);

    return { items, count, loading, pending, add, remove };
}
