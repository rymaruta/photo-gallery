"use client";

import React from "react";
import Link from "next/link";
import { BookmarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { useSavedSpots } from "../../lib/hooks/useSavedSpots";
import { useLocale } from "../i18n/context";
import { ROUTES, loginWithNext } from "../../lib/routes";
import { collectEntries, collectionPath } from "../../lib/utils/collections";

/**
 * 行きたい場所（保存した撮影スポット）の一覧。
 *
 * ## 写真の「保存」とは別のページ
 *
 * `/favorites` は**いいねした写真**。こちらは**行きたい場所**で、
 * 中身も入れ物（`spots#<uid>`）も別。
 *
 * ## 端末の控えと和を取らない
 *
 * `/favorites` はサーバーと `localStorage` の**和**を出す（未ログインでも
 * 押せるいいねを拾うため）。こちらは和を取らない——行きたい場所は
 * **サーバーの一覧が唯一の状態**で、端末に控えを持つと「サーバーから
 * 消えたのに端末には残る」が直らない（いいねはマーカーで直せる）。
 *
 * ## 「まだ」「聞けなかった」「0件」を混ぜない
 *
 * 混ぜると、通信に失敗しただけの人に「保存した場所はまだありません」と
 * 言い切ることになる（この台帳が何度も踏んでいる形）。
 */
export default function SavedSpotsPage() {
    const { locale } = useLocale();
    const en = locale === "en";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { photos, loaded } = usePhotos();
    const { slugs, pending, failed, retry, toggle, busy } = useSavedSpots(isAuthenticated, authLoading);

    /**
     * 保存したスラッグ → 見出しと枚数。
     *
     * **見出しも枚数も集約ページの関数から引く**（`collectEntries`）。
     * サーバーはスラッグしか返さない（`likes.getMyLikes` が「写真の中身は
     * 返さない」としているのと同じ）ので、名前をここで別に作ると
     * **飛んだ先の見出しと食い違う**——チップと飛び先の字が違う、という
     * 形は `pickRepresentative` のコメントが名指しで避けている。
     */
    const entries = React.useMemo(() => {
        const bySlug = new Map(collectEntries(photos, "location").map((e) => [e.slug, e]));
        // **保存した順（新しい順）を保つ。** 枚数順に並べ替えない
        return slugs.map((slug) => ({ slug, entry: bySlug.get(slug) }));
    }, [photos, slugs]);

    if (!authLoading && !isAuthenticated) {
        return (
            <Shell locale={locale}>
                <Empty
                    text={en ? "Sign in to keep spots you want to visit." : "行きたい場所を残すにはログインしてください。"}
                    action={
                        <Link
                            href={loginWithNext(ROUTES.SAVED_SPOTS)}
                            prefetch={false}
                            className="text-sky-300 hover:text-sky-200 underline underline-offset-4"
                        >
                            {en ? "Sign in" : "ログイン"}
                        </Link>
                    }
                />
            </Shell>
        );
    }

    return (
        // **数を出すのは、聞けたときだけ。** 失敗した回に `slugs.length` を
        // 出すと「保存した場所 0 件」と言い切ることになる（このファイルの
        // docstring が「混ぜない」と書いている当の形）
        <Shell locale={locale} count={pending || failed ? null : slugs.length}>
            {/* 取りに行って失敗した回は、黙って短い一覧を出さない
                （`/favorites` が同じ場面で同じ断りを出している） */}
            {failed && (
                <p role="alert" className="mb-4 text-sm text-amber-300/90">
                    {en
                        ? "Couldn't load your saved spots. "
                        : "保存した場所を読み込めませんでした。"}
                    <button onClick={retry} className="underline text-white/80 hover:text-white">
                        {en ? "Retry" : "再試行"}
                    </button>
                </p>
            )}

            {pending ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex items-center justify-center" aria-busy>
                    <p className="text-white/60 text-sm">{en ? "Loading…" : "読み込み中…"}</p>
                </div>
            ) : failed ? (
                // **失敗した回に「まだありません」と言わない。** 上の
                // `role="alert"` が事情と再試行を出しているので、ここは黙る
                // （0件の案内を重ねると「無い」と読める）
                null
            ) : entries.length === 0 ? (
                <Empty
                    text={en ? "No saved spots yet." : "行きたい場所はまだありません。"}
                    action={
                        <span className="text-white/60 text-xs">
                            {en
                                ? "Open a spot page and tap “Save to want-to-go”."
                                : "撮影地のページで「行きたい」を押すと、ここに集まります。"}
                        </span>
                    }
                />
            ) : (
                <ul className="flex flex-col gap-2">
                    {entries.map(({ slug, entry }) => (
                        <li
                            key={slug}
                            className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-3"
                        >
                            <Link
                                href={collectionPath("location", slug)}
                                prefetch={false}
                                className="flex-1 min-w-0 hover:text-white"
                                style={{ touchAction: "manipulation", minHeight: 44, display: "flex", alignItems: "center" }}
                            >
                                <span className="truncate text-sm font-semibold">
                                    {/* **見出しが引けないときはスラッグを出す。**
                                        「不明な場所」のような、こちらで作った
                                        言葉を置かない。引けないのは、その撮影地の
                                        写真が非公開になった／まだ届いていない
                                        （`loaded` が false）とき */}
                                    {entry?.label ?? decodeSlug(slug)}
                                </span>
                                {entry && (
                                    <span className="ml-2 shrink-0 text-xs text-white/60 tabular-nums">
                                        {entry.count}{en ? "" : "枚"}
                                    </span>
                                )}
                                {/* 一覧がまだ届いていない間は「0枚」と言い切らない */}
                                {!entry && !loaded && (
                                    <span className="ml-2 shrink-0 text-xs text-white/60">…</span>
                                )}
                            </Link>
                            <button
                                type="button"
                                onClick={() => void toggle(slug)}
                                disabled={busy === slug}
                                aria-label={en ? `Remove ${entry?.label ?? slug}` : `「${entry?.label ?? slug}」を外す`}
                                className="shrink-0 rounded-full px-3 py-1.5 text-xs bg-white/5 ring-1 ring-white/15 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-60 transition"
                                style={{ touchAction: "manipulation", minHeight: 44 }}
                            >
                                {en ? "Remove" : "外す"}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Shell>
    );
}

/** 表示用にデコードする（不正な % は素のまま出す。ここで落とさない） */
function decodeSlug(slug: string): string {
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}

function Shell({ locale, count, children }: { locale: "ja" | "en"; count?: number | null; children: React.ReactNode }) {
    const en = locale === "en";
    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full pb-28">
            <div className="mb-4 sm:mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">{en ? "Want to go" : "行きたい場所"}</h1>
                <p className="text-sm text-white/60 mt-1">
                    {/* **「まだ」と「0件」を混ぜない**（`/favorites` と同じ判断） */}
                    {count === null || count === undefined
                        ? (en ? "Spots you saved." : "保存した撮影スポット。")
                        : en
                            ? `${count} spot${count !== 1 ? "s" : ""}`
                            : `保存した場所 ${count} 件`}
                </p>
            </div>
            {children}
        </main>
    );
}

function Empty({ text, action }: { text: string; action: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <BookmarkIcon className="w-8 h-8 text-white/60" />
            </div>
            <p className="text-white/70 text-sm">{text}</p>
            {action}
        </div>
    );
}
