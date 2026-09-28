"use client";

import React from "react";
import Link from "next/link";
import type { SpotIndexItem } from "@/lib/data/spotLink";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";

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
/**
 * **受け取るのは解いたあとの軽い形だけ**（`SpotIndexItem`）。
 * 台帳の `Spot` をそのまま受けると、全文がこのページの HTML に乗る
 * ——実測 518KB／120件。`lib/data/spotLink.ts` の注記を参照。
 */
type Props = {
    spots: SpotIndexItem[];
    /**
     * どの区画の一覧か（`/spots/area/<slug>`）。見出しとパンくずに使う。
     * 省くと区画名のない一覧になる。
     */
    area?: { name: string; nameEn: string };
};

export default function SpotIndexClient({ spots, area }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";
    const [theme, setTheme] = React.useState<string | null>(null);

    /** 台帳に実際に在るカテゴリと件数（**架空のテーマを出さない**） */
    // 運営未確認の下書きの数。**「運営が調べた」と言えるのは人が確かめた行だけ**
    const draftCount = spots.filter((s) => s.stage === "review").length;
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
            {/* **戻り道を必ず出す。** 区画のページは `/spots` からしか辿れない */}
            <p className="m-0 mb-2" style={{ fontSize: "13px", lineHeight: "18px" }}>
                <Link href={ROUTES.SPOTS} prefetch={false}
                      className="text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
                    {isJa ? "← 撮影スポットをさがす" : "← Find a place to shoot"}
                </Link>
            </p>
            <h1 className="font-serif text-2xl sm:text-[34px] sm:leading-[1.15] font-bold m-0 tracking-tight">
                {area
                    ? (isJa ? `${area.name}の撮影スポット` : `Photo spots in ${area.nameEn}`)
                    : (isJa ? "撮影スポットをさがす" : "Find a place to shoot")}
            </h1>
            {spots.length > 0 && (
            <p className="m-0 mt-2 mb-5 text-white/70" style={{ fontSize: "14px", lineHeight: "22px" }}>
                {/* **「運営が調べた」と言えるのは、人が確かめた行だけ**（`stage`）。
                    全部が下書きならそう言う */}
                {draftCount >= spots.length
                    ? (isJa
                        ? `撮影地ガイドの下書きです（${spots.length}件・運営未確認）。写真の投稿がまだ無い場所も載っています。`
                        : `Draft guides, not checked by us yet (${spots.length}). Places with no photos yet are listed too.`)
                    : (isJa
                        ? `運営が調べた撮影地のガイドです（${spots.length}件${draftCount > 0 ? `・うち下書き${draftCount}件` : ""}）。写真の投稿がまだ無い場所も載っています。`
                        : `Guides we researched (${spots.length}${draftCount > 0 ? `, ${draftCount} drafts` : ""}). Places with no photos yet are listed too.`)}
            </p>
            )}

            {/* 旅のテーマ＝**台帳に在るカテゴリだけ**。0件のテーマは作らない */}
            {themes.length > 0 && (
                <div role="group" aria-label={isJa ? "テーマでしぼる" : "Filter by theme"}
                     className="flex flex-wrap gap-1.5 mb-6">
                    <button type="button" role="switch" aria-checked={theme === null}
                            onClick={() => setTheme(null)}
                            className={`inline-flex items-center rounded-full transition-colors ${
                                theme === null ? "bg-primary text-ink" : "bg-chip text-chip-text hover:bg-surface-2 hover:text-white"
                            }`}
                            style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                        {isJa ? "すべて" : "All"}
                    </button>
                    {themes.map(([c, n]) => (
                        <button key={c} type="button" role="switch" aria-checked={theme === c}
                                onClick={() => setTheme(theme === c ? null : c)}
                                className={`inline-flex items-center gap-1.5 rounded-full transition-colors ${
                                    theme === c ? "bg-primary text-ink" : "bg-chip text-chip-text hover:bg-surface-2 hover:text-white"
                                }`}
                                style={{ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" }}>
                            {c}
                            {/* 件数は**選択状態に合わせて色を変える**。白の塗りの上で
                                `text-white/60` のままだと、選んだテーマの件数が消えていた */}
                            <span className={theme === c ? "text-ink/70" : "text-white/60"} style={{ fontSize: "11px" }}>{n}</span>
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
                        const where = s.region;
                        // 出すかどうかの判断はサーバー側で済んでいる（`cover` が null なら写真なし）
                        const noImage = !s.cover;
                        return (
                            <li key={s.slug}>
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
                                                <img src={s.cover!.src} alt={s.cover!.alt}
                                                     className="absolute inset-0 w-full h-full object-cover" />
                                                {s.cover!.credit && (
                                                    <span className="absolute bottom-1 right-2 text-white/70"
                                                          style={{ fontSize: "9px" }}>
                                                        {`Photo: ${s.cover!.credit}`}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="p-3">
                                        <p className="m-0 font-serif font-bold text-white wrap-anywhere"
                                           style={{ fontSize: "16px", lineHeight: "22px" }}>{s.name}</p>
                                        {(where || s.stage === "review") && (
                                            <p className="m-0 mt-0.5 text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                                {s.stage === "review" && (isJa ? "下書き" : "Draft")}
                                                {s.stage === "review" && where ? " ・ " : ""}
                                                {where}
                                            </p>
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
