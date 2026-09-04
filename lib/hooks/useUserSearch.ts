"use client";

import { usableRows } from "../utils/apiRows";
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

/**
 * 検索を始める最小文字数。
 * 英数字は2文字（"a" では候補が多すぎる）。日本語・中国語などは
 * 1文字でも十分に絞り込めるうえ、名前自体が短いので1文字から検索する。
 */
export function isSearchableQuery(q: string): boolean {
    if (!q) return false;
    // ASCII 以外（かな・漢字など）を含むなら1文字から
    if (/[^\u0000-\u007F]/.test(q)) return q.length >= 1;
    return q.length >= 2;
}

// 入力欄側で既に300ms待っているので、ここは短くして体感を落とさない
const DEBOUNCE_MS = 120;

/**
 * 検索語に一致するユーザーを引く。写真の検索と同じ入力欄から呼ぶ想定。
 * 入力のたびに叩かないよう 300ms 待ってから1回だけ問い合わせる。
 */
export function useUserSearch(query: string): { users: UserHit[]; loading: boolean; failed: boolean } {
    const [users, setUsers] = useState<UserHit[]>([]);
    const [loading, setLoading] = useState(false);
    // **「見つからなかった」と「聞けなかった」を分ける。**
    // 失敗も `setUsers([])` にしていたので、API が落ちているだけなのに
    // 「その人は登録していない」と読める文言が出ていた。知り合いを探しに
    // 来た新規ユーザーが最初に踏む画面。
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const q = query.trim().replace(/^@+/, "");
        if (!isSearchableQuery(q)) {
            setUsers([]);
            setLoading(false);
            // 検索語を消したら失敗の印も下ろす（前の失敗を引きずらない）
            setFailed(false);
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
                    if (!aborted) {
                        setUsers(usableRows<UserHit>(data.users, "GET /users/search") ?? []);
                        setFailed(false);
                    }
                } catch (e) {
                    // 中断は正常系。それ以外は結果を空にして黙って諦める（写真の検索は動き続ける）
                    if (!aborted && (e as Error).name !== "AbortError") {
                        log.warn("user search error:", e);
                        setUsers([]);
                        setFailed(true);
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

    return { users, loading, failed };
}
