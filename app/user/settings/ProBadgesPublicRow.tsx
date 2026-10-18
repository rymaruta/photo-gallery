"use client";

/**
 * 設定の「プロフィール」の札の中: **公開プロフィールに Pro の章を出す**の入切
 * （2026-10-18 owner・journey.photo-ios #296。iOS は設定の Pro の節の「名前の横」の下・板 43 設定）。
 *
 * - 入切は `PUT /user/profile` の `proBadgesHidden`（オン＝出す＝`false`）。オフにすると、他の人の
 *   公開プロフィールから Pro のメダル（サポーター章・続けた年・季節の章）とサポーターの番号・申し込んだ日・
 *   続けた月数が消える（サーバーの `toPublicProfile`）。本人の画面はそのまま
 * - **出すのは、サポーターの番号か Pro のメダルを持っている人だけ**（やめた人も。番号とメダルは残るので）
 * - **自分のプロフィールに `proBadgesHidden` が無い（古いサーバー）ときは出さない**——古いサーバーは
 *   知らない項目を黙って捨てるので、出すと押しても効かない入切になる
 *
 * 2026-10-18 判断: Web の設定の「Pro」の節（`LightAlertSettings`）は**いま Pro の人だけ**に出すので、
 * やめた人に届かない。iOS と同じ節には置かず、名前の横・メダルの行が並ぶ「プロフィール」の札に置いた。
 * 見た目は板のトグル（`LightAlertSettings` と同じ 51×31・入は accent-deep に白い玉）
 */

import React, { useEffect, useRef, useState } from "react";
import { userFetch, sessionErrorMessage } from "../../../lib/utils/api";
import { usableObject } from "../../../lib/utils/apiRows";
import { isProBadgeKey } from "../../../lib/data/badges";

/** この人に入切を出すか（自分のプロフィールの応答から） */
export function showsProBadgesRow(p: Record<string, unknown> | null | undefined): boolean {
    if (!p || typeof p.proBadgesHidden !== "boolean") return false;
    const s = p.supporter as { number?: unknown } | undefined;
    const hasNumber = !!s && typeof s === "object" && typeof s.number === "number";
    const badges = p.badges && typeof p.badges === "object" && !Array.isArray(p.badges) ? Object.keys(p.badges) : [];
    return hasNumber || badges.some(isProBadgeKey);
}

export default function ProBadgesPublicRow({ locale }: { locale: "ja" | "en" }) {
    const en = locale === "en";
    const [shown, setShown] = useState(false);
    /** 出す（= `proBadgesHidden` が偽） */
    const [on, setOn] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false);

    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const res = await userFetch("/user/profile");
                if (!res.ok || !live) return;
                const p = usableObject<Record<string, unknown>>(await res.json().catch(() => null), "GET /user/profile");
                if (!p || !live) return;
                setOn(p.proBadgesHidden !== true);
                setShown(showsProBadgesRow(p));
            } catch { /* 読めなければ出さない */ }
        })();
        return () => { live = false; };
    }, []);

    if (!shown) return null;

    const toggle = async () => {
        if (busy.current) return;
        busy.current = true;
        const before = on;
        const next = !before;
        setOn(next);
        setSaving(true);
        setError(null);
        try {
            const res = await userFetch("/user/profile", { method: "PUT", body: JSON.stringify({ proBadgesHidden: !next }) });
            if (!res.ok) throw new Error(String(res.status));
        } catch (e) {
            // 送れなければ元に戻す（隠したつもりで出ている、を作らない）
            setOn(before);
            setError(sessionErrorMessage(e)
                ?? (en ? "Couldn't change this. Please try again." : "切り替えられませんでした。もう一度お試しください。"));
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };

    const label = en ? "Show Pro medals on your public profile" : "公開プロフィールに Pro の章を出す";
    return (
        <div className="border-t border-white/[0.08] pt-3" data-testid="settings-pro-badges">
            <div className="flex items-center gap-3" style={{ minHeight: "54px" }}>
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-[15px] text-white/95">{label}</span>
                    <span className="text-xs leading-relaxed text-white/60">
                        {en
                            ? "When off, other people won't see your Pro medals, supporter number or months supported (your pass face still shows whether you're Pro now)."
                            : "オフにすると、Pro のメダル・サポーターの番号と続けた月数を他の人に見せません（いま Pro かどうかは乗車券の券面で分かります）"}
                    </span>
                </span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={label}
                    disabled={saving}
                    onClick={() => void toggle()}
                    className="flex-shrink-0 flex items-center disabled:opacity-60"
                    style={{ width: "51px", minHeight: "44px", touchAction: "manipulation" }}
                >
                    <span
                        className={`relative block rounded-full transition-colors ${on ? "bg-accent-deep" : "bg-white/20"}`}
                        style={{ width: "51px", height: "31px" }}
                    >
                        <span
                            className="absolute rounded-full bg-white transition-transform"
                            style={{
                                width: "27px", height: "27px", top: "2px", left: "2px",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                                transform: on ? "translateX(20px)" : "translateX(0)",
                            }}
                        />
                    </span>
                </button>
            </div>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
    );
}
