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
import type { SpotLink } from "../../lib/data/spotLink";
import { parseSavedKey, dedupeSavedKeys } from "../../lib/utils/savedSpotKey";

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
 *
 * ## 2種類が同じ一覧に並ぶ
 *
 *  - **公式撮影地ガイド**（`/spots/<slug>`）… 鍵に頭が付く（`SPOT-`）。
 *    見出しは**台帳**（`content/spots.json`）から引く
 *  - **撮影地の集約ページ**（`/location/<スラッグ>`）… これまでの形。
 *    見出しは**写真から**引く（`collectEntries`）
 *
 * 見分けは `lib/utils/savedSpotKey.ts` の1か所だけ。**綴りで判定しない。**
 * 台帳から消えた／下書きに戻ったスポットは、**行ごと消さずにリンクを外す**
 * ——押しても 404 のページへ送らず、それでも「外す」は押せる
 * （消すと、本人が外す手段を失う）。
 *
 * ## 🔴 台帳はここから読まない
 *
 * `content/spots.json` は人が書く棚で、1件ごとに概要・見どころ・季節・
 * アクセス・出典まで持つ。`"use client"` のここから `SPOTS` を読むと
 * **その全文がこのページのチャンクに載る**（台帳に1件入れてビルドして実測）。
 * **受け取るのは解いたあとの `SpotLink` だけ**——解くのは `page.tsx`。
 */
export default function SavedSpotsClient({ spots }: { spots: Record<string, SpotLink> }) {
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
        return dedupeSavedKeys(slugs).map((key) => {
            const parsed = parseSavedKey(key);
            if (parsed.kind === "spot") {
                // 台帳に無い＝公開条件を満たさない／下書きに戻った
                // ＝そのページは作られていない（＝リンク先が無い）
                const sp = spots[parsed.slug];
                return {
                    key,
                    kind: "spot" as const,
                    // **名前が作れないときは鍵そのものを出す。** スラッグの無い
                    // 壊れた鍵（`SPOT-`）でも行が消えないようにする——消すと
                    // サーバーには残ったまま、本人が外す手段を失う
                    label: sp?.name || decodeSlug(parsed.slug) || key,
                    href: sp ? `${ROUTES.SPOTS}/${parsed.slug}` : null,
                    note: sp ? sp.region : "",
                    cover: sp?.cover ?? null,
                };
            }
            const entry = bySlug.get(parsed.slug);
            return {
                key,
                kind: "location" as const,
                label: entry?.label ?? decodeSlug(parsed.slug),
                href: collectionPath("location", parsed.slug),
                // 一覧がまだ届いていない間は「0枚」と言い切らない
                note: entry ? `${entry.count}${en ? "" : "枚"}` : (loaded ? "" : "…"),
                cover: null,
            };
        });
    }, [photos, slugs, en, loaded, spots]);

    if (!authLoading && !isAuthenticated) {
        return (
            <Shell locale={locale}>
                <Empty
                    text={en ? "Sign in to keep spots you want to visit." : "行きたい場所を残すにはログインしてください。"}
                    action={
                        <Link
                            href={loginWithNext(ROUTES.SAVED_SPOTS)}
                            prefetch={false}
                            className="text-link hover:text-white underline underline-offset-4"
                        >
                            {en ? "Sign in" : "ログイン"}
                        </Link>
                    }
                />
            </Shell>
        );
    }

    return (
        // **数を出すのは、聞けたときだけ。** 失敗した回に件数を出すと
        // 「保存した場所 0 件」と言い切ることになる（このファイルの
        // docstring が「混ぜない」と書いている当の形）。
        // **数えるのは描く一覧そのもの**（`entries`）——生の `slugs` で
        // 数えると、畳んだぶん・壊れた値のぶんだけ行数と食い違う
        <Shell locale={locale} count={pending || failed ? null : entries.length}>
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
                <ul className="m-0 grid grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4" style={{ listStyle: "none" }}>
                    {entries.map(({ key, kind, label, href, note, cover }) => (
                        <li key={key} className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
                            {href ? (
                                <Link href={href} prefetch={false}
                                      aria-label={`${label} — ${kind === "spot" ? (en ? "Shooting guide" : "撮影ガイド") : (en ? "Place photos" : "撮影地の写真")}`}
                                      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
                                    <SavedCover cover={cover} label={label} kind={kind} locale={locale} />
                                    <SavedInfo label={label} note={note} kind={kind} locale={locale} />
                                </Link>
                            ) : (
                                <div>
                                    <SavedCover cover={null} label={label} kind={kind} locale={locale} />
                                    <SavedInfo label={label} note={note} kind={kind} locale={locale} unavailable />
                                </div>
                            )}
                            {/* リンクと削除は兄弟要素に分離。クリック領域が重ならない。 */}
                            <div className="flex justify-end border-t border-white/10 px-2 py-1">
                                <button type="button" onClick={() => void toggle(key)}
                                        disabled={busy !== null}
                                        aria-label={en ? `Remove ${label}` : `「${label}」を外す`}
                                        className="rounded-full px-3 text-xs text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        style={{ minHeight: 44, touchAction: "manipulation" }}>
                                    {en ? "Remove" : "外す"}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Shell>
    );
}

/** 保存カード: 写真は検証済みの公式スポット用だけ。旧形式に別の写真を流用しない。 */
function SavedCover({ cover, label, kind, locale }: {
    cover: SpotLink["cover"]; label: string; kind: "spot" | "location"; locale: string;
}) {
    const en = locale === "en";
    return (
        <span className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-surface-2">
            {cover ? (
                <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cover.src} alt={cover.alt} loading="lazy" decoding="async"
                         className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    {cover.credit && (
                        <span className="absolute inset-x-1 bottom-1 rounded bg-black/85 px-1.5 py-1 text-right text-[11px] leading-4 text-white">
                            {cover.credit}
                        </span>
                    )}
                </>
            ) : (
                <span className="flex flex-col items-center gap-2 px-3 text-center">
                    <BookmarkIcon aria-hidden="true" className="h-7 w-7 text-white/60" />
                    <span className="line-clamp-2 font-serif text-sm font-semibold leading-5 text-white/80">{label}</span>
                    <span className="text-[11px] text-white/60">{kind === "spot"
                        ? (en ? "Guide" : "撮影ガイド") : (en ? "Place" : "撮影地")}</span>
                </span>
            )}
        </span>
    );
}

function SavedInfo({ label, note, kind, locale, unavailable = false }: {
    label: string; note: string; kind: "spot" | "location"; locale: string; unavailable?: boolean;
}) {
    const en = locale === "en";
    return (
        <span className="block min-h-[96px] px-3 pb-3 pt-2.5">
            <span className="mb-1 block text-[11px] text-link">{kind === "spot"
                ? (en ? "OFFICIAL GUIDE" : "公式撮影地ガイド")
                : (en ? "PLACE PHOTOS" : "撮影地の写真")}</span>
            <span className="block break-words font-serif text-[15px] font-semibold leading-5 text-white">{label}</span>
            {note && <span className="mt-1 block break-words text-xs leading-4 text-white/65">{note}</span>}
            {unavailable && <span className="mt-1 block text-xs leading-4 text-white/70">{en ? "Guide unavailable" : "現在はページを表示できません"}</span>}
        </span>
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
        <main className="jp-page p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full pb-28">
            <div className="mb-4 sm:mb-6">
                <p className="jp-page__eyebrow mb-1">MY JOURNEY / SAVED</p>
                <h1 className="jp-page__title">{en ? "Want to go" : "行きたい場所"}</h1>
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
