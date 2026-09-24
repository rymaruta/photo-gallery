// lib/data/spots.ts
// 撮影スポットの台帳。**写真に書かれた撮影地の文字列とは別物**。
//
// ## 置き場は `content/`（`app/data/` ではない）
//
// 🔴 **`app/data/*.json` はビルドのたびに DynamoDB から作り直される**
// （`scripts/sync-photos-from-ddb.js` を `prepare-static-build.js` が呼ぶ）。
// 人が書いた台帳をあそこへ置くと**次のビルドで消える**。
// `content/` は誰も書き換えない——`content/spot-master.json`（ふりがな・概要）
// と同じ棚に置く。
//
// ## `/location/*` とは役割が違う（owner の指示書 5）
//
//   `/location/*`  写真の自由入力から作る**地域・撮影地の集約ページ**。
//                  鍵は撮影地のスラッグ。**これは引き続き維持する**
//   スポット        **個別地点**のマスタ。鍵は `spotId`。人が台帳に書く
//
// 「パリ」「フランス」は地域なので `spotId` を持たない。
// 「高屋神社」「オペラ・ガルニエ」は個別地点なので持つ。
// **同名異所は別 `spotId`**（集約ページは字の一致で寄せるので、
// そこが2つを分ける理由）。
//
// 既にあるもの / 無いものをはっきりさせておく:
//
//   `photo.location`   撮影者が打った文字列。実データ14種のうち、
//                      「東京」「フランス」「北海道」のような**地域**が大半で、
//                      個別の地点は「高屋神社」「国営ひたち海浜公園」
//                      「オペラ・ガルニエ（パリ）」「山中湖」の4つだけ
//   `photo.coords`     約1km に丸めた座標。**本番の公開30枚は0枚が保持**
//                      （2026-09-21 に app/data/photos.json で実測）。
//                      つまり**座標だけでスポットを決めることは今できない**
//
// 台帳はこの隙間を埋める:「地点そのもの」に ID・住所・地域・カテゴリを持たせ、
// 写真から **spotId** で指す。地名の綴りが揺れても、改名されても、
// 指し先は動かない。
export type SpotRegion = {
    /** 国名（日本語表記。例: 日本 / フランス） */
    country?: string;
    /** 都道府県・州・県相当（例: 香川県 / Île-de-France） */
    prefecture?: string;
    /** 市区町村（例: 観音寺市） */
    city?: string;
};

export type Spot = {
    /**
     * 台帳の鍵。**名前から作らない**（`sp_` + 12桁の16進）。
     *
     * 名前を鍵にすると (1) 同名異所を混ぜてしまう (2) 改名で鍵が変わる。
     * どちらも後から直せない壊れ方なので、最初から無意味な ID にする。
     */
    spotId: string;
    /**
     * URL に出る綴り。**作ったときに決めて、改名しても変えない**
     * （`/spots/takaya-jinja` を残したまま正式名だけ直せる）。
     */
    slug: string;
    /** 正式名（画面の見出し） */
    name: string;
    /** 読み（ふりがな） */
    reading?: string;
    /** 概要。**書かれたものだけを出す**（自動生成しない） */
    summary?: string;
    /** 別名・旧称・英語表記・撮影者が打ちがちな綴り */
    aliases?: string[];
    /** 住所（1行） */
    address?: string;
    region?: SpotRegion;
    /**
     * 公開してよい座標。**写真と同じ約1km精度**に丸める
     * （台帳の地点は公共の場所だが、精度を写真と揃えておくと
     * 「写真の座標から住所が割れた」と誤解されない）。
     */
    coords?: { lat: number; lng: number };
    /** 種別（神社 / 公園 / 山 …）。集約の軸に使う */
    category?: string;
    /** 代表写真。**公開写真の id** を1つだけ持つ */
    coverPhotoId?: string;
    /** 下書きは公開ページを作らない */
    status?: "draft" | "published";
    /** 人が確かめたか（未確認のまま出さない判断に使う） */
    verified?: boolean;

    // ── ここから公式ガイド（2026-09-23・owner の指示書 第4章）───────────
    //
    // **ユーザー投稿が0枚でも、この節だけでページが成立する**のが目的。
    // どれも任意——**確認できた項目だけ書く**。無い項目は画面に出さない
    // （`lib/utils/spotGuide.ts` が判断を1か所に持つ）。

    /** 英語名（海外から来た人向け・`alternateName` にも出す） */
    nameEn?: string;
    /** 詳しい概要。`summary` は1〜2行、こちらは段落 */
    description?: string;
    /** 見どころ。**箇条書き**（長文を1つにしない＝読み飛ばせる形にする） */
    highlights?: string[];
    /** 季節ごとの景色 */
    seasonalGuide?: { season: SpotSeason; text: string }[];
    /** 時間帯ごとの撮影の特徴 */
    timeOfDayGuide?: { time: SpotTimeOfDay; text: string }[];
    /** 代表的な構図・撮影のヒント。**事実ではなく運営のアドバイス** */
    compositionTips?: string[];
    /** 撮影時の注意（立入禁止・撮影制限・危険）。**出典が要る**（下） */
    safetyNotes?: string[];
    /** アクセス。**出典が要る** */
    access?: { transit?: string; car?: string; walk?: string };
    /**
     * 駐車場。**料金は持たない**——変わりやすく、間違えると実害が出る。
     * 金額を知りたい人は `officialWebsiteUrl` へ送る。
     */
    parking?: { available?: boolean; note?: string };
    /** 公式サイト（自治体・施設） */
    officialWebsiteUrl?: string;
    /**
     * 周辺スポット。**手で指定する**（`spotId` の配列）。
     * 座標からの導出（`nearbySpots()`）は補助として残すが、
     * 「近い＝関係がある」とは限らないので、出すのは手で選んだものだけ。
     */
    nearbySpotIds?: string[];
    /** 公式ガイド用の代表写真。**ユーザー投稿とは別管理**（下の型） */
    coverImage?: SpotCoverImage;
    /**
     * 項目ごとの出典と確認日。**変わりやすい情報はこれが無いと画面に出さない**
     * （owner:「未確認の営業時間、駐車料金、所要時間、交通規制、撮影制限などを
     * 推測で埋めないでください」）。人の注意力ではなく**表示側で機械的に**効かせる。
     */
    sources?: SpotSource[];
    /** 最終確認日（ISO）。`verified` の真偽を日付に格上げしたもの */
    verifiedAt?: string;

    createdAt: string;
    updatedAt: string;
};

/** 季節。画面の並び順もこの順 */
export type SpotSeason = "spring" | "summer" | "autumn" | "winter";
/** 時間帯。画面の並び順もこの順 */
export type SpotTimeOfDay = "dawn" | "morning" | "day" | "goldenHour" | "dusk" | "night";

/**
 * 出典と確認日。**どの項目の裏付けか**まで持つ。
 *
 * 1件のスポットに複数（アクセスは市の公式サイト、注意点は施設の掲示、など）。
 */
export type SpotSource = {
    /** 裏付ける項目名（`Spot` のキー。例: "access" / "parking" / "safetyNotes"） */
    field: string;
    url: string;
    /** 出典の名前（「観音寺市 公式サイト」） */
    title?: string;
    /** 確認した日（ISO の日付） */
    checkedAt: string;
};

/**
 * 公式ガイド用の代表写真。**ユーザー投稿の写真とは別に持つ。**
 *
 * owner の指示（第5章）:
 *   - 観光協会・自治体・Google マップ・SNS の写真を無断で複製しない
 *   - **出典 URL があることと、転載できることは別**
 *   - AI 生成の風景を「撮影スポットを記録した写真」として出さない
 *   - 利用できる写真が無いときは、**無関係な写真で埋めない**
 *
 * だから「どこから来て・誰のもので・どう使ってよいか」を**必須**にする。
 * `credit` か `checkedAt` が空の代表写真は、テストがビルドを落とす。
 */
export type SpotCoverImage = {
    /** 画像の在りか。**サイト内に置いたものだけ**（外部へのホットリンクはしない） */
    src: string;
    /** 代替テキスト（読み上げ・画像が出ないとき） */
    alt: string;
    /** 縦横比（幅÷高さ）。レイアウトのガタつきを防ぐ */
    aspectRatio?: number;
    /** 撮影者・権利者。**必須** */
    credit: string;
    /** 利用の根拠。**必須** */
    license: SpotImageLicense;
    /** どこで許諾・ライセンスを確認したか */
    sourceUrl?: string;
    /** 許諾の条件として画面に必ず出す文字（あれば） */
    requiredCreditText?: string;
    /** 確認した日（ISO）。**必須** */
    checkedAt: string;
    /**
     * **その写真がこのスポットのものだと確かめたか。**
     * 「写真がある」と「そこで撮った」は別（被写体と撮影位置は違いうる）。
     */
    verifiedPlace: boolean;
    /**
     * 利用者の投稿を採る場合の元の写真 ID。**描画時に公開状態を見る**
     * ——非公開にされた・消された写真を公式ガイドに出し続けない。
     */
    photoId?: string;
};

/**
 * 画像を出してよい根拠。
 *
 * `owner` 以外は**クレジットを画面に必ず出す**（`SpotCoverImage.credit`）。
 */
export type SpotImageLicense =
    | "owner"               // owner 本人が撮った
    | "permission-granted"  // 権利者から許諾を得た（`sourceUrl` にやり取りの記録）
    | "cc-by"
    | "cc-by-sa";

import spotsJson from "@/content/spots.json";

/**
 * 台帳の全件。**人が `content/spots.json` に書く**（機械は書かない）。
 *
 * ⚠️ **訂正（2026-09-23）。** #132 の時点では「`sync-photos-from-ddb.js` が
 * DynamoDB から書き出す」と書いてあったが、**あのスクリプトは1行も触られて
 * いない**（`git diff --name-only` で確認）。書く側が無いまま「機械が作る」と
 * 書いてあると、次に読む人が「なぜ空なのか」を探して迷う。
 *
 * **置き場は `content/`＝人が書く棚。** 更新は PR で、履歴がそのまま
 * 「誰がいつ確認したか」の記録になる（`docs/spot-guide-2026-09-23.md` §6）。
 *
 * 静的書き出し（`output: export`）なので、画面もアプリもこの JSON を読む
 * ——**スポットのために新しい API を呼ばない**。
 */
export const SPOTS: Spot[] = spotsJson as Spot[];
