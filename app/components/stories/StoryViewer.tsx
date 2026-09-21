"use client";

import { usableRows } from "../../../lib/utils/apiRows";
import { safeSongPreviewUrl } from "../../../lib/utils/mediaHosts";
import { dropCachedPhoto } from "../../../lib/utils/photoCache";
import { publicImageUrl } from "@/lib/utils/seo";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { XMarkIcon, EyeIcon, SpeakerWaveIcon, SpeakerXMarkIcon, TrashIcon, MusicalNoteIcon, PhotoIcon, ChatBubbleOvalLeftIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { PlayIcon, PauseIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import UserAvatar from "../UserAvatar";
import type { StoryGroup, StoryViewer as ViewerEntry } from "@/lib/stories";
import { timeAgo } from "@/lib/stories";
import { log } from "@/lib/utils/log";
import { useMusic } from "../../music/MusicContext";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import { isImeKey } from "@/lib/utils/ime";
import { wasShortTap, type PressPoint } from "@/lib/utils/tap";
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

    // ストーリーBGM: 表示中のストーリーに曲が付いていれば再生する。
    // ブラウザの自動再生ポリシーに合わせて既定はミュート（チップかスピーカーで解除）。
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // グローバル音楽（マイBGM等）とは同時に鳴らさない
    const { stop: stopGlobalMusic } = useMusic();
    useEffect(() => { stopGlobalMusic(); }, [stopGlobalMusic]);
    const [viewers, setViewers] = useState<ViewerEntry[] | null>(null);
    // 取得の失敗を「閲覧者0人」と混ぜない（SW-b8）
    const [viewersError, setViewersError] = useState(false);
    const [viewersOpen, setViewersOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
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
    // 届いた返信（投稿者だけ）
    const [replies, setReplies] = useState<StoryReply[] | null>(null);
    const [repliesError, setRepliesError] = useState(false);
    const [repliesOpen, setRepliesOpen] = useState(false);
    // ギャラリーに残す（このサイトにしかない向き。消えるもの → 検索に出るもの）
    const [keeping, setKeeping] = useState(false);
    const [keptPhotoId, setKeptPhotoId] = useState<string | null>(null);
    const [keepError, setKeepError] = useState<string | null>(null);
    /** 返信の一覧から「この人からの返信を受け取らない」を押した相手 */
    const [blocking, setBlocking] = useState<string | null>(null);
    const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const reportedRef = useRef<Set<string>>(new Set());

    const group = groups[g];
    const item = group?.items[i];
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

    // 閲覧をサーバーに記録（ログイン済み・他人のストーリーのみ・セッション内1回）
    useEffect(() => {
        if (!item || !isAuthenticated || isOwnStory) return;
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
    // deps に入れられなかった（入れると開いた瞬間に `setViewersOpen(false)`
    // が走って開けない）。分けたので、取得の側に開閉を効かせられる
    useEffect(() => {
        setViewers(null);
        setViewersError(false);   // 前のストーリーの失敗を持ち越さない
        setViewersOpen(false);
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
        if (!item || !isOwnStory) return;
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
        if (bar) bar.style.transform = "scaleX(0)";
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
                bar.style.transform = `scaleX(${ratio})`;
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

    const onZonePointerDown = useCallback((e: React.PointerEvent) => {
        pressRef.current = { t: Date.now(), x: e.clientX, y: e.clientY };
        setPaused((prev) => { pressPausedRef.current = !prev; return true; });
    }, []);

    /** 指を離した。長押しで止めたときだけ再開する */
    const onZonePointerUp = useCallback(() => {
        if (!pressPausedRef.current) return;
        pressPausedRef.current = false;
        setPaused(false);
    }, []);

    /** 直前の操作が短いタップだったか（長押し・指の移動があれば false） */
    const wasTap = useCallback((e: React.MouseEvent): boolean => {
        const p = pressRef.current;
        pressRef.current = null;
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
        || (!mediaReady && !mediaError);

    // 画像の進捗は CSS アニメーション（60fps・再描画なし）が駆動し、
    // 完了は onAnimationEnd で検知する。動画は下の onTimeUpdate で進捗を更新。

    // 一時停止/再開を動画にも反映
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (frozen) v.pause();
        else void v.play()?.catch?.(() => { /* 自動再生ブロック等は無視 */ });
    }, [frozen, item]);

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
        if (replayChanged || a.currentTime < start) {
            try { a.currentTime = start; } catch { /* seek 未対応は無視 */ }
        }
        void a.play().catch(() => { /* 自動再生ブロック等は無視 */ });
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
        setReplies(null);
        setRepliesError(false);
        setRepliesOpen(false);
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
        } catch (e) {
            const { sessionErrorMessage } = await import("../../../lib/utils/api");
            if (stillHere()) setReplyError(sessionErrorMessage(e) ?? (locale === "en" ? "Couldn't send." : "送信できませんでした"));
        } finally {
            setReplySending(false);
        }
    }, [item, replySending, locale]);

    // 届いた返信は**開いたときに取りに行く**（バッジの数は `replyCount` が
    // 持っているので、開かない限り読みに行かない）。
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
                // **配列でない応答を「まだ返信はありません」にしない**
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
    const blockSender = useCallback(async (uid: string) => {
        if (!uid || blocking) return;
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
    }, [blocking, onBlocked, locale]);

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
            if (confirmDelete || viewersOpen || repliesOpen) {
                if (e.key === "Escape") { setConfirmDelete(false); setViewersOpen(false); setRepliesOpen(false); }
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
    }, [onClose, goNext, goPrev, confirmDelete, viewersOpen, repliesOpen]);

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

    // 表示中のストーリーが変わったら確認シートを閉じる。
    // 開いたときの対象と、押したときの対象がずれないようにする。
    useEffect(() => { setConfirmDelete(false); }, [item?.id]);

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

    return (
        <div
            ref={rootRef}
            className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center select-none"
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
                {item.texts?.length && !mediaError ? (
                    <StoryTextOverlay texts={item.texts} box={mediaBox} />
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
            {item.song && (
                <audio
                    key={`audio-${item.id}`}
                    ref={audioRef}
                    // **出すときにも確かめる。** サーバーの許可リストは
                    // これから保存する値にしか効かず、許可リスト以前の行は
                    // 任意のホストのまま残りうる。しかもここは
                    // `preload="auto"`＝**開いた瞬間に取りに行く**うえ、
                    // ストーリーはログイン中の全員のトレイに出る
                    // ——`mediaHosts.ts` のコメントが最悪ケースとして
                    // 名指ししているのがこの経路
                    src={safeSongPreviewUrl(item.song.previewUrl)}
                    muted
                    preload="auto"
                    // 指定された「好きな部分」から繰り返す（loop属性だと必ず0秒に戻ってしまう）
                    onEnded={(e) => {
                        const a = e.currentTarget;
                        try { a.currentTime = songStartSec(item.song?.startSec); } catch { /* ignore */ }
                        void a.play().catch(() => { /* ignore */ });
                    }}
                />
            )}

            {/* 上部グラデーション + プログレスバー + ヘッダー */}
            {/* z-20: 下のタップ領域(z-10)より前面。ノッチ端末では safe-area の分だけ
                ヘッダーが下がり、曲チップがタップ領域に潜って押せなくなるため。 */}
            <div className="absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/70 to-transparent pt-2 pb-8 px-2 pointer-events-none">
                <div className="flex gap-1 mb-3" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
                    {group.items.map((s, idx) => {
                        const done = idx < i;
                        const active = idx === i;
                        return (
                            <div key={s.id} className="flex-1 h-[2.5px] rounded-full bg-white/30 overflow-hidden">
                                {active ? (
                                    isVideo ? (
                                        // 動画: rAF が毎フレーム scaleX を書く（補間は要らない）
                                        <div
                                            ref={progressBarRef}
                                            className="h-full w-full bg-white rounded-full origin-left"
                                            style={{ transform: "scaleX(0)" }}
                                        />
                                    ) : (
                                        // 画像: CSS アニメーションが 0→100% を滑らかに駆動
                                        <div
                                            key={`${item.id}-${replay}`}
                                            className="h-full w-full bg-white rounded-full story-progress-fill"
                                            style={{
                                                animationDuration: `${storyDurationMs(item.durationSec)}ms`,
                                                animationPlayState: frozen ? "paused" : "running",
                                            }}
                                            onAnimationEnd={goNext}
                                        />
                                    )
                                ) : (
                                    <div
                                        className="h-full w-full bg-white rounded-full origin-left"
                                        style={{ transform: done ? "scaleX(1)" : "scaleX(0)" }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
                <div className="flex items-start gap-2 px-1 pr-24">
                    <UserAvatar userId={group.userId} className="w-8 h-8" iconClassName="w-5 h-5" />
                    <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-white drop-shadow truncate">{group.displayName}</span>
                            <span className="text-xs text-white/60 flex-shrink-0">{timeAgo(item.createdAt, locale)}</span>
                        </div>
                        {/* **撮影地。** 見る側に「どこで」が伝わる。名前の段の下に
                            置くのは、キャプションの段（下端）が既に3つのピルで
                            埋まっているため（実測でキャプションが潰れた前例あり） */}
                        {item.location && (
                            <p className="text-[11px] text-white/70 drop-shadow truncate max-w-full">
                                <MapPinIcon className="w-3 h-3 inline -mt-0.5 mr-0.5" aria-hidden="true" />
                                {item.location}
                            </p>
                        )}
                        {/* 曲は名前のすぐ下の段（親は pointer-events-none なのでここで戻す） */}
                        {item.song && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
                                className="pointer-events-auto mt-1 inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full bg-white/15 ring-1 ring-white/15 text-white/90 text-[11px] active:scale-95 transition"
                                style={{ touchAction: "manipulation" }}
                                aria-label={muted ? (locale === "en" ? "Turn sound on" : "音を出す") : (locale === "en" ? "Mute" : "ミュート")}
                            >
                                {muted
                                    ? <SpeakerXMarkIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/60" />
                                    : <MusicalNoteIcon className="w-3.5 h-3.5 flex-shrink-0 text-fuchsia-300" />}
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
                    </div>
                </div>
            </div>

            {/* 閉じる / ミュート切り替え */}
            <div className="absolute top-3 right-2 z-20 flex items-center gap-1" style={{ marginTop: "env(safe-area-inset-top, 0px)" }}>
                {(isVideo || item.song) && (
                    <button
                        onClick={() => setMuted((m) => !m)}
                        aria-label={muted ? (locale === "en" ? "Unmute" : "ミュート解除") : (locale === "en" ? "Mute" : "ミュート")}
                        className="p-2.5 text-white/80 hover:text-white"
                        style={{ touchAction: "manipulation" }}
                    >
                        {muted ? <SpeakerXMarkIcon className="w-5 h-5" /> : <SpeakerWaveIcon className="w-5 h-5" />}
                    </button>
                )}
                {/* **止める手段を画面に置く。** これまで自動送りを止められるのは
                    「押しっぱなし」だけで、キーボードだけの人には手段が無かった。
                    読む速さは人によって違うので、設定（動きを減らす）とは関係なく要る */}
                <button
                    onClick={() => setPaused((v) => !v)}
                    aria-label={paused
                        ? (locale === "en" ? "Resume" : "再生")
                        : (locale === "en" ? "Pause" : "一時停止")}
                    aria-pressed={paused}
                    className="p-2.5 text-white/80 hover:text-white"
                    style={{ touchAction: "manipulation" }}
                >
                    {paused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
                </button>
                {isOwnStory && onDelete && (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        aria-label={locale === "en" ? "Delete story" : "ストーリーを削除"}
                        className="p-2.5 text-white/80 hover:text-white"
                        style={{ touchAction: "manipulation" }}
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                )}
                <button
                    ref={closeBtnRef}
                    onClick={onClose}
                    aria-label={locale === "en" ? "Close" : "閉じる"}
                    className="p-2.5 text-white/80 hover:text-white"
                    style={{ touchAction: "manipulation" }}
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
                style={{ top: 80, bottom: zoneBottom, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goPrev(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={onZonePointerUp}
                onPointerLeave={onZonePointerUp}
            />
            <div
                className="absolute right-0 w-2/3 z-10"
                style={{ top: 80, bottom: zoneBottom, touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                onClick={(e) => { if (wasTap(e)) goNext(); }}
                onPointerDown={onZonePointerDown}
                onPointerUp={onZonePointerUp}
                onPointerLeave={onZonePointerUp}
            />

            {/* 画面下: 閲覧者数（自分のみ）とキャプションを同じ段に並べる。
                **置いた場所の文字が在るときは、この段には出さない**
                （同じ文言が写真の上と下に二重に出る） */}
            {(isOwnStory || (item.caption && !item.texts?.length)) && (
                <div
                    /* **`flex-wrap`。** ピルは全部 `flex-shrink-0` で、縮むのは
                       キャプションだけ。閲覧者・返信件数・残すの3つが並ぶと
                       実測（390px）で**キャプションの幅が 0px**になり、
                       360px 以下ではピル自体が**画面の外へ切れる**（押せない
                       部分ができる）。折り返せばキャプションは2段目に落ちる
                       ——位置が変わるだけで、見た目の作り直しにはならない */
                    className="absolute bottom-4 left-4 right-4 z-20 flex flex-wrap items-center gap-2"
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
                    {isOwnStory && (
                        <button
                            onClick={() => setViewersOpen(true)}
                            aria-label={locale === "en" ? "Viewers" : "閲覧者を見る"}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
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
                    {/* 届いた返信（投稿者だけ）。数は `replyCount` が持っている
                        ので、開かない限り読みに行かない。**0件のときは出さない**
                        ——押しても何も無いボタンを常に置かない */}
                    {isOwnStory && (item.replyCount ?? 0) > 0 && (
                        <button
                            onClick={() => setRepliesOpen(true)}
                            aria-label={locale === "en" ? "Replies" : "届いた返信を見る"}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm"
                            style={{ touchAction: "manipulation" }}
                        >
                            <ChatBubbleOvalLeftIcon className="w-4 h-4" />
                            {locale === "en"
                                ? `${item.replyCount} repl${item.replyCount === 1 ? "y" : "ies"}`
                                : `返信 ${item.replyCount}件`}
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
                                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/90 text-black text-xs font-semibold"
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
                                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/60 text-white/80 hover:text-white text-xs backdrop-blur-sm disabled:opacity-50"
                                style={{ touchAction: "manipulation" }}
                            >
                                <PhotoIcon className="w-4 h-4" />
                                {keeping
                                    ? (locale === "en" ? "Keeping…" : "残しています…")
                                    : (locale === "en" ? "Keep" : "残す")}
                            </button>
                        )
                    )}
                    {item.caption && !item.texts?.length && (
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
            )}

            {keepError && isOwnStory && (
                <p
                    className="absolute inset-x-4 bottom-16 z-20 text-center text-[11px] text-rose-300"
                    style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                    role="alert"
                >{keepError}</p>
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
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={replyText}
                                    onChange={(e) => setReplyText(e.target.value)}
                                    /* **打っている間は進めない。** 入力中に次へ送られると、
                                       書いた相手と違う人に届く */
                                    onFocus={() => setReplyFocused(true)}
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
                                    placeholder={locale === "en" ? "Send a message…" : "メッセージを送信…"}
                                    aria-label={locale === "en" ? "Reply to this story" : "このストーリーに返信"}
                                    className="min-w-0 flex-1 px-4 py-2.5 rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/20 text-white text-sm placeholder:text-white/50 focus:outline-none focus:ring-white/40"
                                />
                                {replyText.trim() && (
                                    <button
                                        onClick={() => void sendReply({ text: replyText.trim() })}
                                        disabled={replySending}
                                        aria-label={locale === "en" ? "Send" : "送信"}
                                        className="flex-shrink-0 px-3 py-2.5 text-sm text-white font-semibold disabled:opacity-40 active:scale-95 transition"
                                        style={{ touchAction: "manipulation" }}
                                    >
                                        {locale === "en" ? "Send" : "送信"}
                                    </button>
                                )}
                            </div>
                            {replyError && (
                                <p className="pt-1.5 text-center text-[11px] text-rose-300" role="alert">{replyError}</p>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* 閲覧者リスト（ボトムシート） */}
            {viewersOpen && isOwnStory && (
                <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm" onClick={() => setViewersOpen(false)}>
                    <div
                        className="absolute inset-x-0 bottom-0 bg-[#16181c] ring-1 ring-white/10 rounded-t-3xl max-h-[60%] flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        {/* グラバー */}
                        <div className="flex justify-center pt-2.5 pb-1">
                            <span className="w-9 h-1 rounded-full bg-white/20" />
                        </div>
                        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">
                                {locale === "en" ? "Viewers" : "閲覧者"}
                                {/* **取得中を 0 と言わない。** 同じ画面のボタン側は
                                    `viewers === null` を "..." と出しているのに、
                                    この見出しだけ `?? 0` で潰していて、開いた瞬間
                                    「閲覧者 0」が出てから数字が入っていた */}
                                {/* 失敗したら数字を出さない（上のボタンと同じ）。
                                    本文が「読み込めませんでした」と説明する */}
                                {!viewersError && (
                                    <span className="ml-2 text-white/50 font-normal">{viewers === null ? "…" : viewers.length}</span>
                                )}
                            </h3>
                            <button onClick={() => setViewersOpen(false)} className="p-1 text-white/60 hover:text-white" aria-label={locale === "en" ? "Close" : "閉じる"}>
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
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
                    </div>
                </div>
            )}

            {/* 届いた返信（投稿者だけ。閲覧者リストと同じ形のボトムシート） */}
            {repliesOpen && isOwnStory && (
                <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm" onClick={() => setRepliesOpen(false)}>
                    <div
                        className="absolute inset-x-0 bottom-0 bg-[#16181c] ring-1 ring-white/10 rounded-t-3xl max-h-[60%] flex flex-col shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                    >
                        <div className="flex justify-center pt-2.5 pb-1">
                            <span className="w-9 h-1 rounded-full bg-white/20" />
                        </div>
                        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">
                                {locale === "en" ? "Replies" : "届いた返信"}
                                {/* 取得中を 0 と言わない・失敗したら数字を出さない
                                    （閲覧者リストと同じ扱い） */}
                                {!repliesError && (
                                    <span className="ml-2 text-white/50 font-normal">{replies === null ? "…" : replies.length}</span>
                                )}
                            </h3>
                            <button onClick={() => setRepliesOpen(false)} className="p-1 text-white/60 hover:text-white" aria-label={locale === "en" ? "Close" : "閉じる"}>
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="overflow-y-auto p-2">
                            {(replies ?? []).length === 0 ? (
                                <p className="text-xs text-white/50 text-center py-8">
                                    {repliesError
                                        ? (locale === "en" ? "Couldn't load replies." : "返信を読み込めませんでした")
                                        : (locale === "en" ? "No replies yet." : "まだ返信はありません")}
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
                                                    className="text-[11px] text-white/50 hover:text-rose-300 disabled:opacity-40 active:scale-95 transition"
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
                                        ? "Blocking also removes follows in both directions. You can unblock from your profile settings."
                                        : "ブロックすると、お互いのフォローも外れます。解除はプロフィール設定からできます。"}
                                </p>
                            )}
                            {/* ブロックが効かなかった理由（`replyError` と同じ形） */}
                            {blockError && (
                                <p className="pt-1.5 text-center text-[11px] text-rose-300" role="alert">{blockError}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 削除確認ダイアログ */}
            {confirmDelete && (
                <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 px-3 pb-3 sm:pb-0" onClick={() => !deleting && setConfirmDelete(false)}>
                    {/* iOS のアクションシート風。装飾は最小限にして、文字そのもので選ばせる */}
                    <div className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl overflow-hidden">
                            <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">
                                {locale === "en"
                                    ? "This story will be deleted. This can't be undone."
                                    : "このストーリーを削除します。この操作は取り消せません。"}
                            </p>
                            <button
                                onClick={() => void handleDelete()}
                                disabled={deleting}
                                className="w-full py-3.5 border-t border-white/10 text-[#ff453a] text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ touchAction: "manipulation" }}
                            >
                                {deleting && <div className="w-3.5 h-3.5 border-2 border-[#ff453a]/40 border-t-[#ff453a] rounded-full animate-spin" />}
                                {locale === "en" ? "Delete" : "削除"}
                            </button>
                        </div>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                            className="w-full py-3.5 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-[#2c2c2e]/95 active:bg-[#2c2c2e] transition disabled:opacity-50"
                            style={{ touchAction: "manipulation", marginBottom: "env(safe-area-inset-bottom, 0px)" }}
                        >
                            {locale === "en" ? "Cancel" : "キャンセル"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
