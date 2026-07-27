import { useCallback, useEffect, useRef, useState } from "react";
import { publicFetch, userFetch } from "../utils/api";
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

export function resetFollowingCache() {
    followingCache = null;
    followingPromise = null;
}

export function useFollow(targetUserId: string | undefined, isAuthenticated: boolean) {
    const [isFollowing, setIsFollowing] = useState(false);
    const [followers, setFollowers] = useState(0);
    const [following, setFollowing] = useState(0);
    const [pending, setPending] = useState(false);
    const busyRef = useRef(false);

    useEffect(() => {
        if (!targetUserId) return;
        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await publicFetch(`/users/${encodeURIComponent(targetUserId)}/follow`, { signal: controller.signal });
                if (res.ok) {
                    const data = await res.json() as { followers?: number; following?: number };
                    if (!aborted) {
                        if (typeof data.followers === "number") setFollowers(data.followers);
                        if (typeof data.following === "number") setFollowing(data.following);
                    }
                }
            } catch { /* 0のまま */ }
        })();
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
        setIsFollowing(!was);
        setFollowers((c) => Math.max(0, c + (was ? -1 : 1)));

        try {
            const res = await userFetch(`/users/${encodeURIComponent(targetUserId)}/follow`, {
                method: was ? "DELETE" : "POST",
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json() as { followers?: number };
            if (typeof data.followers === "number") setFollowers(data.followers);
            if (followingCache) {
                if (was) followingCache.delete(targetUserId); else followingCache.add(targetUserId);
            }
            return was ? "unfollowed" : "followed";
        } catch (e) {
            log.error("follow toggle error:", e);
            setIsFollowing(was);
            setFollowers((c) => Math.max(0, c + (was ? 1 : -1)));
            return "error";
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [targetUserId, isFollowing, isAuthenticated]);

    return { isFollowing, followers, following, pending, toggle };
}
