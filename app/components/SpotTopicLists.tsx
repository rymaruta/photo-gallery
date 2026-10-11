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
import type { TopicCard, TopicCredit, TopicLink } from "@/lib/data/spotTopics";
import { useLocale } from "@/app/i18n/context";
import { CHIP_OFF } from "./chipStyles";

/**
 * 枠の文言（パンくず・見出し・関連の見出し）を表示の言語で出す（2026-10-11）。
 * 書き出しの HTML は日本語（`LocaleProvider` の初期値）で、英語の人には水和のあとに切り替わる
 * （`SpotIndexClient` などと同じ）。導入文・カードは日本語のまま（台帳が日本語）
 */
export function Lang({ ja, en }: { ja: string; en: string }) {
    const { locale } = useLocale();
    return <>{locale === "en" ? en : ja}</>;
}

/**
 * 押せるチップの当たり（2026-10-11）。見た目は 34px のまま、**上下 5px ずつ外へ当たりを広げて 44px**。
 * 並びの縦の隙間を 10px にして、となりの行の当たりと重ねない
 */
export const CHIP_HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']";
export const CHIP_ROW = "flex flex-wrap gap-x-1.5 gap-y-2.5 m-0 p-0";

/** 切り口のチップの並び（`/spots` でも使う） */
export function TopicChips({ links }: { links: TopicLink[] }) {
    const { locale } = useLocale();
    const en = locale === "en";
    return (
        <ul className={CHIP_ROW} style={{ listStyle: "none" }}>
            {links.map((l) => (
                <li key={l.href}>
                    <Link href={l.href} prefetch={false}
                          className={`${CHIP_HIT} inline-flex items-center gap-1.5 rounded-full ${CHIP_OFF} transition-colors`}
                          style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                        {en && l.labelEn ? l.labelEn : l.label}
                        <span className="text-white/60" style={{ fontSize: "12px" }}>{l.count}</span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}

/**
 * 写真の表示（CC BY・CC BY-SA の条件）。**スポットの頁の代表写真の下と同じ形**:
 * 「写真: 作者 / ライセンス（文面へのリンク）/ Wikimedia Commons（出典へ）」。
 *
 * 🔴 **ライセンスを先の行に出し、切らない。** 1行に詰めて末尾を「…」で切ると、ライセンス名
 * （表示の条件）が隠れていた。`compact` ではライセンスの行と作者の行の2行にし、作者の行だけを切る
 * （全文は `title`）。カードのリンクの外に置く（リンクの中にリンクを入れない）
 */
export function TopicCreditLine({ credit, compact = false }: { credit: TopicCredit; compact?: boolean }) {
    const { locale } = useLocale();
    const photo = locale === "en" ? "Photo: " : "写真: ";
    const a = "text-white/60 underline underline-offset-2 hover:text-white";
    const style = { fontSize: "12px", lineHeight: "16px" } as const;
    if (!credit.license) {
        const text = credit.text || credit.author;
        return <p className={`m-0 text-white/60 ${compact ? "truncate" : "wrap-anywhere"}`} style={style} title={text}>{credit.text ? text : `${photo}${text}`}</p>;
    }
    const license = credit.licenseUrl
        ? <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer license" className={a}>{credit.license}</a>
        : credit.license;
    const source = credit.sourceUrl
        ? <>{" / "}<a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className={a}>Wikimedia Commons</a></>
        : null;
    if (compact) {
        // 狭い札の下（ホーム）: 1行目はライセンス（文面へ・切らない）、2行目は作者で**出典（Commons のページ）へのリンク**
        // を兼ねる（「/ Wikimedia Commons」まで1行に入れると札の幅を越えて隣に重なった・画面写真で確かめた）
        return (
            <div className="text-white/60 min-w-0" style={style} data-testid="topic-credit">
                <p className="m-0 whitespace-nowrap">{license}</p>
                <p className="m-0 truncate" title={credit.author}>
                    {credit.sourceUrl
                        ? <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-white">{photo}{credit.author}</a>
                        : <>{photo}{credit.author}</>}
                </p>
            </div>
        );
    }
    return (
        <p className="m-0 text-white/60 wrap-anywhere" style={style} data-testid="topic-credit">
            {photo}{credit.author}{" / "}{license}{source}
        </p>
    );
}

function Card({ c }: { c: TopicCard }) {
    return (
        <div className="h-full flex flex-col rounded-2xl overflow-hidden bg-surface ring-1 ring-line">
            <Link href={`/spots/${c.slug}`} prefetch={false}
                  className="group block flex-1 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
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
                <div className="p-3 pb-2">
                    <p className="m-0 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "16px", lineHeight: "22px" }}>{c.name}</p>
                    {c.region && (
                        <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{c.region}</p>
                    )}
                    {c.summary && (
                        <p className="m-0 mt-1.5 text-white/75 line-clamp-2" style={{ fontSize: "13px", lineHeight: "20px" }}>{c.summary}</p>
                    )}
                </div>
            </Link>
            {/* CC BY・CC BY-SA は作者とライセンスの表示が条件。写真の下・リンクの外（本文系の最小 12） */}
            {c.cover?.credit && (
                <div className="px-3 pb-3"><TopicCreditLine credit={c.cover.credit} /></div>
            )}
            {!c.cover?.credit && <div className="pb-1" />}
        </div>
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
