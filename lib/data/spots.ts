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
    createdAt: string;
    updatedAt: string;
};

import spotsJson from "@/content/spots.json";

/**
 * 台帳の全件。**ビルド時に DynamoDB から書き出した JSON**
 * （`scripts/sync-photos-from-ddb.js` が写真と同じ1回の Scan で作る）。
 *
 * 静的書き出し（`output: export`）なので、画面もアプリもこの JSON を読む
 * ——**スポットのために新しい API を呼ばない**。
 */
export const SPOTS: Spot[] = spotsJson as Spot[];
