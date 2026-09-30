// lib/utils/placeName.ts
//
// **撮影地の文字列を「見出し」と「どこの」に分け、地域か具体的な場所かを見分ける**（表示専用）。
//
// 2026-09-30 のレビュー:
//   - 「フランス」「パリ」「フランス ヴェルサイユ」が同じ一覧に並び、地域と撮影スポットの違いが伝わらない
//   - 長い住所（「香川県 観音寺市 高屋神社」）がそのままカードの見出しになる
//
// ## 何をするか（データは1文字も変えない）
//
//   - 見出し = いちばん具体的な部分（「高屋神社」「ヴェルサイユ」「オペラ・ガルニエ」）
//   - どこの = その前後の地域（「香川県 観音寺市」「フランス」「パリ」）
//   - 種類   = 国・都道府県・市区町村（地域）か、それより狭い場所か
//
// URL・集約ページのスラッグ・保存済みの場所は**元の文字列のまま**（`collectEntries` の
// `slug`）。ここは画面の字面だけを変えるので、共有 URL も `/location/*` も壊れない。
//
// ## 地域の見分け方
//
// 国と都道府県は下の表、日本の市区町村は語尾（市・区・町・村・郡）、海外の都市と州は
// 撮影スポットの台帳（公開済み）に出てくる地域名の表（`OVERSEAS_AREAS`）で見る。
// **台帳に地域が増えたら表を足す**——`lib/utils/__tests__/placeName.test.ts` が
// 台帳の地域名がすべて表に入っていることを見張る。
//
// **推測で「撮影スポット」とは名乗らない。** 地域と分からなかったものは「場所」（種類 place）
// とするだけで、公式の撮影スポットだとは言わない（それは `spotId` の紐付けだけが言える）。

/** 国（台帳に出るもの＋よく書かれるもの） */
export const COUNTRIES: readonly string[] = [
    "日本", "フランス", "スペイン", "フィンランド", "イタリア", "ドイツ", "チェコ", "スイス", "ギリシャ", "イギリス", "オランダ", "ポルトガル", "クロアチア", "バチカン市国", "オーストリア", "アメリカ", "アメリカ合衆国", "カナダ", "メキシコ", "ブラジル", "ペルー", "オーストラリア", "ニュージーランド", "韓国", "台湾", "中国", "香港", "マカオ", "タイ", "ベトナム", "シンガポール", "マレーシア", "インドネシア", "フィリピン", "インド", "トルコ", "エジプト", "モロッコ", "アイスランド", "ノルウェー", "スウェーデン", "デンマーク", "ベルギー", "ポーランド", "ハンガリー", "アイルランド", "スコットランド",
];

/** 都道府県（語尾つき）。語尾なし（「東京」「大阪」「北海道」）も地域として見る */
export const PREFECTURES: readonly string[] = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** 海外の都市・州・県（台帳の公開済みの行の `region.city` / `region.prefecture`） */
export const OVERSEAS_AREAS: readonly string[] = [
    "アテネ", "アルベロベッロ", "アンダルシア州", "アンドル＝エ＝ロワール県", "アヴィニョン", "イル・ド・フランス", "イヴリーヌ県", "ウィーン", "エディンバラ", "エトルタ", "オード県", "カスティーリャ・イ・レオン州", "カスティーリャ＝ラ・マンチャ州", "カタルーニャ州", "カランバカ", "カルカソンヌ", "ガリシア州", "ガール県", "グラナダ", "ケルン", "コルドバ", "サンティアゴ・デ・コンポステーラ", "サン・マロ", "シエーナ", "シティ・オブ・ロンドン", "シャルトル", "シャンボール", "シュノンソー", "シュヴァンガウ", "シントラ", "スコットランド", "ストラスブール", "セゴビア", "セビリア", "セーヌ＝エ＝マルヌ県", "セーヌ＝マリティーム県", "チェスキー・クルムロフ", "トゥルク", "トスカーナ州", "トリカラ県", "トレド", "ドゥブロヴニク", "ドゥブロヴニク＝ネレトヴァ郡", "ニーウ・レッケルラント", "ニーダーエスターライヒ州", "ハイデルベルク", "バイエルン州", "バルセロナ", "バーデン＝ヴュルテンベルク州", "パリ", "ビルバオ", "ピサ", "フィレンツェ", "フォンテーヌブロー", "ブルターニュ地方", "プッリャ州", "プラハ", "プリトヴィツェ湖群市", "ヘルシンキ", "ベルリン", "ベルン州", "ポルト", "マドリード", "マンシュ県", "ミラノ", "メルク", "ラッピ県", "ランス", "リグーリア州", "リスボン", "ルツェルン", "ル・モン＝サン＝ミシェル", "ルーアン", "ロワール＝エ＝シェール県", "ロンドン", "ロンバルディア州", "ローマ", "ヴェネツィア", "ヴェネト州", "ヴェルサイユ", "ヴェローナ", "ヴォー州", "南ホラント州", "南ボヘミア州",
];

const COUNTRY_SET = new Set(COUNTRIES);
const PREF_SET = new Set([...PREFECTURES, ...PREFECTURES.map((p) => p.replace(/[都府県]$/, "")).filter((p) => p !== "北海")]);
const OVERSEAS_SET = new Set(OVERSEAS_AREAS);
/** 日本の市区町村の語尾。「山中湖」「高屋神社」は当たらない */
const MUNICIPALITY = /^[^\s]{1,8}(市|区|町|村|郡)$/;

export type PlaceKind = "country" | "prefecture" | "municipality" | "place";

export type PlaceParts = {
    /** 見出しにする部分（いちばん具体的なところ） */
    title: string;
    /** どこの（地域）。無ければ空 */
    context: string;
    /** 見出しの種類。`place` 以外は地域 */
    kind: PlaceKind;
};

export function areaKind(token: string): PlaceKind {
    const t = token.trim();
    if (COUNTRY_SET.has(t)) return "country";
    if (PREF_SET.has(t)) return "prefecture";
    if (OVERSEAS_SET.has(t) || MUNICIPALITY.test(t)) return "municipality";
    return "place";
}

/** 地域の広さ（小さいほど広い）。並べ替えで「どこの」を広い順に書く */
const BREADTH: Record<PlaceKind, number> = { country: 0, prefecture: 1, municipality: 2, place: 3 };

/**
 * 撮影地の文字列を分ける。
 *
 *     "香川県 観音寺市 高屋神社"   → 高屋神社 / 香川県 観音寺市 / place
 *     "フランス ヴェルサイユ"       → ヴェルサイユ / フランス / municipality
 *     "パリ, フランス"              → パリ / フランス / municipality
 *     "オペラ・ガルニエ（パリ）"    → オペラ・ガルニエ / パリ / place
 *     "フランス"                    → フランス / "" / country
 *     "山中湖"                      → 山中湖 / "" / place
 */
export function placeParts(label: string): PlaceParts {
    const raw = (label ?? "").trim();
    if (!raw) return { title: "", context: "", kind: "place" };
    // 「X（Y）」「X (Y)」: 括弧の中を「どこの」に
    const paren = raw.match(/^(.+?)\s*[（(]([^（）()]+)[）)]$/);
    if (paren) {
        const inner = placeParts(paren[1]);
        const ctx = [inner.context, paren[2].trim()].filter(Boolean).join(" ");
        return { title: inner.title, context: ctx, kind: inner.kind };
    }
    const tokens = raw.split(/[\s　,、，]+/).filter(Boolean);
    if (tokens.length === 1) return { title: tokens[0], context: "", kind: areaKind(tokens[0]) };
    const kinds = tokens.map(areaKind);
    const places = tokens.filter((_, i) => kinds[i] === "place");
    if (places.length > 0) {
        // 地域でない部分が見出し。地域の部分は広い順に「どこの」へ
        const areas = tokens.map((t, i) => ({ t, k: kinds[i], i })).filter((x) => x.k !== "place")
            .sort((a, b) => BREADTH[a.k] - BREADTH[b.k] || a.i - b.i).map((x) => x.t);
        return { title: places.join(" "), context: areas.join(" "), kind: "place" };
    }
    // 全部が地域: いちばん狭いものが見出し（同じ広さなら後ろ＝日本語の書き順で具体的な方）
    let best = 0;
    for (let i = 1; i < tokens.length; i++) {
        if (BREADTH[kinds[i]] >= BREADTH[kinds[best]]) best = i;
    }
    const rest = tokens.map((t, i) => ({ t, k: kinds[i], i })).filter((x) => x.i !== best)
        .sort((a, b) => BREADTH[a.k] - BREADTH[b.k] || a.i - b.i).map((x) => x.t);
    return { title: tokens[best], context: rest.join(" "), kind: kinds[best] };
}

/** 見出しが地域（国・都道府県・市区町村）か */
export function isAreaPlace(label: string): boolean {
    return placeParts(label).kind !== "place";
}

/**
 * カードの2行目の頭（枚数の前）。地域なら「地域・」、場所で地域が分かれば「香川県 観音寺市・」。
 * 分からなければ空（枚数だけ）
 */
export function placeLine(label: string, isJa = true): string {
    const p = placeParts(label);
    if (p.kind !== "place") return isJa ? "地域・" : "Area · ";
    return p.context ? `${p.context}${isJa ? "・" : " · "}` : "";
}
