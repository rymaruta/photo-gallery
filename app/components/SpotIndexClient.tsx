"use client";

import React from "react";
import Link from "next/link";
import type { Spot } from "@/lib/data/spots";
import { useLocale } from "@/app/i18n/context";
import { usesMapHero, needsVisibleCredit } from "@/lib/utils/spotGuide";

/**
 * **公式撮影地ガイドの索引**（`/spots`）。
 *
 * owner の指示書 第8章:「旅のテーマ」から撮影スポットを発見できるようにする。
 * ただし **「これらは固定の見た目だけのカードではなく、登録済みスポットの
 * カテゴリやタグと実際に紐付けてください」「該当スポットがないテーマは、
 * 空の特集として表示しないでください」**。
 *
 * だから**テーマの一覧は持たない**——台帳の `category` を数えて、
 * **実際に在るものだけ**をチップにする。0件のテーマは存在しようがない。
 */
type Props = { spots: Spot[] };

export default function SpotIndexClient({ spots }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";
    const [theme, setTheme] = React.useState<string | null>(null);

    /** 台帳に実際に在るカテゴリと件数（**架空のテーマを出さない**） */
    const themes = React.useMemo(() => {
        const m = new Map<string, number>();
        for (const s of spots) {
            const c = (s.category ?? "").trim();
            if (c) m.set(c, (m.get(c) ?? 0) + 1);
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [spots]);

    const shown = theme ? spots.filter((s) => s.category === theme) : spots;

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl">
            <h1 className="font-serif text-2xl sm:text-[34px] sm:leading-[1.15] font-bold m-0 tracking-tight">
                {isJa ? "撮影スポットをさがす" : "Find a place to shoot"}
            </h1>
            <p className="m-0 mt-2 mb-5 text-white/70" style={{ fontSize: "14px", lineHeight: "22px" }}>
                {isJa
                    ? "運営が調べた撮影地のガイドです。写真の投稿がまだ無い場所も載っています。"
                    : "Guides we researched. Places with no photos yet are listed too."}
            </p>

            {/* 旅のテーマ＝**台帳に在るカテゴリだけ**。0件のテーマは作らない */}
            {themes.length > 0 && (
                <div role="group" aria-label={isJa ? "テーマでしぼる" : "Filter by theme"}
                     className="flex flex-wrap gap-1.5 mb-6">
                    <button type="button" role="switch" aria-checked={theme === null}
                            onClick={() => setTheme(null)}
                            className={`inline-flex items-center rounded-full transition-colors ${
                                theme === null ? "bg-white text-black" : "bg-chip text-chip-text hover:bg-surface-2 hover:text-white"
                            }`}
                            style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                        {isJa ? "すべて" : "All"}
                    </button>
                    {themes.map(([c, n]) => (
                        <button key={c} type="button" role="switch" aria-checked={theme === c}
                                onClick={() => setTheme(theme === c ? null : c)}
                                className={`inline-flex items-center gap-1.5 rounded-full transition-colors ${
                                    theme === c ? "bg-white text-black" : "bg-chip text-chip-text hover:bg-surface-2 hover:text-white"
                                }`}
                                style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                            {c}<span className="text-white/60" style={{ fontSize: "11px" }}>{n}</span>
                        </button>
                    ))}
                </div>
            )}

            {shown.length === 0 ? (
                /* **架空のスポットで埋めない。** 0件なら0件と言う */
                <p className="m-0 text-white/70" style={{ fontSize: "14px" }}>
                    {isJa ? "公開中の撮影スポットはまだありません。" : "No published spots yet."}
                </p>
            ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 m-0 p-0" style={{ listStyle: "none" }}>
                    {shown.map((s) => {
                        const where = [s.region?.prefecture, s.region?.city].filter(Boolean).join(" ");
                        const noImage = usesMapHero(s);
                        return (
                            <li key={s.spotId}>
                                <Link href={`/spots/${s.slug}`} prefetch={false}
                                      className="group block rounded-2xl overflow-hidden bg-surface ring-1 ring-line hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                    <div className="relative w-full aspect-[3/2] overflow-hidden">
                                        {noImage ? (
                                            /* 代表写真が無いときは**地図と名前**（無関係な写真で埋めない） */
                                            <div className="absolute inset-0 flex items-center justify-center bg-surface-2 px-4">
                                                <span className="font-serif font-bold text-white/80 text-center"
                                                      style={{ fontSize: "17px", lineHeight: "1.3" }}>{s.name}</span>
                                            </div>
                                        ) : (
                                            <>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={s.coverImage!.src} alt={s.coverImage!.alt}
                                                     className="absolute inset-0 w-full h-full object-cover" />
                                                {needsVisibleCredit(s) && (
                                                    <span className="absolute bottom-1 right-2 text-white/70"
                                                          style={{ fontSize: "9px" }}>
                                                        {s.coverImage!.requiredCreditText || `Photo: ${s.coverImage!.credit}`}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="p-3">
                                        <p className="m-0 font-serif font-bold text-white wrap-anywhere"
                                           style={{ fontSize: "16px", lineHeight: "22px" }}>{s.name}</p>
                                        {where && (
                                            <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{where}</p>
                                        )}
                                        {s.summary && (
                                            <p className="m-0 mt-1.5 text-white/75 line-clamp-2"
                                               style={{ fontSize: "13px", lineHeight: "20px" }}>{s.summary}</p>
                                        )}
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </main>
    );
}
