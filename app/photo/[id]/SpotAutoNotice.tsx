"use client";

import React, { useState } from "react";
import { useToast } from "../../../lib/hooks/useToast";
import { sessionErrorMessage } from "../../../lib/utils/api";
import { SPOT_AUTO_OFF } from "../../../lib/utils/spotAutoLink";

/**
 * **自動の結びの知らせと「外す」**（撮った本人にだけ・2026-10-31 判断・journey.photo-ios#425）。
 *
 * 板（https://claude.ai/artifact/NHrF23fezgz9sAE6qvS6xW の PhotoWeb の 4）のとおり:
 *   眉「あなたにだけ表示」（真鍮・黒地の札の上）→「『◯◯』の写真としてまとめました」→ 説明 →「違う場所なので外す」
 * 外したあとは「自動のまとめを外しています」と「元に戻す」（`spotAuto: null` で行から印を消す）。
 *
 * 書くのは `PUT /photos/{id}` の `spotAuto`（`api-user/src/photoUpdate.ts`）。静的な頁は作り直しで
 * 変わるので、ここでは押した結果だけを先に見せ、反映まで数分かかると伝える。
 * 距離は出さない（写真の位置を細かく言わない・他の画面と同じ）
 */
export default function SpotAutoNotice({ photoId, spotName, off, onChange, locale }: {
    photoId: string;
    spotName: string;
    /** いま外してあるか */
    off: boolean;
    /** 保存できたら呼ぶ（親が撮影スポットの札を出し入れする） */
    onChange: (off: boolean) => void;
    locale: string;
}) {
    const isJa = locale !== "en";
    const { showToast } = useToast();
    const [saving, setSaving] = useState(false);

    const save = async (nextOff: boolean) => {
        setSaving(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, {
                method: "PUT",
                body: JSON.stringify({ spotAuto: nextOff ? SPOT_AUTO_OFF : null }),
            });
            if (!res.ok) {
                showToast(await readApiError(res, isJa ? "保存できませんでした" : "Could not save"), "error");
                return;
            }
            onChange(nextOff);
            showToast(nextOff
                ? (isJa ? "外しました。撮影スポットの頁から外れるのは、サイトの更新が終わってからです" : "Removed. The spot page updates after the site is rebuilt.")
                : (isJa ? "元に戻しました。サイトの更新が終わると、撮影スポットの頁に並びます" : "Restored. It will appear on the spot page after the site is rebuilt."),
            "success");
        } catch (e) {
            showToast(sessionErrorMessage(e)
                ?? (isJa ? "通信に失敗しました。時間をおいてもう一度お試しください" : "Network error. Please try again."), "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="mt-5 rounded-2xl bg-surface ring-1 ring-line p-4 flex flex-col gap-2"
                 aria-labelledby="photo-spot-auto" data-testid="spot-auto-notice">
            <span className="text-accent font-semibold" style={{ fontSize: "11px", letterSpacing: "0.12em" }}>
                {isJa ? "あなたにだけ表示" : "Only you can see this"}
            </span>
            <h2 id="photo-spot-auto" className="m-0 text-white font-semibold" style={{ fontSize: "16px", lineHeight: "22px" }}>
                {off
                    ? (isJa ? `「${spotName}」への自動のまとめを外しています` : `Not grouped with “${spotName}”`)
                    : (isJa ? `「${spotName}」の写真としてまとめました` : `Grouped with “${spotName}”`)}
            </h2>
            <p className="m-0 text-white/70" style={{ fontSize: "13px", lineHeight: "20px" }}>
                {off
                    ? (isJa ? "撮影スポットの頁には並びません。同じ場所なら元に戻せます。" : "It won’t appear on the spot page. Restore it if this is the same place.")
                    : (isJa ? "撮影地の名前と写真の位置から、自動でまとめています。違う場所なら外してください。"
                        : "Grouped automatically by place name and location. Remove it if this is a different place.")}
            </p>
            <div>
                <button type="button" onClick={() => save(!off)} disabled={saving}
                        className="inline-flex items-center rounded-full ring-1 ring-line text-white hover:bg-surface-2 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ fontSize: "15px", padding: "0 18px", minHeight: "44px" }}>
                    {off ? (isJa ? "元に戻す" : "Restore") : (isJa ? "違う場所なので外す" : "Different place — remove")}
                </button>
            </div>
        </section>
    );
}
