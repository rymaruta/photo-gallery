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
                                {b.label}
                                {/* まだのものは灰色だけで分けない（読み上げにも伝える） */}
                                {!b.owned && <span className="sr-only">{locale === "en" ? " (not yet)" : "（まだ）"}</span>}
                            </p>
                            {b.sub && (
                                <p className="text-[12px] text-white/60 leading-snug tabular-nums">{b.sub}</p>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
