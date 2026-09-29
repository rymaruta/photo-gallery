"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../auth/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { fetchFollowingSet, subscribeFollowingSet } from "../../lib/hooks/useFollow";
import { timelinePhotos } from "../../lib/utils/timeline";
import { ROUTES, loginWithNext } from "../../lib/routes";
import HomeMosaic from "./HomeMosaic";

type Props = { locale: string };

/**
 * フォローしている人の写真が**投稿の新しい順に流れる**面（Instagram のホームに
 * 当たる）。トップの「フォロー中」タブが描く。
 *
 * **並べ方は新着・おすすめと同じ `HomeMosaic`**（iOS の `GalleryView` が3つのタブを
 * 同じ並びで描くのに揃えた・2026-09-29）。撮った人の名前は撮影地と一緒に写真に重ねる。
 * **撮影地の無い写真は名前も重ねない**（iOS と同じ）ので、そのときは読み上げと写真ページで分かる。
 * 以前は縦1列の札（投稿者の行・題・説明・タグ・保存など4つの操作）だった
 *
 * owner:「この画面（トップ）は、タブで切り替えて、自分の写真かフォロー中の人の
 * 写真みれるようにしたい」。以前は別ページ `/timeline` → マイページのタブと
 * 置き場所を2回読み違えた。中身の決め方は `lib/utils/timeline.ts`。
 *
 * **投稿権限（グループ）は要らない**——フォローはグループが無くてもできる。
 * 未ログインで描かれることは無いはずだが、その場合はログインへの導線を出す。
 */
export default function TimelineFeed({ locale }: Props) {
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { photos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
    // `null` ＝ まだ分からない。**「0人」と混ぜない**（取得中に「まだ誰も
    // フォローしていません」を出すと、フォローが効いていないように見える）
    const [following, setFollowing] = React.useState<Set<string> | null>(null);
    const [followingError, setFollowingError] = React.useState(false);
    const [reloadKey, setReloadKey] = React.useState(0);

    React.useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) {
            // ログアウトしたら前の人の集合を持ち越さない
            setFollowing(null);
            setFollowingError(false);
            return;
        }
        let aborted = false;
        setFollowingError(false);
        setFollowing(null);
        fetchFollowingSet()
            .then((set) => { if (!aborted) setFollowing(new Set(set)); })
            .catch(() => { if (!aborted) setFollowingError(true); });
        return () => { aborted = true; };
    }, [authLoading, isAuthenticated, reloadKey]);

    // フォロー・解除・ブロックで共有の一覧が変わったら取り直す
    // （結果をコピーして持つので、購読しないと伝わらない）
    React.useEffect(() => subscribeFollowingSet(() => setReloadKey((k) => k + 1)), []);

    const items = React.useMemo(
        () => (following ? timelinePhotos(photos, following) : []),
        [photos, following],
    );

    const isJa = locale !== "en";

    if (authLoading) return <Status text={isJa ? "読み込み中…" : "Loading…"} />;
    if (!isAuthenticated) {
        return (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "ログインすると、フォローしている人の写真がここに流れます。" : "Log in to see photos from people you follow."}
                </p>
                <Link href={loginWithNext(typeof window === "undefined" ? null : window.location.pathname)} prefetch={false} className={pillClass}>
                    {isJa ? "ログイン" : "Log in"}
                </Link>
            </Empty>
        );
    }
    if (followingError) {
        return (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "フォロー中の一覧を読み込めませんでした。" : "Couldn't load who you follow."}
                </p>
                <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={pillClass} style={{ touchAction: "manipulation" }}>
                    {isJa ? "もう一度読み込む" : "Retry"}
                </button>
            </Empty>
        );
    }
    if (following === null) return <Status text={isJa ? "読み込み中…" : "Loading…"} />;
    if (following.size === 0) {
        return (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "まだ誰もフォローしていません。" : "You aren't following anyone yet."}
                </p>
                <Link href={ROUTES.USER_SEARCH} prefetch={false} className={pillClass}>
                    {isJa ? "ユーザーを探す" : "Find people"}
                </Link>
            </Empty>
        );
    }
    if (items.length === 0) {
        // 一覧が届く前は「まだ投稿していません」と言い切らない
        // （`photos` の初期値はビルド時のスナップショット＝週1で古い）
        if (!photosLoaded && !photosFailed) return <Status text={isJa ? "読み込み中…" : "Loading…"} />;
        return (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {photosFailed
                        ? (isJa ? "写真の一覧を読み込めませんでした。" : "Couldn't load photos.")
                        : (isJa ? "フォロー中の人は、まだ写真を投稿していません。" : "The people you follow haven't posted yet.")}
                </p>
            </Empty>
        );
    }
    return <HomeMosaic photos={items} locale={isJa ? "ja" : "en"} />;
}

const pillClass = "px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors";

function Status({ text }: { text: string }) {
    return (
        <div className="py-16 text-center text-sm text-white/50" role="status" aria-live="polite">{text}</div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 px-4 flex flex-col items-center justify-center gap-3 text-center">
            {children}
        </div>
    );
}
