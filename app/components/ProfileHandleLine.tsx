import React from "react";

/**
 * 名前の下の1行「@ユーザー名 · (線のピン) 居住地」（板 05c・05d・31・iOS の `ProfileHandleLine`）。
 *
 * 居住地（`homeLocation`）は公開プロフィールに前から載っていた（`toPublicProfile`）のに、
 * Web はどこにも出していなかった（2026-10-11 owner の決定で足す）。
 * 片方だけでも出す。両方無ければ何も描かない。
 */
export default function ProfileHandleLine({ username, homeLocation, locale, className = "" }: {
    username?: string;
    homeLocation?: string;
    locale: "ja" | "en";
    className?: string;
}) {
    const handle = username?.trim() ? `@${username.trim()}` : "";
    const home = homeLocation?.trim() ?? "";
    if (!handle && !home) return null;
    return (
        <p className={`text-sm text-white/50 truncate ${className}`} data-testid="profile-handle-line">
            {handle}
            {handle && home && <span aria-hidden="true"> · </span>}
            {home && (
                <>
                    {/* 線のピン（板の絵）。読み上げは「居住地」と言う */}
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-1px] mr-0.5">
                        <path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" />
                        <circle cx="12" cy="10" r="2.2" />
                    </svg>
                    <span className="sr-only">{locale === "en" ? "Based in " : "居住地 "}</span>
                    {home}
                </>
            )}
        </p>
    );
}
