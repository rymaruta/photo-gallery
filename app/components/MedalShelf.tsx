/**
 * メダルの棚（デザインの板 `Shelf.dc.html`「獲得したメダル」）。3列の札に、絵・名前・下の1行。
 * まだのもの（自分の棚だけ）は灰色で薄く置く。
 *
 * 使うのは2か所: 自分の棚（`/user/badges`・下の1行は「あと◯で次」）と、
 * 人の名前の横のメダルから開く一覧（`ProfileNameMarks` の `MedalListDialog`・持っているものだけ）。
 * 行を組むのは `lib/data/badgeShelf.ts`。
 */
import React from "react";
import { badgeImage } from "../../lib/data/badges";
import type { ShelfItem } from "../../lib/data/badgeShelf";

/**
 * 取った日（その段を初めて取った日）。日付まで・日本時間。
 * 以前の縦の一覧（`MedalListDialog`）が出していたものを、棚の形でも小さく添える
 * （2026-10-11: 棚に置き換えたときに一度落としたが、owner の判断なしに情報を減らさないので戻した）
 *
 * 2026-10-11 判断: 形は板の数字の書き方（`2024.05.12`）の短い形にする。「2026年3月15日」は
 * 3列の札（390px で中の幅 約 87px）に収まらず「日」だけ次の行に落ちていた。日英とも同じ形で、
 * 札の中では折り返さない（`whitespace-nowrap`）。
 */
export function formatMedalDate(at: string): string {
    const t = Date.parse(at);
    if (Number.isNaN(t)) return "";
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
        }).formatToParts(t);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
        return `${get("year")}.${get("month")}.${get("day")}`;
    } catch {
        return "";
    }
}

/**
 * メダルの名前。段の部分（「（1年目）」「 · Silver」）は**ひとかたまりで折る**——
 * 狭い札で「続けた年（1年 / 目）」のように1字だけ次の行に落ちないように
 * （2026-10-11 判断。名前の横の設定のシートの一覧も同じ部品を使う）。
 */
export function MedalName({ label }: { label: string }) {
    const i = label.search(/（| · /);
    if (i <= 0) return <>{label}</>;
    return (
        <>
            {label.slice(0, i)}
            {label[i] === " " && " "}
            <span className="whitespace-nowrap" data-testid="medal-name-tier">{label.slice(i).trimStart()}</span>
        </>
    );
}

export default function MedalShelf({ items, locale }: { items: ShelfItem[]; locale: "ja" | "en" }) {
    return (
        <ul className="grid grid-cols-3 gap-2.5" data-testid="medal-shelf">
            {items.map((b) => {
                // 季節の章で絵の無い年は null → 同じ大きさの空き（並びをそろえる）
                const src = badgeImage(b.key, b.tier, false);
                return (
                    <li
                        key={b.key}
                        className="flex flex-col items-center gap-1 px-1 py-2.5 rounded-[14px] bg-[#0B0B0B] ring-1 ring-inset ring-[#1F1F1F] text-center"
                        data-owned={b.owned ? "true" : "false"}
                        data-testid="medal-shelf-item"
                    >
                        {src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={src}
                                alt=""
                                width={72}
                                height={72}
                                loading="lazy"
                                style={{ width: 72, height: 72, opacity: b.owned ? 1 : 0.35, filter: b.owned ? "none" : "grayscale(1)" }}
                            />
                        ) : (
                            <span aria-hidden="true" style={{ width: 72, height: 72 }} />
                        )}
                        <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-white leading-snug">
                                <MedalName label={b.label} />
                                {/* まだのものは灰色だけで分けない（読み上げにも伝える） */}
                                {!b.owned && <span className="sr-only">{locale === "en" ? " (not yet)" : "（まだ）"}</span>}
                            </p>
                            {b.sub && (
                                // 1字だけ次の行に落ちないよう、行の長さをならす。折る所は文節の切れ目
                                // （`auto-phrase`・対応するブラウザだけ。無ければならすだけ）（2026-10-11 判断）
                                <p className="text-[12px] text-white/60 leading-snug tabular-nums text-balance [word-break:auto-phrase]" data-testid="medal-shelf-sub">{b.sub}</p>
                            )}
                            {b.at && formatMedalDate(b.at) && (
                                <p className="text-[12px] text-white/50 leading-snug tabular-nums whitespace-nowrap" data-testid="medal-shelf-date">
                                    {formatMedalDate(b.at)}
                                </p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
