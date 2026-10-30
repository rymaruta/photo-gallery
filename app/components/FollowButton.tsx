"use client";

// プロフィールのフォローUI: フォロワー/フォロー中の数（全員に表示）と、
// 他人のプロフィールにはフォローボタン。

import React, { useRef, useState } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { INLINE_BTN, INLINE_BTN_STYLE, FOLLOW_ON, FOLLOW_OFF, FOLLOW_LIST_MIN_W, PROFILE_FOLLOW_BTN, PROFILE_FOLLOW_STYLE, PROFILE_FOLLOW_OFF, PROFILE_FOLLOW_ON } from "./buttonStyles";
import { useFollow } from "../../lib/hooks/useFollow";
import { useToast } from "../../lib/hooks/useToast";
import { STAT_NUMBER_PX, STAT_LABEL_PX, STAT_NUMBER_CLASS, STAT_LABEL_CLASS, STAT_CELL_CLASS } from "./statCellStyle";
import FollowingSheet, { type FollowListKind } from "./FollowingSheet";

type Props = {
    targetUserId: string;
    isOwner: boolean;
    isAuthenticated: boolean;
    locale: "ja" | "en";
    /**
     * どの場面のボタンか。**大きさと文言だけが違う**（押したときの処理・
     * 楽観更新・エラーの返し分けは `useFollow` の1本で共有する）。
     *
     * - `profile` … プロフィールのアクション行。「フォローする」
     * - `outline` … 写真ページ。短い「フォロー」（名前は以前の形の名残。形はもう線ではない）
     * - `followBack` … 通知一覧の「フォローバック」（モック 05 の注釈③）。**文言も変える**——通知の文脈では
     *   「フォロー」ではなく、相手のフォローに返す操作だから
     * - `list` … 人を探すの一覧の行。「フォローする」・幅の下限 96（押し替えで揺れない）
     * 形は2つ（2026-10-30 束 0b C8）: `profile` は人のページの大きい札（iOS `ProfileFollowButtonLabel`・40・15）、
     * ほかは行の中の小ボタン（iOS `FollowPill`・36・13・`INLINE_BTN`）
     *
     * **2つ目のフォローボタンを作らないための prop。** 見た目のために
     * 別コンポーネントを立てると、`useFollow` を2か所から呼ぶことになり、
     * 「押しても数が動かない」「エラー文言が片方だけ古い」が必ず出る
     * （このリポジトリが何度も踏んでいる「同じものを二度作る」の形）。
     */
    variant?: "profile" | "outline" | "followBack" | "list";
    /**
     * 読み上げ用の名前。**一覧に並べるときは必ず渡す。**
     * 文言だけだと「フォローバック、ボタン」が人数ぶん続いて、
     * どれが誰なのか分からない（隣のアバターのリンクは名前を持っている）。
     */
    ariaLabel?: string;
    /**
     * 既にフォローしている相手では**何も描かない**。
     *
     * プロフィールの行では「フォロー中」（＝押すと解除）でよいが、
     * 通知の一覧は 56px の行が並ぶスクロール面で、そこに置いた高さ 32px の
     * 錠剤は**誤タップで無確認に解除される**。モックがフォローバックを
     * 出しているのも「まだ返していない」行なので、返し終わったら消える方が
     * モックにも近い。
     *
     * **判定が付くまでも描かない**（`!resolved`）。先に「フォローバック」を
     * 出してから消すと、一覧が一瞬ずれる。
     */
    hideWhenFollowing?: boolean;
};

/**
 * @param variant "stats" は最終版モックのマイページ用——投稿数と同じ行に並ぶ
 *   「数字が上・ラベルが下」の形（ピルではない）。既定の "pill" は今までどおり
 */
// **`variant` は `Omit` で外す。** `Props.variant` は `FollowAction` 用の
// 3つ（profile / outline / followBack）で、こちらの2つ（pill / stats）と
// 交わらない——外さずに `&` すると型が `never` になり、`variant="stats"` を
// 渡している呼び出し側が落ちる（develop を取り込んだときに実際に落ちた）
export default function FollowButton({ targetUserId, isAuthenticated, locale, variant = "pill" }: Omit<Props, "isOwner" | "variant"> & { isOwner?: boolean; variant?: "pill" | "stats" }) {
    const { followers, following, countsKnown } = useFollow(targetUserId, isAuthenticated);
    const [sheet, setSheet] = useState<FollowListKind | null>(null);
    const followingBtnRef = useRef<HTMLButtonElement>(null);
    const followersBtnRef = useRef<HTMLButtonElement>(null);


    // **自分の行を持つ。** 以前は「投稿・いいね」と同じ行に並べるために
    // ラッパー無しのフラグメントを返していたが、フォロー中／フォロワーは
    // 次の行に置く（owner の指示）。
    //
    // **行ごと消さない。** `countsKnown` は毎回 false から始まるので、
    // 行ごと消すと**初回描画には必ず無く**、数が届いた瞬間に約33pxの行が
    // 挿入されて自己紹介より下（サイト・タブ・写真グリッド）が全部動く。
    // すぐ上の「投稿・いいね」は同じ問題に `photosResolved ? postCount : "…"`
    // で答えている。**数字だけ `…` にすれば**「0人と言い切らない」を守った
    // まま行の高さが動かない。
    const shown = (n: number) => (countsKnown ? n.toLocaleString() : "…");

    if (variant === "stats") {
        // 数字が上・ラベルが下。押せるときだけボタンにする（0人・取得前は押させない）
        const cell = (n: number, label: string, kind: FollowListKind, ref: React.RefObject<HTMLButtonElement | null>) => {
            const open = isAuthenticated && countsKnown && n > 0;
            const inner = (
                <>
                    <span className={STAT_NUMBER_CLASS} style={{ fontSize: `${STAT_NUMBER_PX}px` }}>{shown(n)}</span>
                    <span className={STAT_LABEL_CLASS} style={{ fontSize: `${STAT_LABEL_PX}px` }}>{label}</span>
                </>
            );
            return open ? (
                <button type="button" ref={ref} onClick={() => setSheet(kind)} aria-haspopup="dialog"
                        className={`${STAT_CELL_CLASS} hover:opacity-80 active:scale-95 transition`}
                        style={{ touchAction: "manipulation", minHeight: "44px" }}>
                    {inner}
                </button>
            ) : <div className={STAT_CELL_CLASS}>{inner}</div>;
        };
        return (
            <>
                {cell(followers, locale === "en" ? "followers" : "フォロワー", "followers", followersBtnRef)}
                {cell(following, locale === "en" ? "following" : "フォロー中", "following", followingBtnRef)}
                {sheet && (
                    <FollowingSheet
                        userId={targetUserId}
                        kind={sheet}
                        locale={locale}
                        onClose={() => setSheet(null)}
                        openerRef={sheet === "following" ? followingBtnRef : followersBtnRef}
                    />
                )}
            </>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2 -mt-2 mb-4">
            {/* カウントピル（全員に表示）。フォロー中 → フォロワー の順。
                **まだ分からない間は数を出さない**——`?? EMPTY` の 0/0 を
                そのまま描いていた頃は、取得が落ちた人が「フォロワー 0」と
                言い切られていた（本当に0人の人と区別が付かない）。 */}
            {/* 0人のときと、数が届く前は押させない（開いても空／押せる・
                押せないが途中で変わる）。未ログインは一覧の口が断る */}
            {isAuthenticated && countsKnown && following > 0 ? (
                <button
                    type="button"
                    ref={followingBtnRef}
                    onClick={() => setSheet("following")}
                    aria-haspopup="dialog"
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-line px-3 py-1.5 hover:bg-black/50 active:scale-95 transition"
                    style={{ touchAction: "manipulation" }}
                >
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(following)}</span>
                    <span className="text-[12px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
                    {/* **押せると分かるようにする。** 押せない側のピルと
                        `hover:` しか違わないと、スマホでは見分けが付かない */}
                    <ChevronRightIcon className="w-3 h-3 text-white/60" aria-hidden="true" />
                </button>
            ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-line px-3 py-1.5">
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(following)}</span>
                    <span className="text-[12px] text-white/60">{locale === "en" ? "following" : "フォロー中"}</span>
                </div>
            )}
            {isAuthenticated && countsKnown && followers > 0 ? (
                <button
                    type="button"
                    ref={followersBtnRef}
                    onClick={() => setSheet("followers")}
                    aria-haspopup="dialog"
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-line px-3 py-1.5 hover:bg-black/50 active:scale-95 transition"
                    style={{ touchAction: "manipulation" }}
                >
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(followers)}</span>
                    <span className="text-[12px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
                    <ChevronRightIcon className="w-3 h-3 text-white/60" aria-hidden="true" />
                </button>
            ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-line px-3 py-1.5">
                    <span className="text-sm font-bold tabular-nums leading-none">{shown(followers)}</span>
                    <span className="text-[12px] text-white/60">{locale === "en" ? "followers" : "フォロワー"}</span>
                </div>
            )}
            {sheet && (
                <FollowingSheet
                    userId={targetUserId}
                    kind={sheet}
                    locale={locale}
                    openerRef={sheet === "following" ? followingBtnRef : followersBtnRef}
                    onClose={() => setSheet(null)}
                />
            )}
        </div>
    );
}

/**
 * フォローボタン単体。数字のピル（FollowButton）とは切り離し、
 * プロフィールのアクション行（編集/写真を追加 と同じ場所）に置けるようにする。
 */
export function FollowAction({ targetUserId, isOwner, isAuthenticated, locale, variant = "profile", ariaLabel, hideWhenFollowing }: Props) {
    // 数は描かないので取りに行かない（検索結果 N 件で N 本飛んでいた）。
    // 数のピルはプロフィールの FollowButton が別に取る。
    //
    // **通知一覧に N 個並んでも問い合わせは増えない。** `withCounts = false`
    // なので `GET /users/<id>/follow` は飛ばず、フォロー中の一覧
    // （`fetchFollowingSet`）は**モジュール側で1本に束ねてある**
    // （`followingPromise` の相乗り）ので、50件の通知に何個ボタンが出ても
    // `GET /user/following` は1回。ここを確かめずに並べると、通知を開く
    // たびに数十本の GET が飛ぶ形になっていた。
    const { isFollowing, pending, resolved, toggle } = useFollow(targetUserId, isAuthenticated, false);
    const { showToast } = useToast();
    const compact = variant === "followBack";

    if (isOwner) return null;
    // 返し終わった行（と、まだ判定が付いていない行）には何も置かない。
    // **`useFollow` より後に置くこと**——フックは毎回同じ数だけ呼ぶ
    if (hideWhenFollowing && (!resolved || isFollowing)) return null;

    const onClick = async () => {
        const { result, message } = await toggle();
        if (result === "auth-required") {
            showToast(message ?? (locale === "en" ? "Log in to follow" : "フォローするにはログインしてください"), "info");
        } else if (result === "followed") {
            // `already`（取り直したら既にフォロー中）はここを通らない。送っていないので言わない
            showToast(locale === "en" ? "Following" : "フォローしました", "success");
        } else if (result === "error") {
            // サーバーの理由をそのまま出す（「自分はフォローできません」など）。
            // 一語に潰していた頃は、直せるものも直せない案内になっていた
            showToast(message ?? (locale === "en" ? "Something went wrong" : "うまくいきませんでした"), "error");
        }
    };

    return (
        <button
            onClick={() => void onClick()}
            // 判定が終わるまで押させない。初期値の false を「未フォロー」と
            // 同じ扱いにしていた頃は、一覧を取り終える前にボタンが「フォロー」と
            // 出て、押しても既にフォロー済みで画面が変わらなかった。
            disabled={pending || !resolved}
            aria-pressed={isFollowing}
            aria-label={ariaLabel}
            // 2026-10-30 束 0b C8: 人のページは iOS の `ProfileFollowButtonLabel`（40・15・フォロー中は線と ▾）、
            // 写真の詳細・お知らせ・一覧は `FollowPill`（36・13）。以前は場面ごとに 真鍮の線（写真）・白塗り 44（人）・32（お知らせ）と割れていた
            className={variant === "profile"
                ? `${PROFILE_FOLLOW_BTN} flex-shrink-0 ${isFollowing ? PROFILE_FOLLOW_ON : PROFILE_FOLLOW_OFF}`
                : `${INLINE_BTN} flex-shrink-0 ${isFollowing ? FOLLOW_ON : FOLLOW_OFF}`}
            style={variant === "profile"
                ? { ...PROFILE_FOLLOW_STYLE, touchAction: "manipulation" }
                : { ...INLINE_BTN_STYLE, ...(variant === "list" ? { minWidth: FOLLOW_LIST_MIN_W } : {}), touchAction: "manipulation" }}
        >
            {isFollowing
                ? (variant === "profile"
                    ? <>{locale === "en" ? "Following" : "フォロー中"}<ChevronDownIcon aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 2.5 }} /></>
                    : (locale === "en" ? "Following" : "フォロー中"))
                : compact
                    ? (locale === "en" ? "Follow back" : "フォローバック")
                    : variant === "outline"
                        ? (locale === "en" ? "Follow" : "フォロー")
                        : (locale === "en" ? "Follow" : "フォローする")}
        </button>
    );
}
