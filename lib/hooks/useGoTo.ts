import { useCallback, useEffect, useRef, useState } from "react";
import { publicFetch, userFetch } from "../utils/api";
import { log } from "../utils/log";

// 「行く」= この写真の場所に行きたい、の意思表示。
//   - goCount（行きたい人数）と moved（実際に動かした人数）は全員に見える
//   - 押した状態（going）はサーバーの自分の行きたいリストに永続化される
//   - 後日その場所で写真を投稿すると「行った」が成立し、投稿者に通知が届く

export type GoListItem = {
    photoId: string;
    src: string;
    title?: unknown;
    location?: string;
    coords?: { lat: number; lng: number };
    t: string;
    fulfilled?: boolean;
    fulfilledAt?: string;
};

// セッション内キャッシュ: 自分の「行く」済み photoId 集合（認証時のみ取得）
let goSetCache: Set<string> | null = null;
let goSetPromise: Promise<Set<string>> | null = null;

async function fetchGoSet(): Promise<Set<string>> {
    if (goSetCache) return goSetCache;
    if (!goSetPromise) {
        goSetPromise = (async () => {
            try {
                const res = await userFetch("/user/go");
                if (!res.ok) return new Set<string>();
                const data = await res.json() as { items?: GoListItem[] };
                const set = new Set((data.items ?? []).map((x) => x.photoId));
                goSetCache = set;
                return set;
            } catch {
                return new Set<string>();
            } finally {
                goSetPromise = null;
            }
        })();
    }
    return goSetPromise;
}

/** テスト用/ログアウト時: キャッシュを破棄 */
export function resetGoCache() {
    goSetCache = null;
    goSetPromise = null;
}

export function useGoTo(photoId: string, isAuthenticated: boolean) {
    const [going, setGoing] = useState(false);
    const [goCount, setGoCount] = useState(0);
    const [moved, setMoved] = useState(0);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 公開カウント + 自分の状態を取得
    useEffect(() => {
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await publicFetch(`/photos/${encodeURIComponent(photoId)}/go`, { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json() as { goCount?: number; moved?: number };
                    if (!aborted) {
                        if (typeof data.goCount === "number") setGoCount(data.goCount);
                        if (typeof data.moved === "number") setMoved(data.moved);
                    }
                }
            } catch { /* 表示は0のまま */ }
        })();
        if (isAuthenticated) {
            void fetchGoSet().then((set) => { if (!aborted) setGoing(set.has(photoId)); });
        }
        return () => { aborted = true; controller.abort(); };
    }, [photoId, isAuthenticated]);

    const toggle = useCallback(async (): Promise<"added" | "removed" | "auth-required" | "error"> => {
        if (busyRef.current) return "error";
        if (!isAuthenticated) return "auth-required";
        busyRef.current = true;
        setPending(true);

        const was = going;
        setGoing(!was);
        setGoCount((c) => Math.max(0, c + (was ? -1 : 1)));

        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/go`, {
                method: was ? "DELETE" : "POST",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json() as { going?: boolean; goCount?: number };
            if (typeof data.goCount === "number") setGoCount(data.goCount);
            if (goSetCache) {
                if (was) goSetCache.delete(photoId); else goSetCache.add(photoId);
            }
            return was ? "removed" : "added";
        } catch (e) {
            log.error("go toggle error:", e);
            // 巻き戻し
            setGoing(was);
            setGoCount((c) => Math.max(0, c + (was ? 1 : -1)));
            return "error";
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [photoId, going, isAuthenticated]);

    return { going, goCount, moved, pending, toggle };
}
