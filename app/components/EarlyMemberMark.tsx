/**
 * 初期メンバーの印（名前の横の真鍮の盾＋墨の星・2026-10-28 owner の決定）。
 *
 * **出すかどうかはサーバーが決める**（応答の `earlyMark`・`api-user/src/badgeKeys.ts` の
 * `showsEarlyMark`）。資格は初期ユーザー章で、既定で付き、本人が外せる。既定で出るのは
 * 名前の横に公式・Pro の印・選んだメダルのどれも出ていない人だけ。
 *
 * 形は公式の封印（`VerifiedBadge`）と同じ「単色の真鍮 ＋ 墨のアイコン」。公式（封印）・
 * Pro（丸）と**輪郭で見分ける**ために盾にした（名前を伏せた比べで 16px でも取り違えなかった）。
 */
const SHIELD = "M12 0.9L21.1 4Q21.8 4.2 21.8 5V11.2Q21.8 18.9 12.35 23Q12 23.15 11.65 23Q2.2 18.9 2.2 11.2V5Q2.2 4.2 2.9 4Z";
// 星は盾の見た目の中央に合わせて 0.5 上げてある（盾は下が尖るぶん、重心が上にある）
const STAR = "M11.8 5.46Q12 4.95 12.2 5.46L13.57 9.01Q13.76 9.52 14.31 9.55L18.11 9.76Q18.66 9.79 18.23 10.13L15.28 12.53Q14.85 12.88 14.99 13.41L15.97 17.08Q16.11 17.61 15.65 17.31L12.46 15.25Q12 14.95 11.54 15.25L8.35 17.31Q7.89 17.61 8.03 17.08L9.01 13.41Q9.15 12.88 8.72 12.53L5.77 10.13Q5.34 9.79 5.89 9.76L9.69 9.55Q10.24 9.52 10.43 9.01Z";

export function earlyMarkLabel(locale: string): string {
    return locale === "en" ? "Early member" : "初期からのメンバー";
}

export default function EarlyMemberMark({ shown, size = 18, locale = "ja" }: {
    shown?: boolean;
    size?: number;
    locale?: string;
}) {
    if (shown !== true) return null;
    const label = earlyMarkLabel(locale);
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            role="img"
            aria-label={label}
            className="shrink-0"
            data-testid="early-mark"
        >
            <title>{label}</title>
            <path d={SHIELD} fill="#C9A66B" />
            <path d={STAR} fill="#1A140A" />
        </svg>
    );
}
