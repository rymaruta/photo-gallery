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
                    // 「公式」と名乗るのは人が確かめた行だけ。下書きは「下書き」
                    stage: sp?.stage ?? null,
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
                stage: null,
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
                <ul className="flex flex-col gap-2">
                    {entries.map(({ key, kind, label, href, note, stage }) => (
                        <li
                            key={key}
                            className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-3"
                        >
                            {/* **見出しが引けないときはスラッグを出す。**
                                「不明な場所」のような、こちらで作った言葉を
                                置かない。引けないのは、その撮影地の写真が
                                非公開になった／まだ届いていない（`loaded` が
                                false）／台帳からそのスポットが下りたとき */}
                            <Row href={href} label={label} note={note}
                                 badge={kind !== "spot" || stage === null ? null
                                     : stage === "published" ? (en ? "Official" : "公式")
                                         : (en ? "Draft" : "下書き")} />
                            <button
                                type="button"
                                onClick={() => void toggle(key)}
                                // **1件でも書き込み中なら、全部押させない。**
                                // `busy === slug` だけを見ていたので、行Aの
                                // 処理中に行Bを押すと `toggle` が `false` を
                                // 返して**何も起きない**（押せるのに無反応）
                                disabled={busy !== null}
                                aria-label={en ? `Remove ${label}` : `「${label}」を外す`}
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

/**
 * 一覧の1行の中身。**リンクが無いときは素の行にする**
 * （台帳から下りたスポットへ送っても 404 になるだけ）。
 */
function Row({ href, label, note, badge }: { href: string | null; label: string; note: string; badge: string | null }) {
    /**
     * 🔴 **公式スポットの地域名は、名前と同じ行に置かない。**
     *
     * 一度は撮影地の「3枚」と同じ枠（`shrink-0`）に入れていたが、
     * 地域名は自由長なので**縮む側が名前だけ**になる。320px で実測:
     *
     *     「高屋神社（天空の鳥居）」  名前の枠 85px（切れる）／地域 76px
     *     「国営ひたち海浜公園」      名前の枠 63px（切れる）／地域 99px
     *
     * 名前が読めないと、どのスポットか分からない。**地域は次の行へ。**
     * 撮影地の「3枚」は短く長さも決まっているので、今までどおり同じ行。
     */
    const stacked = badge !== null;
    const inner = (
        <span className="min-w-0 flex-1 flex flex-col justify-center">
            <span className="flex items-center min-w-0">
                <span className="truncate text-sm font-semibold">{label}</span>
                {badge && (
                    <span className="ml-2 shrink-0 rounded-full bg-chip text-chip-text ring-1 ring-line" style={{ fontSize: "10px", padding: "2px 8px" }}>
                        {badge}
                    </span>
                )}
                {note && !stacked && (
                    <span className="ml-2 shrink-0 text-xs text-white/60 tabular-nums">{note}</span>
                )}
            </span>
            {note && stacked && (
                <span className="truncate text-xs text-white/60" style={{ marginTop: "2px" }}>{note}</span>
            )}
        </span>
    );
    const style = { touchAction: "manipulation", minHeight: 44, display: "flex", alignItems: "center" } as const;
    if (!href) return <div className="flex-1 min-w-0" style={style}>{inner}</div>;
    return (
        <Link href={href} prefetch={false} className="flex-1 min-w-0 hover:text-white" style={style}>
            {inner}
        </Link>
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
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full pb-28">
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
