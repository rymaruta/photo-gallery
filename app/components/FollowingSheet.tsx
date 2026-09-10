"use client";

/**
 * フォロー中／フォロワーの一覧（下から出るシート）。
 *
 * owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
 *
 * **1つの部品で両方出す。** 違うのは口と見出しだけで、倒し方
 * （読み込み中・失敗・0人を分ける／退会した人はリンクにしない／
 * 全部出せていないことを言う）は同じ。分けて書くと静かにずれる。
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { XMarkIcon } from "@heroicons/react/24/outline";
import UserAvatar from "./UserAvatar";
import { ROUTES } from "../../lib/routes";
import { userFetch } from "../../lib/utils/api";
import { usableUserRows, type UserRow } from "../../lib/utils/userRows";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";

export type FollowListKind = "following" | "followers";

type Props = {
    userId: string;
    kind: FollowListKind;
    locale: "ja" | "en";
    onClose: () => void;
    openerRef?: React.RefObject<HTMLElement | null>;
};

const TITLE: Record<FollowListKind, { ja: string; en: string }> = {
    following: { ja: "フォロー中", en: "Following" },
    followers: { ja: "フォロワー", en: "Followers" },
};
const EMPTY: Record<FollowListKind, { ja: string; en: string }> = {
    following: { ja: "まだ誰もフォローしていません", en: "Not following anyone yet." },
    followers: { ja: "まだフォロワーはいません", en: "No followers yet." },
};

export default function FollowingSheet({ userId, kind, locale, onClose, openerRef }: Props) {
    const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
    const [rows, setRows] = useState<UserRow[]>([]);
    const [total, setTotal] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    // 外へ漏らさない・閉じたら押した場所へ戻す（このリポジトリの8か所と同じ道具）
    useFocusTrap(true, panelRef, openerRef);
    // **`document` で聞く。** React の合成イベントはフォーカスがパネルの
    // 中にあるときしか届かないので、`<p>` の文字をタップしてフォーカスが
    // body に落ちた時点で Escape が効かなくなる。既存の6か所と同じ道具
    // （変換中の Escape ＝「変換の取り消し」を除く判定も入っている）
    useEscapeKey(true, onClose);

    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await userFetch(`/users/${encodeURIComponent(userId)}/${kind}`);
                if (!res.ok) throw new Error(String(res.status));
                // `listed`（一覧に入っている数）も返るが、画面は使わない
                // ——出す判断は `total` と実際に描く行数で足りる
                const data = await res.json() as { users?: unknown; total?: unknown };
                // **配列でなければ「取れなかった」**。`[]` に潰すと
                // 「0人」と「壊れた応答」が混ざる（この部品が掲げている
                // 「読み込み中・失敗・0人を分ける」の逆）
                const list = usableUserRows(data.users, kind);
                if (cancelled) return;
                if (!list) { setState("failed"); return; }
                setRows(list);
                setTotal(typeof data.total === "number" ? data.total : 0);
                setState("ready");
            } catch {
                if (!cancelled) setState("failed");
            }
        })();
        return () => { cancelled = true; };
    }, [userId, kind]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
            onClick={onClose}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={locale === "en" ? TITLE[kind].en : TITLE[kind].ja}
                // 下端に密着させない（iPhone のホームインジケータに最後の行が
                // かぶる）。既存のボトムシート2つと同じ形
                className="w-full sm:max-w-sm max-h-[70dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#1c1c1e] ring-1 ring-white/10 pb-[calc(env(safe-area-inset-bottom,0px))] sm:pb-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <p className="text-sm text-white/90">
                        {locale === "en" ? TITLE[kind].en : TITLE[kind].ja}
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
                    {/* **「0人」と「まだ揃っていない」を分ける。**
                        数（`followstats#`）は正しいのに一覧が空、という状態が
                        ある——埋め戻しを流すまで／1件だけ書けなかったとき。
                        分けないと「5 フォロワー」と言いながら開くと
                        「まだフォロワーはいません」になる */}
                    {state === "ready" && rows.length === 0 && (
                        <p className="text-xs text-white/60 text-center py-8">
                            {total > 0
                                ? (locale === "en"
                                    ? "This list isn't ready yet. The count above is correct."
                                    : "一覧はまだ用意できていません。上の数は正しい値です。")
                                : (locale === "en" ? EMPTY[kind].en : EMPTY[kind].ja)}
                        </p>
                    )}
                    {rows.map((u) => (u.deleted ? (
                        // **退会した人はリンクにしない**（開いても空のページ）。
                        // 退会が消すのは本人の `following#` だけなので、
                        // 他人の一覧には残り続ける。コメント欄・ストーリーの
                        // 返信と同じ扱い（アバターも出さない）
                        <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                            <UserAvatar userId="" className="w-9 h-9 flex-shrink-0" iconClassName="w-5 h-5" />
                            <span className="text-sm text-white/60 truncate">
                                {locale === "en" ? "Deleted user" : "退会したユーザー"}
                            </span>
                        </div>
                    ) : (
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
                    )))}
                    {/* サーバーは50人までしか返さない（1回で2000回の GetItem は
                        撃てない）。**足りないことを黙らない**。
                        `total`（正しい数）と比べる——一覧が追いついていない
                        ぶんもここに出る */}
                    {state === "ready" && rows.length > 0 && total > rows.length && (
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
