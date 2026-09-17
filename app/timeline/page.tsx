"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { fetchFollowingSet, subscribeFollowingSet } from "../../lib/hooks/useFollow";
import { timelinePhotos } from "../../lib/utils/timeline";
import { ROUTES, loginWithNext } from "../../lib/routes";
import TimelineCard from "../components/TimelineCard";

/** 最初の画面に入る枚数ぶんだけ優先で読む（1列なので2枚で足りる） */
const PRIORITY_COUNT = 2;

/**
 * フォローしている人の写真が**投稿の新しい順に流れる**面（Instagram の
 * ホームに当たる）。
 *
 * トップの一覧は「みんなの写真」で、誰が上げたかが見えない。ここは
 * 1列のカードに投稿者と日付を付けて出す。中身の決め方は `lib/utils/timeline.ts`。
 *
 * **会員ページだが `useMemberGate` は使わない。** あれは「投稿できる人」の門で、
 * フォローは投稿権限（グループ）が無くてもできる。未ログインは送り返さず、
 * ログインへの導線を出す（メニューにはログイン中しか出ないので、ここに
 * 着くのは直接 URL を開いた人だけ）。
 */
export default function TimelinePage() {
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { locale } = useLocale();
    const { photos, loaded: photosLoaded, failed: photosFailed } = usePhotos();

    // `null` ＝ まだ分からない。**「0人」と混ぜない**（トップの
    // フォロー中フィードが踏んだ穴。取得中に「まだ誰もフォローしていません」
    // を出すと、フォローが効いていないように見える）
    const [following, setFollowing] = React.useState<Set<string> | null>(null);
    const [followingError, setFollowingError] = React.useState(false);
    const [reloadKey, setReloadKey] = React.useState(0);

    React.useEffect(() => {
        if (authLoading || !isAuthenticated) return;
        let aborted = false;
        setFollowingError(false);
        setFollowing(null);
        fetchFollowingSet()
            .then((set) => { if (!aborted) setFollowing(new Set(set)); })
            .catch(() => { if (!aborted) setFollowingError(true); });
        return () => { aborted = true; };
    }, [authLoading, isAuthenticated, reloadKey]);

    // フォロー・解除・ブロックで共有の一覧が変わったら取り直す
    // （結果をコピーして持つので、購読しないと伝わらない——トップと同じ判断）
    React.useEffect(() => subscribeFollowingSet(() => setReloadKey((k) => k + 1)), []);

    const items = React.useMemo(
        () => (following ? timelinePhotos(photos, following) : []),
        [photos, following],
    );

    const isJa = locale !== "en";
    const heading = isJa ? "タイムライン" : "Timeline";
    const sub = isJa ? "フォローしている人の写真が、新しい順に流れます。" : "Photos from people you follow, newest first.";

    let body: React.ReactNode;
    if (authLoading) {
        body = <Status text={isJa ? "読み込み中…" : "Loading…"} />;
    } else if (!isAuthenticated) {
        body = (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "ログインすると、フォローしている人の写真がここに流れます。" : "Log in to see photos from people you follow."}
                </p>
                <Link href={loginWithNext(ROUTES.TIMELINE)} prefetch={false} className={pillClass}>
                    {isJa ? "ログイン" : "Log in"}
                </Link>
            </Empty>
        );
    } else if (followingError) {
        body = (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "フォロー中の一覧を読み込めませんでした。" : "Couldn't load who you follow."}
                </p>
                <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={pillClass} style={{ touchAction: "manipulation" }}>
                    {isJa ? "もう一度読み込む" : "Retry"}
                </button>
            </Empty>
        );
    } else if (following === null) {
        body = <Status text={isJa ? "読み込み中…" : "Loading…"} />;
    } else if (following.size === 0) {
        body = (
            <Empty>
                <p className="text-sm text-white/70 m-0">
                    {isJa ? "まだ誰もフォローしていません。" : "You aren't following anyone yet."}
                </p>
                <Link href={ROUTES.USER_SEARCH} prefetch={false} className={pillClass}>
                    {isJa ? "ユーザーを探す" : "Find people"}
                </Link>
            </Empty>
        );
    } else if (items.length === 0) {
        // 一覧が届く前は「まだ投稿していません」と言い切らない
        // （`photos` の初期値はビルド時のスナップショット＝週1で古い）
        body = !photosLoaded && !photosFailed
            ? <Status text={isJa ? "読み込み中…" : "Loading…"} />
            : (
                <Empty>
                    <p className="text-sm text-white/70 m-0">
                        {photosFailed
                            ? (isJa ? "写真の一覧を読み込めませんでした。" : "Couldn't load photos.")
                            : (isJa ? "フォロー中の人は、まだ写真を投稿していません。" : "The people you follow haven't posted yet.")}
                    </p>
                </Empty>
            );
    } else {
        body = (
            <ol className="flex flex-col gap-4 sm:gap-6 m-0 p-0" style={{ listStyle: "none" }}>
                {items.map((p, i) => (
                    <li key={p.id} className="m-0 p-0">
                        <TimelineCard photo={p} locale={locale} priority={i < PRIORITY_COUNT} />
                    </li>
                ))}
            </ol>
        );
    }

    return (
        <main className="p-4 sm:p-6 min-h-screen text-white bg-black max-w-xl mx-auto w-full">
            <div className="mb-4 sm:mb-6">
                <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">{heading}</h1>
                <p className="text-sm text-white/60 mt-1">{sub}</p>
            </div>
            {body}
        </main>
    );
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
