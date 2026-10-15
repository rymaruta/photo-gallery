// 訪れた国・地域（iOS の `Core/Text/VisitedCountries.swift` と同じ表・同じ当て方）。
//
// ## なぜ「撮影地の異なり数」ではないのか
//
// 撮影地は**自由入力の文字列**で、国の欄は無い。異なり数を数えると
// 「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」が3つになり、
// **国の数とは言えない**。だから、撮影地の中に**国・地域の名前が
// 書かれているときだけ**数える。
//
// ## 数えないものは数えない
//
// 「山中湖」から日本を、「バルセロナ」からスペインを**推測しない**。
// 地名から国を当てる辞書を持っていないし、当て損なうと**書いていない国が
// 実績として並ぶ**。数を増やしたい人は撮影地に国名を足せばよい
// ——それは `/location/*` を厚くする動き（SEO）とも同じ向き。
//
// 🔴 **iOS と同じ数を出す。** 表と当て方（長い名前から・小文字にして含むか）を
// 変えるときは iOS 側も一緒に。マイページの「◯か国・地域」が Web とアプリで
// 割れると、どちらかが嘘に見える。

/**
 * 国・地域の名前（日本語 → 英語の小文字）。**書かれていれば当たる**だけの表で、
 * 地名から国を当てるものではない。**同じ国を2行に書かない**（二重に数える）。
 */
export const COUNTRY_TABLE: ReadonlyArray<{ ja: string; en: string }> = [
    { ja: "日本", en: "japan" }, { ja: "フランス", en: "france" }, { ja: "スペイン", en: "spain" },
    { ja: "ギリシャ", en: "greece" }, { ja: "イタリア", en: "italy" }, { ja: "フィンランド", en: "finland" },
    { ja: "アイスランド", en: "iceland" }, { ja: "ニュージーランド", en: "new zealand" },
    { ja: "クロアチア", en: "croatia" }, { ja: "ボリビア", en: "bolivia" }, { ja: "ペルー", en: "peru" },
    { ja: "アメリカ", en: "united states" }, { ja: "カナダ", en: "canada" }, { ja: "メキシコ", en: "mexico" },
    { ja: "イギリス", en: "united kingdom" }, { ja: "ドイツ", en: "germany" }, { ja: "スイス", en: "switzerland" },
    { ja: "オーストリア", en: "austria" }, { ja: "オランダ", en: "netherlands" }, { ja: "ベルギー", en: "belgium" },
    { ja: "ポルトガル", en: "portugal" }, { ja: "ノルウェー", en: "norway" }, { ja: "スウェーデン", en: "sweden" },
    { ja: "デンマーク", en: "denmark" }, { ja: "アイルランド", en: "ireland" }, { ja: "ポーランド", en: "poland" },
    { ja: "チェコ", en: "czechia" }, { ja: "ハンガリー", en: "hungary" }, { ja: "トルコ", en: "turkey" },
    { ja: "モロッコ", en: "morocco" }, { ja: "エジプト", en: "egypt" }, { ja: "南アフリカ", en: "south africa" },
    { ja: "ケニア", en: "kenya" }, { ja: "インド", en: "india" }, { ja: "ネパール", en: "nepal" },
    { ja: "タイ", en: "thailand" }, { ja: "ベトナム", en: "vietnam" }, { ja: "カンボジア", en: "cambodia" },
    { ja: "インドネシア", en: "indonesia" }, { ja: "マレーシア", en: "malaysia" },
    { ja: "シンガポール", en: "singapore" }, { ja: "フィリピン", en: "philippines" },
    { ja: "韓国", en: "south korea" }, { ja: "台湾", en: "taiwan" }, { ja: "中国", en: "china" },
    { ja: "香港", en: "hong kong" }, { ja: "モンゴル", en: "mongolia" },
    { ja: "オーストラリア", en: "australia" }, { ja: "フィジー", en: "fiji" },
    { ja: "ブラジル", en: "brazil" }, { ja: "アルゼンチン", en: "argentina" }, { ja: "チリ", en: "chile" },
    { ja: "キューバ", en: "cuba" }, { ja: "アラブ首長国連邦", en: "united arab emirates" },
];

/**
 * **長い名前から見る**（表の並び順ではなく）。「南アフリカ」が短い語に
 * 引っぱられないように。長さは日本語・英語の長い方（iOS の `Character` 数と
 * 同じになるよう、コードポイントで数える）。同じ長さは表の順（安定ソート）
 */
const BY_LENGTH = [...COUNTRY_TABLE].sort(
    (a, b) => Math.max([...b.ja].length, [...b.en].length) - Math.max([...a.ja].length, [...a.en].length),
);

function fold(value: string): string {
    return value.toLowerCase().replace(/　/g, " ");
}

/** その文字列に書かれている国・地域（最初に当たった1つ・日本語名）。無ければ null */
export function countryIn(text: string | null | undefined): string | null {
    const folded = fold(typeof text === "string" ? text : "");
    if (!folded) return null;
    for (const entry of BY_LENGTH) {
        if (folded.includes(entry.ja) || folded.includes(entry.en)) return entry.ja;
    }
    return null;
}

/** 写真に書かれている国・地域の数（**同じ国は1つ**）。見るのは撮影地の文字列だけ */
export function visitedCountryCount(photos: ReadonlyArray<{ location?: unknown }>): number {
    const found = new Set<string>();
    for (const p of photos) {
        const name = countryIn(typeof p.location === "string" ? p.location : "");
        if (name) found.add(name);
    }
    return found.size;
}
