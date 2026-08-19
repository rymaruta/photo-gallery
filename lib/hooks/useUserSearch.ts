"use client";

import { useEffect, useState } from "react";
import { userPublicFetch } from "../utils/api";
import { log } from "../utils/log";

export type UserHit = {
    userId: string;
    username?: string;
    displayName?: string;
    bio?: string;
    themeColor?: string;
};

/** 検索語が2文字未満なら検索しない（候補が多すぎて意味がないため。サーバー側と同じ基準） */
export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

/**
 * 検索語に一致するユーザーを引く。写真の検索と同じ入力欄から呼ぶ想定。
 * 入力のたびに叩かないよう 300ms 待ってから1回だけ問い合わせる。
 */
export function useUserSearch(query: string): { users: UserHit[]; loading: boolean } {
    const [users, setUsers] = useState<UserHit[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const q = query.trim().replace(/^@+/, "");
        if (q.length < MIN_QUERY_LENGTH) {
            setUsers([]);
            setLoading(false);
            return;
        }

        let aborted = false;
        const controller = new AbortController();
        setLoading(true);

        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const res = await userPublicFetch(`/users/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
                    if (!res.ok) throw new Error(String(res.status));
                    const data = await res.json() as { users?: UserHit[] };
                    if (!aborted) setUsers(Array.isArray(data.users) ? data.users : []);
                } catch (e) {
                    // 中断は正常系。それ以外は結果を空にして黙って諦める（写真の検索は動き続ける）
                    if (!aborted && (e as Error).name !== "AbortError") {
                        log.warn("user search error:", e);
                        setUsers([]);
                    }
                } finally {
                    if (!aborted) setLoading(false);
                }
            })();
        }, DEBOUNCE_MS);

        return () => {
            aborted = true;
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    return { users, loading };
}
