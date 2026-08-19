"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BellIcon, ChatBubbleOvalLeftIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, HeartIcon, MapPinIcon } from "@heroicons/react/24/solid";
import { userFetch } from "../../lib/utils/api";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";

type Notif = {
    type: "inspired" | "like" | "go" | "comment" | "follow";
    photoId: string;
    photoSrc: string;
    byName: string;
    /** 通知を起こした本人。プロフィールへ飛ぶために使う */
    byId?: string;
    atLocation?: string;
    targetUserId?: string;
    t: string;
};

// 通知ベル: 「いいねされた」「行きたいリストに入った」
// 「あなたの写真が◯◯さんを旅立たせた」が届く場所。
// 認証済みヘッダーにのみ表示。開くと既読になり、通知タップで写真へ飛べる。
export default function NotificationsBell() {
    const { locale } = useLocale();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Notif[]>([]);
    const [unread, setUnread] = useState(0);
    const [now, setNow] = useState(0);

    useEffect(() => {
        void (async () => {
            try {
                const res = await userFetch("/user/notifications");
                if (!res.ok) return;
                const data = await res.json() as { items?: Notif[]; unread?: number };
                setItems(Array.isArray(data.items) ? data.items : []);
                setUnread(typeof data.unread === "number" ? data.unread : 0);
                setNow(Date.now());
            } catch { /* 通知は取得できなくてもUIを壊さない */ }
        })();
    }, []);

    const toggleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next && unread > 0) {
            setUnread(0);
            void userFetch("/user/notifications", { method: "PUT" }).catch(() => { /* ignore */ });
        }
    };

    const fmtTime = (iso: string) => {
        const t = Date.parse(iso);
        if (isNaN(t) || !now) return "";
        const days = Math.floor((now - t) / (24 * 60 * 60 * 1000));
        if (days <= 0) return locale === "en" ? "today" : "今日";
        if (days === 1) return locale === "en" ? "yesterday" : "昨日";
        return locale === "en" ? `${days}d ago` : `${days}日前`;
    };

    return (
        <div className="relative">
            <button
                onClick={toggleOpen}
                aria-label={locale === "en" ? "Notifications" : "通知"}
                aria-expanded={open}
                className="relative inline-flex items-center justify-center w-11 h-11 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition"
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            >
                <BellIcon className="w-6 h-6" />
                {unread > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-sky-500 text-[10px] font-bold text-white flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {open && (
                <>
                    {createPortal(
                        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />,
                        document.body,
                    )}
                    <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[85vw] rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in">
                        <div className="px-4 py-2.5 border-b border-white/5">
                            <span className="text-xs font-semibold tracking-widest uppercase text-white/45">
                                {locale === "en" ? "Notifications" : "通知"}
                            </span>
                        </div>
                        {items.length === 0 ? (
                            <p className="px-4 py-8 text-center text-xs text-white/40">
                                {locale === "en"
                                    ? "Likes, travel-list adds, and journeys your photos inspire will show up here."
                                    : "いいね・行きたいリスト追加・旅立ちの報告がここに届きます。"}
                            </p>
                        ) : (
                            <ul className="max-h-96 overflow-y-auto no-scrollbar divide-y divide-white/5">
                                {items.map((n, i) => (
                                    <li key={`${n.photoId || n.targetUserId}-${n.t}-${i}`} className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                                        {/* 左のアイコンは相手のプロフィールへ。
                                            名前だけだと、名前未設定の人は既定名で表示されて
                                            誰なのか辿れず、フォローしに行けないため */}
                                        {(n.byId || n.targetUserId) ? (
                                            <Link
                                                href={ROUTES.USER_PROFILE(String(n.byId || n.targetUserId))}
                                                onClick={() => setOpen(false)}
                                                aria-label={locale === "en" ? `Open ${n.byName}'s profile` : `${n.byName} さんのプロフィール`}
                                                className="flex-shrink-0 rounded-full active:scale-95 transition"
                                                style={{ touchAction: "manipulation" }}
                                            >
                                                <UserAvatar userId={String(n.byId || n.targetUserId)} className="w-10 h-10" iconClassName="w-5 h-5" />
                                            </Link>
                                        ) : (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={n.photoSrc} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                        )}
                                        <Link
                                            href={n.type === "follow" && n.targetUserId ? ROUTES.USER_PROFILE(n.targetUserId) : ROUTES.PHOTO(n.photoId)}
                                            onClick={() => setOpen(false)}
                                            className="flex items-start gap-3 min-w-0 flex-1 active:opacity-80 transition"
                                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[13px] text-white/85 leading-snug">
                                                    {n.type === "follow" ? (
                                                        <>
                                                            <UserPlusIcon className="w-3.5 h-3.5 text-sky-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> followed you</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたをフォローしました</>}
                                                        </>
                                                    ) : n.type === "like" ? (
                                                        <>
                                                            <HeartIcon className="w-3.5 h-3.5 text-rose-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> liked your photo</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真にいいねしました</>}
                                                        </>
                                                    ) : n.type === "go" ? (
                                                        <>
                                                            <MapPinIcon className="w-3.5 h-3.5 text-emerald-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> added your photo to their travel list!</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真を行きたいリストに追加しました！</>}
                                                        </>
                                                    ) : n.type === "comment" ? (
                                                        <>
                                                            <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5 text-fuchsia-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> commented on your photo</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真にコメントしました</>}
                                                        </>
                                                    ) : (
                                                        <>
                                                            <PaperAirplaneIcon className="w-3.5 h-3.5 -rotate-45 text-sky-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <>Your photo moved <span className="font-semibold">{n.byName}</span> to travel{n.atLocation ? ` to ${n.atLocation}` : ""}!</>
                                                                : <>あなたの写真が <span className="font-semibold">{n.byName}</span> さんを{n.atLocation ? `「${n.atLocation}」へ` : ""}旅立たせました！</>}
                                                        </>
                                                    )}
                                                </p>
                                                <p className="text-[11px] text-white/35 mt-0.5">{fmtTime(n.t)}</p>
                                            </div>
                                            {/* どの写真のことかが分かるよう、右端にその写真を出す */}
                                            {n.type !== "follow" && n.photoSrc && (n.byId || n.targetUserId) && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={n.photoSrc} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                            )}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
