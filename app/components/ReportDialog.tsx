"use client";

import React, { useRef, useState } from "react";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { userFetch, readApiError } from "../../lib/utils/api";
import { useToast } from "../../lib/hooks/useToast";
import { sessionErrorMessage } from "../../lib/utils/api";
import { log } from "../../lib/utils/log";

/**
 * **不適切な投稿の通報。**
 *
 * `api-user/src/block.ts` が「通報（誰かが読んで裁く仕組みが要る。
 * 利用者1人の今は空回りする）」として見送っていたもの。前提が変わった
 * ——他人の投稿が並ぶ画面ができ、確認済みの利用者も増えた。
 *
 * **自動で何かを消す仕組みは作らない。** 受け付けて運営が読む、まで。
 * 誤報や嫌がらせで正当な投稿が消える方が、対応が数日遅れるより悪い。
 *
 * 理由の一覧は**サーバーと同じもの**（`api-user/src/report.ts` の
 * `REPORT_REASONS`）。片方だけ増やすと、選べるのに 400 で断られる
 * ——`reportReasons.test.ts` が突き合わせる。
 */
export const REPORT_REASON_LABELS: ReadonlyArray<{ value: string; ja: string; en: string }> = [
    { value: "copyright", ja: "自分の写真を無断で使われている", en: "My photo is used without permission" },
    { value: "privacy", ja: "写っている人や場所の権利を害している", en: "Violates someone's privacy" },
    { value: "sexual", ja: "わいせつな内容", en: "Sexual content" },
    { value: "violence", ja: "暴力的・残虐な内容", en: "Violent content" },
    { value: "harassment", ja: "特定の人への攻撃・いやがらせ", en: "Harassment" },
    { value: "spam", ja: "広告・勧誘・スパム", en: "Spam" },
    { value: "other", ja: "その他", en: "Other" },
];

/** 補足の上限。**サーバーの `REPORT_NOTE_MAX` と揃える** */
export const NOTE_MAX = 500;

type Props = {
    photoId: string;
    locale: string;
    onClose: () => void;
    openerRef?: React.RefObject<HTMLElement | null>;
};

export default function ReportDialog({ photoId, locale, onClose, openerRef }: Props) {
    const isJa = locale !== "en";
    const panelRef = useRef<HTMLDivElement>(null);
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const [sending, setSending] = useState(false);
    const { showToast } = useToast();

    // 外へ漏らさない・閉じたら押した場所へ戻す（このリポジトリの8か所と同じ道具）
    useFocusTrap(true, panelRef, openerRef);
    // `document` で聞く（合成イベントだと本文をタップした時点で効かなくなる）
    useEscapeKey(true, onClose);
    React.useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    const submit = async () => {
        if (!reason || sending) return;
        setSending(true);
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}/report`, {
                method: "POST",
                body: JSON.stringify({ reason, ...(note.trim() ? { note: note.trim() } : {}) }),
            });
            if (!res.ok) {
                showToast(await readApiError(res, isJa ? "通報できませんでした" : "Could not report"), "error");
                return;
            }
            // **「対応しました」とは言わない。** 読むのは人で、すぐには終わらない
            showToast(
                isJa ? "通報を受け付けました。運営が確認します。" : "Report received. We'll review it.",
                "success",
            );
            onClose();
        } catch (e) {
            log.error("report failed:", e);
            const known = sessionErrorMessage(e);
            showToast(known ?? (isJa ? "通報できませんでした" : "Could not report"), "error");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4">
            {/* 背景。キーボードの経路は Escape が担保している */}
            <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="report-title"
                className="relative w-full sm:max-w-md bg-neutral-900 ring-1 ring-white/10 rounded-t-2xl sm:rounded-2xl p-5 max-h-[90dvh] overflow-y-auto"
            >
                <h2 id="report-title" className="text-base font-semibold">
                    {isJa ? "この投稿を通報する" : "Report this post"}
                </h2>
                <p className="mt-1.5 text-xs text-white/60">
                    {isJa
                        ? "運営が内容を確認します。すぐに削除されるとは限りません。"
                        : "We'll review it. This doesn't remove the post immediately."}
                </p>

                <fieldset className="mt-4">
                    <legend className="text-xs text-white/70 mb-2">{isJa ? "理由を選んでください" : "Choose a reason"}</legend>
                    <div className="space-y-1.5">
                        {REPORT_REASON_LABELS.map((r) => (
                            <label key={r.value} className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                                <input
                                    type="radio"
                                    name="report-reason"
                                    value={r.value}
                                    checked={reason === r.value}
                                    onChange={() => setReason(r.value)}
                                    className="mt-0.5"
                                />
                                <span className="text-sm text-white/85">{isJa ? r.ja : r.en}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                <div className="mt-4">
                    <label className="block text-xs text-white/70 mb-1.5" htmlFor="report-note">
                        {isJa ? "補足（任意）" : "Details (optional)"}
                    </label>
                    <textarea
                        id="report-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={NOTE_MAX}
                        rows={3}
                        style={{ fontSize: "16px" }}
                        className="w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-white/30"
                        placeholder={isJa ? "分かる範囲でお書きください" : "Anything that helps us review"}
                    />
                </div>

                <div className="mt-5 flex gap-2.5 justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/5"
                        style={{ touchAction: "manipulation" }}
                    >
                        {isJa ? "キャンセル" : "Cancel"}
                    </button>
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={!reason || sending}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-black disabled:bg-white/20 disabled:text-white/50"
                        style={{ touchAction: "manipulation" }}
                    >
                        {sending ? (isJa ? "送信中…" : "Sending…") : (isJa ? "通報する" : "Report")}
                    </button>
                </div>
            </div>
        </div>
    );
}
