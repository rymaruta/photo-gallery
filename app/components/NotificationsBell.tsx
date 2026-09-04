"use client";

import { usableRows } from "../../lib/utils/apiRows";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BellIcon, ChatBubbleOvalLeftIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { HeartIcon } from "@heroicons/react/24/solid";
import { userFetch } from "../../lib/utils/api";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";

type Notif = {
    // 実際に作られるのは like / comment / follow の3種類。
    // inspired / go は「行きたいリスト」機能のもので、通知を作る側が
    // どこにも無い（マーカーを書く経路も、UIのボタンも存在しない）。
    type: "like" | "comment" | "follow";
    photoId: string;
    photoSrc: string;
    byName: string;
    /** 通知を起こした本人。プロフィールへ飛ぶために使う */
    byId?: string;
    /**
     * その人が退会している（サーバーが `byName` を伏せたときに立つ）。
     * 退会するとプロフィールは墓石になり、公開APIは空を返すので、
     * リンクを出すと「開いても何も無いページ」へ誘うことになる。
     * コメント欄（CommentSection）と同じ扱いにする。
     */
    deleted?: boolean;
    atLocation?: string;
    targetUserId?: string;
    t: string;
};

/** 常駐ぶんの再取得の間隔。短くしすぎると人数×頻度でAPI が増える */
const POLL_MS = 60_000;

// 通知ベル: **いいね・コメント・フォロー**が届く場所。
// 認証済みヘッダーにのみ表示。開くと既読になり、通知タップで写真へ飛べる。
//
// **「行きたいリスト」と「旅立ちの報告」はもう無い。** 上の型のコメントに
// そう書いてあるのに、ここと空表示の本文だけが古いまま残っていて、
// **存在しない機能を2つ案内していた**（逆に、実在するコメントとフォローには
// 触れていなかった）。登録直後の人が最初に読む文なので、実態に合わせる。
export default function NotificationsBell() {
    const { locale } = useLocale();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Notif[]>([]);
    // **「まだ」「0件」「取れなかった」を分ける。**
    // 以前は `items.length === 0` だけを見ていたので、取得に失敗しても
    // 「まだ通知はありません」相当の案内が出て、届いている通知が無いように
    // 見えた。開いた直後の一瞬も同じ見え方になる。
    // 再試行は要らない——このベルは POLL_MS ごとに勝手に取り直す。
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [unread, setUnread] = useState(0);
    const [now, setNow] = useState(0);

    // 取得は1回きりではいけない。このベルはヘッダーに常駐するので、
    // `[]` deps だけだと**リロードするまで新着が出ない**——いいねも
    // コメントもフォローもここに届くのに、開いても前に読み込んだ内容の
    // ままだった。
    //
    // ただしポーリングは足しすぎない。主にするのは「開いたときの再取得」で、
    // 常駐ぶんは長めの間隔にとどめる（1人あたり60秒に1回）。
    // 世代を2つ持つ。混ぜると、片方を直したつもりでもう片方を壊す。
    //
    // `fetchSeqRef` … 取得の世代。**追い越された応答は丸ごと捨てる。**
    //   これを付けずに未読数だけ捨てていたら、遅い GET が返ってきたときに
    //   「新しい方で出ている未読を 0 にし、一覧まで古い方で上書きする」——
    //   つまり**新着が最大60秒（裏タブはもっと長く）出ない**方に倒れていた。
    //   古い数字が出るより、新着が出ない方が悪い。
    //
    // `readSeqRef` … 既読化の世代。取得を投げてから返るまでの間に既読化
    //   したら、返ってきた unread は既に古い。ベルを開くと GET と PUT が
    //   ほぼ同時に出るが、サーバーは GET を先に受けるので `unread: 3` を
    //   返し、消えたバッジが数百ms後に復活していた。
    const fetchSeqRef = useRef(0);
    const readSeqRef = useRef(0);
    const load = useCallback(async () => {
        const mine = ++fetchSeqRef.current;
        const readAt = readSeqRef.current;
        try {
            const res = await userFetch("/user/notifications");
            if (!res.ok) { if (mine === fetchSeqRef.current) setStatus("error"); return; }
            const data = await res.json() as { items?: Notif[]; unread?: number };
            if (mine !== fetchSeqRef.current) return;   // 追い越された。丸ごと捨てる
            // **読めない行は落としてから入れる。** ここはレイアウトに常駐
            // しているので、**開いたあとは**描画中に落ちるとどのページでも
            // `ErrorBoundary` のカードになる（60秒ごとに取り直すので
            // 「再試行」も効かない）
            setItems(usableRows<Notif>(data.items, "GET /user/notifications") ?? []);
            setUnread(readAt === readSeqRef.current && typeof data.unread === "number" ? data.unread : 0);
            setNow(Date.now());
            setStatus("ready");
        } catch {
            // 通知は取得できなくてもUIを壊さない。ただし**黙らない**
            if (mine === fetchSeqRef.current) setStatus("error");
        }
    }, []);

    useEffect(() => {
        // 初回と、以後は一定間隔で。async の中で await してから state を触る
        // （effect の本体で直接 setState しない）。
        void (async () => { await load(); })();
        const timer = setInterval(() => {
            // 見えていないタブでは叩かない（背面のタブが延々と取りにいくのを避ける）
            if (typeof document !== "undefined" && document.hidden) return;
            void load();
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [load]);

    const toggleOpen = () => {
        const next = !open;
        setOpen(next);
        if (next) {
            // 開いた時点の中身を出す。バッジが 0 でも、閉じている間に
            // 届いた通知はここで初めて見える。
            void load();
            if (unread > 0) {
                readSeqRef.current++;
                setUnread(0);
                void userFetch("/user/notifications", { method: "PUT" }).catch(() => { /* ignore */ });
            }
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
                                {status === "error"
                                    ? (locale === "en"
                                        ? "Couldn't load notifications. Retrying shortly."
                                        : "通知を読み込めませんでした。しばらくすると取り直します。")
                                    : status === "loading"
                                        ? (locale === "en" ? "Loading…" : "読み込み中…")
                                        : (locale === "en"
                                            ? "Likes, comments, and new followers will show up here."
                                            : "いいね・コメント・フォローがここに届きます。")}
                            </p>
                        ) : (
                            <ul className="max-h-96 overflow-y-auto no-scrollbar divide-y divide-white/5">
                                {items.map((n, i) => {
                                    // **退会した人のフォロー通知は、開く先が墓石になる。**
                                    // フォローの通知は写真を持たないので、代わりの行き先も
                                    // 無い——リンクを外して文面だけ残す（コメント欄と同じ扱い）。
                                    // **判定は1か所で作る。** 片方だけ厳密にすると、
                                    // `deleted: "1"` のような応答でアイコンだけ伏せて
                                    // 本文はリンクのまま、という食い違いになる。
                                    // 迷ったら伏せる側（コメント欄も truthy 判定）。
                                    const isDeleted = !!n.deleted;
                                    const goesNowhere = isDeleted && n.type === "follow";
                                    const body = (
                                        <>
                                            <div className="min-w-0 flex-1">
                                                {/* `break-words`: 表示名は100文字まで通るので、
                                                    空白の無い名前だとパネルの外に出て**丸ごと読めなくなる**
                                                    （実測: 名前の右端896px に対しパネル右端320px） */}
                                                <p className="text-[13px] text-white/85 leading-snug break-words">
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
                                                    ) : n.type === "comment" ? (
                                                        <>
                                                            <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5 text-fuchsia-400 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> commented on your photo</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真にコメントしました</>}
                                                        </>
                                                    ) : null /* 知らない種類は何も出さない。
                                                        以前はここが「旅立たせました！」の分岐で、
                                                        将来わけの分からない通知が全部その文言で出る作りだった */}
                                                </p>
                                                <p className="text-[11px] text-white/35 mt-0.5">{fmtTime(n.t)}</p>
                                            </div>
                                            {/* どの写真のことかが分かるよう、右端にその写真を出す */}
                                            {n.type !== "follow" && n.photoSrc && (n.byId || n.targetUserId) && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={n.photoSrc} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                            )}
                                        </>
                                    );
                                    return (
                                        <li key={`${n.photoId || n.targetUserId}-${n.t}-${i}`} className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                                            {/* 左のアイコンは相手のプロフィールへ。
                                                名前だけだと、名前未設定の人は既定名で表示されて
                                                誰なのか辿れず、フォローしに行けないため */}
                                            {isDeleted ? (
                                                // 退会した人。名前は既にサーバーが伏せてある
                                                <span className="flex-shrink-0">
                                                    <UserAvatar userId="" className="w-10 h-10" iconClassName="w-5 h-5" />
                                                </span>
                                            ) : (n.byId || n.targetUserId) ? (
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
                                            {goesNowhere ? (
                                                <div className="flex items-start gap-3 min-w-0 flex-1">{body}</div>
                                            ) : (
                                                <Link
                                                    href={n.type === "follow" && n.targetUserId ? ROUTES.USER_PROFILE(n.targetUserId) : ROUTES.PHOTO(n.photoId)}
                                                    onClick={() => setOpen(false)}
                                                    className="flex items-start gap-3 min-w-0 flex-1 active:opacity-80 transition"
                                                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                                                >
                                                    {body}
                                                </Link>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
