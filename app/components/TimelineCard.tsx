"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { HeartIcon, ChatBubbleOvalLeftIcon } from "@heroicons/react/24/outline";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { slugify, tagKey, collectionPath } from "@/lib/utils/collections";
import { photoAltText } from "@/lib/utils/photoAlt";
import { timeAgo } from "@/lib/stories";
import Thumb from "./Thumb";
import ProfileLink from "./ProfileLink";
import { FollowAction } from "./FollowButton";
import { FEED_SIZES_XL } from "./gridSizes";

type Props = {
    photo: Photo;
    locale: Locale;
    /** 最初の画面に入る数枚だけ true（`fetchPriority="high"`） */
    priority?: boolean;
    /** ログイン中か。フォローの操作を出すかの判断に使う */
    isAuthenticated?: boolean;
    /** 見ている人の id。自分の写真にはフォローを出さない */
    viewerId?: string | null;
};

/** カードに出すタグの数。全部出すと写真より文字が多くなる */
const TAGS_SHOWN = 4;

/**
 * **サーバーでは描かない値のための札**（`Thumb` と同じ形）。
 *
 * 「3日前」は**見ている瞬間で変わる**。静的書き出しはビルド時に文字列を
 * 焼くので、そのまま出すと**ビルドの翌日以降は毎回 水和が食い違う**
 * （実測: `out/index.html` に「244日前」が19件焼かれていて、実ブラウザの
 * スモークが React の水和エラー #418 を出した）。
 *
 * 焼かずに、React が付いてから出す。**検索に効く文字ではない**ので、
 * 静的HTMLに無くて困らない（題・撮影地・説明・タグは焼いたまま）。
 */
const subscribeNoop = () => () => {};
function useAfterHydration(): boolean {
    return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/**
 * 一覧の1枚（owner の新デザインのカード）。
 *
 * **写真が先、投稿者が後。** 以前は投稿者の行が写真の上にあったが、モックは
 * 写真を一番上に置き、題と撮影地を写真の上に重ね、その下に投稿者の行を敷く。
 * 「写真が主役」（CLAUDE.md）と同じ向き。
 *
 * 画像は一覧と同じ `Thumb`（512px の派生まで）。写真ページの主役（≤1600）を
 * 流し読みの面で1枚ずつ落とすのは重すぎる。押せば写真ページで原寸に近い方が出る。
 *
 * **いいね・コメントは「数」と「行き先」だけ。**
 * `usePhotoLikes` は写真ごとにサーバーへ引きに行くので、カードに載せると
 * **一覧を開くだけで N 往復**になる（CLAUDE.md の優先度「表示速度」と逆）。
 * 押すと写真ページが開き、そこで押せる。**押せない見た目のボタンを置かない**
 * ——リンクとして出す。
 */
export default function TimelineCard({ photo, locale, priority = false, isAuthenticated = false, viewerId = null }: Props) {
    const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const alt = photoAltText(photo, locale);
    const isJa = locale !== "en";
    // 「いつ上げたか」。撮影日ではない（並びと同じ理由。`lib/utils/timeline.ts`）。
    // **`createdAt` は UTC の瞬間（`…Z`）**なので、書かれた数字をそのまま出す
    // `formatStoredDateTime` に通すと JST の人には9時間前の時刻になる
    // （実測 `2026-04-29T23:10:00Z` → 「4月29日 23:10」＝本当は 4/30 08:10）。
    // ストーリー・コメントと同じ相対表記（「3日前」）なら閲覧者のゾーンで正しい
    const hydrated = useAfterHydration();
    const posted = hydrated && photo.createdAt ? timeAgo(photo.createdAt, isJa ? "ja" : "en") : "";
    // 実寸があればその比で枠を予約する（読み込み後に高さが伸びて下がガタつかない）。
    // 無ければ一覧と同じ 3:2
    const ratio = photo.width && photo.height && photo.width > 0 && photo.height > 0
        ? (photo.height / photo.width) * 100
        : 75;
    // **壊れた要素は数えない**（「1/3」と出して開くと2枚、を作らない）
    const extraCount = Array.isArray(photo.extraImages)
        ? photo.extraImages.filter((i) => typeof i?.src === "string" && !!i.src).length
        : 0;
    // 説明は段落で持つ（`getLocalizedParagraphs` が言語の落とし込みまでやる）
    const paragraphs = getLocalizedParagraphs(photo.description, locale);
    // **同じタグを2回出さない**（`tagKey` は `#旅` と `旅`、大小を畳む）
    const tags = React.useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const t of photo.tags ?? []) {
            const k = tagKey(t);
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(t);
            if (out.length >= TAGS_SHOWN) break;
        }
        return out;
    }, [photo.tags]);
    // **自分の写真にフォローは出さない**（押しても断られる）。
    // 投稿者が分からない古い行にも出さない
    const showFollow = !!photo.userId && photo.userId !== viewerId;

    return (
        <article className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <Link
                href={ROUTES.PHOTO(photo.id)}
                prefetch={false}
                className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                aria-label={title ? `${title} を開く` : "写真を開く"}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                data-photo-id={photo.id}
            >
                <div
                    className="relative w-full overflow-hidden"
                    style={{ paddingTop: `${ratio}%`, backgroundColor: photo.dominantColor ?? "#111", fontSize: 0, lineHeight: 0 }}
                >
                    <Thumb photo={photo} alt={alt} sizes={FEED_SIZES_XL} priority={priority} />

                    {/* 複数枚の「1/N」（一覧のセルと同じ形） */}
                    {extraCount > 0 && (
                        <p className="absolute top-3 right-3 rounded-full bg-black/60 backdrop-blur-sm text-white pointer-events-none"
                           style={{ fontSize: "12px", lineHeight: "14px", padding: "3px 8px" }}
                           aria-hidden="true">
                            1/{extraCount + 1}
                        </p>
                    )}

                    {/* **題と撮影地を写真の上に。** 中身が無ければ帯ごと出さない
                        （題の無い写真に空の帯を敷くと、下だけ黒くなって理由が
                        分からない。一覧のセルで一度直した形） */}
                    {(title || photo.location) && (
                        <div className="absolute left-0 right-0 bottom-0 px-3 pb-3 pt-10"
                             style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)" }}>
                            {title && (
                                <p className="text-white font-bold break-words m-0"
                                   style={{ fontSize: "18px", lineHeight: "24px" }}>{title}</p>
                            )}
                            {photo.location && (
                                <p className="text-white/80 break-words m-0 mt-0.5"
                                   style={{ fontSize: "13px", lineHeight: "18px" }}>{photo.location}</p>
                            )}
                        </div>
                    )}
                </div>
            </Link>

            {/* 投稿者の行 */}
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                {/* **名前の箱は縮んでよい。** `ProfileLink` の中の `break-words` は
                    フレックス行の子としての最小幅（＝空白の無い名前1語の幅）を縮めない
                    ので、100文字の名前で右のものがカードの外へ押し出される（レビューが
                    Chromium 320px で実測）。箱に `min-w-0` ＋中の名前を
                    `overflow-wrap: anywhere` で折る */}
                <div className="min-w-0 overflow-hidden [&_span]:wrap-anywhere">
                    {photo.userId ? (
                        <ProfileLink userId={photo.userId} displayName={photo.displayName || "旅人"} size="sm" />
                    ) : (
                        <span className="text-xs sm:text-sm text-white/60">{photo.displayName || "旅人"}</span>
                    )}
                    {posted && (
                        <time className="block text-white/50" style={{ fontSize: "11px", lineHeight: "14px" }}
                              dateTime={photo.createdAt}>{posted}</time>
                    )}
                </div>
                {showFollow && (
                    <div className="flex-shrink-0">
                        <FollowAction
                            targetUserId={photo.userId!}
                            isOwner={false}
                            isAuthenticated={isAuthenticated}
                            locale={isJa ? "ja" : "en"}
                        />
                    </div>
                )}
            </div>

            {/* 説明 */}
            {paragraphs.length > 0 && (
                <div className="px-3 pb-2 text-white/80 break-words" style={{ fontSize: "14px", lineHeight: "20px" }}>
                    {paragraphs.map((line, i) => <p key={i} className="m-0">{line}</p>)}
                </div>
            )}

            {/* タグ。**集約ページへの内部リンク**（回遊と SEO）。
                先読みしない（静的書き出し＋`no-store` 配信なので、画面に入るたび
                行き先を丸ごと落とし直す。`d8884430`） */}
            {tags.length > 0 && (
                <div className="px-3 pb-2 flex flex-wrap gap-x-2 gap-y-1">
                    {tags.map((t) => (
                        <Link
                            key={t}
                            href={collectionPath("tag", slugify(t, "tag"))}
                            prefetch={false}
                            className="inline-flex items-center rounded-full bg-chip text-chip-text hover:bg-surface-2 hover:text-white transition-colors"
                            style={{ fontSize: "12px", lineHeight: "16px", padding: "3px 9px", touchAction: "manipulation" }}
                        >
                            #{t.replace(/^#/, "")}
                        </Link>
                    ))}
                </div>
            )}

            {/* いいね・コメントの数。**押すと写真ページが開く**（そこで押せる）。
                ここで押せるようにすると写真ごとにサーバーへ引きに行くことになり、
                一覧を開くだけで N 往復になる */}
            <div className="flex items-center gap-4 px-3 pb-3">
                <Link
                    href={ROUTES.PHOTO(photo.id)}
                    prefetch={false}
                    className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors"
                    style={{ touchAction: "manipulation" }}
                    aria-label={isJa ? `いいね ${photo.likes ?? 0}件。写真を開く` : `${photo.likes ?? 0} likes. Open photo`}
                >
                    <HeartIcon aria-hidden="true" style={{ width: "20px", height: "20px" }} />
                    <span style={{ fontSize: "13px", lineHeight: "18px" }}>{(photo.likes ?? 0).toLocaleString()}</span>
                </Link>
                <Link
                    href={ROUTES.PHOTO(photo.id)}
                    prefetch={false}
                    className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors"
                    style={{ touchAction: "manipulation" }}
                    aria-label={isJa ? `コメント ${photo.commentCount ?? 0}件。写真を開く` : `${photo.commentCount ?? 0} comments. Open photo`}
                >
                    <ChatBubbleOvalLeftIcon aria-hidden="true" style={{ width: "20px", height: "20px" }} />
                    <span style={{ fontSize: "13px", lineHeight: "18px" }}>{(photo.commentCount ?? 0).toLocaleString()}</span>
                </Link>
            </div>
        </article>
    );
}
