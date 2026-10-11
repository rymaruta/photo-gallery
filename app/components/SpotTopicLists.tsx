"use client";

// app/components/SpotTopicLists.tsx
//
// 撮影スポットの切り口の頁（`SpotTopicPage`）と `/spots` の**並び**（カード・チップ）。
//
// 🔴 **クライアント部品にしているのは軽くするため**（2026-10-11・実ビルドで測った）。
// サーバー部品で並べると、RSC ペイロード（HTML に埋まる・`.txt` にも出る）に要素の木が
// クラス名ごと1件ずつ入る。ここで受け取るのは `TopicCard` / `TopicLink` の**データだけ**
// （名前・場所・概要・写真の場所）で、木はクライアントの JS（1回だけ・キャッシュされる）が持つ。
// 操作は無い——水和しても見た目は変わらない。

import React from "react";
import Link from "next/link";
import type { TopicCard, TopicLink } from "@/lib/data/spotTopics";
import { CHIP_OFF } from "./chipStyles";

/** 切り口のチップの並び（`/spots` でも使う） */
export function TopicChips({ links }: { links: TopicLink[] }) {
    return (
        <ul className="flex flex-wrap gap-1.5 m-0 p-0" style={{ listStyle: "none" }}>
            {links.map((l) => (
                <li key={l.href}>
                    <Link href={l.href} prefetch={false}
                          className={`inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                          style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                        {l.label}
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


/** スポットのカードの並び（代表写真のあるものが先・`spotTopics.ts` の `topicCards`） */
export function TopicCards({ cards }: { cards: TopicCard[] }) {
    return (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 m-0 p-0 mb-8" style={{ listStyle: "none" }}>
            {cards.map((c) => <li key={c.slug}><Card c={c} /></li>)}
        </ul>
    );
}
