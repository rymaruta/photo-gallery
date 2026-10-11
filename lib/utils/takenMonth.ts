// lib/utils/takenMonth.ts
//
// **作例が撮られた月**（2026-10-11・撮影地ページの「作例」の節の末尾）。
//
// 作例（Wikimedia Commons・Flickr など）の撮影日時 `takenAt` は出どころの書き方のまま
// （"2016-10-14 13:41:43"・"2011年9月20日"・"Taken on 18 August 2010"・"17 August 2007 (according to Exif data)" …）。
// ここから**月が確かに読めるものだけ**を数える。年だけ（"2003"）・"Unknown date"・幅のある書き方
// （"circa"・"between"・"〜"・"頃"・"…より前"）は数えない——推測の月を事実として出さない。
//
// Flickr の「撮影日不明（takenunknown）＝アップロード日」について（2026-10-11 に確かめた）:
//   - Flickr から直接載せた作例（`source.name === "Flickr"`・21枚）は撮影日を持たない＝数えない
//   - Commons に転載された Flickr の写真の日付は Commons の `DateTimeOriginal` で、`collect-commons-samples.mjs` は
//     「アップロード」と書かれたものだけ外す（`plainDate`）。takenunknown かどうかは Commons の値からも
//     台帳からも見分けられない（Flickr の API を引いていない）。混ざりうることを承知で数えている

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_NAME = MONTHS_EN.join("|");

/** 撮影日時の文字から月（1〜12）。読めなければ null */
export function takenMonth(takenAt: string | undefined | null): number | null {
    const s = (takenAt ?? "").trim();
    if (!s) return null;
    // 幅・推定の書き方は数えない
    if (/circa|\bca\.|\bc\.\s*\d|between|before|after|around|unknown|\bor\b|[?〜~]|頃|ごろ|以前|以降|より前|より後|まで/i.test(s)) return null;
    let m: number | null = null;
    let hit: RegExpExecArray | null;
    if ((hit = /^(?:taken on\s+)?(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?=[ T,(]|$)/i.exec(s))) {
        // "2006-10"・"2016-10-14 13:41"・"2018/03/21"・"2008-04-28(JST)"。年が先の形だけ（"04-10-2025"・"11/01/2009" は
        // 日と月の順が決まらないので数えない）。"2010-2012"（年の幅）は区切りの先読みで外れる
        m = Number(hit[2]);
    } else if ((hit = /^(\d{4})年(\d{1,2})月/.exec(s))) {
        m = Number(hit[2]);
    } else if ((hit = new RegExp(`^(?:taken on\\s+)?(?:\\d{1,2}\\s+)?(${MONTH_NAME})\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\b`, "i").exec(s))) {
        // "Taken on 18 August 2010"・"17 August 2007 (according to Exif data)"・"August 18, 2010"・"August 2010"
        m = MONTHS_EN.indexOf(hit[1].toLowerCase()) + 1;
    }
    return m !== null && m >= 1 && m <= 12 ? m : null;
}

/** 月ごとの枚数（多い順・同じ枚数は月の順）と、月の読めた枚数 */
export function takenMonthCounts(list: readonly { takenAt?: string }[]): { counts: Array<{ month: number; count: number }>; dated: number } {
    const by = new Map<number, number>();
    for (const x of list) {
        const m = takenMonth(x.takenAt);
        if (m !== null) by.set(m, (by.get(m) ?? 0) + 1);
    }
    const counts = [...by.entries()].map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month - b.month);
    return { counts, dated: counts.reduce((n, c) => n + c.count, 0) };
}

const MONTH_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 節の末尾の1行。「作例が撮られた月（撮影日の分かる5枚）: 4月 2枚・8月 1枚・10月 2枚」。
 * 月の読める作例が無ければ null（行ごと出さない）
 */
export function takenMonthLine(list: readonly { takenAt?: string }[], isJa = true): string | null {
    const { counts, dated } = takenMonthCounts(list);
    if (dated === 0) return null;
    const items = counts.map((c) => isJa ? `${c.month}月 ${c.count}枚` : `${MONTH_SHORT_EN[c.month - 1]} ${c.count}`);
    return isJa
        ? `作例が撮られた月（撮影日の分かる${dated}枚）: ${items.join("・")}`
        : `Months the example photos were taken (${dated} with a known date): ${items.join(", ")}`;
}
