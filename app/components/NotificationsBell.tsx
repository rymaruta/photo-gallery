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
import { publicImageUrl } from "@/lib/utils/seo";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
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
 * 通知のタブ。モックの「すべて／いいね／コメント／フォロー」と対。
 *
 * **別の画面（`/notifications`）にはしない。** 一覧は `NOTIFS_MAX = 50` で
 * 頭打ち（`api-user/src/notify.ts`）＝ページ送りが要らないので、全画面に
 * する実用上の理由が無い。逆に画面を足すと**通知を読む導線が2つ**になり、
 * しかもこのベルが積み上げてきた正しさ（取得世代・既読世代・`status` の
 * 3状態・ブロック除去後の未読数）を写した側で作り直すことになる。
 * モックが全画面なのは iOS のタブバーに枠があるからで、Web ではこのベルが
 * その枠にあたる。
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

/** 時間の区分。モックの「新着」「今日」の見出しと対 */
export type NotifBucket = "new" | "today" | "week" | "older";

export const BUCKET_ORDER: readonly NotifBucket[] = ["new", "today", "week", "older"] as const;

const BUCKET_LABEL: Record<NotifBucket, { ja: string; en: string }> = {
    new: { ja: "新着", en: "New" },
    today: { ja: "今日", en: "Today" },
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
            if (unread > 0) {
                readSeqRef.current++;
                setUnread(0);
                void userFetch("/user/notifications", { method: "PUT" }).catch(() => { /* ignore */ });
            }
        }
    };

    /**
     * 行の時刻。
     *
     * **見出しと同じ語を行に書かない。** 区分の見出し（今日／今週／それ以前）が
     * 粗い位置を持つので、行は**その中での位置**を出す:
     *
     *     今日      → 時刻（14:32）      見出しが「今日」と言っているので繰り返さない
     *     昨日      → 「昨日」
     *     1週間以内 → 「3日前」
     *     それ以前  → 日付（8/22）       「45日前」より置き場所が分かる
     *
     * 以前は今日のぶんも「今日」と書いていた。見出しを足した以上、
     * そのままだと**同じ語が2つ並ぶ**。
     */
    const fmtTime = (iso: string) => {
        const t = Date.parse(iso);
        if (isNaN(t) || !now) return "";
        // **見出しと同じ物差し**（暦日）で数える。転がる24時間のままだと
        // 午前1時に「今日 23:00」＝まだ来ていない時刻に見える
        const days = calendarDaysAgo(t, now);
        const d = new Date(t);
        // 先の時刻（端末の時計がずれている）も「今日」側に倒す
        if (days <= 0) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
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
                        <div className="fixed inset-0 z-40" onClick={closePanel} aria-hidden="true" />,
                        document.body,
                    )}
                    <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[85vw] rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in">
                        <div className="px-4 py-2.5 border-b border-white/5">
                            {/* **`h2` にする。** 区分の見出しを `h3` にしたので、
                                ここが `span` のままだと**見出しの階層が飛ぶ**
                                （読み上げの「見出しへ移動」でパネルの題に着けない）。
                                見た目は変えない——字の大きさも太さも据え置き */}
                            <h2 className="text-xs font-semibold tracking-widest uppercase text-white/50">
                                {locale === "en" ? "Notifications" : "通知"}
                            </h2>
                        </div>
                        {/* **1件も無いときはタブを出さない。** 押しても中身が
                            変わらない操作を4つ並べることになり、しかも下の
                            「まだ届いていません／読み込めませんでした」が
                            タブの奥に隠れて読みにくくなる */}
                        {items.length > 0 && (
                            <div
                                role="tablist"
                                aria-label={locale === "en" ? "Filter notifications" : "通知の絞り込み"}
                                className="flex border-b border-white/5"
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
                                            // **`/50` より薄くしない**（黒地で 5.28:1・
                                            // `textContrast.test.ts` の下限）。選択中との差は
                                            // 色だけに頼らず下線でも出す
                                            className={`flex-1 border-b-2 transition ${selected
                                                ? "border-white text-white font-semibold"
                                                : "border-transparent text-white/50 hover:text-white/80"}`}
                                            // **px で書く**（640px 未満で root が 14px に
                                            // 落ちるので rem 系は縮む）
                                            style={{
                                                fontSize: "12px",
                                                paddingTop: "10px",
                                                paddingBottom: "8px",
                                                minHeight: "44px",
                                                touchAction: "manipulation",
                                                WebkitTapHighlightColor: "transparent",
                                            }}
                                        >
                                            {TAB_LABEL[key][locale === "en" ? "en" : "ja"]}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {items.length === 0 ? (
                            <p className="px-4 py-8 text-center text-xs text-white/50">
                                {status === "error"
                                    ? (locale === "en"
                                        ? "Couldn't load notifications. Retrying shortly."
                                        : "通知を読み込めませんでした。しばらくすると取り直します。")
                                    : status === "loading"
                                        ? (locale === "en" ? "Loading…" : "読み込み中…")
                                        : (locale === "en"
                                            ? "Likes, comments, story replies, and new followers will show up here."
                                            : "いいね・コメント・ストーリーへの返信・フォローがここに届きます。")}
                            </p>
                        ) : (
                            <div
                                id="notif-tabpanel"
                                role="tabpanel"
                                aria-labelledby={`notif-tab-${tab}`}
                                // **スクロールする枠は、キーボードでも掴めること。**
                                // 中にリンクが1つも無いタブ（退会した人からの
                                // フォロー通知だけ、など）は、これが無いと
                                // **キーボードだけでは一覧を送れない**（WCAG 2.1.1）
                                tabIndex={0}
                                className="max-h-96 overflow-y-auto no-scrollbar"
                            >
                            {/* **そのタブだけ空**のときは、全体が0件のときと
                                別の文を出す。同じ「まだ届いていません」にすると、
                                絞っていることを忘れた人に**通知が消えた**ように
                                見える */}
                            {groups.length === 0 ? (
                                <p className="px-4 py-8 text-center text-xs text-white/50">
                                    {locale === "en"
                                        ? "Nothing in this tab yet."
                                        : "このタブに届いた通知はまだありません。"}
                                </p>
                            ) : groups.map(({ bucket, rows }) => (
                            <section key={bucket}>
                                {/* 見出しは貼り付ける（384px の枠を繰ると、
                                    いま何の区分を見ているか分からなくなる）。
                                    **透けない下地**を敷かないと行が裏を通る */}
                                <h3
                                    className={`sticky top-0 z-10 bg-[#16181c] px-4 py-1.5 font-semibold ${bucket === "new" ? "text-sky-400" : "text-white/50"}`}
                                    style={{ fontSize: "11px", letterSpacing: "0.08em" }}
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
                                    // **開く先が無い通知**。判定は1か所で作る
                                    // （2か所に分けると、アイコンだけ伏せて本文は
                                    // リンクのまま、という食い違いになる）。
                                    //   - 退会した人のフォロー通知（開く先が墓石）
                                    //   - ストーリーへの返信（ストーリーに個別ページは無い。
                                    //     `ROUTES.PHOTO(story-…)` は静的書き出しに
                                    //     存在しないので 404 になる）
                                    const goesNowhere = (isDeleted && n.type === "follow") || n.type === "storyreply";
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
                                                    ) : n.type === "storyreply" ? (
                                                        <>
                                                            <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5 text-amber-300 inline -mt-0.5 mr-1" />
                                                            {locale === "en"
                                                                ? <><span className="font-semibold">{n.byName}</span> replied to your story</>
                                                                : <><span className="font-semibold">{n.byName}</span> さんがあなたのストーリーに返信しました</>}
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
                                                <p className="text-[11px] text-white/50 mt-0.5">{fmtTime(n.t)}</p>
                                            </div>
                                            {/* どの写真のことかが分かるよう、右端にその写真を出す */}
                                            {/* **ストーリーのサムネは出さない。** 返信の通知が持つ
                                                `photoSrc` は24時間で消えるストーリーの画像で、
                                                通知の方は残る＝**古い返信通知はすべて灰色の四角**に
                                                なる。写真の通知は消えない限り出し続けてよい */}
                                            {n.type !== "follow" && n.type !== "storyreply" && n.photoSrc && (n.byId || n.targetUserId) && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={publicImageUrl(n.photoSrc)} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                            )}
                                        </>
                                    );
                                    return (
                                        <li key={key} className="flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
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
                                                    onClick={closePanel}
                                                    aria-label={locale === "en" ? `Open ${n.byName}'s profile` : `${n.byName} さんのプロフィール`}
                                                    className="flex-shrink-0 rounded-full active:scale-95 transition"
                                                    style={{ touchAction: "manipulation" }}
                                                >
                                                    <UserAvatar userId={String(n.byId || n.targetUserId)} className="w-10 h-10" iconClassName="w-5 h-5" />
                                                </Link>
                                            ) : n.photoSrc ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={publicImageUrl(n.photoSrc)} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover bg-white/10 flex-shrink-0" />
                                            ) : (
                                                // **空の `src` を出さない。** 右端のサムネ（下）には
                                                // `n.photoSrc &&` のガードがあるのに、ここだけ無かった。
                                                // `<img src="">` は Chromium ではページを取り直さないが
                                                // （実測）、灰色の四角が黙って残る。人型のアイコンに
                                                // 落として「誰かからの通知」と分かる形にする
                                                <span className="flex-shrink-0">
                                                    <UserAvatar userId="" className="w-10 h-10" iconClassName="w-5 h-5" />
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
                                        </li>
                                    );
                                })}
                            </ul>
                            </section>
                            ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
