// app/components/SpotTopicPage.tsx（サーバーコンポーネント）
//
// **撮影スポットの切り口の頁**（国・テーマ・季節・海外の国の一覧）の本体（2026-10-11）。
// 中身は `lib/data/spotTopics.ts` がビルド時に組んだ `TopicView`。
//
// 2026-10-11 判断: **クライアント部品にしない。** 絞り込みのような操作は無い（切り口ごとに
// 頁を分けた）ので、水和も JS も要らない。文言は日本語だけ——頁名そのものが日本語の検索語
// （「京都府の寺社の撮影スポット」）で、スポット名・カテゴリも台帳の日本語のまま。
//
// 見た目はデザインの板「黒塗りの真鍮」と `SpotIndexClient` に合わせる: 黒地・h1 は明朝・
// 眉ラベルは真鍮の等幅 11・カードは面（surface）・チップは `CHIP_OFF`・本文系の最小 12。

import React from "react";
import Link from "next/link";
import type { TopicView, TopicCard, TopicLink } from "@/lib/data/spotTopics";
import { topicStructuredData } from "@/lib/data/spotTopics";
import { ROUTES } from "@/lib/routes";
import { CHIP_OFF } from "./chipStyles";

/** JSON-LD を `<script>` に埋める形（`SpotGuidePage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

/** 切り口のチップの並び（`/spots` でも使う） */
export function TopicChips({ links, label }: { links: TopicLink[]; label?: (l: TopicLink) => string }) {
    return (
        <ul className="flex flex-wrap gap-1.5 m-0 p-0" style={{ listStyle: "none" }}>
            {links.map((l) => (
                <li key={l.href}>
                    <Link href={l.href} prefetch={false}
                          className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                          style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                        {label ? label(l) : l.label}
                        <span className="text-white/60" style={{ fontSize: "12px" }}>{l.count}</span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function Card({ c }: { c: TopicCard }) {
    return (
        <Link href={`/spots/${c.slug}`} prefetch={false}
              className="group block h-full rounded-2xl overflow-hidden bg-surface ring-1 ring-line hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <div className="relative w-full aspect-[3/2] overflow-hidden bg-surface-2">
                {c.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.cover.src} alt={c.cover.alt} loading="lazy" decoding="async"
                         className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                    /* 代表写真が無いときは名前だけ（無関係な写真で埋めない・`SpotIndexClient` と同じ） */
                    <div className="absolute inset-0 flex items-center justify-center px-4">
                        <span className="font-serif font-bold text-white/80 text-center" style={{ fontSize: "17px", lineHeight: "1.3" }}>{c.name}</span>
                    </div>
                )}
            </div>
            <div className="p-3">
                <p className="m-0 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "16px", lineHeight: "22px" }}>{c.name}</p>
                {c.region && (
                    <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{c.region}</p>
                )}
                {c.summary && (
                    <p className="m-0 mt-1.5 text-white/75 line-clamp-2" style={{ fontSize: "13px", lineHeight: "20px" }}>{c.summary}</p>
                )}
                {/* CC BY・CC BY-SA は作者とライセンスの表示が条件。写真の上ではなく下に置く（本文系の最小 12） */}
                {c.cover?.credit && (
                    <p className="m-0 mt-1.5 text-white/60 truncate" style={{ fontSize: "12px", lineHeight: "16px" }} title={c.cover.credit}>
                        {`写真: ${c.cover.credit}`}
                    </p>
                )}
            </div>
        </Link>
    );
}

export default function SpotTopicPage({ view, eyebrow }: { view: TopicView; eyebrow: string }) {
    const { breadcrumb, itemList } = topicStructuredData(view);
    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }} />
            {itemList && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />}
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl" data-testid="spot-topic">
                {/* パンくず（構造化データの `BreadcrumbList` と同じ段） */}
                <nav aria-label="パンくずリスト" className="mb-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                    <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                    <span className="mx-1.5" aria-hidden>/</span>
                    <Link href={ROUTES.SPOTS} prefetch={false} className="hover:text-white/90">撮影スポット</Link>
                    {view.crumbs.map((c) => (
                        <React.Fragment key={c.href}>
                            <span className="mx-1.5" aria-hidden>/</span>
                            <Link href={c.href} prefetch={false} className="hover:text-white/90">{c.name}</Link>
                        </React.Fragment>
                    ))}
                </nav>
                <p aria-hidden className="m-0 mb-1.5 font-mono font-medium uppercase text-accent"
                   style={{ fontSize: "11px", lineHeight: "16px", letterSpacing: "1.5px" }}>{eyebrow}</p>
                <h1 className="font-serif text-2xl sm:text-[34px] sm:leading-[1.15] font-bold m-0 tracking-tight">{view.heading}</h1>
                {view.intro && (
                    <p className="m-0 mt-2 mb-6 text-white/70 max-w-3xl" style={{ fontSize: "14px", lineHeight: "22px" }}>{view.intro}</p>
                )}

                {view.cards.length > 0 && (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 m-0 p-0 mb-8" style={{ listStyle: "none" }}>
                        {view.cards.map((c) => <li key={c.slug}><Card c={c} /></li>)}
                    </ul>
                )}

                {view.related.map((g) => (
                    <section key={g.heading} className="mb-7">
                        <h2 className="font-serif font-bold m-0 mb-2.5 text-white/90" style={{ fontSize: "17px", lineHeight: "24px" }}>{g.heading}</h2>
                        <TopicChips links={g.links} />
                    </section>
                ))}
            </main>
        </>
    );
}
