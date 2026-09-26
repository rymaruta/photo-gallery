/**
 * 認証済みの印（名前の横の真鍮の封印・アーティファクトの板 08・A）。
 *
 * **立っている人にだけ出す。** 立てられるのは運営だけ（本人からは立てられない。
 * `api-user/src/userProfile.ts` の `verified`・`scripts/set-verified.js`）。
 *
 * 形はアプリ（`checkmark.seal.fill` を墨と真鍮の2色）と揃える: 真鍮の12山の封印に
 * 墨のチェック。撮影スポットの真鍮の丸とは封印の山で見分ける。
 */

// 12山の封印（外 11.5・内 9.6。板 08 と同じ点）
const SEAL_POINTS = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 === 0 ? 11.5 : 9.6;
    const a = (Math.PI * i) / 12 - Math.PI / 2;
    return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
}).join(" ");

export default function VerifiedBadge({ verified, size = 18, locale = "ja" }: {
    verified?: boolean;
    size?: number;
    locale?: string;
}) {
    if (verified !== true) return null;
    const label = locale === "en" ? "Verified" : "認証済み";
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            role="img"
            aria-label={label}
            className="shrink-0"
            data-testid="verified-badge"
        >
            <title>{label}</title>
            <polygon points={SEAL_POINTS} fill="#C9A66B" />
            <path d="M7.2 12.4l3.1 3.1 6.5-6.7" fill="none" stroke="#1A140A" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
