"use client";

/**
 * **親しい友達**（iOS の `CloseFriendsView` と同じ）。
 *
 * 公開範囲を「親しい友達」にした写真を見られる人を選ぶ。選ぶのはフォロー中の
 * 人の中から。**相手には知らせない**（サーバーも知らせない・`closeFriends.ts`）。
 *
 * API は前から在った（`GET /user/close-friends`・`PUT|DELETE /user/close-friends/{id}`）。
 * Web には呼ぶ画面が無く、iOS で選んだ人を Web で確かめることもできなかった。
 *
 * **保存は押したときにまとめて**（iOS と同じ）。星を押すたびに撃つと、
 * 迷いながら押した分がそのまま相手の見える範囲になる。
 * 送るのは差分だけで、1人ずつ（サーバーが1人ずつしか受けない）。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { usableUserRows, type UserRow } from "../../../lib/utils/userRows";
import UserAvatar from "../../components/UserAvatar";

/** サーバーの `CLOSE_FRIENDS_MAX` と同じ */
export const CLOSE_FRIENDS_MAX = 200;

type Props = { locale: "ja" | "en"; userId: string };

export default function CloseFriends({ locale, userId }: Props) {
    const isJa = locale !== "en";
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [following, setFollowing] = useState<UserRow[]>([]);
    /** サーバーに入っている人（保存が効いたぶんだけ進める） */
    const [saved, setSaved] = useState<Set<string>>(new Set());
    /** 画面で選んでいる人 */
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [cf, fl] = await Promise.all([
                    userFetch("/user/close-friends"),
                    userFetch(`/users/${encodeURIComponent(userId)}/following`),
                ]);
                if (!cf.ok || !fl.ok) throw new Error(`${cf.status}/${fl.status}`);
                const cfData = await cf.json() as { userIds?: unknown };
                const flData = await fl.json() as { users?: unknown };
                const rows = usableUserRows(flData.users, "following");
                // **配列でなければ「取れなかった」**（0人と壊れた応答を混ぜない）
                if (!rows || !Array.isArray(cfData.userIds)) throw new Error("shape");
                const ids = (cfData.userIds as unknown[]).filter((x): x is string => typeof x === "string" && !!x);
                if (cancelled) return;
                setFollowing(rows.filter((r) => !r.deleted));
                setSaved(new Set(ids));
                setChosen(new Set(ids));
                setState("ready");
            } catch {
                if (!cancelled) setState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, [userId]);

    const followingIds = useMemo(() => new Set(following.map((r) => r.id)), [following]);
    /** 選んであるのにフォロー中の一覧に出ない人（フォローを外した人など） */
    const outside = useMemo(() => [...chosen].filter((id) => !followingIds.has(id)), [chosen, followingIds]);
    const q = query.trim().toLowerCase();
    const shown = q ? following.filter((r) => (r.name ?? "").toLowerCase().includes(q)) : following;

    const dirty = chosen.size !== saved.size || [...chosen].some((id) => !saved.has(id));
    const overLimit = chosen.size > CLOSE_FRIENDS_MAX;

    const toggle = (id: string) => {
        setDone(false);
        setChosen((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const save = useCallback(async () => {
        if (saving || !dirty || overLimit) return;
        setSaving(true);
        setError(null);
        setDone(false);
        const add = [...chosen].filter((id) => !saved.has(id));
        const remove = [...saved].filter((id) => !chosen.has(id));
        // **効いた分だけ `saved` を進める。** 途中で落ちたら、残りは画面に
        // 「未保存」のまま残る（もう一度押せば続きから送る）
        const nowSaved = new Set(saved);
        try {
            for (const id of remove) {
                const res = await userFetch(`/user/close-friends/${encodeURIComponent(id)}`, { method: "DELETE" });
                if (!res.ok) throw new Error(await readApiError(res, isJa ? "保存できませんでした" : "Couldn't save"));
                nowSaved.delete(id);
            }
            for (const id of add) {
                const res = await userFetch(`/user/close-friends/${encodeURIComponent(id)}`, { method: "PUT" });
                if (!res.ok) throw new Error(await readApiError(res, isJa ? "保存できませんでした" : "Couldn't save"));
                nowSaved.add(id);
            }
            setDone(true);
        } catch (e) {
            setError(sessionErrorMessage(e) ?? (e instanceof Error && e.message ? e.message : (isJa ? "保存できませんでした" : "Couldn't save")));
        } finally {
            setSaved(nowSaved);
            setSaving(false);
        }
    }, [saving, dirty, overLimit, chosen, saved, isJa]);

    const row = (id: string, name: string | undefined) => {
        const on = chosen.has(id);
        const label = name ?? (isJa ? "名前の分からない人" : "Unknown user");
        return (
            <li key={id} className="flex items-center gap-3 py-2">
                <UserAvatar userId={id} className="w-9 h-9" iconClassName="w-5 h-5" />
                <span className="flex-1 min-w-0 truncate text-sm text-white/90">{label}</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={isJa ? `${label} を親しい友達にする` : `Add ${label} to close friends`}
                    onClick={() => toggle(id)}
                    disabled={saving}
                    className={`inline-flex items-center justify-center rounded-full transition disabled:opacity-40 ${on ? "text-accent" : "text-white/50 hover:text-white/80"}`}
                    style={{ minWidth: 44, minHeight: 44, touchAction: "manipulation" }}
                >
                    {on ? <StarSolid className="w-6 h-6" /> : <StarOutline className="w-6 h-6" />}
                </button>
            </li>
        );
    };

    return (
        <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">{isJa ? "親しい友達" : "Close friends"}</h3>
                {state === "ready" && (
                    <span className="text-xs text-white/60">{isJa ? `選んだ人 ${chosen.size}` : `${chosen.size} picked`}</span>
                )}
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
                {isJa
                    ? "公開範囲を「親しい友達」にした写真は、選んだ人だけが見られます。相手には知らせません。"
                    : "Photos shared with Close friends are visible only to the people you pick. They won't be notified."}
            </p>

            {state === "loading" && <p className="text-xs text-white/60">{isJa ? "読み込み中…" : "Loading…"}</p>}
            {state === "failed" && (
                <p role="alert" className="text-xs text-danger">
                    {isJa ? "読み込めませんでした。時間をおいてもう一度お試しください。" : "Couldn't load. Please try again later."}
                </p>
            )}

            {state === "ready" && following.length === 0 && outside.length === 0 && (
                <p className="text-xs text-white/60">
                    {isJa
                        ? "フォローしている人がまだいません。フォローすると、ここから選べます。"
                        : "You're not following anyone yet. Follow people to pick them here."}
                </p>
            )}

            {state === "ready" && following.length > 0 && (
                <>
                    <label className="block">
                        <span className="sr-only">{isJa ? "名前で探す" : "Search by name"}</span>
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={isJa ? "名前で探す" : "Search by name"}
                            className="w-full rounded-xl bg-surface-2 ring-1 ring-outline px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-accent"
                        />
                    </label>
                    {shown.length === 0
                        ? <p className="text-xs text-white/60">{isJa ? "見つかりませんでした" : "No matches"}</p>
                        : <ul className="divide-y divide-white/5 max-h-80 overflow-y-auto">{shown.map((r) => row(r.id, r.name))}</ul>}
                </>
            )}

            {state === "ready" && outside.length > 0 && (
                <div className="pt-1">
                    <p className="text-xs font-semibold text-white/80">{isJa ? "フォロー中の一覧に出ない人" : "Not in your following list"}</p>
                    <p className="text-[11px] text-white/60 mt-0.5">
                        {isJa
                            ? "フォローを外した人などです。星を外して保存すると、「親しい友達」の写真が見えなくなります。"
                            : "People you've unfollowed, for example. Unstar and save to stop sharing Close friends photos with them."}
                    </p>
                    <ul className="divide-y divide-white/5">{outside.map((id) => row(id, undefined))}</ul>
                </div>
            )}

            {state === "ready" && (
                <div className="flex items-center justify-end gap-3 pt-1">
                    {overLimit && (
                        <p role="alert" className="mr-auto text-xs text-danger">
                            {isJa
                                ? `選べるのは ${CLOSE_FRIENDS_MAX} 人までです（いま ${chosen.size} 人）。減らすと保存できます。`
                                : `You can pick up to ${CLOSE_FRIENDS_MAX} people (now ${chosen.size}). Remove some to save.`}
                        </p>
                    )}
                    {error && <p role="alert" className="mr-auto text-xs text-danger">{error}</p>}
                    {done && !dirty && <p role="status" className="mr-auto text-xs text-white/70">{isJa ? "保存しました" : "Saved"}</p>}
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!dirty || overLimit || saving}
                        className="rounded-full bg-accent-fill text-ink px-5 text-sm font-semibold hover:brightness-110 disabled:bg-white/10 disabled:text-white/50 transition"
                        style={{ minHeight: 44, touchAction: "manipulation" }}
                    >
                        {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "保存" : "Save")}
                    </button>
                </div>
            )}
        </div>
    );
}
