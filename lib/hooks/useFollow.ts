import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { userPublicFetch, userFetch } from "../utils/api";
import { log } from "../utils/log";

// フォロー。フォロー中の userId 集合はセッション内キャッシュ（useGoTo の goSet と同型）。

let followingCache: Set<string> | null = null;
let followingPromise: Promise<Set<string>> | null = null;

export async function fetchFollowingSet(): Promise<Set<string>> {
    if (followingCache) return followingCache;
    if (!followingPromise) {
        followingPromise = (async () => {
            try {
                const res = await userFetch("/user/following");
                if (!res.ok) return new Set<string>();
                const data = await res.json() as { userIds?: string[] };
                const set = new Set(Array.isArray(data.userIds) ? data.userIds : []);
                followingCache = set;
                return set;
            } catch {
                return new Set<string>();
            } finally {
                followingPromise = null;
            }
        })();
    }
    return followingPromise;
}

/**
 * ログアウト時に必ず呼ぶこと。
 * これを呼ばないと、同じタブで別の人がログインしたときに
 * 前の人のフォロー一覧がそのまま使われる（ログアウトはクライアント遷移なので
 * モジュールの状態が生き残る）。
 */
export function resetFollowingCache() {
    followingCache = null;
    followingPromise = null;
    counts.clear();
    listeners.clear();
}

// ────────────────────────────────
// フォロー数の共有ストア
//
// 同じ相手について複数のコンポーネントが useFollow を呼ぶ（プロフィールでは
// 数字のピルとフォローボタンが別コンポーネント）。それぞれが自前の state を
// 持つと、押しても数が変わらないうえに同じ問い合わせが2回飛ぶ。
// targetUserId 単位で1つの値を共有する。
// ────────────────────────────────
type Counts = { followers: number; following: number };

const counts = new Map<string, Counts>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const EMPTY: Counts = { followers: 0, following: 0 };

function emit(userId: string) {
    for (const fn of listeners.get(userId) ?? []) fn();
}

function setCounts(userId: string, next: Counts) {
    const cur = counts.get(userId);
    if (cur && cur.followers === next.followers && cur.following === next.following) return;
    counts.set(userId, next);
    emit(userId);
}

function subscribe(userId: string, fn: () => void): () => void {
    let set = listeners.get(userId);
    if (!set) { set = new Set(); listeners.set(userId, set); }
    set.add(fn);
    return () => { set?.delete(fn); };
}

/** 相手のフォロー数を取り込む。同時に複数から呼ばれても問い合わせは1回。 */
function loadCounts(userId: string, signal?: AbortSignal): Promise<void> {
    const running = inflight.get(userId);
    if (running) return running;
    const p = (async () => {
        try {
            const res = await userPublicFetch(`/users/${encodeURIComponent(userId)}/follow`, { signal });
            if (!res.ok) return;
            const data = await res.json() as { followers?: number; following?: number };
            setCounts(userId, {
                followers: typeof data.followers === "number" ? data.followers : 0,
                following: typeof data.following === "number" ? data.following : 0,
            });
        } catch { /* 取れなければ 0 のまま */ } finally {
            inflight.delete(userId);
        }
    })();
    inflight.set(userId, p);
    return p;
}

export function useFollow(targetUserId: string | undefined, isAuthenticated: boolean) {
    const [isFollowing, setIsFollowing] = useState(false);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    // 数は共有ストアから読む（同じ相手を見ている他のコンポーネントと同期する）
    const { followers, following } = useSyncExternalStore(
        useCallback((fn) => (targetUserId ? subscribe(targetUserId, fn) : () => {}), [targetUserId]),
        useCallback(() => (targetUserId ? counts.get(targetUserId) ?? EMPTY : EMPTY), [targetUserId]),
        useCallback(() => EMPTY, []),
    );

    useEffect(() => {
        if (!targetUserId) return;
        let aborted = false;
        const controller = new AbortController();
        void loadCounts(targetUserId, controller.signal);
        if (isAuthenticated) {
            void fetchFollowingSet().then((set) => { if (!aborted) setIsFollowing(set.has(targetUserId)); });
        }
        return () => { aborted = true; controller.abort(); };
    }, [targetUserId, isAuthenticated]);

    const toggle = useCallback(async (): Promise<"followed" | "unfollowed" | "auth-required" | "error"> => {
        if (!targetUserId) return "error";
        if (!isAuthenticated) return "auth-required";
        if (busyRef.current) return "error";
        busyRef.current = true;
        setPending(true);

        const was = isFollowing;
        const before = counts.get(targetUserId) ?? EMPTY;
        setIsFollowing(!was);
        // 楽観的更新。共有ストア経由なので数字のピルもその場で動く
        setCounts(targetUserId, { ...before, followers: Math.max(0, before.followers + (was ? -1 : 1)) });

        try {
            const res = await userFetch(`/users/${encodeURIComponent(targetUserId)}/follow`, {
                method: was ? "DELETE" : "POST",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json() as { followers?: number };
            if (typeof data.followers === "number") {
                setCounts(targetUserId, { ...(counts.get(targetUserId) ?? before), followers: data.followers });
            }
            if (followingCache) {
                if (was) followingCache.delete(targetUserId); else followingCache.add(targetUserId);
            }
            return was ? "unfollowed" : "followed";
        } catch (e) {
            log.error("follow toggle error:", e);
            setIsFollowing(was);
            setCounts(targetUserId, before);
            return "error";
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [targetUserId, isFollowing, isAuthenticated]);

    return { isFollowing, followers, following, pending, toggle };
}
