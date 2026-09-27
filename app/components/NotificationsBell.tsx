"use client";

import { usableRows } from "../../lib/utils/apiRows";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BellIcon, ChatBubbleOvalLeftIcon, UserPlusIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import { HeartIcon } from "@heroicons/react/24/solid";
import { userFetch } from "../../lib/utils/api";
import { useLocale } from "../i18n/context";
import { useAuth } from "../auth/context";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";
import { FollowAction } from "./FollowButton";
import { publicImageUrl } from "@/lib/utils/seo";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { nextTabIndex } from "../../lib/utils/tabKeys";

type Notif = {
    // 実際に作られるのは like / comment / follow / storyreply の4種類。
    // inspired / go は「行きたいリスト」機能のもので、通知を作る側が
    // どこにも無い（マーカーを書く経路も、UIのボタンも存在しない）。
    // **`api-user/src/notify.ts` の `Notif` と対。** 足したのに
    // ここへ足さないと、下の分岐が「知らない種類」として何も出さない
    // ＝**届いているのに画面には何も出ない**通知になる。
    type: "like" | "comment" | "follow" | "storyreply";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PC の境目。**1024px から別の形にする**（owner の指示 2026-09-22
 * 「スマホはモックのとおり。PC（1024px 以上）は横に引き伸ばさず別に設計する」）。
 *
 * スマホ側はモックのとおり**1画面ぶんの一覧**（全画面のシート）、PC 側は
 * ベルから吊る従来の板のまま幅だけ広げる——**モックを横に伸ばさない**。
 * 640px（`sm`）ではなく 1024px（`lg`）なのは、タブレットの縦（768px）が
 * まだ「1画面の一覧」の方が読みやすい幅だから。
 */
const WIDE_QUERY = "(min-width: 1024px)";

/**
 * PC 幅か。
 *
 * **CSS だけでは切り替えられない。** 全画面のシートは `position: fixed` で
 * body へポータルする必要があり（ヘッダーが `backdrop-blur` を持つので、
 * CSS 仕様により固定配置の**包含ブロックがヘッダーになる**——`HeaderNav` が
 * メニューを body へ出しているのと同じ理由）、PC の板はベルに吊るので
 * ポータルできない。**置き場所そのものが違う**ので、両方を描いて
 * `lg:hidden` で隠す形は採れない——id（`notif-tab-*`）と読み上げの中身が
 * 二重になる。
 *
 * jsdom は `matchMedia` を持たないので、テストでは常に false ＝
 * **スマホの形**になる（モックに忠実な側が既定で試験される）。
 * 同じ守り方を `MiniPlayer` がしている。
 */
function useWidePanel(): boolean {
    const [wide, setWide] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const mq = window.matchMedia(WIDE_QUERY);
        const apply = () => setWide(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, []);
    return wide;
}

/**
 * 通知のタブ。**モックのタブとは中身が違う**（理由は下の `tabs` を見よ
 * ——モックの「お知らせ」を作る側がコードに存在しないため）。
 *
 * ## 別の画面（`/notifications`）にはしない（2026-09-22 に再確認）
 *
 * モック 05 は1画面ぶんの通知一覧だが、**ページは足さずにこのベルを
 * 1画面ぶんに作り替えた**（スマホは全画面のシート・PC は板）。
 *
 *   - 一覧は `NOTIFS_MAX = 50` で頭打ち（`api-user/src/notify.ts`）
 *     ＝**ページ送りが要らない**ので、ルートを足す実用上の理由が無い
 *   - 画面を足すと**通知を読む導線が2つ**になる（ベルと URL）
 *   - このベルが積み上げてきた正しさ——取得世代（`fetchSeqRef`）・
 *     既読世代（`readSeqRef`）・開閉世代（`panelSeqRef`）・`status` の
 *     3状態・ブロック除去後の未読数——を、写した側で作り直すことになる。
 *     ここは4周ぶんの回帰を吸って今の形になっている
 *   - ログインした人しか見ない画面なので、**検索の面積は1ページも
 *     増えない**（増えるのは `noindex` と `robots.txt` の世話だけ）。
 *     このサイトの優先度は「SEO・表示速度・安定性」（`CLAUDE.md`）
 *
 * モックが全画面なのは iOS のタブバーに枠があるからで、Web ではこのベルが
 * その枠にあたる。**「全画面の見た目」はルートを足さずに作れる**ので、
 * モックに合わせるために画面を増やす必要は無かった。
 */
export type NotifTab = "all" | "like" | "comment" | "follow";

export const NOTIF_TABS: readonly NotifTab[] = ["all", "like", "comment", "follow"] as const;

const TAB_LABEL: Record<NotifTab, { ja: string; en: string }> = {
    all: { ja: "すべて", en: "All" },
    like: { ja: "いいね", en: "Likes" },
    comment: { ja: "コメント", en: "Comments" },
    follow: { ja: "フォロー", en: "Follows" },
};

/**
 * タブの絞り込み。
 *
 * **`storyreply` は「コメント」に入れる。** 通知の種別は4つ（like /
 * comment / follow / storyreply）あるのにモックのタブは3つなので、
 * 素直に `type === tab` で絞ると**ストーリーへの返信が「すべて」以外の
 * どのタブにも出ない**。どちらも「誰かが自分宛てに書いた」もので、
 * この下の本文は既に両方へ同じ吹き出しのアイコンを出している。
 *
 * 知らない種別は「すべて」にだけ残る（本文は出ないが、行は数に入る）。
 * ここで弾くと、種別を足した人が**タブから消えたこと**に気づけない。
 */
export function inTab(type: string, tab: NotifTab): boolean {
    if (tab === "all") return true;
    if (tab === "comment") return type === "comment" || type === "storyreply";
    return type === tab;
}

/**
 * 時間の区分。モック 05 の注釈⑤（「今日」「昨日」「今週」）と対。
 *
 * **「昨日」はモックに在って実装に無かった。** 1日前の通知が「今週」に
 * 落ちていたので、前日ぶんが2〜7日前と同じ束に混ざっていた。
 * `t` から暦日で出せる＝**サーバーに何も足さずに作れる**区分なので入れる。
 *
 * 「新着」と「それ以前」はモックに無いが**消さない**——前者は
 * 「開いたときに何が新しかったか」を出す唯一の手段（バッジは開いた瞬間に
 * 0 になる）、後者は 50件の輪に8日以上前が残るときの行き先。
 */
export type NotifBucket = "new" | "today" | "yesterday" | "week" | "older";

export const BUCKET_ORDER: readonly NotifBucket[] = ["new", "today", "yesterday", "week", "older"] as const;

const BUCKET_LABEL: Record<NotifBucket, { ja: string; en: string }> = {
    new: { ja: "新着", en: "New" },
    today: { ja: "今日", en: "Today" },
    yesterday: { ja: "昨日", en: "Yesterday" },
    week: { ja: "今週", en: "This week" },
    older: { ja: "それ以前", en: "Earlier" },
};

/**
 * 暦日の差（**転がる24時間ではなく、日付が何回変わったか**）。
 *
 * 🔴 `Math.floor((now - at) / DAY_MS)` だと、**午前0時を回った直後に
 * 「今日」の見出しの下に昨日の夜の通知が並ぶ**。しかも行は時刻だけを
 * 出す（下の `fmtTime`）ので、**午前1時に「今日 23:00」＝まだ来ていない
 * 時刻**に見える。見出しを暦日の言葉（今日・昨日）にした以上、判定も
 * 暦日にしないと表示が嘘になる。
 *
 * `Math.round` なのは夏時間のため（23時間・25時間の日がある）。
 */
export function calendarDaysAgo(at: number, now: number): number {
    const a = new Date(at); a.setHours(0, 0, 0, 0);
    const b = new Date(now); b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * どの見出しの下に置くか。
 *
 * 🔴 **「新着」は位置ではなく時刻の境界で決める。** 未読は
 * 「**先頭 N 件**」＝位置の意味を持つ数（`api-user/src/notifications.ts` の
 * `headCount`。`64a45d74` で直した回帰の中心）。タブで絞ったあとの並びに
 * 番号で当てると、**落としたぶんが先頭側だったかどうか**を見ていない
 * 同じ穴をここで掘り直すことになる。だから**絞る前の全件**から境界の
 * 時刻を1つ取り出し（`newSince`）、それ以降を新着とする——絞っても
 * 並べ替えても壊れず、開いている間に届いたぶん（より新しい `t`）も
 * 勝手に入る。
 *
 * 読めない時刻は**末尾**へ。先頭（新着）に混ぜると、壊れた行が毎回
 * 「新着」として一番上に出続ける。**この `isNaN` の枝が無くても
 * `NaN` の比較は全部 false なので最後の `older` に落ちる**が、
 * 「日付が読めない行をどこへ置くか」は並べ方の決めごとなので、
 * 比較演算子の副作用に任せずここに書く（並び替えたときに黙って壊れる）。
 */
export function bucketOf(t: string, now: number, newSince: number | null): NotifBucket {
    const at = Date.parse(t);
    if (isNaN(at)) return "older";
    if (newSince !== null && at >= newSince) return "new";
    const days = calendarDaysAgo(at, now);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days <= 7) return "week";
    return "older";
}

// 通知ベル: **いいね・コメント・フォロー**が届く場所。
// 認証済みヘッダーにのみ表示。開くと既読になり、通知タップで写真へ飛べる。
//
// **「行きたいリスト」と「旅立ちの報告」はもう無い。** 上の型のコメントに
// そう書いてあるのに、ここと空表示の本文だけが古いまま残っていて、
// **存在しない機能を2つ案内していた**（逆に、実在するコメントとフォローには
// 触れていなかった）。登録直後の人が最初に読む文なので、実態に合わせる。
export default function NotificationsBell() {
    const { locale } = useLocale();
    // **フォローバックのために要る**（`FollowAction` は未ログインを
    // 「ログインしてください」に倒すので、真偽を渡さないと既にログイン
    // している人にその案内が出る）。このベル自体は `HeaderNav` が
    // `isAuthenticated && <NotificationsBell />` で出しているので実際は
    // 常に true だが、**そこに寄りかかって true を直書きしない**
    // ——置き場所が変わった日に黙って嘘になる。
    const { isAuthenticated } = useAuth();
    const wide = useWidePanel();
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
    const [tab, setTab] = useState<NotifTab>("all");
    /**
     * 「新着」の境界（この時刻以降が新着）。**バッジ（`unread`）とは別に持つ。**
     *
     * バッジは開いた瞬間に 0 にする（既読化）ので、それを見出しに使うと
     * **開いた瞬間に「新着」が消えて、何が新しかったのか分からなくなる**。
     * だから境界は開いている間**下げない**（下の `load` の `Math.min`）。
     * 閉じてから取り直したぶんで初めて下がる＝次に開いたときには
     * 正しく「新着なし」になる。
     */
    const [newSince, setNewSince] = useState<number | null>(null);
    /**
     * `open` を effect の外から読むための控え。`load` は `[]` deps の
     * `useCallback` なので、`open` を直接読むと取得のたびに作り直しになり、
     * ポーリングの `setInterval` まで張り直される。
     */
    const openRef = useRef(false);

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
    //
    // `panelSeqRef` … **開閉の世代。** 開くときと閉じるときに進める。
    //   これが無いと、**閉じた直後に着地した古い GET が `newSince` を
    //   据え直す**——`closePanel` が境界を捨てた後に、開いていた頃に
    //   投げた応答（まだ `unread > 0` を返す）が `openRef.current === false`
    //   の枝に入って `bound` を書き戻す。次に開くと `prev` が非 null なので
    //   「開いている間は下げない」に守られ、**読み終わった通知が永久に
    //   「新着」に出続ける**。開いてすぐ閉じる（回線が細いと普通に起きる）
    //   だけで踏む。
    const fetchSeqRef = useRef(0);
    const readSeqRef = useRef(0);
    const panelSeqRef = useRef(0);
    const load = useCallback(async () => {
        const mine = ++fetchSeqRef.current;
        const readAt = readSeqRef.current;
        const panelAt = panelSeqRef.current;
        try {
            const res = await userFetch("/user/notifications");
            if (!res.ok) { if (mine === fetchSeqRef.current) setStatus("error"); return; }
            const data = await res.json() as { items?: Notif[]; unread?: number };
            if (mine !== fetchSeqRef.current) return;   // 追い越された。丸ごと捨てる
            // **読めない行は落としてから入れる。** ここはレイアウトに常駐
            // しているので、**開いたあとは**描画中に落ちるとどのページでも
            // `ErrorBoundary` のカードになる（60秒ごとに取り直すので
            // 「再試行」も効かない）
            const rows = usableRows<Notif>(data.items, "GET /user/notifications");
            if (!rows) {
                // **配列でない応答を「まだ通知はありません」にしない。**
                // 上の `status` のコメントが「『まだ』『0件』『取れなかった』を
                // 分ける」と書いているとおり。`?? []` にしていたので、
                // 届いている通知が無いように見えていた
                setStatus("error");
                return;
            }
            setItems(rows);
            setUnread(readAt === readSeqRef.current && typeof data.unread === "number" ? data.unread : 0);
            // **見出しの境界は、既読化の世代で捨てない。** バッジ（すぐ上）は
            // 既読化に追い越されたら 0 に倒すが、こちらは「開いたときに何が
            // 新しかったか」を出すためのものなので、生の `unread` から作る。
            //
            // 未読は先頭 N 件なので、境界は **N 件目の時刻**。落としたぶんは
            // サーバーが既に除いている（`getNotifications` がブロック相手を
            // 消したうえで未読も数え直す）ので、ここは受け取った並びを
            // そのまま信じてよい。
            //
            // **先頭 N 件のうち、読める時刻の最小**を取る。`rows[head-1].t` の
            // 1件だけを見ていたら、**その行の時刻が壊れているだけで「新着」の
            // 見出しが丸ごと消えた**（実際にテストで踏んだ）。最小を探せば、
            // 壊れた行は `bucketOf` が「それ以前」へ落とすだけで済み、
            // 残りの未読は正しく新着に入る。
            //
            // 🔴 **数えるのは `rows` ではなく生の `data.items`。** `unread` は
            // サーバーが返した並びでの「先頭 N 件」で、`usableRows` は
            // **その並びから読めない行を1件ずつ抜く**（`filter`）ので、
            // `rows` の先頭 N 件は別のものを指す:
            //
            //     サーバー  [p1(未読), null(未読), p3(既読)]  unread=2
            //     rows      [p1, p3]  → 先頭2件 = p1 と **既読の p3**
            //
            // ＝境界が既読側まで下がり、**読み終わった通知が「新着」に
            // 化ける**。`64a45d74` がサーバー側で塞いだ「落としたぶんが
            // 先頭側だったかを見ていない」穴を、画面側で開け直すことになる。
            const serverUnread = typeof data.unread === "number" ? data.unread : 0;
            const raw = data.items as unknown[];
            const head = Math.max(0, Math.min(serverUnread, raw.length));
            let bound: number | null = null;
            for (let i = 0; i < head; i++) {
                const t = (raw[i] as { t?: unknown } | null)?.t;
                const at = typeof t === "string" ? Date.parse(t) : NaN;
                if (!isNaN(at) && (bound === null || at < bound)) bound = at;
            }
            // 開閉をまたいだ応答は境界に触らない（上の `panelSeqRef`）
            if (panelAt === panelSeqRef.current) setNewSince((prev) => {
                // 閉じている間は素直に入れ替える（次に開いたときの正解）
                if (!openRef.current) return bound;
                // 開いている間は下げない。`Math.min` なので、開いたあとに
                // 届いたぶん（より新しい `t`）は境界より後ろ＝新着に入る
                if (prev === null) return bound;
                if (bound === null) return prev;
                return Math.min(prev, bound);
            });
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

    /**
     * 閉じる口は**1つにまとめる**。
     *
     * `setOpen(false)` は3か所から呼ばれる（外側の覆い・通知のリンク・ベル
     * そのもの）。`openRef` を片方だけで下ろしていたら、**外側を押して
     * 閉じた人は `openRef` が立ったまま**になり、「新着」の境界が二度と
     * 下がらない＝読み終わった通知が延々「新着」に出続ける。
     */
    const closePanel = useCallback(() => {
        panelSeqRef.current++;
        openRef.current = false;
        setOpen(false);
        // 🔴 **閉じたら境界を捨てる。** 「開いている間は下げない」だけだと、
        // 下げられるのは**閉じている間に走った常駐ポーリング**（60秒に1回・
        // 裏タブでは走らない）だけになり、
        //
        //     開く → 5秒で閉じる → すぐ開き直す
        //
        // で `openRef` が先に立つので境界が据え置かれ、**読み終わった通知が
        // 「新着」に出続ける**（ポーリングを挟まないと再現する）。
        // 閉じた時点で捨てておけば、次に開いたときの取得が素直に決め直す。
        setNewSince(null);
    }, []);

    // **Escape で閉じる**（既存の作法。`isImeKey` の判定まで込み）。
    // 開いている間だけ拾う。タブが4つ増えたぶん、閉じる手段が
    // 「ベルを押す／外側を押す」のマウス2つだけなのは辛い
    useEscapeKey(open, closePanel);

    /**
     * 全画面のシート（スマホ）だけ Tab を閉じ込める。
     *
     * **PC の板には掛けない。** あちらは `aria-modal` を名乗らない
     * ポップオーバーで、裏のページは読み上げにも残る。閉じ込めると
     * 「Tab で抜けられない板」になり、Escape を知らない人が詰む。
     * スマホのシートは画面を覆う＝裏に届く操作が無いので、
     * `aria-modal="true"` と閉じ込めが正しい（`HeaderNav` のメニューと同じ）。
     */
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(open && !wide, sheetRef, bellRef);

    /**
     * 全画面のシートの間だけ、裏のページを固定する。
     *
     * **画面を覆う `aria-modal` は全部これを掛けている**——`HeaderNav` の
     * メニュー・`FollowingSheet`・`DeleteConfirmModal`・`DeleteAccountModal`・
     * `PostSheet`・`StoryViewer`。掛けないと、一覧を端まで送ってさらに引いた
     * ときに**裏のページが動く**（スクロール連鎖）。
     *
     * **PC の板には掛けない。** あちらは画面を覆わないポップオーバーで、
     * 裏を固定すると「板が開いている間ページが動かせない」になる。
     */
    useEffect(() => {
        if (!open || wide) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [open, wide]);

    /**
     * 未読を全部既読にする。モック 05 の注釈⑦「右上の『すべて既読にする』で、
     * 未読の通知をまとめて既読に」。
     *
     * 🔴 **数を触るので、先に書き出しておく**（`CLAUDE.md`「4周連続で『数』の
     * 扱いから回帰を出している」）:
     *
     *   どこから来るか … `GET /user/notifications` の `unread`。サーバー側は
     *     `min(stored, items.length)` を採ったうえ、ブロック相手を除いた
     *     先頭ぶんを数え直している（`notifications.ts` の `headCount`）
     *   何を数えているか … **位置**。追記は `list_append(:new, existing)` で
     *     先頭が新しいので、`unread` は「**先頭 N 件**が未読」の N。
     *     総量ではない
     *   画面のどこに出るか … ベルのバッジ（`9+` で頭打ち）と、**この操作を
     *     出すかどうか**の判定だけ。区分の見出し（「新着」）は
     *     **別の値**（`newSince`）で決まる
     *   ずれたらどちらへ倒れるか … ここは 0 を描く側なので、ずれる向きは
     *     「未読が残っているのにバッジが消える」。**だから `newSince` には
     *     触らない**——触ると「何が新しかったか」まで消えて、読み落としが
     *     画面から復元できなくなる。バッジが消えても見出しが残るのが、
     *     この2値を分けている理由そのもの
     *
     * **世代を先に進める。** 逆にすると、飛んでいる GET の応答が
     * `readAt === readSeqRef.current` を満たし、サーバーが返した古い
     * `unread` でバッジが復活する（`load` のコメントの通り）。
     *
     * **開いたときの既読化と同じ処理**。`toggleOpen` から切り出して1本にした
     * ——2か所に書くと、片方だけ世代を進める形が必ず生まれる。
     */
    const markAllRead = useCallback(() => {
        readSeqRef.current++;
        setUnread(0);
        void userFetch("/user/notifications", { method: "PUT" }).catch(() => { /* ignore */ });
    }, []);

    const toggleOpen = () => {
        const next = !open;
        if (!next) { closePanel(); return; }
        panelSeqRef.current++;
        openRef.current = next;
        setOpen(next);
        if (next) {
            // **開くたびに「すべて」へ戻す。** 絞ったまま閉じると、次に
            // 届いた別の種別（フォローで絞ったあとの いいね）が**バッジには
            // 出るのに開いても見えない**。絞りは「いま探している」操作で、
            // 覚えておくものではない
            setTab("all");
            // 開いた時点の中身を出す。バッジが 0 でも、閉じている間に
            // 届いた通知はここで初めて見える。
            void load();
            if (unread > 0) markAllRead();
        }
    };

    /**
     * 行の時刻。
     *
     * **見出しと同じ語を行に書かない。** 区分の見出し（今日／今週／それ以前）が
     * 粗い位置を持つので、行は**その中での位置**を出す:
     *
     *     今日      → 時刻（14:32）      見出しが「今日」と言っているので繰り返さない
     *     昨日      → 時刻（23:10）      **同上**。「昨日」の見出しを足したので
     *     1週間以内 → 「3日前」
     *     それ以前  → 日付（8/22）       「45日前」より置き場所が分かる
     *
     * 以前は今日のぶんも「今日」と書いていた。見出しを足した以上、
     * そのままだと**同じ語が2つ並ぶ**。
     *
     * 🔴 **区分を足したら、ここも合わせること。** 「昨日」の区分を入れた回、
     * ここを直さないと**「昨日」の見出しの下に「昨日」と書いた行が並ぶ**
     * ——この doc がまさに禁じている形を、区分を足した側が作る。
     * 見出しが暦日の言葉を持つ区分（今日・昨日）は、行は時刻を出す。
     */
    const fmtTime = (iso: string, bucket: NotifBucket) => {
        const t = Date.parse(iso);
        if (isNaN(t) || !now) return "";
        // **見出しと同じ物差し**（暦日）で数える。転がる24時間のままだと
        // 午前1時に「今日 23:00」＝まだ来ていない時刻に見える
        const days = calendarDaysAgo(t, now);
        const d = new Date(t);
        const clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
        // 🔴 **暦日の語を落としてよいのは、その見出しが暦日を言う区分だけ。**
        //
        // 「昨日」の区分を足した回、ここを `days <= 1` で時刻に倒して**回帰を
        // 出した**。未読は暦日より先に「新着」へ吸い上げられる（`bucketOf` は
        // `newSince` を最初に見る）ので、**「新着」の下に日付の手がかりが無い
        // 「23:00」が並ぶ**。実測:
        //
        //     見出し  ['新着']
        //     行      '今朝の人 …いいねしました 9:00'
        //             '昨夜の人 …いいねしました 23:00'
        //
        // 新しい順なのに時刻が上がるので、**2行目が「今日の23時」＝まだ来て
        // いない時刻**に読める——`calendarDaysAgo` の doc がまさに禁じている形を、
        // 区分を足した側が別の経路で作り直していた。朝に開くほど強く出る。
        //
        // だから見出しで分ける。`today` / `yesterday` は見出しが暦日を言うので
        // 行は時刻だけ。`new` / `week` / `older` は言わないので、行が言う。
        if (bucket === "today" || bucket === "yesterday") return clock;
        // 先の時刻（端末の時計がずれている）も「今日」側に倒す
        if (days <= 0) return clock;
        if (days === 1) return locale === "en" ? "yesterday" : "昨日";
        if (days <= 7) return locale === "en" ? `${days}d ago` : `${days}日前`;
        return `${d.getMonth() + 1}/${d.getDate()}`;
    };

    /**
     * タブのキーボード操作（WAI-ARIA のタブの作法）。
     *
     * `role="tab"` を名乗った以上、**矢印で移動できないと壊れて見える**
     * ——支援技術は「1/4」と読み上げるのに動かない。合わせて
     * **タブストップは tablist 全体で1つ**にする（roving tabindex）。
     * 4つ全部が Tab の停止点だと、通知を1件読むまでに4回 Tab を押す。
     */
    const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        // 計算は `lib/utils/tabKeys.ts`（`SpotPageClient` と共有）。
        // 選び方とフォーカスの送り先だけがここの仕事
        const to = nextTabIndex(e.key, NOTIF_TABS.indexOf(tab), NOTIF_TABS.length);
        if (to === null) return;
        // 矢印での横スクロールを起こさない
        e.preventDefault();
        const next = NOTIF_TABS[to];
        setTab(next);
        // 選んだタブへフォーカスも移す（roving tabindex は「選択中だけが
        // 停止点」なので、移さないと次の Tab が一覧を飛ばす）
        document.getElementById(`notif-tab-${next}`)?.focus();
    };

    // タブで絞る → 区分でまとめる、の順。**区分は絞る前の `newSince` で
    // 決まる**ので、どのタブでも「新着」の中身は変わらない
    // （フォローのタブに立つ「新着」は、フォローの新着だけになる）。
    // **key に並びの番号を混ぜない。** `-${i}` を含めていたので、ポーリングで
    // 先頭に1件挿入されると**以降の行の key が全部ずれ、全部作り直される**
    // ——リンクに当たっていたキーボードのフォーカスが `<body>` へ落ち、
    // アバターとサムネの `<img>` が再マウントして描き直しになる。
    // 中身から作れば、増えた1件だけが新しい行になる。
    //
    // 同じ人が同じ写真に同じミリ秒で2回——は作れない（いいねは冪等、
    // コメントとフォローと返信は `t` が別々に作られる）。
    const shownRows = items
        .map((n) => ({ n, key: `${n.type}-${n.byId ?? ""}-${n.photoId || n.targetUserId || ""}-${n.t}` }))
        .filter(({ n }) => inTab(n.type, tab));
    const groups = BUCKET_ORDER
        .map((bucket) => ({ bucket, rows: shownRows.filter(({ n }) => bucketOf(n.t, now, newSince) === bucket) }))
        .filter((g) => g.rows.length > 0);

    // ───────── 寸法表（スマホ＝モックの実測／PC＝別に設計） ─────────
    //
    // **owner の指示（2026-09-22）で2つ持つ。** スマホはモック 05 の画素から
    // 測った値、PC は**横に引き伸ばさない**別の値。
    //
    // 測り方は `docs/mockups/README.md` のとおり——端末画面の幅を 393px と
    // して比を取る。この画像は**画面の中身が x=289..666（377 画像px）**
    // だったので **1 画像px ≒ 1.042 CSS px**。
    //
    // 🔴 **端の明るい2px は画面ではなく筐体の縁。** 最初そこを画面の端と
    // 読んで x=275..680（410px）で測り、左の余白を 30px と出していた。
    // 生の画素を並べると「縁の輝き（200超）→ 黒い額縁（0〜5）→ 画面の下地
    // （15）」の3層で、**下地が始まるのは 289** だった。
    //
    //     要素              実測(画像px)  → CSS px    採った値
    //     アバター              46           48         48
    //     サムネイル            53×54        55×56      56
    //     区分の見出し（墨）    14           16         15
    //     本文（墨）            12           14         14
    //     タブの錠剤           106×34       110×35      高さ36
    //     フォローバック       117×28       122×29      高さ32（指のため上げた）
    //     左右の余白            19 / 10      20 / 10    16
    //
    // 文字は墨の高さから逆算する（漢字 ≈ 0.88em）。**左右の余白だけ
    // モックに従わない**——19px と 10px で非対称＝生成画像の揺れなので、
    // サイトの刻み（16px）に寄せた。片側だけ合わせる方が歪む。
    const M = wide
        ? {
            title: 15, heading: 11, body: 13, time: 11,
            avatar: "w-10 h-10", avatarIcon: "w-5 h-5", thumb: "w-10 h-10", emptyBell: "w-10 h-10",
            // 貼り付く見出しの下地は**容器と同じ色**であること（透けると行が裏を通る）
            headingBg: "bg-surface-2",
        }
        : {
            title: 22, heading: 15, body: 14, time: 12,
            avatar: "w-12 h-12", avatarIcon: "w-6 h-6", thumb: "w-14 h-14", emptyBell: "w-16 h-16",
            headingBg: "bg-bg",
        };

    /**
     * 上の行（題・すべて既読にする・閉じる）。
     *
     * **スマホと PC で同じものを使う。** 中身を2か所に書くと、片方だけ
     * 直した差分が必ず出る（このリポジトリが何度も踏んでいる形）。
     * 違うのは寸法表（`M`）と、閉じるボタンを出すかだけ。
     */
    const header = (
        <div
            className="flex items-center gap-1 border-b border-white/5 flex-shrink-0"
            style={{ paddingLeft: 16, paddingRight: wide ? 16 : 4, minHeight: wide ? 44 : 56 }}
        >
            <h2 className="flex-1 min-w-0 font-semibold text-white" style={{ fontSize: M.title }}>
                {locale === "en" ? "Notifications" : "通知"}
            </h2>
            {/* **未読があるときだけ出す。**
                モック 05 の注釈⑦ は常に置いているが、この実装は**開いた時点で
                既読にする**（`toggleOpen`）ので、開いた直後の `unread` は必ず 0
                ——常に置くと「押しても何も起きないボタン」になる。owner の
                「未実装の設定を、動作するボタンとして表示しない」に従い、
                **仕事があるときだけ**出す。
                実際に出るのは「開けたまま新しい通知が届いた」とき（60秒ごとの
                ポーリングが `unread` を持ち帰る）。押すと消えるのはバッジだけで、
                **「新着」の見出しは残る**（`markAllRead` の doc を見よ）。 */}
            {unread > 0 && (
                <button
                    type="button"
                    onClick={markAllRead}
                    className="inline-flex items-center gap-1 rounded-full text-link hover:bg-white/10 transition flex-shrink-0"
                    style={{ fontSize: 12, minHeight: 36, paddingLeft: 10, paddingRight: 10, touchAction: "manipulation" }}
                >
                    <CheckIcon className="w-4 h-4" aria-hidden="true" />
                    {locale === "en" ? "Mark all read" : "すべて既読にする"}
                </button>
            )}
            {/* 全画面のシートは**画面の中に閉じる口が要る**（PC の板は外側を
                押せば閉じるが、シートの外側は画面の外）。ベルを押しても
                閉じられるが、一覧を見ている人の指はベルまで戻らない */}
            {!wide && (
                <button
                    type="button"
                    onClick={closePanel}
                    aria-label={locale === "en" ? "Close notifications" : "通知を閉じる"}
                    className="inline-flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition flex-shrink-0"
                    style={{ width: 44, height: 44, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>
            )}
        </div>
    );

    /**
     * タブ。**1件も無いときは出さない**（押しても中身が変わらない操作を
     * 4つ並べることになり、下の空表示がタブの奥に隠れて読みにくくなる）。
     *
     * 🔴 **モックのタブ（「すべて／アクティビティ／お知らせ」）は採れない。**
     *   - **「お知らせ」を作る側がコードに存在しない。** 運営からの通知を
     *     書き込む経路が `api-user` にも `api` にも無く、`Notif` の型にも
     *     その種別が無い（`like`/`comment`/`follow`/`storyreply` の4つだけ）。
     *     空のタブを置くのは「架空のデータを出さない」に反する
     *   - その結果、**「アクティビティ」は「すべて」と同じ中身になる**
     *     ——お知らせが無いのだから、活動以外の通知が存在しない。
     *     同じ一覧を出すタブを2つ並べることになる
     *
     * なので**実データで絞れる4つ**（すべて／いいね／コメント／フォロー）を
     * 保つ。見た目だけモックの錠剤に寄せた（下線から）。
     */
    const tabs = items.length > 0 ? (
        <div
            role="tablist"
            aria-label={locale === "en" ? "Filter notifications" : "通知の絞り込み"}
            className="flex gap-2 overflow-x-auto no-scrollbar border-b border-white/5 flex-shrink-0"
            style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}
        >
            {NOTIF_TABS.map((key) => {
                const selected = tab === key;
                return (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`notif-tab-${key}`}
                        aria-selected={selected}
                        aria-controls="notif-tabpanel"
                        // roving tabindex（停止点は選択中の1つだけ）
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setTab(key)}
                        onKeyDown={onTabKeyDown}
                        // **選択中は白の塗り（`primary`）に墨。** デザインシステムの
                        // 「白＝位置と選択」。真鍮は合図の色で、選択状態は担わない
                        // 非選択は `/70`（`/46` が下限・`textContrast.test.ts`）
                        className={`flex-shrink-0 rounded-full transition ${selected
                            ? "bg-primary text-ink font-semibold"
                            : "bg-white/[0.07] text-white/70 hover:bg-white/15 hover:text-white/90"}`}
                        // **px で書く**（640px 未満で root が 14px に落ちるので rem 系は縮む）
                        style={{
                            fontSize: 13,
                            minHeight: 36,
                            paddingLeft: 14,
                            paddingRight: 14,
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                        }}
                    >
                        {TAB_LABEL[key][locale === "en" ? "en" : "ja"]}
                    </button>
                );
            })}
        </div>
    ) : null;

    /**
     * 1件も無いとき。**「まだ」「0件」「取れなかった」を分ける**（`status`）。
     *
     * 0件のときだけモック 05 の「空の状態」に寄せる（ベルの絵・見出し・
     * 「写真を投稿する」）。読み込み中と失敗は**文だけ**——絵と導線を出すと
     * 「通知が無い」と言い切ることになる。
     */
    const empty = (
        <div
            // スマホは残りの高さを取って**中央に置く**（モックの空の状態と同じ）。
            // PC の板は高さが中身で決まるので、余白だけで足りる
            className={`flex flex-col items-center justify-center text-center ${wide ? "" : "flex-1 min-h-0"}`}
            style={{ paddingLeft: 24, paddingRight: 24, paddingTop: wide ? 32 : 56, paddingBottom: wide ? 32 : 56 }}
        >
            {status === "error" ? (
                <p className="text-white/50" style={{ fontSize: M.time }}>
                    {locale === "en"
                        ? "Couldn't load notifications. Retrying shortly."
                        : "通知を読み込めませんでした。しばらくすると取り直します。"}
                </p>
            ) : status === "loading" ? (
                <p className="text-white/50" style={{ fontSize: M.time }}>
                    {locale === "en" ? "Loading…" : "読み込み中…"}
                </p>
            ) : (
                <>
                    <BellIcon className={`${M.emptyBell} text-white/50`} aria-hidden="true" />
                    <p className="font-semibold text-white" style={{ fontSize: M.body, marginTop: 12 }}>
                        {locale === "en" ? "No notifications yet" : "まだ通知はありません"}
                    </p>
                    <p className="text-white/50" style={{ fontSize: M.time, marginTop: 6, lineHeight: 1.7 }}>
                        {locale === "en"
                            ? "Likes, comments, story replies, and new followers will show up here."
                            : "いいね・コメント・ストーリーへの返信・フォローがここに届きます。"}
                    </p>
                    {/* モックの「空の状態」にある「写真を投稿する」。
                        **実在する画面へ送る**（`ROUTES.UPLOAD` = `/user/upload`）。
                        絵だけのボタンは置かない */}
                    <Link
                        href={ROUTES.UPLOAD}
                        onClick={closePanel}
                        className="inline-flex items-center justify-center rounded-full bg-accent-fill text-ink font-semibold hover:brightness-110 transition"
                        style={{ fontSize: 13, minHeight: 40, paddingLeft: 18, paddingRight: 18, marginTop: 16, touchAction: "manipulation" }}
                    >
                        {locale === "en" ? "Post a photo" : "写真を投稿する"}
                    </Link>
                </>
            )}
        </div>
    );

    /** 一覧（区分の見出し＋行）。スマホは残りの高さいっぱい、PC は 384px で頭打ち */
    const list = (
        <div
            id="notif-tabpanel"
            role="tabpanel"
            aria-labelledby={`notif-tab-${tab}`}
            // **スクロールする枠は、キーボードでも掴めること。**
            // 中にリンクが1つも無いタブ（退会した人からのフォロー通知だけ、
            // など）は、これが無いと**キーボードだけでは一覧を送れない**
            // （WCAG 2.1.1）
            tabIndex={0}
            className={wide
                ? "max-h-96 overflow-y-auto overscroll-contain no-scrollbar"
                : "flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar"}
        >
            {/* **そのタブだけ空**のときは、全体が0件のときと別の文を出す。
                同じ「まだ届いていません」にすると、絞っていることを忘れた人に
                **通知が消えた**ように見える */}
            {groups.length === 0 ? (
                <p
                    className="text-center text-white/50"
                    style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 32, paddingBottom: 32, fontSize: M.time }}
                >
                    {locale === "en" ? "Nothing in this tab yet." : "このタブに届いた通知はまだありません。"}
                </p>
            ) : groups.map(({ bucket, rows }) => (
                <section key={bucket}>
                    {/* 見出しは貼り付ける（繰ると、いま何の区分を見ているか
                        分からなくなる）。**透けない下地**を敷かないと行が裏を通る */}
                    <h3
                        className={`sticky top-0 z-10 ${M.headingBg} font-semibold ${bucket === "new" ? "text-link" : "text-white/50"}`}
                        style={{ fontSize: M.heading, letterSpacing: "0.08em", paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6 }}
                    >
                        {BUCKET_LABEL[bucket][locale === "en" ? "en" : "ja"]}
                    </h3>
                    <ul className="divide-y divide-white/5">
                        {rows.map(({ n, key }) => {
                            // **退会した人のフォロー通知は、開く先が墓石になる。**
                            // フォローの通知は写真を持たないので、代わりの行き先も
                            // 無い——リンクを外して文面だけ残す（コメント欄と同じ扱い）。
                            // **判定は1か所で作る。** 片方だけ厳密にすると、
                            // `deleted: "1"` のような応答でアイコンだけ伏せて
                            // 本文はリンクのまま、という食い違いになる。
                            // 迷ったら伏せる側（コメント欄も truthy 判定）。
                            const isDeleted = !!n.deleted;
                            // 通知を起こした相手。フォローの通知は `byId` と
                            // `targetUserId` の両方に同じ値が入る（`follow.ts`）
                            const byUser = String(n.byId || n.targetUserId || "");
                            // **開く先が無い通知**。判定は1か所で作る
                            // （2か所に分けると、アイコンだけ伏せて本文は
                            // リンクのまま、という食い違いになる）。
                            //   - 退会した人のフォロー通知（開く先が墓石）
                            //   - ストーリーへの返信（ストーリーに個別ページは無い。
                            //     `ROUTES.PHOTO(story-…)` は静的書き出しに
                            //     存在しないので 404 になる）
                            const goesNowhere = (isDeleted && n.type === "follow") || n.type === "storyreply";
                            // **フォローバック**（モック 05 の注釈③）。
                            //
                            // ボタンは `FollowAction` を**そのまま**使う
                            // （`variant="followBack"` で大きさと文言だけ変える）。
                            // 押したときの処理・楽観更新・「自分はフォロー
                            // できません」等の返し分けは `useFollow` の1本。
                            //
                            // **退会した人には出さない**（フォローしに行く先が
                            // 墓石で、サーバーも 404 を返す）。相手が分からない
                            // 行にも出さない。
                            const canFollowBack = n.type === "follow" && !isDeleted && !!byUser;
                            const body = (
                                <>
                                    <div className="min-w-0 flex-1">
                                        {/* `break-words`: 表示名は100文字まで通るので、
                                            空白の無い名前だと枠の外に出て**丸ごと読めなくなる**
                                            （実測: 名前の右端896px に対しパネル右端320px） */}
                                        <p className="text-white/85 leading-snug break-words" style={{ fontSize: M.body }}>
                                            {n.type === "follow" ? (
                                                <>
                                                    <UserPlusIcon className="w-3.5 h-3.5 text-link inline -mt-0.5 mr-1" />
                                                    {locale === "en"
                                                        ? <><span className="font-semibold">{n.byName}</span> followed you</>
                                                        : <><span className="font-semibold">{n.byName}</span> さんがあなたをフォローしました</>}
                                                </>
                                            ) : n.type === "like" ? (
                                                <>
                                                    <HeartIcon className="w-3.5 h-3.5 text-white inline -mt-0.5 mr-1" />
                                                    {locale === "en"
                                                        ? <><span className="font-semibold">{n.byName}</span> liked your photo</>
                                                        : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真にいいねしました</>}
                                                </>
                                            ) : n.type === "storyreply" ? (
                                                <>
                                                    <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5 text-accent inline -mt-0.5 mr-1" />
                                                    {locale === "en"
                                                        ? <><span className="font-semibold">{n.byName}</span> replied to your story</>
                                                        : <><span className="font-semibold">{n.byName}</span> さんがあなたのストーリーに返信しました</>}
                                                </>
                                            ) : n.type === "comment" ? (
                                                <>
                                                    <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5 text-accent inline -mt-0.5 mr-1" />
                                                    {locale === "en"
                                                        ? <><span className="font-semibold">{n.byName}</span> commented on your photo</>
                                                        : <><span className="font-semibold">{n.byName}</span> さんがあなたの写真にコメントしました</>}
                                                </>
                                            ) : null /* 知らない種類は何も出さない。
                                                以前はここが「旅立たせました！」の分岐で、
                                                将来わけの分からない通知が全部その文言で出る作りだった */}
                                        </p>
                                        <p className="text-white/50" style={{ fontSize: M.time, marginTop: 2 }}>{fmtTime(n.t, bucket)}</p>
                                    </div>
                                    {/* どの写真のことかが分かるよう、右端にその写真を出す */}
                                    {/* **ストーリーのサムネは出さない。** 返信の通知が持つ
                                        `photoSrc` は24時間で消えるストーリーの画像で、
                                        通知の方は残る＝**古い返信通知はすべて灰色の四角**に
                                        なる。写真の通知は消えない限り出し続けてよい */}
                                    {n.type !== "follow" && n.type !== "storyreply" && n.photoSrc && byUser && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={publicImageUrl(n.photoSrc)} alt="" loading="lazy" className={`${M.thumb} rounded-[10px] object-cover bg-white/10 flex-shrink-0`} />
                                    )}
                                </>
                            );
                            return (
                                <li
                                    key={key}
                                    className="flex items-start gap-3 hover:bg-white/5 transition-colors"
                                    style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}
                                >
                                    {/* 左のアイコンは相手のプロフィールへ。
                                        名前だけだと、名前未設定の人は既定名で表示されて
                                        誰なのか辿れず、フォローしに行けないため */}
                                    {isDeleted ? (
                                        // 退会した人。名前は既にサーバーが伏せてある
                                        <span className="flex-shrink-0">
                                            <UserAvatar userId="" className={M.avatar} iconClassName={M.avatarIcon} />
                                        </span>
                                    ) : byUser ? (
                                        <Link
                                            href={ROUTES.USER_PROFILE(byUser)}
                                            onClick={closePanel}
                                            aria-label={locale === "en" ? `Open ${n.byName}'s profile` : `${n.byName} さんのプロフィール`}
                                            className="flex-shrink-0 rounded-full active:scale-95 transition"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            <UserAvatar userId={byUser} className={M.avatar} iconClassName={M.avatarIcon} />
                                        </Link>
                                    ) : n.photoSrc ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={publicImageUrl(n.photoSrc)} alt="" loading="lazy" className={`${M.avatar} rounded-[10px] object-cover bg-white/10 flex-shrink-0`} />
                                    ) : (
                                        // **空の `src` を出さない。** 右端のサムネ（上）には
                                        // `n.photoSrc &&` のガードがあるのに、ここだけ無かった。
                                        // `<img src="">` は Chromium ではページを取り直さないが
                                        // （実測）、灰色の四角が黙って残る。人型のアイコンに
                                        // 落として「誰かからの通知」と分かる形にする
                                        <span className="flex-shrink-0">
                                            <UserAvatar userId="" className={M.avatar} iconClassName={M.avatarIcon} />
                                        </span>
                                    )}
                                    {goesNowhere ? (
                                        <div className="flex items-start gap-3 min-w-0 flex-1">{body}</div>
                                    ) : (
                                        <Link
                                            href={n.type === "follow" && n.targetUserId ? ROUTES.USER_PROFILE(n.targetUserId) : ROUTES.PHOTO(n.photoId)}
                                            onClick={closePanel}
                                            className="flex items-start gap-3 min-w-0 flex-1 active:opacity-80 transition"
                                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                                        >
                                            {body}
                                        </Link>
                                    )}
                                    {/* **リンクの外に置く。** 中に入れると
                                        `<a>` の中に `<button>` が入り（不正な入れ子）、
                                        押すと行のリンクごと発火してプロフィールへ飛ぶ */}
                                    {canFollowBack && (
                                        <div className="flex-shrink-0 self-center">
                                            <FollowAction
                                                targetUserId={byUser}
                                                isOwner={false}
                                                isAuthenticated={isAuthenticated}
                                                locale={locale === "en" ? "en" : "ja"}
                                                variant="followBack"
                                                // **誰をフォローバックするのかを読み上げに出す。**
                                                // 文言だけだと「フォローバック、ボタン」が
                                                // 人数ぶん続いて区別が付かない
                                                ariaLabel={locale === "en"
                                                    ? `Follow ${n.byName} back`
                                                    : `${n.byName} さんをフォローバック`}
                                                // **返し終わったら消す。** 残すと「フォロー中」
                                                // ＝押すと解除のボタンが、密に並ぶ行の中に
                                                // 32px で居座る（誤タップで無確認に解除される）
                                                hideWhenFollowing
                                            />
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </div>
    );

    return (
        <div className="relative">
            <button
                ref={bellRef}
                onClick={toggleOpen}
                aria-label={locale === "en" ? "Notifications" : "通知"}
                aria-expanded={open}
                className="relative inline-flex items-center justify-center w-11 h-11 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition"
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
            >
                <BellIcon className="w-6 h-6" />
                {unread > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-[10px] font-bold text-ink flex items-center justify-center">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {open && (wide ? (
                /* ───── PC（1024px 以上）: ベルから吊る板 ─────
                   **モックを横に伸ばさない**（owner の指示）。一覧は
                   `NOTIFS_MAX = 50` で頭打ちなので、板のまま高さで繰る。
                   幅だけ 320px → 384px に広げた（本文を 14px にすると
                   320px では2行が3行に割れる）。 */
                <>
                    {createPortal(
                        <div className="fixed inset-0 z-40" onClick={closePanel} aria-hidden="true" />,
                        document.body,
                    )}
                    <div className="absolute right-0 top-full mt-2 z-50 w-96 max-w-[85vw] rounded-2xl bg-surface-2/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in">
                        {header}
                        {tabs}
                        {items.length === 0 ? empty : list}
                    </div>
                </>
            ) : createPortal(
                /* ───── スマホ: モックのとおり「1画面ぶんの通知一覧」 ─────
                   **body へポータルする。** ヘッダーは `backdrop-blur` を
                   持つので、CSS 仕様により固定配置の**包含ブロックが
                   ヘッダーになる**——ベルの中に置いたままでは
                   `fixed inset-0` が画面いっぱいにならない
                   （`HeaderNav` がメニューを body へ出しているのと同じ理由）。

                   **ヘッダーの下から始める。** モックもヘッダー（ロゴ・
                   ベル・アバター）を残したまま下に一覧を敷いているので、
                   `HeaderNav` のメニューと同じく、ヘッダーの実際の高さ
                   （`--header-h`・上の安全領域込み）に合わせる。ベルがそのまま
                   閉じる口として残る。 */
                <div
                    ref={sheetRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label={locale === "en" ? "Notifications" : "通知"}
                    className="fixed left-0 right-0 bottom-0 top-[var(--header-h)] z-50 flex flex-col bg-bg"
                    // ホームインジケーターの下に一覧の最後の行が隠れないように
                    style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                    {header}
                    {tabs}
                    {items.length === 0 ? empty : list}
                </div>,
                document.body,
            ))}
        </div>
    );
}
