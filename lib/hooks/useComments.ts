import { useCallback, useEffect, useRef, useState } from "react";
import { userPublicFetch, userFetch, isGoneResponse } from "../utils/api";
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
    // 取得の失敗を「0件」と混ぜない。混ぜると、付いているコメントが
    // 「まだコメントがありません」に化けて消えたように見える
    // （admin 一覧・下書き一覧で直したのと同じ型）。再試行で立て直す。
    const [loadError, setLoadError] = useState(false);
    // 再試行のたびに増やして effect を回し直す
    const [reloadKey, setReloadKey] = useState(0);
    const busyRef = useRef(false);

    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        setLoadError(false);
        void (async () => {
            try {
                const res = await userPublicFetch(`/photos/${encodeURIComponent(photoId)}/comments`, { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json() as { items?: CommentItem[]; count?: number };
                    if (!aborted) {
                        setItems(Array.isArray(data.items) ? data.items : []);
                        if (typeof data.count === "number") setCount(data.count);
                    }
                } else if (!aborted) {
                    setLoadError(true);
                }
            } catch {
                if (!aborted) setLoadError(true);
            } finally {
                if (!aborted) setLoading(false);
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [photoId, reloadKey]);

    const reload = useCallback(() => {
        setLoading(true);
        setReloadKey((k) => k + 1);
    }, []);

    /**
 * 投稿の結果。`error` のときは `message` に理由が入る。
 *
 * サーバーは断る理由を日本語で返している（「同じ写真へのコメントは
 * 10件までです」など）が、本文を捨てて「投稿に失敗しました」とだけ
 * 出していたので、利用者は障害だと思って何度も送り直していた
 * （そのたびに写真と200件のコメント文書を読み直す）。
 *
 * 理由を state で渡してはいけない。呼び出し側は
 * `const r = await add(text)` の直後に読むので、その関数が作られた
 * 描画時点の値——つまり**1回前の理由**——を見てしまう。
 * 初回の 429 では null のまま「投稿に失敗しました」が出て、
 * 2回目にようやく1回目の文言が出る、という形で踏んでいた。
 * だから理由は戻り値だけで渡す。
 */
    type AddResult = { status: "ok" | "auth-required" | "empty" | "error"; message?: string };
    const add = useCallback(async (text: string): Promise<AddResult> => {
        const trimmed = text.trim().slice(0, 500);
        if (!trimmed) return { status: "empty" };
        if (!isAuthenticated) return { status: "auth-required" };
        if (busyRef.current) return { status: "error" };
        busyRef.current = true;
        setPending(true);
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/comments`, {
                method: "POST",
                body: JSON.stringify({ text: trimmed }),
            });
            if (!res.ok) {
                const { readApiError } = await import("../utils/api");
                return { status: "error", message: await readApiError(res, "投稿に失敗しました") };
            }
            const data = await res.json() as { comment?: CommentItem };
            if (data.comment) {
                setItems((prev) => [data.comment as CommentItem, ...prev]);
                setCount((c) => c + 1);
                // 一覧の取得失敗の表示が残っていると、投稿は成功したのに
                // 自分のコメントが画面に出ない（件数だけ増えて不審）。
                // 投稿できた＝疎通は生きているので、表示を一覧に戻す
                setLoadError(false);
            }
            return { status: "ok" };
        } catch (e) {
            log.error("comment add error:", e);
            // 通信そのものが落ちた場合も、前回の理由を残さない
            // （無関係な失敗に「10件までです」が出ていた）
            return { status: "error", message: "通信に失敗しました" };
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
            // **404 は成功として扱う。** 別のタブ（や写真オーナー）が先に
            // 消していると、サーバーは「コメントが見つかりません」を返す。
            // これを失敗と読んで巻き戻していたので、**消えたはずのコメントが
            // 一覧に戻り**、「削除できませんでした」と出て、何度押しても
            // 同じことが起きた（リロードするまで直らない）。
            // サーバー自身も、再試行の途中で消えた場合は成功扱いにしている
            // （api-user/src/comments.ts の gone）。入口だけ厳しかった。
            if (await isGoneResponse(res)) {
                // 手元の一覧が古い合図でもある。取り直して収束させる
                // （ストーリー側は loadStories() で同じことをしている）
                reload();
                return true;
            }
            if (!res.ok) throw new Error(String(res.status));
            return true;
        } catch (e) {
            log.error("comment delete error:", e);
            setItems(prevItems);
            setCount(prevCount);
            return false;
        }
    }, [photoId, items, count, reload]);

    return { items, count, loading, loadError, reload, pending, add, remove };
}
