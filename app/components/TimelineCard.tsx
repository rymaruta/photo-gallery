"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { HeartIcon, ChatBubbleOvalLeftIcon, PaperAirplaneIcon, BookmarkIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolidIcon } from "@heroicons/react/24/solid";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import { ROUTES } from "@/lib/routes";
import { slugify, tagKey, collectionPath } from "@/lib/utils/collections";
import { photoAltText } from "@/lib/utils/photoAlt";
import { shareUrl } from "@/lib/utils/share";
import { timeAgo } from "@/lib/stories";
import { usePhotoSave } from "@/lib/hooks/usePhotoSave";
import { useToast } from "@/lib/hooks/useToast";
import Thumb from "./Thumb";
import UserAvatar from "./UserAvatar";
import { FEED_SIZES_XL } from "./gridSizes";

type Props = {
    photo: Photo;
    locale: Locale;
    /** 最初の画面に入る数枚だけ true（`fetchPriority="high"`） */
    priority?: boolean;
    /** ログイン中か。保存の操作の可否に使う */
    isAuthenticated?: boolean;
    /** ログインの確認中か（その間は保存を押せない） */
    authLoading?: boolean;
    /**
     * 自分が保存した写真の id（`useMySaves`）。**一覧ぶんを1回で引いた結果**を
     * 渡す。渡さないと `usePhotoSave` が写真ごとにサーバーへ聞きに行き、
     * 一覧を開くだけで N 往復になる（いいねを「数と行き先だけ」にしたのと
     * 同じ理由）。`null` は「まだ分からない／取れなかった」
     */
    savedIds?: ReadonlySet<string> | null;
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
 * ホームの1枚（最終版モックのカード・2026-09-21・owner「全く同じにしたい」）。
 *
 * **並びはモックのまま**: 投稿者の行（アバター・名前・撮影地／右に投稿時間）
 * → 角丸の写真 → 題と本文 → ハッシュタグのチップ → いいね・コメント・シェア・
 * 右端に保存。以前は「写真が先で題を重ねる」形だったが、モックは投稿者が先。
 *
 * **フォローのボタンはカードに置かない**（モックに無い。フォローは
 * プロフィールと写真ページの持ち場）。
 *
 * 画像は一覧と同じ `Thumb`（512px の派生まで）。写真ページの主役（≤1600）を
 * 流し読みの面で1枚ずつ落とすのは重すぎる。押せば写真ページで原寸に近い方が出る。
 *
 * **いいね・コメントは「数」と「行き先」だけ。** `usePhotoLikes` は写真ごとに
 * サーバーへ引きに行くので、カードに載せると**一覧を開くだけで N 往復**になる
 * （CLAUDE.md の優先度「表示速度」と逆）。押すと写真ページが開き、そこで押せる。
 * **保存は押せる**——一覧ぶんの id を `savedIds` で1回で受け取るので往復が
 * 増えない（`usePhotoSave` の `known`）。
 */
export default function TimelineCard({
    photo, locale, priority = false, isAuthenticated = false, authLoading = false, savedIds = null,
}: Props) {
    const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const alt = photoAltText(photo, locale);
    const isJa = locale !== "en";
    const { showToast } = useToast();
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

    // 保存。一覧から分かっていれば（`savedIds`）写真ごとに聞きに行かない
    const known = savedIds ? savedIds.has(photo.id) : undefined;
    const { saved, pending: savePending, toggle: toggleSave } = usePhotoSave(photo.id, isAuthenticated, authLoading, known);
    const handleSave = React.useCallback(() => {
        void toggleSave().then((r) => {
            if (r.ok) return;
            // **未ログインは「失敗」ではなく案内**（モーダルと同じ文言）
            if (r.requiresAuth) {
                showToast(isJa ? "写真を保存するにはログインしてください" : "Log in to save photos.", "error");
                return;
            }
            showToast(r.message ?? (isJa ? "保存できませんでした。もう一度お試しください" : "Couldn't save this photo. Please try again."), "error");
        });
    }, [toggleSave, showToast, isJa]);

    // シェア。行き先は写真ページ（写真ページ・モーダルと同じ判断: `?photo=` ではなく `/photo/<id>`）
    const handleShare = React.useCallback(() => {
        const url = new URL(ROUTES.PHOTO(photo.id), window.location.origin).href;
        void shareUrl(url, title || undefined, paragraphs.join(" ")).then((result) => {
            // cancelled（利用者が閉じた）と shared は何も出さない
            if (result === "copied") showToast(isJa ? "リンクをクリップボードにコピーしました" : "Link copied to clipboard!", "success");
            else if (result === "failed") showToast(isJa ? "共有できませんでした" : "Could not share", "error");
        });
    }, [photo.id, title, paragraphs, showToast, isJa]);

    const displayName = photo.displayName || (isJa ? "旅人" : "Traveler");
    const actionText = { fontSize: "13px", lineHeight: "18px" } as const;
    const iconSize = { width: "22px", height: "22px" } as const;

    return (
        <article className="rounded-2xl bg-surface ring-1 ring-line overflow-hidden">
            {/* 投稿者の行: アバター・名前・撮影地／右に投稿時間 */}
            <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
                {photo.userId ? (
                    <Link href={ROUTES.USER_PROFILE(photo.userId)} prefetch={false}
                          className="flex-shrink-0 rounded-full"
                          aria-label={isJa ? `${displayName} のプロフィール` : `${displayName}'s profile`}
                          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}>
                        <UserAvatar userId={photo.userId} className="w-9 h-9" iconClassName="w-5 h-5" />
                    </Link>
                ) : (
                    <span aria-hidden="true" className="w-9 h-9 rounded-full bg-white/10 flex-shrink-0" />
                )}
                {/* **名前の箱は縮んでよい。** `min-w-0` が無いと、空白の無い100文字の
                    名前で右の時刻がカードの外へ押し出される（レビューが Chromium
                    320px で実測した形）。中の名前は `overflow-wrap: anywhere` で折る */}
                <div className="min-w-0 flex-1">
                    {photo.userId ? (
                        <Link href={ROUTES.USER_PROFILE(photo.userId)} prefetch={false}
                              className="block text-white font-semibold wrap-anywhere hover:text-white/80 transition-colors"
                              style={{ fontSize: "15px", lineHeight: "20px", touchAction: "manipulation" }}>
                            {displayName}
                        </Link>
                    ) : (
                        <span className="block text-white font-semibold wrap-anywhere" style={{ fontSize: "15px", lineHeight: "20px" }}>{displayName}</span>
                    )}
                    {photo.location && (
                        <p className="m-0 flex items-center gap-1 text-white/60 min-w-0" style={{ fontSize: "12px", lineHeight: "16px" }}>
                            <MapPinIcon aria-hidden="true" className="flex-shrink-0" style={{ width: "13px", height: "13px" }} />
                            <span className="truncate">{photo.location}</span>
                        </p>
                    )}
                </div>
                {posted && (
                    <time className="flex-shrink-0 text-white/50" style={{ fontSize: "12px", lineHeight: "16px" }}
                          dateTime={photo.createdAt}>{posted}</time>
                )}
            </div>

            {/* 写真。角丸で左右に少し余白（モックの形）。押すと写真ページ */}
            <Link
                href={ROUTES.PHOTO(photo.id)}
                prefetch={false}
                className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={title ? (isJa ? `${title} を開く` : `Open ${title}`) : (isJa ? "写真を開く" : "Open photo")}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                data-photo-id={photo.id}
            >
                <div
                    className="relative mx-2 rounded-xl overflow-hidden"
                    style={{ paddingTop: `${ratio}%`, backgroundColor: photo.dominantColor ?? "#0d1a26", fontSize: 0, lineHeight: 0 }}
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
                </div>
            </Link>

            {/* 題と本文。**題は焼いたまま**（検索に効く文字。写真の上に重ねるのをやめても消さない） */}
            {(title || paragraphs.length > 0) && (
                <div className="px-3 pt-2.5 break-words">
                    {title && (
                        <p className="m-0 text-white font-semibold" style={{ fontSize: "15px", lineHeight: "22px" }}>{title}</p>
                    )}
                    {paragraphs.length > 0 && (
                        <div className="text-white/85" style={{ fontSize: "14px", lineHeight: "21px" }}>
                            {paragraphs.map((line, i) => <p key={i} className="m-0">{line}</p>)}
                        </div>
                    )}
                </div>
            )}

            {/* タグ。**集約ページへの内部リンク**（回遊と SEO）。
                先読みしない（静的書き出し＋`no-store` 配信なので、画面に入るたび
                行き先を丸ごと落とし直す。`d8884430`） */}
            {tags.length > 0 && (
                <div className="px-3 pt-2 flex flex-wrap gap-1.5">
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

            {/* いいね・コメントの数（押すと写真ページが開く）・シェア・右端に保存 */}
            <div className="flex items-center gap-5 px-3 pt-2.5 pb-3">
                <Link
                    href={ROUTES.PHOTO(photo.id)}
                    prefetch={false}
                    className="flex items-center gap-1.5 text-white/85 hover:text-white transition-colors"
                    style={{ touchAction: "manipulation" }}
                    aria-label={isJa ? `いいね ${photo.likes ?? 0}件。写真を開く` : `${photo.likes ?? 0} likes. Open photo`}
                >
                    <HeartIcon aria-hidden="true" style={iconSize} />
                    <span style={actionText}>{(photo.likes ?? 0).toLocaleString()}</span>
                </Link>
                <Link
                    href={ROUTES.PHOTO(photo.id)}
                    prefetch={false}
                    className="flex items-center gap-1.5 text-white/85 hover:text-white transition-colors"
                    style={{ touchAction: "manipulation" }}
                    aria-label={isJa ? `コメント ${photo.commentCount ?? 0}件。写真を開く` : `${photo.commentCount ?? 0} comments. Open photo`}
                >
                    <ChatBubbleOvalLeftIcon aria-hidden="true" style={iconSize} />
                    <span style={actionText}>{(photo.commentCount ?? 0).toLocaleString()}</span>
                </Link>
                <button
                    type="button"
                    onClick={handleShare}
                    className="flex items-center gap-1.5 text-white/85 hover:text-white transition-colors"
                    style={{ touchAction: "manipulation" }}
                    aria-label={isJa ? "シェア" : "Share"}
                >
                    <PaperAirplaneIcon aria-hidden="true" style={{ ...iconSize, transform: "rotate(-30deg)" }} />
                    <span style={actionText}>{isJa ? "シェア" : "Share"}</span>
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    aria-pressed={saved}
                    aria-disabled={savePending || undefined}
                    className={`ml-auto flex items-center transition-colors ${saved ? "text-accent" : "text-white/85 hover:text-white"}`}
                    style={{ touchAction: "manipulation" }}
                    aria-label={saved ? (isJa ? "保存を取り消す" : "Remove from saved") : (isJa ? "保存" : "Save")}
                >
                    {saved ? <BookmarkSolidIcon aria-hidden="true" style={iconSize} /> : <BookmarkIcon aria-hidden="true" style={iconSize} />}
                </button>
            </div>
        </article>
    );
}
