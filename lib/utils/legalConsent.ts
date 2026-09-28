/**
 * **規約への同意の記録**（iOS の `LegalConsent.swift` と同じ形）。
 *
 * 利用者が作った内容を載せるサービスは、「不適切な内容を許さない」ことを含む
 * 規約に**使う前に同意させる**（App Store のガイドライン 1.2。iOS はこのために
 * 「はじめる前に」の画面を持つ）。Web は見るだけならログイン不要なので、
 * **ログインした人にだけ**、最初に一度出す（owner の決定 2026-09-27・案A）。
 *
 * **記録は端末の中だけ**（iOS も `UserDefaults`）。API は変えない。
 * 別の端末・ブラウザでは、そこで初めてログインしたときにもう一度出る。
 */

/** 規約を変えたら上げる。上げると全員にもう一度出る（iOS の `currentVersion` と揃える） */
export const LEGAL_CONSENT_VERSION = 1;

/** iOS の `UserDefaults` のキーと同じ名前 */
export const LEGAL_CONSENT_KEY = "legal.consent.version";

/**
 * 同意済みの版。読めないとき（プライベートブラウズ・保存の拒否）は 0。
 * **読めないなら「未同意」に倒す**——同意の画面は押せば閉じるので、
 * 誤って出す害は小さい。誤って出さない方が、同意を取らないまま使わせる。
 */
export function acceptedLegalVersion(): number {
    try {
        const v = Number(window.localStorage.getItem(LEGAL_CONSENT_KEY));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch {
        return 0;
    }
}

export function needsLegalConsent(required: number = LEGAL_CONSENT_VERSION): boolean {
    return acceptedLegalVersion() < required;
}

/**
 * 同意を記録する。**書けなくても閉じる**（戻り値 false）——書けない端末で
 * 画面から出られなくなると、サイトが丸ごと使えなくなる。その場合は
 * 次に開いたときにもう一度出る。
 */
export function acceptLegalConsent(version: number = LEGAL_CONSENT_VERSION): boolean {
    try {
        window.localStorage.setItem(LEGAL_CONSENT_KEY, String(version));
        return true;
    } catch {
        return false;
    }
}
