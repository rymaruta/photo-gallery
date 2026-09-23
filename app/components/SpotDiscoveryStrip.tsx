import React from "react";
import Link from "next/link";

/**
 * 「さがす」の公式ガイド入口。サーバーから必要な数件だけ受け取る。
 * この部品から Spot 台帳を import しない（client bundle に全文を載せない）。
 * 投稿が0件でもガイドの公開条件を満たす場所を表示できる。
 */
export type SpotDiscoveryItem = {
    slug: string;
    name: string;
    region?: string;
    summary?: string;
    coverSrc?: string;
    coverAlt?: string;
    credit?: string;
};

export default function SpotDiscoveryStrip({ spots, isJa }: { spots: readonly SpotDiscoveryItem[]; isJa: boolean }) {
    if (!spots.length) return null;

    return (
        <section className="mb-6 sm:mb-8" aria-labelledby="search-official-spots">
            <div className="mb-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <p className="m-0 mb-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-link">
                        JOURNEY GUIDE
                    </p>
                    <h2 id="search-official-spots" className="m-0 font-serif text-xl sm:text-2xl font-bold tracking-tight text-white">
                        {isJa ? "景色から、旅先を見つける" : "Discover your next destination"}
                    </h2>
                    <p className="m-0 mt-1 text-xs sm:text-sm text-white/70">
                        {isJa ? "投稿がまだない場所も、撮影地ガイドから探せます。" : "Explore our guides, even before anyone shares a photo."}
                    </p>
                </div>
                <Link href="/spots" prefetch={false}
                      className="shrink-0 rounded-full border border-line px-3 py-2 text-xs text-link hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {isJa ? "すべて見る" : "Explore all"} <span aria-hidden="true">↗</span>
                </Link>
            </div>

            {/* スマホは横スクロールで写真一覧へすぐ進める。PCは3列に収める。 */}
            <ul className="m-0 p-0 flex gap-2.5 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible"
                style={{ listStyle: "none", scrollbarWidth: "thin" }}>
                {spots.map((s) => (
                    <li key={s.slug} className="m-0 w-[72vw] max-w-[260px] shrink-0 lg:w-auto lg:max-w-none">
                        <Link href={`/spots/${s.slug}`} prefetch={false}
                              className="group flex h-full items-center gap-2.5 rounded-xl border border-line bg-surface p-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            <span className="relative flex h-[70px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                                {s.coverSrc ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={s.coverSrc} alt={s.coverAlt ?? ""}
                                         loading="lazy" decoding="async"
                                         className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                ) : (
                                    <span aria-hidden="true" className="text-2xl text-link">⌖</span>
                                )}
                                {s.credit && <span className="sr-only">{s.credit}</span>}
                            </span>
                            <span className="min-w-0 flex-1">
                                {s.region && <span className="block truncate text-[11px] text-white/60">{s.region}</span>}
                                <span className="block font-serif text-[15px] font-bold leading-5 text-white">{s.name}</span>
                                {s.summary && <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-white/70">{s.summary}</span>}
                            </span>
                            <span aria-hidden="true" className="shrink-0 text-link">›</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
