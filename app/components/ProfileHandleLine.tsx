import React from "react";

/**
 * 名前の下の1行「@ユーザー名 · (線のピン) 居住地」（板 05c・05d・31・iOS の `ProfileHandleLine`）。
 *
 * 居住地（`homeLocation`）は公開プロフィールに前から載っていた（`toPublicProfile`）のに、
 * Web はどこにも出していなかった（2026-10-11 owner の決定で足す）。
 * 片方だけでも出す。両方無ければ何も描かない。
 *
 * 2026-10-11 判断: 1行に詰めて末尾を切る（`truncate`）のをやめ、**入らなければ居住地を次の行に回す**。
 * 自分のページは名前の行の右に「プロフィールを編集」が在り、390px で「京都府 …」と居住地が切れていた。
 * @名と居住地はそれぞれ1かたまり（長すぎるときだけそれぞれの末尾を切る）。
 * 区切りの「·」は居住地の頭に付け、行の頭に来たときは外の枠で隠す（左へ 0.75rem ずらして
 * はみ出した分を `overflow-hidden` で切る。行の頭の項目の「·」だけがその隠れる所に入る）。
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
    // 行の頭の「·」を隠すための、項目の頭の区切り（幅 0.75rem）。読み上げには出さない（`/ ''` の代わりの文）
    const SEP = "before:content-['·'_/_''] before:inline-block before:w-3 before:text-center";
    return (
        <div className={`overflow-hidden ${className}`}>
            <p className="-ml-3 flex flex-wrap text-sm text-white/50" data-testid="profile-handle-line">
                {handle && <span className={`${SEP} max-w-full truncate`} data-testid="profile-handle">{handle}</span>}
                {home && (
                    <span className={`${SEP} max-w-full truncate`} data-testid="profile-home">
                        {/* 線のピン（板の絵）。読み上げは「居住地」と言う */}
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-1px] ml-0.5 mr-0.5">
                            <path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" />
                            <circle cx="12" cy="10" r="2.2" />
                        </svg>
                        <span className="sr-only">{locale === "en" ? "Based in " : "居住地 "}</span>
                        {home}
                    </span>
                )}
            </p>
        </div>
    );
}
