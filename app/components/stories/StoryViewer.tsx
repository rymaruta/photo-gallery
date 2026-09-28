"use client";

import { usableRows } from "../../../lib/utils/apiRows";
import { seekWhenReady } from "../../../lib/utils/mediaSeek";
import { safeSongPreviewUrl } from "../../../lib/utils/mediaHosts";
import { dropCachedPhoto } from "../../../lib/utils/photoCache";
import { publicImageUrl } from "@/lib/utils/seo";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { HeartIcon, PaperAirplaneIcon, XMarkIcon, EyeIcon, EyeSlashIcon, SpeakerWaveIcon, SpeakerXMarkIcon, TrashIcon, MusicalNoteIcon, PhotoIcon, ChatBubbleOvalLeftIcon, MapPinIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import StoryActionSheet, { type StorySheetItem } from "./StoryActionSheet";
import ReportDialog from "../ReportDialog";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import UserAvatar from "../UserAvatar";
import type { StoryGroup, StoryViewer as ViewerEntry } from "@/lib/stories";
import { timeAgo } from "@/lib/stories";
import { log } from "@/lib/utils/log";
import type { StoryVoteChoice, StoryVoteState } from "@/lib/utils/storyText";
import { useMusic } from "../../music/MusicContext";
import { useFocusTrap, isBehindPriorityOverlay } from "../../../lib/hooks/useFocusTrap";
import { isImeKey } from "@/lib/utils/ime";
import { wasShortTap, type PressPoint } from "@/lib/utils/tap";
import { swipeDirection, verticalSwipeDirection } from "@/lib/utils/swipe";
import { STORY_REACTIONS, type StoryReply } from "@/lib/stories";
import StoryTextOverlay from "./StoryTextOverlay";
import { useMediaBox } from "@/lib/hooks/useMediaBox";

/** 返信の本文の上限。**サーバーの `TEXT_MAX` と対**（api-user/src/storyReplies.ts）。
 *  画面だけ緩いと、打てるのに保存で黙って切られる */
const STORY_REPLY_MAX = 200;
/**
 * 「残す」ときに一緒に送る、一覧用のサムネ・代表色・ぼかし。
 *
 * 写真のアップロード画面と**同じ道具**（`lib/utils/image.ts`）を使う
 * ——同じものを二度作らない。作れなかったら空を返す（残す方は進める）。
 */
/**
 * 画像のバイト列を取り直す。**まず同一オリジンで。**
 *
 * `item.src` は CloudFront の既定ドメイン（`CLOUDFRONT_URL`）を指すので、
 * `journey-photo.com` から見ると**別オリジン**。`fetch` の既定は
 * `mode: "cors"` なので `Access-Control-Allow-Origin` が要るが、
 * **`/uploads/*` は CORS を返していない**——キャッシュポリシーが `Origin`
 * を転送しないので S3 のバケット CORS まで届かない
 * （`public/sw.js` の `isStorablePhoto` が同じことを書いている。
 *  `PhotoPageClient` の EXIF 取得が best-effort なのも同じ理由）。
 * つまり素で `fetch(src)` すると **必ず TypeError** で、呼び出し側の
 * `.catch` が飲んで「サムネ無しで成功」になる＝直したつもりで何も
 * 変わらない、というこのリポジトリが繰り返している形。
 *
 * `/uploads/*` は**サイトと同じディストリビューションのビヘイビア**なので、
 * パスだけにすれば同一オリジンとして取れる（CORS が要らない）。
 * 取れなければ元の URL でもう一度試す——CORS が入った環境や、
 * サイト側に `/uploads/*` が無い置き方でも動くように。
 */
async function fetchImageBytes(src: string): Promise<Blob> {
    let sameOrigin = "";
    try {
        const u = new URL(src, location.href);
        if (u.origin !== location.origin && u.pathname.startsWith("/uploads/")) sameOrigin = u.pathname;
    } catch { /* URL でなければそのまま */ }
    if (sameOrigin) {
        const res = await fetch(sameOrigin).catch(() => null);
        if (res?.ok) return await res.blob();
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    return await res.blob();
}

async function buildKeepThumb(src: string): Promise<{ fields: Record<string, string>; thumbKey?: string }> {
    const [{ createThumbnail, extractDominantColor, createBlurPlaceholder }, { userFetch }] = await Promise.all([
        import("../../../lib/utils/image"),
        import("../../../lib/utils/api"),
    ]);
    // **控えからは返らない。** 同一オリジンのパスに変えた＝別のキャッシュキーで、
    // しかも `<img>` が別オリジンから取った応答は tainted なので cors の
    // `fetch` には使い回されない。押すたびに1枚ぶん取り直す（CORS で必ず
    // 落ちるよりは良い、という取り引き）
    const blob = await fetchImageBytes(src);
    const file = new File([blob], "story.jpg", { type: blob.type || "image/jpeg" });
    const fields: Record<string, string> = {};
    const color = await extractDominantColor(file).catch(() => null);
    if (color) fields.dominantColor = color;
    const blur = await createBlurPlaceholder(file).catch(() => null);
    if (blur) fields.blurDataURL = blur;

    const thumb = await createThumbnail(file).catch(() => null);
    if (!thumb) return { fields };
    const presign = await userFetch("/upload/presigned-url", {
        method: "POST",
        body: JSON.stringify({ fileName: thumb.name, fileType: thumb.type, fileSize: thumb.size }),
    });
    if (!presign.ok) return { fields };
    const t = await presign.json() as { presignedUrl: string; publicUrl: string; key?: string; contentType?: string };
    const put = await fetch(t.presignedUrl, {
        method: "PUT",
        body: thumb,
        // 署名した種別で送る（違うと S3 が 403）。`max-age` は写真と揃える
        headers: { "Content-Type": t.contentType ?? thumb.type, "Cache-Control": "max-age=31536000" },
    });
    // **上げ切れなかったら URL を送らない。** 送ると、一覧が存在しない
    // ファイルを指して**割れた画像**が並ぶ（サムネ無しより悪い）
    if (!put.ok) return { fields };
    fields.thumbUrl = t.publicUrl;
    // **キーを控える。** `/keep` が通らなかったら S3 の孤児になる
    // （上げた実体を指す行がどこにも無い＝どの削除経路からも辿れない）。
    // 同じことをする既存の2経路——`app/user/upload` の `reservedThumbKey` と
    // `StoriesBar` の `uploadedKey`——は両方とも後始末を持っている。
    return { fields, thumbKey: typeof t.key === "string" ? t.key : undefined };
}

const STORY_DEFAULT_DURATION_SEC = 5; // 画像の表示時間（投稿時に未指定だったとき）
const STORY_MIN_DURATION_SEC = 3;
const STORY_MAX_DURATION_SEC = 15;

/** 曲の再生開始位置（30秒プレビュー内の秒数）。未指定・範囲外は 0。 */
export function songStartSec(startSec: unknown): number {
    const n = typeof startSec === "number" ? startSec : Number(startSec);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(29, Math.round(n));
}

/** 投稿者が指定した表示秒数をミリ秒に。未指定・範囲外は既定値に丸める。 */
export function storyDurationMs(durationSec: unknown): number {
    const n = typeof durationSec === "number" ? durationSec : Number(durationSec);
    if (!Number.isFinite(n)) return STORY_DEFAULT_DURATION_SEC * 1000;
    return Math.min(STORY_MAX_DURATION_SEC, Math.max(STORY_MIN_DURATION_SEC, Math.round(n))) * 1000;
}

type Props = {
    groups: StoryGroup[];
    initialGroupIndex: number;
    /**
     * 最初に出す1枚（その束の中の添字）。省略時は先頭。アーカイブの
     * グリッドで押した1枚から始めるために要る——先頭からしか始められないと、
     * 30枚目を見るのに29回送ることになる
     */
    initialItemIndex?: number;
    locale: "ja" | "en";
    ownUserId?: string | null;
    isAuthenticated: boolean;
    onSeen: (storyId: string) => void;
    /** 自分のストーリーを削除。成功時 true を返すと閉じる */
    onDelete?: (storyId: string) => Promise<boolean>;
    /**
     * 返信一覧からブロックした。**親はストーリーの一覧を取り直すこと。**
     *
     * サーバーは `GET /stories` でブロック両向きを除外する
     * （`api-user/src/stories.ts` の `hiddenUserIds`）が、`StoriesBar` が
     * 取り直すのは**マウント時と `isAuthenticated` の変化時だけ**。
     * 伝えないと、ブロックした相手のリングがバーに残り、開いて再生できる。
     *
     * **プロフィール経由のブロックでは起きない**——あちらはギャラリーへ
     * 戻る時点で `StoriesBar` が再マウントされて取り直すので、直さなくても
     * 症状が出ない。**症状が出る唯一の経路がこちら**、という非対称は
     * フォローの一覧でまったく同じ形を踏んだばかり。
     *
     * （再マウントの根拠は**配置**——`StoriesBar` を描くのは
     *   `GalleryPageClient` だけ、それを描くのは `app/page.tsx`（`/`）だけ。
     *   プロフィールは `/users/<id>` か `/users?id=` で別ルート。
     *   **実ブラウザでは測っていない**）
     */
    onBlocked?: (userId: string) => void;
    onClose: () => void;
};

export default function StoryViewer({ groups, initialGroupIndex, initialItemIndex = 0, locale, ownUserId, isAuthenticated, onSeen, onDelete, onBlocked, onClose }: Props) {
    const [g, setG] = useState(initialGroupIndex);
    const [i, setI] = useState(initialItemIndex);
    // 動画の進捗は **DOM に直接書く**（下の rAF ループ）。
    // state 経由にしていた頃は timeupdate（仕様上ブラウザ任せ・実測 250ms
    // 間隔）でしか動かず、120ms の transition で補間しても線が
    // 「進んでは止まり」を繰り返して見えた。しかも更新のたびにビューア全体が
    // 再描画されていた。
    const progressBarRef = useRef<HTMLDivElement | null>(null);
    const [muted, setMuted] = useState(true);
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    // ストーリーBGM: 表示中のストーリーに曲が付いていれば再生する。
    // ブラウザの自動再生ポリシーに合わせて既定はミュート（チップかスピーカーで解除）。
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // グローバル音楽（マイBGM等）とは同時に鳴らさない
    const { stop: stopGlobalMusic } = useMusic();
    useEffect(() => { stopGlobalMusic(); }, [stopGlobalMusic]);
    const [viewers, setViewers] = useState<ViewerEntry[] | null>(null);
    // 取得の失敗を「閲覧者0人」と混ぜない（SW-b8）
    const [viewersError, setViewersError] = useState(false);
    /**
     * 反応の一覧（モック09 の状態例「リアクション・閲覧者リスト」）。
     * **シートは1枚で、タブで切り替える**——以前は「閲覧者」と「届いた返信」で
     * 別々のシートが2枚在り、同じ形の入れ物を2回書いていた。
     * `null` は閉じている。
     *
     * ⚠️ **`"reactions"` の中身は絵文字の反応と文字の返信の両方**。
     * サーバーは1つの文書（`storyreplies#<id>`）に両方を入れ、`replyCount` も
     * 両方を数える（`api-user/src/storyReplies.ts` の `postStoryReply` が
     * `emoji` と `text` のどちらでも同じ配列に足す）。だから画面の名前は
     * **「リアクション・返信」**——片方だけの名前を付けると、
     * 「リアクション 3」を開いて文字の返信が並ぶ／「返信 3件」を開いて
     * ♡ が並ぶ、という嘘になる。
     *
     * 分ける必要が出たら**サーバーの形から**変えること（種類で数を割るには
     * `replyCount` を2つにするか、一覧を読んでから数えることになる。
     * 後者は「開かないと数が出ない」＝バッジが出せない）。
     */
    const [insights, setInsights] = useState<null | "viewers" | "reactions">(null);
    const viewersOpen = insights !== null;
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    /**
     * 「…」の操作シート（モック09 ⑦⑧）。一時停止・ミュート・テキストの
     * 表示・このユーザーを非表示・報告を、右上の1つの入口にまとめる
     */
    const [menuOpen, setMenuOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    /**
     * 写真の上の文字を伏せる（モック⑦「テキストを非表示」）。**写真そのものを
     * 見たいとき**のための表示設定なので、ストーリーを送っても保ったままにする
     * （1枚ごとに戻すと、押し直しが要る）。端末には覚えさせない
     */
    const [textsHidden, setTextsHidden] = useState(false);
    const menuBtnRef = useRef<HTMLButtonElement | null>(null);
    // 返信（見た人 → 投稿者）。**ストーリーごとに必ずリセットする**
    // ——打ちかけのまま次へ送られると、**書いた相手と違う人に届く**
    const [replyText, setReplyText] = useState("");
    const [replySending, setReplySending] = useState(false);
    const [replySent, setReplySent] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);
    /** ブロックが効かなかった理由（`replyError` と同じ形でその場に出す） */
    const [blockError, setBlockError] = useState<string | null>(null);
    /** 入力中は進めない（打っている間に次のストーリーへ送られない） */
    const [replyFocused, setReplyFocused] = useState(false);
    /**
     * 絵文字の列を出しているか（モック⑥: 帯は入力と ♡ と ➤ の1段で、
     * 絵文字は出ていない）。**フォーカスが外れても畳まない**——触れた瞬間に
     * 消えると、その絵文字を押せない
     */
    const [replyOpen, setReplyOpen] = useState(false);
    // 届いたリアクション・返信（投稿者だけ）
    const [replies, setReplies] = useState<StoryReply[] | null>(null);
    const [repliesError, setRepliesError] = useState(false);
    const repliesOpen = insights === "reactions";
    // ギャラリーに残す（このサイトにしかない向き。消えるもの → 検索に出るもの）
    const [keeping, setKeeping] = useState(false);
    const [keptPhotoId, setKeptPhotoId] = useState<string | null>(null);
    const [keepError, setKeepError] = useState<string | null>(null);
    /**
     * 投票スタンプの票の状態（ストーリーID → 状態）。**初期値は一覧が運ぶ**
     * （`item.vote`）。ここに在るのは、この画面で入れたぶん
     */
    const [votes, setVotes] = useState<Record<string, StoryVoteState>>({});
    const [voting, setVoting] = useState(false);
    const [voteError, setVoteError] = useState<string | null>(null);
    /** 返信の一覧から「この人からの返信を受け取らない」を押した相手 */
    const [blocking, setBlocking] = useState<string | null>(null);
    const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const reportedRef = useRef<Set<string>>(new Set());

    const group = groups[g];
    const item = group?.items[i];
    const itemHasSongRef = useRef(false);
    itemHasSongRef.current = !!item?.song;
    const isVideo = item?.mediaType === "video";
    const isOwnStory = !!ownUserId && group?.userId === ownUserId;
    // 非同期の中から「今どれを表示しているか」を見るための控え。
    // state を閉じ込めると送信を始めた時点の値になる
    const itemIdRef = useRef<string | undefined>(item?.id);
    itemIdRef.current = item?.id;
    /**
     * 返信の帯を出すか。**キャプションの位置がこれで決まる**ので1か所で持つ。
     *
     * **投稿者が「返信を許可」を切っていたら出さない**（`allowReplies`。
     * 無い＝受ける＝この列が生まれる前の投稿）。押しても 403 が返るだけの
     * 欄を置かないため——断るのはサーバー（`postStoryReply`）で、
     * ここは入口を出さないだけ。**画面側だけの防御にしない。**
     */
    const showReplyBar = !isOwnStory && isAuthenticated && item?.allowReplies !== false;
    /**
     * 左右のタップ領域の下端。**下に何か在るぶんだけ空ける。**
     * 返信の帯（`showReplyBar`）か、自分のストーリーの段（閲覧者・返信・
     * 残す）が出るときだけ。どちらも無ければ 0——空けたままだと
     * **画面の下 88px が何も受けない帯**になる。
     */
    const zoneBottom = showReplyBar || isOwnStory ? 88 : 0;

    // 表示したストーリーを既読にする（端末側）
    useEffect(() => {
        if (item) onSeen(item.id);
    }, [item, onSeen]);

    // 票の失敗の文言は、そのストーリーを離れたら消す
    useEffect(() => { setVoteError(null); }, [item?.id]);

    /** いま表示しているストーリーの票の状態（この画面で入れたぶんが優先） */
    const voteState = item ? (votes[item.id] ?? item.vote) : undefined;

    /**
     * 2択に票を入れる。**サーバーが断る条件（自分のもの・ブロック・
     * 追っていない相手・投票済み）は画面で繰り返さない**——入口を出すかどうか
     * だけをここで決め（`onVote` を渡すのは他人のストーリー・ログイン済み）、
     * 断るのは `voteStory`。
     */
    const handleVote = useCallback(async (_index: number, choice: StoryVoteChoice) => {
        // **アーカイブ（`archivedAt` あり＝ハイライトから開いた）には入れない。**
        // サーバーは期限切れに 404 を返すので、口を出すと押しても効かない的になる
        if (!item || isOwnStory || !isAuthenticated || voting || item.archivedAt) return;
        const target = item.id;
        setVoting(true);
        setVoteError(null);
        const fallback = locale === "en" ? "Could not send your vote" : "投票を送れませんでした";
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/stories/${encodeURIComponent(target)}/vote`, {
                method: "POST",
                body: JSON.stringify({ choice }),
            });
            if (!res.ok) {
                const msg = await readApiError(res, fallback);
                if (itemIdRef.current === target) setVoteError(msg);
                return;
            }
            const data = await res.json() as StoryVoteState;
            // 応答の形をそのまま持つ（`myVote` が付けば押せなくなる）
            setVotes((prev) => ({
                ...prev,
                [target]: {
                    ...(data.myVote ? { myVote: data.myVote } : {}),
                    ...(data.counts ? { counts: data.counts } : {}),
                },
            }));
        } catch (e) {
            log.warn("story vote error:", e);
            if (itemIdRef.current === target) setVoteError(fallback);
        } finally {
            setVoting(false);
        }
    }, [item, isOwnStory, isAuthenticated, voting, locale]);

    // 閲覧をサーバーに記録（ログイン済み・他人のストーリーのみ・セッション内1回）。
    // **アーカイブ（`archivedAt` あり＝ハイライトから開いた）では送らない。**
    // 期限の切れたストーリーはサーバーが 404 で記録を断るので、1枚ごとに
    // 断られるだけの往復が増える（閲覧者の取得を省くのと同じ理由）
    useEffect(() => {
        if (!item || !isAuthenticated || isOwnStory || item.archivedAt) return;
        if (reportedRef.current.has(item.id)) return;
        reportedRef.current.add(item.id);
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                await userFetch(`/stories/${encodeURIComponent(item.id)}/view`, {
                    method: "POST",
                    body: JSON.stringify({}),
                });
            } catch (e) {
                log.warn("story view report error:", e);
            }
        })();
    }, [item, isAuthenticated, isOwnStory]);

    // 自分のストーリー表示中は閲覧者リストを取得
    /**
     * 開き直したときに引き直すための世代。
     *
     * **前回が失敗していたときだけ**進める。閲覧者の数はシートを開く前の
     * ボタンに出るので取得は先に走る＝毎回引き直すと成功した回まで
     * 往復が増える（Lambda の同時実行はアカウント全体で10）。
     */
    const [viewersRetry, setViewersRetry] = useState(0);

    // **リセットは取得と分ける。** 一緒にしていたので `viewersOpen` を
    // deps に入れられなかった（入れると開いた瞬間に `setInsights(null)`
    // が走って開けない）。分けたので、取得の側に開閉を効かせられる
    useEffect(() => {
        setViewers(null);
        setViewersError(false);   // 前のストーリーの失敗を持ち越さない
        setInsights(null);
    }, [item?.id]);

    // **失敗した回は、開き直したときに引き直す。**
    // 入れていなかったので、閉じて開き直しても取り直さず（再試行ボタンも
    // 無い）、抜けるには別のストーリーへ移って戻るしかなかった
    // ——その手順は画面から読み取れない。**すぐ下の返信一覧は
    // `repliesOpen` を deps に入れていて開き直せば取り直す**＝
    // 同じファイル内で扱いが割れていた
    useEffect(() => {
        if (viewersOpen && viewersError) setViewersRetry((n) => n + 1);
    }, [viewersOpen, viewersError]);

    useEffect(() => {
        // **アーカイブ（`archivedAt` あり）では引かない。** サーバーは期限切れに
        // 必ず 0 人を返す（他人の名前は期限とともに消える側）ので、往復が
        // 1枚ごとに1本増えるだけ（同時実行はアカウント全体で10）
        if (!item || !isOwnStory || item.archivedAt) return;
        // 中断ガード。ストーリーは左右で次々に切り替わるので、前のストーリーの
        // 応答が後から届く。無かった頃は**別のストーリーの閲覧者数と名前**が
        // 出ていた（「誰が見たか」は見せ方として敏感な情報なので、
        // 取り違えたまま出すのは特に良くない）。
        // 同じファイルの閲覧報告の effect には既にこの形が入っている。
        let aborted = false;
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch(`/stories/${encodeURIComponent(item.id)}/viewers`);
                if (aborted) return;
                if (res.ok) {
                    const data = await res.json() as { viewers?: ViewerEntry[] };
                    if (aborted) return;
                    const rows = usableRows<ViewerEntry>(data.viewers, "GET /stories/{id}/viewers");
                    if (!rows) {
                        // **配列でない応答を「まだ閲覧者はいません」にしない**
                        // （下の else と同じ SW-b8）。`?? []` にしていたので
                        // 0人と同じ見た目になっていた。`viewers` は `null` の
                        // まま。**「取得中（…）」との区別は `viewersError` に持たせた**
                        // （数字を出す2か所が読む。記号には差し替えない——下を見よ）
                        // ——一度「`viewersError` が持つ」と書いたが、その時点では
                        // 数字を出す2か所が `viewersError` を読んでおらず、
                        // 失敗しても "…" のままだった（コメントだけが嘘をついていた）
                        setViewersError(true);
                        return;
                    }
                    setViewers(rows);
                    setViewersError(false);
                } else {
                    // 失敗を「まだ閲覧者はいません」と混ぜない（SW-b8）
                    setViewersError(true);
                }
            } catch (e) {
                if (!aborted) {
                    log.warn("story viewers fetch error:", e);
                    setViewersError(true);
                }
            }
        })();
        return () => { aborted = true; };
    }, [item, isOwnStory, viewersRetry]);

    // 再生し直し用のカウンタ。進捗アニメーション/動画/BGM を最初から流し直す
    const [replay, setReplay] = useState(0);
    // 写真そのものが取れなかったストーリー（削除・期限切れの掃除の直後、
    // `uploads/` の 403 など）。**理由を出す**——`alt=""` の `<img>` は
    // 失敗すると 0x0 に潰れるので、以前は真っ黒のまま表示秒数
    // （最大15秒）待たされていた。
    //
    // **動画と扱いが違うのは、時間切れが来るかどうかが違うから。**
    // 動画の進捗バーは `v.duration` が有限のときだけ書く（上の rAF）ので、
    // 読み込めなかった動画は NaN のままバーが1ミリも進まず `onEnded` も
    // 来ない——`onError={goNext}` を外すと**永久に固まる**。画像の進捗は
    // 画像と無関係な CSS アニメーション（`onAnimationEnd={goNext}`）なので、
    // 理由を出して待たせても必ず次へ進む。だから画像は飛ばさない
    // （飛ばすと、1枚しか無い人のリングが「押しても無反応」に見える）。
    const [mediaError, setMediaError] = useState(false);
    // BGM の頭出し判定用（「再生し直しで値が変わったか」を見る）
    const lastReplayRef = useRef(0);
    const lastAudioItemRef = useRef<string | null>(null);
    /** いまの一時停止が「自動再生を断られた」せいか（送ったら解く） */
    const pausedByAutoplayRef = useRef(false);
    /** 止まっているか（タップの処理から読む。`frozen` はこの下で決まる） */
    const frozenRef = useRef(false);

    /**
     * 音の入り切り。**要素の muted はタップの中で直接書く。**
     * 状態だけ変えて effect に任せると、書き換えがタップの処理の外に出る
     * ——iOS は操作の外で消音を外した再生中のメディアを止める。
     */
    const toggleMuted = useCallback(() => {
        const next = !mutedRef.current;
        const a = audioRef.current;
        if (a) {
            a.muted = next;
            // 音を出すなら、止まっている BGM もこのタップの中で鳴らす
            // （消音の自動再生まで断られた低電力モードでは、effect からは鳴らせない）
            if (!next && itemHasSongRef.current && a.paused && !frozenRef.current) {
                void a.play().catch(() => { /* 鳴らせなければ何もしない */ });
            }
        }
        const v = videoRef.current;
        if (v && !itemHasSongRef.current) v.muted = next;
        setMuted(next);
    }, []);
    // 「今のストーリーが始まってからの経過」。左タップの挙動を切り替えるのに使う
    const startedAtRef = useRef(Date.now());
    useEffect(() => { startedAtRef.current = Date.now(); }, [item, replay]);
    // **入るたびに下ろす。** 「止める印」を足したら「入るたびに下ろす」も
    // 一緒に書く（台帳の型0の派生）——下ろさないと、1枚失敗しただけで
    // 以降のストーリーが全部「読み込めません」になる。
    // `replay` も見るのは、左タップ（`restart`）で同じ1枚を読み直せるように。
    // deps は `item?.id`——同じファイルの確認シートのリセット（`[item?.id]`）と
    // 揃える。`groups` を作り直す実装が入ったとき、オブジェクト同一性で
    // 見ていると失敗表示が毎回リトライで点滅する
    useEffect(() => { setMediaError(false); }, [item?.id, replay]);

    /** 進捗バーを 0 に戻す（DOM 直書きなので state のリセットは無い） */
    const resetProgressBar = useCallback(() => {
        const bar = progressBarRef.current;
        if (bar) bar.style.transform = "translateX(-100%)";
    }, []);

    // 動画の進捗を毎フレーム書く。
    //
    // currentTime を毎フレーム読んで transform を直接書けば、画面の
    // リフレッシュレートで滑らかに動く。React の state を経由しないので、
    // ビューア全体の再描画も起きない。
    // 一時停止（長押し）中は currentTime が進まないので、バーも自然に止まる。
    useEffect(() => {
        if (!isVideo) return;
        let raf = 0;
        const tick = () => {
            const v = videoRef.current;
            const bar = progressBarRef.current;
            if (v && bar && Number.isFinite(v.duration) && v.duration > 0) {
                const ratio = Math.min(1, Math.max(0, v.currentTime / v.duration));
                // `translateX`。`scaleX` だと先端の角丸が潰れる（globals.css）
                bar.style.transform = `translateX(${(ratio - 1) * 100}%)`;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isVideo, item?.id, replay]);

    const goNext = useCallback(() => {
        resetProgressBar();
        setReplay(0);
        if (group && i < group.items.length - 1) {
            setI(i + 1);
        } else if (g < groups.length - 1) {
            setG(g + 1);
            setI(0);
        } else {
            onClose();
        }
    }, [group, groups.length, g, i, onClose, resetProgressBar]);

    // 今のストーリーを最初から再生し直す
    const restart = useCallback(() => {
        resetProgressBar();
        setReplay((n) => n + 1);
        const v = videoRef.current;
        if (v) { try { v.currentTime = 0; } catch { /* ignore */ } }
    }, [resetProgressBar]);

    // インスタと同じ: 左タップは「今のストーリーを最初から」。
    // 始まった直後（0.8秒以内）にもう一度押したときだけ1つ前へ戻る。
    const goPrev = useCallback(() => {
        if (Date.now() - startedAtRef.current > 800) {
            restart();
            return;
        }
        resetProgressBar();
        setReplay(0);
        if (i > 0) {
            setI(i - 1);
        } else if (g > 0) {
            const prevGroup = groups[g - 1];
            setG(g - 1);
            setI(Math.max(0, prevGroup.items.length - 1));
        } else {
            restart();
        }
    }, [groups, g, i, restart, resetProgressBar]);

    // 「タップ」か「長押し・スワイプ」かの判定。
    // click は指を離せば必ず発火するため、これが無いと長押しで一時停止したあと
    // 離した瞬間に前後へ移動してしまう。
    // しきい値は `lib/utils/tap.ts` に1つ（下書きの文字の置き方が同じ判断をする）
    const pressRef = useRef<PressPoint | null>(null);

    /** 長押しで止めたのか、ボタン（またはスペース）で止めたのか。
     *  指を離したときに**ボタンで止めたぶんまで再開しない**ように分ける */
    const pressPausedRef = useRef(false);

    /**
     * 直前の操作を「払った」として処理したか。
     *
     * **`pressRef` を捨てるだけでは止まらない。** `wasShortTap` は
     * 押し始めの点が無いとき **`true`（従来どおり動かす）** を返す仕様なので、
     * 払ったあとに必ず来る `click` が素通りする——実測では、左へ払って
     * 次へ進んだ直後に**左のタップ領域の `click` が前へ戻し**、その場に
     * 留まって見えた（上へ払ったときは、戻った先でストーリーが変わり
     * 操作シートが閉じた）。押し始めで毎回 false に戻す。
     */
    const swipedRef = useRef(false);

    const onZonePointerDown = useCallback((e: React.PointerEvent) => {
        pressRef.current = { t: Date.now(), x: e.clientX, y: e.clientY };
        swipedRef.current = false;
        setPaused((prev) => { pressPausedRef.current = !prev; return true; });
    }, []);

    /**
     * 指を離した。長押しで止めたときだけ再開する。
     *
     * **払った向きで振り分ける**（モック⑤「ジェスチャー操作」）:
     * 左右で前後のストーリー、下で閉じる、上で操作シート。
     * 払ったと決めたら `pressRef` を捨てる——残すと、このあと必ず来る
     * `click` が「短いタップ」と読んで**送りが二重に効く**。
     */
    const onZonePointerUp = useCallback((e: React.PointerEvent) => {
        if (pressPausedRef.current) {
            pressPausedRef.current = false;
            setPaused(false);
        }
        const p = pressRef.current;
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        const swiped = () => { swipedRef.current = true; pressRef.current = null; };
        const vertical = verticalSwipeDirection(dx, dy);
        if (vertical === 1) { swiped(); onClose(); return; }
        if (vertical === -1) { swiped(); setMenuOpen(true); return; }
        const horizontal = swipeDirection(dx, dy);
        if (horizontal === 1) { swiped(); goNext(); return; }
        if (horizontal === -1) { swiped(); goPrev(); }
    }, [onClose, goNext, goPrev]);

    /**
     * ブラウザが指の動きを取った（`pointercancel`）。長押しで止めていたなら
     * 再開し、押し始めを捨てる（この後の `pointerleave` で払いと読ませない）。
     */
    const onZonePointerCancel = useCallback(() => {
        if (pressPausedRef.current) {
            pressPausedRef.current = false;
            setPaused(false);
        }
        pressRef.current = null;
    }, []);

    /** 直前の操作が短いタップだったか（長押し・指の移動があれば false） */
    const wasTap = useCallback((e: React.MouseEvent): boolean => {
        const p = pressRef.current;
        pressRef.current = null;
        // 払いとして処理済みなら、この `click` は無かったことにする
        if (swipedRef.current) return false;
        return wasShortTap(p, e.clientX, e.clientY);
    }, []);

    // ダイアログ表示中は自動送りを止める
    /**
     * **「動きを減らす」設定なら、最初から止めて出す。**
     * 自動送りは「勝手に進む動き」そのもので、読む速さも人によって違う。
     * ただし **`animation: none` にはしない**——画像の送りはこの CSS
     * アニメーションの `onAnimationEnd` が駆動しているので、消すと
     * **二度と進まなくなる**。止めるのは再生状態だけにして、進む手段
     * （タップ・→・停止ボタン）は残す。
     * 設定を切り替えても地図と同じく開き直すまでは追随しない（初期値のみ）。
     */
    const [paused, setPaused] = useState(() =>
        typeof window !== "undefined" && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // **入力中・送信中・シートを開いている間は進めない。** 打っている途中で
    // 次へ送られると、書いた相手と違う人に届く（Instagram も入力中は止まる）。
    // **`replySending` を入れ忘れていた**——絵文字を押した時点で入力欄に
    // フォーカスは無いので `replyFocused` は効かず、応答が返るまでの間に
    // 表示が次へ移ると「送信しました」が**次の人の画面**に出ていた。
    /**
     * 🔴 **絵が出るまで、時間を進めない。**
     *
     * owner の報告:「ストーリーが3秒目くらいまで、真っ黒になる」。
     *
     * 原因は2つ重なっている:
     *
     *   1. **ストーリーは `src` しか持たない**（`api-user/src/stories.ts`）。
     *      写真はサムネ・下地色・ぼかしを持つのに、ストーリーは原寸1枚だけ
     *      ——落とし終わるまで**出せるものが何も無い**ので黒くなる
     *   2. 進捗の CSS アニメーションは**マウントで走り出す**ので、
     *      落としている間も 5秒のうちの時間が減る
     *
     * 2 の方を直す。**読み込みが済むまで凍らせる**ので、絵が出てから
     * まるまる表示時間が使える（`frozen` は一時停止と同じ道具で、
     * 動画の `pause()` にもそのまま効く）。
     *
     * `mediaError` のときは**待たない**——出る絵が無いので、待つと
     * 進まないまま固まる（`onError` は `goNext` へ繋がっている動画と違い、
     * 画像は理由を出して止まる作りなので、そこで凍ると押すまで動かない）。
     */
    /**
     * 🔴 **「まだ」へ戻すのに effect を使わない。**
     *
     * 一度 `useEffect(() => setMediaReady(false), [item?.id])` で書いたが、
     * **ref のコールバックは effect より先に走る**ので、控えにある画像を
     * ref が「読み終わっている」と拾った直後に effect が false へ戻し、
     * **永久に止まった**（テストが捕まえた）。
     *
     * 「どれが読み終わったか」を持てば、リセットそのものが要らない。
     */
    const [readyKey, setReadyKey] = useState<string | null>(null);
    const mediaKey = `${item?.id ?? ""}-${replay}`;
    const mediaReady = readyKey === mediaKey;
    const setMediaReady = useCallback((on: boolean) => { setReadyKey(on ? mediaKey : null); }, [mediaKey]);

    /**
     * 🔴 **`onLoad` だけでは足りない。**
     *
     * 控えにある画像（2枚目以降は `goNext` の手前で先読みしている）は
     * **React がハンドラを付ける前に読み終わっている**ことがある。
     * そのとき `onLoad` は飛ばないので、**待つようにしたぶん永久に止まる**
     * ——「3秒黒い」を直して「進まない」を作ることになる。
     *
     * このリポジトリは同じ形を2度踏んでいる（`fa640312`・`24f9df2c`）。
     * 答えも同じで、**ref が付いた時点の `complete` を見る**。
     *
     * `naturalWidth === 0` は「読み終わったが絵が無い」＝失敗。
     * ストーリーの `<img>` は `srcset` を持たないので、
     * `24f9df2c`（密度で割って 0 に丸まる）の罠には当たらない。
     */
    // 文字を**絵の上**の同じ場所に載せるために、絵が実際に描かれている
    // 矩形を測る（`object-contain` なので端末の縦横比で余白が変わる）
    const mediaAreaRef = useRef<HTMLDivElement | null>(null);
    const { attach: attachMediaBox, box: mediaBox, measure: measureMediaBox } = useMediaBox(mediaAreaRef);

    const attachMedia = useCallback((img: HTMLImageElement | null) => {
        attachMediaBox(img);
        if (!img?.complete) return;
        if (img.naturalWidth === 0) setMediaError(true);
        else setMediaReady(true);
    }, [setMediaReady, attachMediaBox]);

    /** 動画も同じ（`readyState >= HAVE_CURRENT_DATA` なら最初の絵は出せる） */
    const attachVideo = useCallback((v: HTMLVideoElement | null) => {
        videoRef.current = v;
        attachMediaBox(v);
        if (v && v.readyState >= 2) setMediaReady(true);
    }, [setMediaReady, attachMediaBox]);

    const frozen = paused || viewersOpen || confirmDelete || repliesOpen || replyFocused || replySending || keeping
        || voting
        // 操作シート・報告の間も進めない（開いたときと押したときで対象がずれる）
        || menuOpen || reportOpen
        || (!mediaReady && !mediaError);
    frozenRef.current = frozen;
    // 自分で再開したら「自動再生を断られた」印は消す（そのあと自分で止めた
    // 一時停止を、送ったときに解いてしまわないように）
    useEffect(() => {
        if (!paused) pausedByAutoplayRef.current = false;
    }, [paused]);

    // 画像の進捗は CSS アニメーション（60fps・再描画なし）が駆動し、
    // 完了は onAnimationEnd で検知する。動画は下の onTimeUpdate で進捗を更新。

    // 一時停止/再開を動画にも反映
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (frozen) v.pause();
        else void v.play()?.catch?.((err: unknown) => {
            // **iOS が音ありの自動再生を断ったら、消音で鳴らし直す。**
            // 断られたまま握りつぶすと、動画は最初のコマで止まり、`onEnded` が
            // 来ないので先へ進まない（進行バーも止まる）。消音にすると
            // スピーカーの表示も「消音」に揃う（音が出ていないのに「オン」の
            // 見た目を残さない）。消音でも断られたら（低電力モード）一時停止
            // にして「再生」ボタンを出す——押せばその操作の中で鳴らせる。
            const notAllowed = (e: unknown) => (e as { name?: string } | null)?.name === "NotAllowedError";
            if (!notAllowed(err)) return;
            // 一時停止は「断られた」ときだけ。鳴らし直しの途中でシートを開いた・
            // 送った（`AbortError`）ときまで止めると、閉じても送っても止まったまま残る
            const blocked = () => { pausedByAutoplayRef.current = true; setPaused(true); };
            if (!v.muted) {
                v.muted = true;
                setMuted(true);
                void v.play().catch((e2: unknown) => { if (notAllowed(e2)) blocked(); });
            } else {
                blocked();
            }
        });
    }, [frozen, item]);

    // 自動再生を断られて止めたのは、そのストーリーだけの事情。次へ送ったら解く
    // （残すと、その先の画像まで止まったまま進まない）
    useEffect(() => {
        if (!pausedByAutoplayRef.current) return;
        pausedByAutoplayRef.current = false;
        setPaused(false);
    }, [item?.id]);

    // ストーリーBGM: 曲つきストーリーの表示中だけ再生（frozenで一時停止）。
    // 投稿者が「好きな部分」を指定していればそこから流す。
    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        if (!item?.song || frozen) {
            a.pause();
            return;
        }
        const start = songStartSec(item.song.startSec);
        // 頭出しするのは「別のストーリーに移った」「最初から再生し直した」ときだけ。
        // 一時停止からの復帰では続きから鳴らす。
        // ここを a.paused で判定すると、再生中に呼ばれる再生し直しでは頭出しされず、
        // 映像だけ戻って音楽が続くことになる（startSec が 0 のときは条件自体が常に偽）。
        const replayChanged = lastReplayRef.current !== replay;
        lastReplayRef.current = replay;
        // <audio> はストーリーをまたいで使い回す（下の JSX の注）ので、
        // 別のストーリーに移ったら必ず頭出しする（同じ曲だと src が変わらず、
        // 前のストーリーの続きから鳴ってしまう）
        const itemChanged = lastAudioItemRef.current !== item.id;
        lastAudioItemRef.current = item.id;
        if (replayChanged || itemChanged || a.currentTime < start) {
            // 曲の情報を読む前は、iOS が頭出しを捨てることがある
            seekWhenReady(a, start);
        }
        void a.play().catch((err: unknown) => {
            // 音ありを断られたら消音で鳴らし直し、スピーカーの表示も揃える
            if ((err as { name?: string } | null)?.name !== "NotAllowedError" || a.muted) return;
            a.muted = true;
            setMuted(true);
            void a.play().catch(() => { /* 消音でも断られた: 一時停止の扱いは動画側に任せる */ });
        });
    }, [frozen, item, replay]);

    // muted は React の属性反映が不安定なため直接同期する
    useEffect(() => {
        if (audioRef.current) audioRef.current.muted = muted;
    }, [muted, item]);

    // **ストーリーが変わったら返信の状態を捨てる。**
    // 打ちかけを持ち越すと、書いた相手と違う人に届く（送り先は `item.id`）。
    // 「送信しました」の表示も持ち越さない——次のストーリーに、前の人へ
    // 送ったはずの手応えが出る。
    useEffect(() => {
        setReplyText("");
        setReplySent(false);
        setReplyError(null);
        setReplySending(false);
        setReplyFocused(false);
        setReplyOpen(false);
        setReplies(null);
        setRepliesError(false);
        setKeeping(false);
        setKeptPhotoId(null);
        setKeepError(null);
        setBlocking(null);
        setBlockedIds(new Set());
        // **写したのは setter と描画だけで、リセットが漏れていた。**
        // 落とさないと、s1 でブロックに失敗した赤い1行が s2 の返信一覧に
        // 出る——このすぐ上のコメントが「前の人へ送ったはずの手応えを
        // 持ち越さない」と戒めている当の形
        setBlockError(null);
    }, [item?.id]);

    /** 返信を送る（本文または絵文字1つ） */
    const sendReply = useCallback(async (payload: { text?: string; emoji?: string }) => {
        if (!item || replySending) return;
        setReplySending(true);
        setReplyError(null);
        // **送り先を先に控える。** 送っている間に次へ送られても、
        // 応答を書き戻す相手を間違えない。
        // **書き戻す側も見る**（下の `stillHere`）——`frozen` は自動送りしか
        // 止めないので、手で矢印を押されれば表示は変わる。そのときに
        // 「送信しました」を出すと、**送っていない人の画面に手応えが出る**
        const target = item.id;
        const stillHere = () => itemIdRef.current === target;
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const { readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/stories/${encodeURIComponent(target)}/replies`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const msg = await readApiError(res, locale === "en" ? "Couldn't send." : "送信できませんでした");
                if (stillHere()) setReplyError(msg);
                return;
            }
            if (!stillHere()) return;
            setReplyText("");
            setReplySent(true);
            // 送り終えたら絵文字の列は畳む（帯はモック⑥ の1段に戻る）
            setReplyOpen(false);
        } catch (e) {
            const { sessionErrorMessage } = await import("../../../lib/utils/api");
            if (stillHere()) setReplyError(sessionErrorMessage(e) ?? (locale === "en" ? "Couldn't send." : "送信できませんでした"));
        } finally {
            setReplySending(false);
        }
    }, [item, replySending, locale]);

    // 届いたリアクション・返信は**開いたときに取りに行く**（バッジの数は
    // `replyCount` が持っているので、開かない限り読みに行かない）。
    // この1本が絵文字の反応と文字の返信の**両方**を返す（口も1つ）。
    // 中断ガードは閲覧者リストと同じ理由——ストーリーは次々に切り替わる
    useEffect(() => {
        if (!repliesOpen || !item || !isOwnStory) return;
        let aborted = false;
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch(`/stories/${encodeURIComponent(item.id)}/replies`);
                if (aborted) return;
                if (!res.ok) { setRepliesError(true); return; }
                const data = await res.json() as { items?: StoryReply[] };
                if (aborted) return;
                const rows = usableRows<StoryReply>(data.items, "GET /stories/{id}/replies");
                // **配列でない応答を「まだリアクションも返信もありません」にしない**
                // （閲覧者リストと同じ SW-b8）
                if (!rows) { setRepliesError(true); return; }
                setReplies(rows);
                setRepliesError(false);
            } catch {
                if (!aborted) setRepliesError(true);
            }
        })();
        return () => { aborted = true; };
    }, [repliesOpen, item, isOwnStory]);

    /**
     * このストーリーをギャラリーに残す。
     *
     * **できるのは下書きの写真**なので、そのまま検索に出ることはない。
     * 残したあとは編集画面（撮影地・題を入れて公開する）へ誘う。
     */
    const keepToGallery = useCallback(async () => {
        if (!item || keeping) return;
        setKeeping(true);
        setKeepError(null);
        const target = item.id;
        // 送信中に手で次へ進められても、手応えを別の1枚に出さない（返信と同じ）
        const stillHere = () => itemIdRef.current === target;
        // **`/keep` が通らなかったら、上げたサムネを捨てる。**
        // 残すと S3 の孤児になる（指す行がどこにも無い＝どの削除経路からも
        // 辿れない）。しかも枚数上限・期限切れ・通信断はどれも押し直せる
        // 失敗なので、**押すたびに1個ずつ増える**。同じことをする
        // `app/user/upload`（`reservedThumbKey`）と `StoriesBar`
        // （`uploadedKey`）は両方とも後始末を持っている——ここだけ無かった。
        // **`finally` に置く。** 応答を読む前に投げる経路（通信断・
        // セッション切れ）が `catch` に飛ぶので、`!res.ok` の枝だけでは足りない。
        let thumbKey: string | undefined;
        let thumbUsed = false;
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            // **一覧用のサムネを作って一緒に送る。**
            // 送らないと、公開したときホームの一覧が**1440px の原寸**を読む
            // （普通のアップロードは端末側で 512px の WebP を作って送る）。
            // 補う `generate-thumbnails.js` はビルド時にしか走らないので、
            // `REBUILD_DISPATCH_TOKEN` が未設定の本番では**最大7日**
            // ——訪問者全員が毎回その差を払う。
            // **失敗しても残す方は進める**（サムネは無くても写真は作れる。
            // 次のビルドが補う）。画像はいま画面に出ているのでブラウザの
            // 控えから取れる
            const extra = await buildKeepThumb(item.src).catch(() => ({ fields: {} as Record<string, string> }));
            thumbKey = (extra as { thumbKey?: string }).thumbKey;
            const res = await userFetch(`/stories/${encodeURIComponent(target)}/keep`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(extra.fields),
            });
            if (!res.ok) {
                const msg = await readApiError(res, locale === "en" ? "Couldn't keep it." : "残せませんでした");
                if (stillHere()) setKeepError(msg);
                return;
            }
            const data = await res.json() as { photoId?: string; already?: boolean };
            // **二度押しは「使われた」に数えない。** サーバーは既に残って
            // いれば `thumbUrl` を見ないので、上げたぶんは誰にも参照されない
            thumbUsed = data.already !== true;
            if (!stillHere()) return;
            if (typeof data.photoId === "string" && data.photoId) setKeptPhotoId(data.photoId);
            else setKeepError(locale === "en" ? "Couldn't keep it." : "残せませんでした");
        } catch (e) {
            const { sessionErrorMessage } = await import("../../../lib/utils/api");
            if (stillHere()) setKeepError(sessionErrorMessage(e) ?? (locale === "en" ? "Couldn't keep it." : "残せませんでした"));
        } finally {
            if (thumbKey && !thumbUsed) {
                const { userFetch } = await import("../../../lib/utils/api");
                await userFetch("/upload/discard", { method: "DELETE", body: JSON.stringify({ key: thumbKey }) })
                    .catch(() => { /* 消せなくても、残す操作の結果は伝える */ });
            }
            setKeeping(false);
        }
    }, [item, keeping, locale]);

    /**
     * この人からの反応を受け取らない。
     *
     * **押せる場所を返信の一覧に置く。** サーバー側は前から入っていたが、
     * 呼ぶ画面がどこにも無く、**迷惑な返信を受けた人にできることが
     * 退会しかなかった**（`block.ts` が「やり取りの口を持つ以上の最低限」と
     * 書いている当のもの）。困っているのは返信を読んでいる人なので、
     * その場に置くのがいちばん短い。
     */
    const blockSender = useCallback(async (uid: string): Promise<boolean> => {
        if (!uid || blocking) return false;
        setBlocking(uid);
        setBlockError(null);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch(`/users/${encodeURIComponent(uid)}/block`, { method: "POST" });
            // **効いたときだけ画面を変える。** 失敗を成功に見せると、
            // 「押したのにまた届く」で二度目の落胆になる
            if (res.ok) {
                setBlockedIds((prev) => new Set(prev).add(uid));
                // **サーバーは両向きのフォローを切る**（`block.ts`）。
                // ここを呼ばないと、共有しているフォロー中の一覧が古いまま
                // ——**ギャラリーのフォロー中フィードにブロックした相手の
                // 写真が出続ける**（この画面はギャラリーの上に重なって
                // 開くので、閉じても再マウントされない＝取り直す契機が無い）。
                // プロフィール経由のブロックだけ直して、こちらを忘れていた
                const { noteFollowSevered } = await import("../../../lib/hooks/useFollow");
                noteFollowSevered(uid);
                // ストーリーのバーも取り直させる（doc を見よ）
                onBlocked?.(uid);
                return true;
            } else {
                // **失敗を無言にしない。** プロフィール側は理由を出すのに、
                // ここだけ押しても何も起きないように見えていた。
                //
                // **トーストは使わない。** `useToast` は Provider が無いと
                // 投げるので、この部品に持たせると**単体で描けなくなる**
                // （実際 7ファイル・68件が落ちた）。同じファイルの
                // `replyError` と同じ形——押したボタンの近くに1行出す
                const { readApiError } = await import("../../../lib/utils/api");
                setBlockError(await readApiError(res, locale === "en" ? "Couldn't do that." : "できませんでした"));
            }
        } catch {
            setBlockError(locale === "en" ? "Couldn't do that." : "できませんでした");
        } finally {
            setBlocking(null);
        }
        return false;
    }, [blocking, onBlocked, locale]);

    /**
     * 「このユーザーを非表示」（モック⑧）。ブロックと同じ操作で、
     * **効いたらこの画面を閉じる**——閉じないと、いま非表示にした相手の
     * ストーリーがそのまま目の前に残る（バーの取り直しは親がやる）。
     */
    const hideAuthor = useCallback(async () => {
        if (!group?.userId) return;
        if (await blockSender(group.userId)) onClose();
    }, [group?.userId, blockSender, onClose]);

    const handleDelete = useCallback(async () => {
        if (!item || !onDelete) return;
        setDeleting(true);
        const ok = await onDelete(item.id);
        setDeleting(false);
        if (ok) onClose();
        else setConfirmDelete(false);
    }, [item, onDelete, onClose]);

    // 次の画像をプリロード（動画はブラウザに任せる）
    useEffect(() => {
        const next = group?.items[i + 1] ?? groups[g + 1]?.items[0];
        if (next && next.mediaType !== "video") {
            const img = new window.Image();
            img.src = publicImageUrl(next.src);
        }
    }, [group, groups, g, i]);

    // Escで閉じる / 矢印キーで移動。
    //
    // シートが開いているときは矢印で送らない。以前は送れてしまい、
    // 「削除しますか」を出したまま → を押すと、背後のストーリーだけが
    // 次に進んで、そのまま「削除」を押すと**別のストーリーが消えた**
    // （しかも成功トーストが出る。元に戻せない）。
    // Esc も同じで、シートを閉じずにビューア全体を閉じていた
    // （他の確認ダイアログと逆の挙動）。
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // **返信を打っている間は横取りしない。** スペースは一時停止、
            // 矢印は送り、Escape は閉じるに割り当ててあるので、そのままだと
            // **空白が打てず、カーソルも動かせず、Escape で画面ごと消える**。
            // Escape だけは入力から抜ける方に使う（変換の取り消しは除く）
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
                if (e.key === "Escape" && !isImeKey(e)) (t as HTMLInputElement).blur();
                return;
            }
            // 報告のダイアログは自前で Escape を聞く（`useEscapeKey`）ので、
            // ここは**何もしない**で返す（二重に閉じない・背後を送らない）
            if (reportOpen) return;
            // 同意画面が上にある間も何もしない（見えないストーリーを送らない）
            if (isBehindPriorityOverlay()) return;
            if (confirmDelete || viewersOpen || repliesOpen || menuOpen) {
                if (e.key === "Escape") { setConfirmDelete(false); setInsights(null); setMenuOpen(false); }
                return;
            }
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowRight") goNext();
            else if (e.key === "ArrowLeft") goPrev();
            // **キーボードだけで止められるようにする。** 長押しは押している間
            // だけで、指を離すと進む＝読む時間を自分で決められない
            else if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); setPaused((v) => !v); }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose, goNext, goPrev, confirmDelete, viewersOpen, repliesOpen, menuOpen, reportOpen]);

    // **Tab を中に閉じ込める。** `aria-modal="true"` を付けた8つのうち、
    // ここと StoriesBar の投稿プレビューだけ管理が無かった。全画面
    // （`fixed inset-0 z-[90]`）の裏にはギャラリーの写真リンクが全部あるので、
    // Tab を押すと見えないところへフォーカスが出ていく。
    //
    // 最初に当てるのは**閉じるボタン**。DOM 順の先頭は音量やゴミ箱で、
    // ゴミ箱は確認シートが挟まるとはいえ破壊的な操作なので先頭にしない。
    //
    // 戻り先は既定（開いた瞬間の要素＝押したリングのボタン）。リングは
    // ビューアを開いても消えないので、そのままで戻る。
    const rootRef = useRef<HTMLDivElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(true, rootRef, undefined, closeBtnRef);

    // 表示中のストーリーが変わったら確認シートと操作シートを閉じる。
    // 開いたときの対象と、押したときの対象がずれないようにする
    // （「報告」も同じ理由。別のストーリーを報告してしまう）。
    useEffect(() => { setConfirmDelete(false); setMenuOpen(false); setReportOpen(false); }, [item?.id]);

    // 背景スクロールロック。**共通の実装に寄せた**（`lib/utils/scrollLock.ts`）。
    // ここは `overflow: hidden` だけの自前実装で、あちらのコメントが
    // 「それでは iOS Safari や内蔵ブラウザで止まらない」と書いている方式
    // そのものだった。位置の控え・復元も無かったので、閉じたときに別の
    // 場所にいることがある。
    // **早期 return より前に置くが、掛けるのは中身がある間だけ。**
    // 無条件で掛けていたので、`groups` が入れ替わって表示対象が消えた
    // ときに「何も描かないのに `position: fixed` のまま」になる
    // ——`overflow: hidden` だけだった頃は「スクロールできない」で
    // 済んでいたが、共通実装に寄せて位置を控えるようになったぶん、
    // ページ先頭へ飛んだまま固まる方に悪化していた（スマホには
    // Escape が無い）
    const showing = !!group && !!item;
    useEffect(() => {
        if (!showing) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [showing]);

    if (!group || !item) return null;

    /**
     * 「…」の操作シートの中身（モック⑦⑧）。**押しても何も起きない項目は
     * 出さない**——音の無いストーリーに「ミュート」、文字の無い写真に
     * 「テキストを非表示」を置かない（このリポジトリの決まり）。
     * 自分のストーリーには「このユーザーを非表示」「報告」を出さず、
     * 代わりに削除を出す。
     */
    const hasAudio = isVideo || !!item.song;
    /** 左下に出すチップ（撮影地・BGM）が1つでも在るか */
    const hasBottomChips = !!item.location || !!item.song;
    const hasTexts = !!item.texts?.length || !!item.caption;
    const sheetItems: StorySheetItem[] = [
        {
            key: "pause",
            label: paused
                ? (locale === "en" ? "Play" : "再生")
                : (locale === "en" ? "Pause" : "一時停止"),
            icon: paused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />,
            onSelect: () => setPaused((v) => !v),
        },
        ...(hasAudio ? [{
            key: "mute",
            label: muted
                ? (locale === "en" ? "Unmute" : "ミュート解除")
                : (locale === "en" ? "Mute" : "ミュート"),
            icon: muted ? <SpeakerXMarkIcon className="w-5 h-5" /> : <SpeakerWaveIcon className="w-5 h-5" />,
            onSelect: toggleMuted,
        }] : []),
        ...(hasTexts ? [{
            key: "texts",
            label: textsHidden
                ? (locale === "en" ? "Show text" : "テキストを表示")
                : (locale === "en" ? "Hide text" : "テキストを非表示"),
            // モックの印はアイコンではなく「Aa」
            icon: <span className="text-[15px] font-semibold leading-none">Aa</span>,
            onSelect: () => setTextsHidden((v) => !v),
        }] : []),
        ...(!isOwnStory && isAuthenticated ? [{
            key: "hide",
            label: locale === "en" ? "Hide this user" : "このユーザーを非表示",
            icon: <EyeSlashIcon className="w-5 h-5" />,
            onSelect: () => { void hideAuthor(); },
            disabled: blocking === group.userId,
        }, {
            key: "report",
            label: locale === "en" ? "Report story" : "ストーリーを報告",
            icon: <ExclamationTriangleIcon className="w-5 h-5" />,
            onSelect: () => setReportOpen(true),
            danger: true,
        }] : []),
        ...(isOwnStory && onDelete ? [{
            key: "delete",
            label: locale === "en" ? "Delete story" : "ストーリーを削除",
            icon: <TrashIcon className="w-5 h-5" />,
            onSelect: () => setConfirmDelete(true),
            danger: true,
        }] : []),
    ];

    return (
        <div
            ref={rootRef}
            className="fixed inset-0 z-[90] bg-black flex items-center justify-center select-none"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Stories" : "ストーリー"}
        >
            {/* アンビエント背景: メディアをぼかして letterbox を埋める（黒帯の安っぽさを消す） */}
            {!isVideo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    key={`bg-${item.id}`}
                    src={publicImageUrl(item.src)}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40 pointer-events-none"
                    draggable={false}
                />
            )}

            {/* **PC は別に設計する**（指示書 4・11・17）。スマホは今までどおり
                画面いっぱい。1024px 以上では**縦長の1枚に収める**——
                ヘッダーも返信の帯も `absolute` でこの入れ物に付くので、
                幅いっぱいに引き伸ばすと、名前が左端・閉じるが右端で 1,200px
                離れる（実測 1280px 幅）。まわりはぼかした写真のまま
                （上の背景はこの外側に置いてある）。 */}
            <div className="relative w-full h-full flex flex-col lg:w-[430px] lg:h-[min(90vh,820px)] lg:rounded-2xl lg:overflow-hidden lg:shadow-2xl lg:shadow-black/60 lg:ring-1 lg:ring-white/10">

            {/* メディア。写真そのものには何も重ねない（構図を隠さないため） */}
            <div ref={mediaAreaRef} className="relative flex-1 min-h-0 w-full flex items-center justify-center">
                {isVideo ? (
                    <video
                        key={item.id}
                        ref={attachVideo}
                        src={publicImageUrl(item.src)}
                        className="block max-w-full max-h-full object-contain rounded-lg story-media-in"
                        autoPlay
                        playsInline
                        // 曲が付いている動画は動画側を常に消す。両方を muted に
                        // 連動させると、ミュート解除で動画の音とBGMが同時に鳴る。
                        muted={muted || !!item.song}
                        // **最初の絵が出せるようになるまで待つ**（画像と同じ）。
                        // 動画の進捗は `currentTime` で描くので止まったままだが、
                        // `frozen` は `pause()` にも効くので**読み込み中に
                        // 再生が始まって先頭を取りこぼす**のを防ぐ
                        onLoadedData={() => { setMediaReady(true); measureMediaBox(); }}
                        onEnded={goNext}
                        onError={goNext}
                    />
                ) : mediaError ? (
                    // 日本語の文言は写真ページ・モーダルと揃える（言い回しを増やさない）。
                    // **英語はここにしか無い**——あちらの2つは日本語ベタ書きで
                    // locale 分岐を持たない（揃えるなら別コミットで向こうを直す）
                    <div className="flex flex-col items-center justify-center text-white/60 gap-2 px-6 text-center">
                        <PhotoIcon className="w-10 h-10" />
                        <p className="text-sm">{locale === "en" ? "Couldn't load image" : "画像を読み込めません"}</p>
                    </div>
                ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        key={item.id}
                        src={publicImageUrl(item.src)}
                        alt=""
                        className="block max-w-full max-h-full object-contain rounded-lg story-media-in"
                        draggable={false}
                        ref={attachMedia}
                        onLoad={() => { setMediaReady(true); measureMediaBox(); }}
                        onError={(e) => { setMediaError(true); void dropCachedPhoto(e.currentTarget.currentSrc || e.currentTarget.src); }}
                    />
                )}

                {/* 置いた場所の文字。**下の帯には出さない**（同じ文言が2か所に出る）。
                    描き方は下書きの画面と同じ部品——別々に書くと「置いた場所と
                    出る場所が違う」になり、置き直しても直らない */}
                {item.texts?.length && !mediaError && !textsHidden ? (
                    <StoryTextOverlay
                        texts={item.texts}
                        box={mediaBox}
                        locale={locale}
                        // 入口は他人のストーリー・ログイン済み・アーカイブでないときだけ
                        // （未ログインは返信と同じで、押してから断る形にしない。
                        //  アーカイブはサーバーが期限切れとして 404 を返す）
                        onVote={!isOwnStory && isAuthenticated && !item.archivedAt ? handleVote : undefined}
                        voteState={voteState}
                        voting={voting}
                    />
                ) : null}

                {/* **読み込み中だと分かるようにする。** ストーリーは `src` しか
                    持たない（写真と違ってサムネも下地色もぼかしも無い）ので、
                    落とし終わるまで出せる絵が無い。せめて「止まっている」のか
                    「読んでいる」のかは見えるようにする。
                    **絵の上には重ねない**——出たあとは消える */}
                {!mediaReady && !mediaError && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
                        <div className="w-7 h-7 rounded-full border-2 border-white/25 border-t-white/80 animate-spin" />
                    </div>
                )}
            </div>

            {/* ストーリーBGM音源（表示中のストーリーに追従） */}
            {/* **ストーリーごとに作り直さない（`key` を付けない）。** iOS は
                「タップで音を出してよいと許した」ことを**要素ごと**に覚える。
                作り直すと自動で次へ進んだ2本目から許可が引き継がれず、
                音をオンにしていても BGM が鳴らなかった（#3）。曲の無い
                ストーリーでは src を外して止める（下の effect が pause する）。 */}
            <audio
                    ref={audioRef}
                    // **出すときにも確かめる。** サーバーの許可リストは
                    // これから保存する値にしか効かず、許可リスト以前の行は
                    // 任意のホストのまま残りうる。しかもここは
                    // `preload="auto"`＝**開いた瞬間に取りに行く**うえ、
                    // ストーリーはログイン中の全員のトレイに出る
                    // ——`mediaHosts.ts` のコメントが最悪ケースとして
                    // 名指ししているのがこの経路
                    src={item.song ? safeSongPreviewUrl(item.song.previewUrl) : undefined}
                    muted
                    preload="auto"
                    // 指定された「好きな部分」から繰り返す（loop属性だと必ず0秒に戻ってしまう）
                    onEnded={(e) => {
                        if (!item.song) return;
                        const a = e.currentTarget;
                        try { a.currentTime = songStartSec(item.song.startSec); } catch { /* ignore */ }
                        void a.play().catch(() => { /* ignore */ });
                    }}
                />

            {/* 上部グラデーション + プログレスバー + ヘッダー */}
            {/* z-20: 下のタップ領域(z-10)より前面。ノッチ端末では safe-area の分だけ
                ヘッダーが下がり、曲チップがタップ領域に潜って押せなくなるため。 */}
            <div className="absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/70 to-transparent pt-2 pb-8 px-2 pointer-events-none">
                {/* 寸法はアーティファクトの板（StoryViewer.dc.html）に合わせる:
                    高さ3px・角丸2px・間隔4px・左右10px。**px で書く**——640px 未満は
                    root が 14px なので `gap-1` は 3.5px、`px-2` は 7px に縮む（実測）。
                    外側が 7px なので、ここで +3px して 10px にする。
                    `role="group"` を付けるのは、**素の div の `aria-label` は読み上げに
                    渡らない**ため（板は div のままだが、それでは名前が届かない）。 */}
                <div className="flex gap-[4px] mb-3 px-[3px]" role="progressbar"
                     aria-label={locale === "en"
                         ? `${i + 1} of ${group.items.length}${frozen ? " · paused" : ""}`
                         : `${group.items.length}本中${i + 1}本目${frozen ? "・止まっています" : ""}`}
                     style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
                    {group.items.map((s, idx) => {
                        const done = idx < i;
                        const active = idx === i;
                        return (
                            <div key={s.id} className="flex-1 h-[3px] rounded-[2px] bg-white/30 overflow-hidden">
                                {active ? (
                                    isVideo ? (
                                        // 動画: rAF が毎フレーム scaleX を書く（補間は要らない）
                                        <div
                                            ref={progressBarRef}
                                            className="h-full w-full bg-white rounded-[2px] story-progress-video"
                                            style={{ transform: "translateX(-100%)" }}
                                        />
                                    ) : (
                                        // 画像: CSS アニメーションが 0→100% を滑らかに駆動
                                        <div
                                            key={`${item.id}-${replay}`}
                                            className="h-full w-full bg-white rounded-[2px] story-progress-fill"
                                            style={{
                                                animationDuration: `${storyDurationMs(item.durationSec)}ms`,
                                                animationPlayState: frozen ? "paused" : "running",
                                            }}
                                            onAnimationEnd={goNext}
                                        />
                                    )
                                ) : (
                                    <div
                                        className="h-full w-full bg-white rounded-[2px]"
                                        style={{ transform: done ? "translateX(0)" : "translateX(-100%)" }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="flex items-start gap-2 px-1 pr-24">
                    {/* 板（StoryViewer.dc.html）は 34px。`w-8` は 640px 未満で 28px に縮むので px で書く */}
                    <UserAvatar userId={group.userId} className="w-[34px] h-[34px]" iconClassName="w-[22px] h-[22px]" />
                    <div className="min-w-0">
                        {/* モック② のヘッダー: 1段目が名前、2段目が細い字の1行。
                            時刻を名前の隣から2段目へ移した——モックの並びで、
                            名前に使える幅も広がる（長い表示名が先に潰れていた）。

                            🔴 **撮影地はここには出さない。** モックはヘッダー（②）と
                            左下のチップ（④）の両方に場所を描いているが、あちらは
                            「イタリア・アマルフィ」と「アマルフィ, イタリア」で
                            粒度が違う。**こちらが持っている `location` は1つの
                            文字列**なので、両方に出すと**同じ文字が画面に2度**
                            並ぶ（実測: 「横浜 みなとみらい」が上下に重なる）。
                            押せる方（④・チップ）に寄せる。 */}
                        <div className="text-[14px] font-semibold text-white drop-shadow truncate">{group.displayName}</div>
                        <p className="text-[12px] text-white/[0.82] drop-shadow truncate max-w-full">
                            {timeAgo(item.createdAt, locale)}
                        </p>
                    </div>
                </div>
            </div>

            {/* 閉じる / ミュート切り替え。**置いた文字・投票（z-25）より上**——
                投稿者が右上に置いた投票の `<button>` に閉じるが覆われないように */}
            <div className="absolute top-3 right-2 z-[26] flex items-center gap-1" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
                {/* モック②⑦⑧: 右上は「…」と「✕」の2つだけ。一時停止・ミュート・
                    テキストの表示・削除・このユーザーを非表示・報告は、この
                    1つの入口（操作シート）にまとめる——以前は最大4つの
                    アイコンが並び、置いた文字や投票と重なっていた */}
                {sheetItems.length > 0 && (
                    <button
                        ref={menuBtnRef}
                        onClick={() => setMenuOpen(true)}
                        aria-label={locale === "en" ? "Story options" : "ストーリーの操作"}
                        aria-haspopup="dialog"
                        aria-expanded={menuOpen}
                        className="flex items-center justify-center text-white/80 hover:text-white"
                        style={{ touchAction: "manipulation", width: "44px", height: "44px" }}
                    >
                        <EllipsisHorizontalIcon className="w-6 h-6" />
                    </button>
                )}
                <button
                    ref={closeBtnRef}
                    onClick={onClose}
                    aria-label={locale === "en" ? "Close" : "閉じる"}
                    className="flex items-center justify-center text-white/80 hover:text-white"
                    style={{ touchAction: "manipulation", width: "44px", height: "44px" }}
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>
            </div>

            {/* タップ領域: 左1/3で戻る、右2/3で進む。長押しで一時停止。
                長押し・スワイプでは移動しない（キャプションを読むために止めたのに
                指を離した瞬間に話が進んでしまうのを防ぐ）。

                **下を空けるのは、下に何か在るときだけ。**
                88px は返信の帯（高さ約124px）と、自分のストーリーの
                閲覧者・返信・残すの段のためのもの。**返信を切った他人の
                ストーリー**ではどちらも出ないので、空けたままだと
                **画面の下 88px が何も受けない帯**になる——同じ画面なのに、
                返信を許した人のストーリーとだけ挙動が割れる。
                自分のストーリー側は今までどおり（あちらは段が出る）。 */}
            <div
                className="absolute left-0 w-1/3 z-10"
                // **`touch-action: pinch-zoom`（1本指の払いは自前で読む）。** `manipulation` だと
                // 縦の指の動きをブラウザがスクロールとして取り、iOS はゴムのように
                // 弾ませる——動き出した時点で `pointercancel` が来て `pointerup` が
                // 来ず、上下の払い（閉じる・メニュー）が効かなかった（#5）。
                // 画面は全画面の固定表示で、ここにスクロールするものは無い。
                // ピンチでの拡大は残す（`none` にすると弱視の人が拡大できない）
                style={{ top: 80, bottom: zoneBottom, touchAction: "pinch-zoom", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goPrev(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={onZonePointerUp}
                onPointerLeave={onZonePointerUp}
                onPointerCancel={onZonePointerCancel}
                aria-hidden="true"
            />
            <div
                className="absolute right-0 w-2/3 z-10"
                // **`touch-action: pinch-zoom`（1本指の払いは自前で読む）。** `manipulation` だと
                // 縦の指の動きをブラウザがスクロールとして取り、iOS はゴムのように
                // 弾ませる——動き出した時点で `pointercancel` が来て `pointerup` が
                // 来ず、上下の払い（閉じる・メニュー）が効かなかった（#5）。
                // 画面は全画面の固定表示で、ここにスクロールするものは無い。
                // ピンチでの拡大は残す（`none` にすると弱視の人が拡大できない）
                style={{ top: 80, bottom: zoneBottom, touchAction: "pinch-zoom", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goNext(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={onZonePointerUp}
                onPointerLeave={onZonePointerUp}
                onPointerCancel={onZonePointerCancel}
                aria-hidden="true"
            />
            {/* **読み上げ（VoiceOver）から前後に送る手段。** 上の2つのタップ領域は
                指で押す・払う面で、読み上げでは触れない（iPhone には矢印キーも
                無い）。無いと「前へ」は手段が0で、「次へ」は自動で進むのを待つ
                しかなかった（#41）。見た目には出さない。 */}
            <div className="sr-only">
                <button type="button" onClick={goPrev}>
                    {locale === "en" ? "Previous story" : "前のストーリー"}
                </button>
                <button type="button" onClick={goNext}>
                    {locale === "en" ? "Next story" : "次のストーリー"}
                </button>
            </div>

            {/* 一時停止の印（モック09 の状態例「一時停止状態」）。**止まっている
                ことが画面で分かる**——これまでは進行バーが止まるだけで、
                長押しで止めたのか読み込みで止まっているのか見分けが付かなかった。
                押すと再開する（読み上げは「再生」。絵はモックのとおり⏸）。
                出すのは**本当に一時停止しているときだけ**——読み込み中や
                シートを開いている間（どちらも `frozen`）には出さない */}
            {paused && !menuOpen && !confirmDelete && !viewersOpen && !repliesOpen && !reportOpen && (
                <div className="absolute inset-0 z-[24] flex items-center justify-center pointer-events-none">
                    <button
                        onClick={() => {
                            setPaused(false);
                            // **鳴らすのはこのタップの中で。** 自動再生を断られて
                            // 止めた（低電力モード）あとは、操作の中の play() しか通らない
                            void videoRef.current?.play()?.catch?.(() => { /* 下の effect に任せる */ });
                            if (itemHasSongRef.current) void audioRef.current?.play()?.catch?.(() => { /* 同上 */ });
                        }}
                        aria-label={locale === "en" ? "Resume" : "再生"}
                        className="pointer-events-auto w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm ring-1 ring-white/20 text-white flex items-center justify-center active:scale-95 transition"
                        style={{ touchAction: "manipulation" }}
                    >
                        <PauseIcon className="w-7 h-7" />
                    </button>
                </div>
            )}

            {/* 画面下: 閲覧者数（自分のみ）とキャプションを同じ段に並べる。
                **置いた場所の文字が在るときは、この段には出さない**
                （同じ文言が写真の上と下に二重に出る） */}
            {(hasBottomChips || isOwnStory || (item.caption && !item.texts?.length && !textsHidden)) && (
                <div
                    /* モック④: **撮影地と BGM のチップは写真の左下**（返信欄のすぐ上）。
                       以前はどちらもヘッダーの中に在り、名前の下に3段が積み上がって
                       いた。チップの列と、既存の段（閲覧者・返信・残す・キャプション）を
                       **1つの入れ物**に縦に積む——位置を決める式（下の `marginBottom`）が
                       2か所に分かれると、返信の帯が出たときにどちらかが帯に潜る。

                       **空いている所はタップを通す**（`pointer-events-none`）。
                       この段は左右のタップ領域（z-10）より前面なので、囲いに
                       当たり判定を持たせると**送りが効かない帯**ができる */
                    className="absolute bottom-4 left-4 right-4 z-20 flex flex-col items-start gap-2 pointer-events-none"
                    /* **返信の帯（高さ約124px）に完全に隠れていた。**
                       実測（390x844）でキャプションの高さの100%が帯と重なり、
                       36px は入力欄そのものの下に沈んでいた（`bg-black/55` +
                       `backdrop-blur` なので判読不能）。帯が出る条件のときだけ
                       その分持ち上げる。**位置を上げるだけ**——キャプションを
                       帯の中へ移すのは見た目の作り直しになる */
                    style={{
                        marginBottom: showReplyBar
                            ? "calc(7.5rem + env(safe-area-inset-bottom, 0px))"
                            : "env(safe-area-inset-bottom, 0px)",
                    }}
                >
                    {/* 撮影地のチップ。**押せる先を持たない**——ストーリーの撮影地は
                        まだ写真が1枚も無い場所でもよく、`/location/<スラッグ>` は
                        ビルド時に在る場所しか作られない（静的書き出し）。
                        行き止まりのリンクを置くくらいなら、出すのは文字だけにする */}
                    {item.location && (
                        <span className="max-w-full inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/15 text-white/90 text-[11px]">
                            <MapPinIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/70" aria-hidden="true" />
                            <span className="truncate">{item.location}</span>
                        </span>
                    )}
                    {/* BGM のチップ。押すと音の入り切り（この画面で音を出せる唯一の
                        一手。操作シートの「ミュート解除」と同じ状態を切り替える） */}
                    {item.song && (
                        <button
                            onClick={(e) => { e.stopPropagation(); toggleMuted(); }}
                            className="pointer-events-auto max-w-full inline-flex items-center gap-1.5 px-3 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/15 text-white/90 text-[11px] active:scale-95 transition"
                            style={{ touchAction: "manipulation", minHeight: "36px" }}
                            aria-label={muted ? (locale === "en" ? "Turn sound on" : "音を出す") : (locale === "en" ? "Mute" : "ミュート")}
                        >
                            {muted
                                ? <SpeakerXMarkIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/60" />
                                : <MusicalNoteIcon className="w-3.5 h-3.5 flex-shrink-0 text-white" />}
                            <span className="truncate">
                                {item.song.title}{item.song.artist ? ` — ${item.song.artist}` : ""}
                            </span>
                            {muted && (
                                <span className="text-[10px] text-white/50 flex-shrink-0">
                                    {locale === "en" ? "Tap for sound" : "タップで再生"}
                                </span>
                            )}
                        </button>
                    )}
                    {/* 閲覧者・返信・残す・キャプションの段（従来どおり横に並べ、
                        溢れたら折り返す） */}
                    <div className="w-full flex flex-wrap items-center gap-2">
                    {/* アーカイブでは出さない——必ず 0 人で、押しても何も無い
                        ボタンを置かない（すぐ下の返信バッジと同じ線） */}
                    {isOwnStory && !item.archivedAt && (
                        <button
                            onClick={() => setInsights("viewers")}
                            aria-label={locale === "en" ? "Viewers" : "閲覧者を見る"}
                            className="pointer-events-auto flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
                            style={{ touchAction: "manipulation" }}
                        >
                            <EyeIcon className="w-4 h-4" />
                            {/* **失敗したら数字を出さない。** `viewers === null` だけを
                                見ていたので、読み込めなかったときも "..." のまま
                                永久に止まっていた（再取得は無い）。シートの本文は
                                「読み込めませんでした」と出るのに、同じ画面の
                                ここだけ「取得中」に見える。
                                **記号（`—` など）に差し替えない**——このリポジトリの
                                前例は `FollowButton` の「まだ分からない間は出さない」で、
                                新しい記号を勝手に足さない。押せばシートが理由を出す */}
                            {viewersError
                                ? null
                                : viewers === null
                                ? "..."
                                : locale === "en"
                                    ? `${viewers.length} viewer${viewers.length === 1 ? "" : "s"}`
                                    : `閲覧 ${viewers.length}人`}
                        </button>
                    )}
                    {/* 届いたリアクション・返信（投稿者だけ）。数は `replyCount` が
                        持っているので、開かない限り読みに行かない。
                        **0件のときは出さない**——押しても何も無いボタンを
                        常に置かない */}
                    {isOwnStory && (item.replyCount ?? 0) > 0 && (
                        <button
                            onClick={() => setInsights("reactions")}
                            aria-label={locale === "en" ? "Reactions and replies" : "届いたリアクション・返信を見る"}
                            className="pointer-events-auto flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
                            style={{ touchAction: "manipulation" }}
                        >
                            <ChatBubbleOvalLeftIcon className="w-4 h-4" />
                            {/* **名前は中身と揃える。** この数（`replyCount`）は
                                絵文字の反応と文字の返信の**合計**なので、
                                「返信 N件」と書くと ♡ だけの N 件でも
                                「返信」と言うことになる */}
                            {locale === "en"
                                ? `${item.replyCount} reaction${item.replyCount === 1 ? "" : "s"} & repl${item.replyCount === 1 ? "y" : "ies"}`
                                : `リアクション・返信 ${item.replyCount}件`}
                        </button>
                    )}
                    {/* **消えるもの → 残るもの。** ストーリーは24時間で消えて
                        検索にも出ないが、写真には個別ページも地図も集約ページも
                        ある。この1枚だけ、**下書きの写真**として残す
                        （公開は編集画面で本人が押す）。動画は写真の行にできない */}
                    {/* **「アーカイブに自動保存」の投稿には出さない。** 残した写真と
                        ストーリーは S3 の実体を共有し、写真を消すとアーカイブごと
                        消える。サーバーも 409 で断る（`storyKeep.ts`）ので、押しても
                        断られるだけのボタンを置かない */}
                    {isOwnStory && item.mediaType !== "video" && item.archive !== true && (
                        keptPhotoId || item.keptAs ? (
                            <Link
                                /* **URL を手で書かない**（`ROUTES.EDIT` と1文字同じものを
                                   書いていた）。`<a>` だと静的サイトを丸ごと読み直すので、
                                   他の導線（`PhotoPageClient`）と同じ `Link` に寄せる */
                                href={ROUTES.EDIT(keptPhotoId ?? String(item.keptAs))}
                                className="pointer-events-auto flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary/90 text-ink text-xs font-semibold"
                                style={{ touchAction: "manipulation" }}
                            >
                                <PhotoIcon className="w-4 h-4" />
                                {/* 短く。3つ並ぶ段なので、1文字でも幅が効く */}
                                {locale === "en" ? "Edit" : "仕上げる"}
                            </Link>
                        ) : (
                            <button
                                onClick={() => void keepToGallery()}
                                disabled={keeping}
                                aria-label={locale === "en" ? "Keep in gallery" : "ギャラリーに残す"}
                                className="pointer-events-auto flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm disabled:opacity-50"
                                style={{ touchAction: "manipulation" }}
                            >
                                <PhotoIcon className="w-4 h-4" />
                                {keeping
                                    ? (locale === "en" ? "Keeping…" : "残しています…")
                                    : (locale === "en" ? "Keep" : "残す")}
                            </button>
                        )
                    )}
                    {item.caption && !item.texts?.length && !textsHidden && (
                        /* **潰れるならキャプションは次の段へ。** ピルは全部
                           `flex-shrink-0` なので、縮むのはここだけ——3つ並ぶと
                           実測（390px）で幅 35px、320px では**ピルが画面の外**へ
                           出ていた。最小幅（8rem）を持たせると、収まらないときだけ
                           折り返る。ピルが1つのときは今までどおり横に並ぶ
                           （実測 390px で 251px）＝**見た目は変えていない** */
                        <p className="min-w-32 basis-32 flex-1 text-white text-sm leading-snug whitespace-pre-wrap break-words line-clamp-3 drop-shadow pointer-events-none">
                            {item.caption}
                        </p>
                    )}
                    </div>
                </div>
            )}

            {voteError && (
                <p
                    // **z は投票カード（25）と閉じる段（26）より上、返信の帯（30）より下。**
                    // z-20 だと、下寄りに置かれた白い投票カード自体が文言を覆う
                    className="absolute inset-x-4 z-[27] text-center text-[11px] text-white"
                    // **返信の帯（bottom-0・z-30・高さ約 7.5rem）の上に出す。**
                    // `keepError` と同じ位置（bottom-16）に置くと帯の裏に隠れる
                    // ——あちらは自分のストーリー（帯が出ない）限定の文言。
                    // 票を入れられる条件は帯が出る条件とほぼ同じなので、
                    // キャプションと同じぶん持ち上げる
                    style={{
                        bottom: showReplyBar
                            ? "calc(7.5rem + 8px + env(safe-area-inset-bottom, 0px))"
                            : "calc(4rem + env(safe-area-inset-bottom, 0px))",
                    }}
                    role="alert"
                ><span className="inline-flex items-start gap-1 rounded-xl bg-black/55 px-3 py-1"><ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />{voteError}</span></p>
            )}

            {keepError && isOwnStory && (
                <p
                    className="absolute inset-x-4 bottom-16 z-20 text-center text-[11px] text-white"
                    style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                    role="alert"
                ><span className="inline-flex items-start gap-1 rounded-xl bg-black/55 px-3 py-1"><ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />{keepError}</span></p>
            )}

            {/* **見た人が反応する道。** 自分のストーリーには出さない
                （送れない）。未ログインにも出さない——押してから断るのは
                いちばん不親切な形で、このリポジトリは会員限定の操作を
                最初から出さない側に揃えている */}
            {showReplyBar && (
                <div
                    className="absolute inset-x-0 bottom-0 z-30 px-3 pt-8 pb-3 bg-gradient-to-t from-black/80 to-transparent"
                    style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
                    /* **`stopPropagation` は要らない**（一度書いて外した）。
                       左右のタップ領域は**兄弟**の要素で、しかもこの帯は
                       その前面（z-30 対 z-10）。React のイベントは親へ上がる
                       だけなので、兄弟の送り操作には最初から届かない。
                       共通の親にも click は付いていない＝**死にコードだった**
                       （外しても挙動は変わらないことを変異で確認） */
                >
                    {replySent ? (
                        <p className="text-center text-white/80 text-xs py-2.5" role="status">
                            {locale === "en" ? "Sent" : "送信しました"}
                        </p>
                    ) : (
                        <>
                            {/* 絵文字の列。**入力に触れてから出す**——モック⑥ の帯は
                                「メッセージを送る…」と ♡ と ➤ の1段で、絵文字は
                                出ていない。触れたら閉じないのは、**閉じる側に
                                倒すと押せない**から（触った瞬間にフォーカスが
                                外れて列ごと消える）。次のストーリーへ移るか、
                                送り終えたら畳む */}
                            {replyOpen && (
                                <div className="flex items-center justify-center gap-1 pb-2">
                                    {STORY_REACTIONS.map((emoji) => (
                                        <button
                                            key={emoji}
                                            onClick={() => void sendReply({ emoji })}
                                            disabled={replySending}
                                            aria-label={locale === "en" ? `React ${emoji}` : `${emoji} で反応する`}
                                            className="text-2xl leading-none px-1.5 py-1 rounded-full active:scale-90 transition disabled:opacity-40"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    /* **打っている間は進めない。** 入力中に次へ送られると、
                                       書いた相手と違う人に届く */
                                    onFocus={() => { setReplyFocused(true); setReplyOpen(true); }}
                                    onBlur={() => setReplyFocused(false)}
                                    /* **変換確定の Enter で送らない。** 「きょう」を
                                       「今日」に変換した瞬間に飛ぶ（`lib/utils/ime.ts`） */
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !isImeKey(e.nativeEvent) && replyText.trim()) {
                                            e.preventDefault();
                                            void sendReply({ text: replyText.trim() });
                                        }
                                    }}
                                    maxLength={STORY_REPLY_MAX}
                                    disabled={replySending}
                                    placeholder={locale === "en" ? "Send a message…" : "メッセージを送る…"}
                                    aria-label={locale === "en" ? "Reply to this story" : "このストーリーに返信"}
                                    className="min-w-0 flex-1 px-4 py-2.5 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/20 text-white text-[16px] placeholder:text-white/50 focus:outline-none focus:ring-white/40"
                                />
                                {/* ♡: いちばん多い反応をひと押しで送る（モック⑥
                                    「いいね（♡）で気持ちを伝えられます」）。
                                    送る中身は絵文字の列の先頭と同じもので、
                                    一覧（`STORY_REACTIONS`）から採る——**絵文字を
                                    ここに書き写さない**（サーバーと突き合わせている
                                    のはあの一覧の方） */}
                                <button
                                    onClick={() => void sendReply({ emoji: STORY_REACTIONS[0] })}
                                    disabled={replySending}
                                    aria-label={locale === "en" ? "Send a like" : "いいねを送る"}
                                    className="flex-shrink-0 flex items-center justify-center text-white/90 hover:text-white disabled:opacity-40 active:scale-90 transition"
                                    style={{ touchAction: "manipulation", width: "44px", height: "44px" }}
                                >
                                    <HeartIcon className="w-6 h-6" />
                                </button>
                                {/* ➤: 打った文字を送る。**空のときは押せない**——
                                    押しても何も起きないボタンにしない（モックの絵は
                                    入力が空の状態で、この印が薄く置かれている） */}
                                <button
                                    onClick={() => void sendReply({ text: replyText.trim() })}
                                    disabled={replySending || !replyText.trim()}
                                    aria-label={locale === "en" ? "Send" : "送信"}
                                    className="flex-shrink-0 flex items-center justify-center text-white/90 hover:text-white disabled:opacity-30 active:scale-90 transition"
                                    style={{ touchAction: "manipulation", width: "44px", height: "44px" }}
                                >
                                    <PaperAirplaneIcon className="w-6 h-6" />
                                </button>
                            </div>
                            {replyError && (
                                <p className="pt-1.5 text-center text-[11px] text-white" role="alert">{replyError}</p>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* 閲覧者リスト（ボトムシート） */}
            {/* 反応の一覧（モック09 の状態例「リアクション・閲覧者リスト」）。
                **シートは1枚。タブで「閲覧者」と「リアクション・返信」を
                切り替える**——以前は同じ形のボトムシートが2枚在り、見出しも
                閉じるも2か所に書いてあった。数はどちらも実データ
                （作り物は出さない）。
                2つ目のタブが**両方を含む**ことは `insights` の doc に書いた。 */}
            {insights !== null && isOwnStory && (
                <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm" onClick={() => setInsights(null)}>
                    <div
                        className="absolute inset-x-0 bottom-0 bg-surface-2 ring-1 ring-white/10 rounded-t-3xl max-h-[60%] flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        {/* グラバー */}
                        <div className="flex justify-center pt-2.5 pb-1">
                            <span className="w-9 h-1 rounded-full bg-white/20" />
                        </div>
                        <div className="px-2 py-1 border-b border-white/10 flex items-center justify-between gap-2">
                            <div className="flex items-center" role="tablist" aria-label={locale === "en" ? "Story insights" : "ストーリーの閲覧者とリアクション・返信"}>
                                {([
                                    ["viewers", locale === "en" ? "Viewers" : "閲覧者",
                                        // 取得中・失敗のときは数を出さない（ピルと同じ扱い）
                                        viewersError ? null : viewers === null ? "…" : String(viewers.length)],
                                    // **「リアクション」だけにしない。** ここに並ぶのは
                                    // 絵文字の反応と文字の返信の両方で、数
                                    // （`replyCount`）も両方の合計。名前を片方に
                                    // すると、開いた中身と食い違う
                                    ["reactions", locale === "en" ? "Reactions & replies" : "リアクション・返信",
                                        // 数はサーバーが行に持っている（開かなくても分かる）
                                        repliesError ? null : String(item.replyCount ?? replies?.length ?? 0)],
                                ] as const).map(([key, label, count]) => {
                                    const active = insights === key;
                                    return (
                                        <button
                                            key={key}
                                            role="tab"
                                            aria-selected={active}
                                            onClick={() => setInsights(key)}
                                            className={`px-3 py-2.5 text-sm transition-colors ${active ? "text-white font-semibold" : "text-white/50 hover:text-white/80"}`}
                                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                                        >
                                            {label}
                                            {count !== null && <span className="ml-1.5 text-white/50 font-normal tabular-nums">{count}</span>}
                                            {/* 選んでいる方に下線（タブだと分かる印） */}
                                            {active && <span className="block h-0.5 mt-1 -mb-1 rounded-full bg-white" />}
                                        </button>
                                    );
                                })}
                            </div>
                            <button onClick={() => setInsights(null)} className="p-2 text-white/60 hover:text-white" aria-label={locale === "en" ? "Close" : "閉じる"}>
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        {insights === "viewers" && (
                        <div className="overflow-y-auto p-2">
                            {(viewers ?? []).length === 0 ? (
                                <p className="text-xs text-white/50 text-center py-8">
                                    {viewersError
                                        ? (locale === "en"
                                            ? "Couldn't load viewers."
                                            : "閲覧者を読み込めませんでした")
                                        : (locale === "en"
                                            ? "No viewers yet."
                                            : "まだ閲覧者はいません（ログインユーザーの閲覧のみ記録されます）")}
                                </p>
                            ) : (
                                (viewers ?? []).map((v) => (
                                    <div key={v.userId} className="flex items-center gap-3 px-3 py-2.5">
                                        {/* 退会した人はアバターも出さない（返信一覧・コメント欄と同じ扱い） */}
                                        <UserAvatar userId={v.deleted ? "" : v.userId} className="w-9 h-9" iconClassName="w-5 h-5" />
                                        <span className={`text-sm flex-1 truncate ${v.deleted ? "text-white/60" : "text-white/90"}`}>
                                            {v.displayName || (locale === "en" ? "User" : "ユーザー")}
                                        </span>
                                        {v.at && <span className="text-[11px] text-white/50">{timeAgo(v.at, locale)}</span>}
                                    </div>
                                ))
                            )}
                        </div>
                        )}
                        {insights === "reactions" && (
                        <div className="overflow-y-auto p-2">
                            {(replies ?? []).length === 0 ? (
                                <p className="text-xs text-white/50 text-center py-8">
                                    {repliesError
                                        ? (locale === "en" ? "Couldn't load reactions and replies." : "リアクション・返信を読み込めませんでした")
                                        : (locale === "en" ? "No reactions or replies yet." : "まだリアクションも返信もありません")}
                                </p>
                            ) : (
                                (replies ?? []).map((r) => (
                                    <div key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                                        {/* 退会した人はプロフィールへ飛ばさない
                                            （開いても墓石。コメント欄と同じ扱い） */}
                                        <UserAvatar userId={r.deleted ? "" : r.uid} className="w-9 h-9 flex-shrink-0" iconClassName="w-5 h-5" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[13px] text-white/90 truncate">{r.name}</p>
                                            <p className="text-sm text-white leading-snug break-words">
                                                {r.emoji ? <span className="text-xl leading-none">{r.emoji}</span> : r.text}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                            <span className="text-[11px] text-white/50">{timeAgo(r.t, locale)}</span>
                                            {/* 退会した人には出さない（もう届かない）。
                                                濃さは `/50`——黒地で 4.5:1 に届く最小
                                                （`/40` は 3.66:1。既存の走査が捕まえた） */}
                                            {!r.deleted && (blockedIds.has(r.uid) ? (
                                                <span className="text-[11px] text-white/50">
                                                    {locale === "en" ? "Blocked" : "ブロック済み"}
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => void blockSender(r.uid)}
                                                    disabled={blocking === r.uid}
                                                    aria-label={locale === "en" ? `Block ${r.name}` : `${r.name} さんをブロック`}
                                                    className="text-[11px] text-white/50 hover:text-danger disabled:opacity-40 active:scale-95 transition"
                                                    style={{ touchAction: "manipulation" }}
                                                >
                                                    {blocking === r.uid
                                                        ? (locale === "en" ? "Blocking…" : "ブロックしています…")
                                                        : (locale === "en" ? "Block" : "ブロック")}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                            {/* **何が起きるかと、戻し方を先に言う。** ブロックは
                                相手とのフォローを**両向きに切る**（`block.ts`）。
                                黙って切ると「フォロワーが1人減った」だけが残る。
                                押してから出しても遅い（確認ダイアログを増やす
                                かわりに、ボタンと同じ画面に1行置く）。
                                出すのはボタンが1つでも出ているときだけ */}
                            {(replies ?? []).some((r) => !r.deleted && !blockedIds.has(r.uid)) && (
                                <p className="pt-1 text-[11px] text-white/60 leading-relaxed">
                                    {locale === "en"
                                        ? "Blocking also removes follows in both directions. You can unblock from Settings."
                                        // 行き先は**設定**（2026-09-21 にプロフィール編集から移設）。
                                        // `BlockedUsers` は `/user/settings` の「プライバシー」に居る
                                        : "ブロックすると、お互いのフォローも外れます。解除は設定の「ブロックした人」からできます。"}
                                </p>
                            )}
                            {/* ブロックが効かなかった理由（`replyError` と同じ形） */}
                            {blockError && (
                                <p className="pt-1.5 text-center text-[11px] text-danger" role="alert">{blockError}</p>
                            )}
                        </div>
                        )}
                    </div>
                </div>
            )}

            {/* 「…」の操作シート（モック09 のストーリーメニュー） */}
            {menuOpen && (
                <StoryActionSheet
                    items={sheetItems}
                    onClose={() => setMenuOpen(false)}
                    cancelLabel={locale === "en" ? "Cancel" : "キャンセル"}
                    label={locale === "en" ? "Story actions" : "ストーリーの操作"}
                    openerRef={menuBtnRef}
                />
            )}

            {/* 報告（モック⑧）。**写真ページと同じ部品**——ストーリーの行は
                写真と同じ表に在るので、`POST /photos/{id}/report` がそのまま効く
                （サーバーは `story: true` を控える） */}
            {reportOpen && (
                <ReportDialog
                    photoId={item.id}
                    blockTargetId={!isOwnStory && group?.userId ? group.userId : undefined}
                    // 通報と一緒にブロックしたら、「このユーザーを非表示」と同じ
                    // 後片付け（ブロック済みの印・バーの取り直し・この画面を閉じる）
                    onBlocked={(uid) => {
                        setBlockedIds((prev) => new Set(prev).add(uid));
                        onBlocked?.(uid);
                        onClose();
                    }}
                    locale={locale}
                    onClose={() => setReportOpen(false)}
                    openerRef={menuBtnRef}
                />
            )}

            {/* 削除の確認。**同じシートの部品**で、説明文と赤い1項目だけを出す */}
            {confirmDelete && (
                <StoryActionSheet
                    items={[{
                        key: "delete",
                        label: locale === "en" ? "Delete" : "削除",
                        danger: true,
                        busy: deleting,
                        // 閉じない——消えるまでの間、進捗を出す場所が無くなる
                        closeOnSelect: false,
                        onSelect: () => { void handleDelete(); },
                    }]}
                    description={locale === "en"
                        ? "This story will be deleted. This can't be undone."
                        : "このストーリーを削除します。この操作は取り消せません。"}
                    onClose={() => { if (!deleting) setConfirmDelete(false); }}
                    cancelLabel={locale === "en" ? "Cancel" : "キャンセル"}
                    openerRef={menuBtnRef}
                />
            )}

            </div>
        </div>
    );
}
