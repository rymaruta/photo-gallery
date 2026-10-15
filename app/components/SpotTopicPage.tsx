// app/components/SpotTopicPage.tsx（サーバーコンポーネント）
//
// **撮影スポットの切り口の頁**（国・テーマ・季節・海外の国の一覧）の本体（2026-10-11）。
// 中身は `lib/data/spotTopics.ts` がビルド時に組んだ `TopicView`。
//
// 2026-10-11 判断: 枠（見出し・導入文・パンくず）はサーバーで描き、**カードとチップの並びだけ
// クライアント部品**（`SpotTopicLists.tsx`）にして軽い形のデータで渡す。サーバー部品のまま
// 並べると RSC ペイロードに要素の木（クラス名ごと）が1件ずつ入り、実測で1枚あたり約3KB
// （フランス54件で 229KB・秋の全体で 635KB）になった。文言は日本語だけ——頁名そのものが日本語の検索語
// （「京都府の寺社の撮影スポット」）で、スポット名・カテゴリも台帳の日本語のまま。
//
// 見た目はデザインの板「黒塗りの真鍮」と `SpotIndexClient` に合わせる: 黒地・h1 は明朝・
// 眉ラベルは真鍮の等幅 11・カードは面（surface）・チップは `CHIP_OFF`・本文系の最小 12。

import React from "react";
import Link from "next/link";
import type { TopicView } from "@/lib/data/spotTopics";
import { topicStructuredData } from "@/lib/data/spotTopics";
import { ROUTES } from "@/lib/routes";
import { TopicChips, TopicCards, Lang } from "./SpotTopicLists";


/** JSON-LD を `<script>` に埋める形（`SpotGuidePage.tsx` と同じ。`</script>` で閉じられないように） */
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export default function SpotTopicPage({ view, eyebrow }: { view: TopicView; eyebrow: string }) {
    const { breadcrumb, itemList } = topicStructuredData(view);
    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumb) }} />
            {itemList && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList) }} />}
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl" data-testid="spot-topic">
                {/* パンくず（構造化データの `BreadcrumbList` と同じ段） */}
                <nav aria-label="パンくずリスト" className="mb-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                    <Link href="/" prefetch={false} className="hover:text-white/90"><Lang ja="ホーム" en="Home" /></Link>
                    <span className="mx-1.5" aria-hidden>/</span>
                    <Link href={ROUTES.SPOTS} prefetch={false} className="hover:text-white/90"><Lang ja="撮影スポット" en="Photo spots" /></Link>
                    {view.crumbs.map((c) => (
                        <React.Fragment key={c.href}>
                            <span className="mx-1.5" aria-hidden>/</span>
                            <Link href={c.href} prefetch={false} className="hover:text-white/90"><Lang ja={c.name} en={c.nameEn} /></Link>
                        </React.Fragment>
                    ))}
                </nav>
                <p aria-hidden className="m-0 mb-1.5 eyebrow text-accent">{eyebrow}</p>
                <h1 className="font-serif text-2xl sm:text-[34px] sm:leading-[1.15] font-bold m-0 tracking-tight"><Lang ja={view.heading} en={view.headingEn} /></h1>
                {view.intro && (
                    <p className="m-0 mt-2 mb-6 text-white/70 max-w-3xl" style={{ fontSize: "14px", lineHeight: "22px" }}>{view.intro}</p>
                )}

                {view.cards.length > 0 && <TopicCards cards={view.cards} />}

                {view.related.map((g) => (
                    <section key={g.heading} className="mb-7">
                        <h2 className="font-serif font-bold m-0 mb-2.5 text-white/90" style={{ fontSize: "17px", lineHeight: "24px" }}><Lang ja={g.heading} en={g.headingEn} /></h2>
                        <TopicChips links={g.links} />
                    </section>
                ))}
            </main>
        </>
    );
}
