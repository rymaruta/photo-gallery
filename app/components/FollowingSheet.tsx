"use client";

/**
 * その人がフォローしている人の一覧（下から出るシート）。
 *
 * owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
 *
 * **フォロワー側は出せない。** いまのデータは `following#<uid>`
 * （自分がフォローしている人）と `followstats#<uid>`（数）だけで、
 * 「誰にフォローされているか」を引ける行が無い。出すには
 * `followers#<uid>` を足して既存の関係を埋め戻す移行が要る＝別件。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { XMarkIcon } from "@heroicons/react/24/outline";
import UserAvatar from "./UserAvatar";
import { ROUTES } from "../../lib/routes";
import { userFetch } from "../../lib/utils/api";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";

type Row = { id: string; name?: string };

/** 応答の形は信用しない（1件壊れていても画面ごと落とさない） */
export function usableRows(raw: unknown): Row[] {
    if (!Array.isArray(raw)) return [];
    const out: Row[] = [];
    for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        const { id, name } = r as { id?: unknown; name?: unknown };
        if (typeof id !== "string" || !id) continue;
        out.push(typeof name === "string" && name ? { id, name } : { id });
    }
    return out;
}

type Props = {
    userId: string;
    locale: "ja" | "en";
    onClose: () => void;
    openerRef?: React.RefObject<HTMLElement | null>;
};

export default function FollowingSheet({ userId, locale, onClose, openerRef }: Props) {
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [rows, setRows] = useState<Row[]>([]);
    const [total, setTotal] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    // 外へ漏らさない・閉じたら押した場所へ戻す（このリポジトリの8か所と同じ道具）
    useFocusTrap(true, panelRef, openerRef);

    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") onClose();
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await userFetch(`/users/${encodeURIComponent(userId)}/following`);
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json() as { users?: unknown; total?: unknown };
                if (cancelled) return;
                setRows(usableRows(data.users));
                setTotal(typeof data.total === "number" ? data.total : 0);
                setState("ready");
            } catch {
                if (!cancelled) setState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, [userId]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
            onClick={onClose}
            onKeyDown={onKeyDown}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={locale === "en" ? "Following" : "フォロー中"}
                className="w-full sm:max-w-sm max-h-[70vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#1c1c1e] ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white/90">
                        {locale === "en" ? "Following" : "フォロー中"}
                        {state === "ready" && total > 0 && (
                            <span className="ml-2 text-[11px] text-white/60 tabular-nums">{total}</span>
                        )}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={locale === "en" ? "Close" : "閉じる"}
                        className="p-1 text-white/60 hover:text-white"
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-2">
                    {/* **「まだ来ていない」を「0人」と言わない**（台帳 0d） */}
                    {state === "loading" && (
                        <p className="text-xs text-white/60 text-center py-8">
                            {locale === "en" ? "Loading…" : "読み込んでいます…"}
                        </p>
                    )}
                    {state === "failed" && (
                        <p className="text-xs text-white/60 text-center py-8">
                            {locale === "en" ? "Couldn't load the list." : "一覧を読み込めませんでした"}
                        </p>
                    )}
                    {state === "ready" && rows.length === 0 && (
                        <p className="text-xs text-white/60 text-center py-8">
                            {locale === "en" ? "Not following anyone yet." : "まだ誰もフォローしていません"}
                        </p>
                    )}
                    {rows.map((u) => (
                        <Link
                            key={u.id}
                            href={ROUTES.USER_PROFILE(u.id)}
                            onClick={onClose}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition"
                        >
                            <UserAvatar userId={u.id} className="w-9 h-9 flex-shrink-0" iconClassName="w-5 h-5" />
                            <span className="text-sm text-white/90 truncate">
                                {u.name ?? (locale === "en" ? "User" : "旅人")}
                            </span>
                        </Link>
                    ))}
                    {/* サーバーは50人までしか返さない（1回で2000回の GetItem は
                        撃てない）。**足りないことを黙らない** */}
                    {state === "ready" && total > rows.length && (
                        <p className="px-3 py-3 text-[11px] text-white/60">
                            {locale === "en"
                                ? `Showing the first ${rows.length} of ${total}.`
                                : `${total} 人のうち、はじめの ${rows.length} 人を表示しています。`}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
