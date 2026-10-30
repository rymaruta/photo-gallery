"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { BTN_FILL, BTN_LINE } from "./buttonStyles";

/**
 * **空・失敗・読み込み中を1つの形に**（iOS の `ErrorBanner.swift`・板 Components 06「4つの状態」・2026-10-21）。
 *
 * 以前は画面ごとに書いていて、同じ「読めなかった」が 12px の灰の1行だったり、赤の帯だったり、
 * 回転する輪だったりした。どの画面でも同じ並びにする——
 *
 *     失敗        灰の三角 → 明朝 20 の見出し（任意）→ 15 の説明 → 44 の線の「もう一度試す」
 *     空          明朝 20 の見出し（任意）→ 15 の説明 → 一手（任意・真鍮の塗りに墨の字）
 *     読み込み中  中身と同じ形の灰の骨組み。0.3 秒より早く読めたら出さない。光は流さない
 *
 * - 三角は**灰**（text-3）。赤にしない——読めないのは見ている人の誤りではない
 * - 空の一手は「写真の無い画面の主ボタン」＝真鍮の塗り（accent-fill）に墨（白の字は 2.81:1 で読めない）
 * - 押せるものは 44px。説明は切り詰めず折り返す
 */

/** 状態の見出し（明朝 20・白・2行まで）。見出しの段は呼ぶ側の文脈で決まるので `role="heading"` で出す */
function StateTitle({ text, level = 3 }: { text: string; level?: number }) {
    return (
        <p role="heading" aria-level={level} className="m-0 font-serif font-bold text-white line-clamp-2"
           style={{ fontSize: "20px", lineHeight: 1.35 }}>
            {text}
        </p>
    );
}

/** 状態の説明（15・text-2・折り返す） */
function StateMessage({ children }: { children: React.ReactNode }) {
    return <p className="m-0 text-text-2 break-words" style={{ fontSize: "15px", lineHeight: 1.6 }}>{children}</p>;
}

const LAYOUT = "flex flex-col items-center justify-center gap-3 text-center w-full p-6";

export type StateAction =
    | { label: string; href: string; onClick?: () => void }
    | { label: string; onClick: () => void; href?: undefined };

/**
 * 空の一手（写真の無い画面の主ボタン＝真鍮の塗り＋墨・**高さ 50**・`BTN_FILL`）。
 * 2026-10-30 束 0b C7・C17: 以前は 44 の独自の形。ボタンは主 50・副 44 の2種類だけ（iOS `JPHeight`）
 */
export const STATE_ACTION_CLASS =
    `inline-flex items-center justify-center ${BTN_FILL} bg-accent-fill text-ink hover:brightness-110 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
/** 失敗の「もう一度」（副ボタン 44・白14%の線・`BTN_LINE`） */
export const STATE_RETRY_CLASS =
    `inline-flex items-center justify-center ${BTN_LINE} hover:bg-white/10 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`;

export function EmptyState({ title, message, action, icon, headingLevel, className = "", testId = "state-empty" }: {
    title?: string;
    message: React.ReactNode;
    action?: StateAction;
    /** 画面の手がかりの絵（任意・灰で出す）。三角は使わない——0件は失敗ではない */
    icon?: React.ReactNode;
    headingLevel?: number;
    className?: string;
    testId?: string;
}) {
    return (
        <div className={`${LAYOUT} ${className}`} data-testid={testId}>
            {icon && <span aria-hidden="true" className="text-text-3">{icon}</span>}
            {title && <StateTitle text={title} level={headingLevel} />}
            <StateMessage>{message}</StateMessage>
            {action && (action.href !== undefined ? (
                <Link href={action.href} prefetch={false} onClick={action.onClick} className={`mt-1 ${STATE_ACTION_CLASS}`}
                      style={{ touchAction: "manipulation" }}>
                    {action.label}
                </Link>
            ) : (
                <button type="button" onClick={action.onClick} className={`mt-1 ${STATE_ACTION_CLASS}`}
                        style={{ touchAction: "manipulation" }}>
                    {action.label}
                </button>
            ))}
        </div>
    );
}

export function ErrorState({ title, message, onRetry, retryLabel, busy = false, locale = "ja", className = "", testId = "state-error", headingLevel }: {
    title?: string;
    /** 見出しの段（画面の題になるときは 1） */
    headingLevel?: number;
    message: React.ReactNode;
    /** 無ければ「もう一度試す」を出さない（勝手に取り直す画面など） */
    onRetry?: () => void;
    retryLabel?: string;
    /** 読み直している最中は押せない（続けて押すと古い答えが新しい答えを上書きする） */
    busy?: boolean;
    locale?: "ja" | "en";
    className?: string;
    testId?: string;
}) {
    return (
        <div className={`${LAYOUT} ${className}`} data-testid={testId}>
            <ExclamationTriangleIcon aria-hidden="true" className="text-text-3" style={{ width: "28px", height: "28px" }} />
            {title && <StateTitle text={title} level={headingLevel} />}
            <StateMessage>{message}</StateMessage>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={busy}
                    className={`mt-1 ${STATE_RETRY_CLASS}`}
                    style={{ touchAction: "manipulation" }}
                >
                    {retryLabel ?? (locale === "en" ? "Try again" : "もう一度試す")}
                </button>
            )}
        </div>
    );
}

/** 骨組みを出すまで待つ時間（ms）。これより早く読めたら何も出さない（ちらつかせない） */
export const LOADING_REVEAL_MS = 300;

/**
 * 読み込み中。`grid`: 写真の格子（3列・すき間 2px・6枚）＋2行の字。`rows`: 字の行だけ。
 * 読み上げは「読み込み中」1つ（骨組みの一つずつを読ませない）。
 * **光は流さない**（`animate-pulse` も付けない）——「視差効果を減らす」の人に止める手間を掛けない
 */
export function LoadingState({ kind = "grid", locale = "ja", className = "", testId = "state-loading", delayMs = LOADING_REVEAL_MS }: {
    kind?: "grid" | "rows";
    locale?: "ja" | "en";
    className?: string;
    testId?: string;
    delayMs?: number;
}) {
    const [revealed, setRevealed] = useState(delayMs <= 0);
    useEffect(() => {
        if (delayMs <= 0) return;
        const t = window.setTimeout(() => setRevealed(true), delayMs);
        return () => window.clearTimeout(t);
    }, [delayMs]);
    const bone = "bg-surface-4";
    return (
        <div role="status" className={`w-full ${className}`} data-testid={testId} data-revealed={revealed ? "true" : "false"}>
            <span className="sr-only">{locale === "en" ? "Loading" : "読み込み中"}</span>
            {revealed && (
                <div aria-hidden="true" className="flex flex-col gap-3 py-4" data-testid={`${testId}-bones`}>
                    {kind === "grid" && (
                        <div className="grid grid-cols-3 gap-[2px]">
                            {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${bone} aspect-square`} />)}
                        </div>
                    )}
                    <div className={`flex flex-col gap-2 ${kind === "grid" ? "px-4" : ""}`}>
                        <div className={`${bone} rounded`} style={{ width: "70%", height: "14px" }} />
                        <div className={`${bone} rounded`} style={{ width: "45%", height: "12px" }} />
                    </div>
                </div>
            )}
        </div>
    );
}
