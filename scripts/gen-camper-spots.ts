// scripts/gen-camper-spots.ts
//
// **とおまわり号の「スポットで撮る」部品が使う、台帳（`content/spots.json`）の小さな写し**を書き出す
// （2026-10-18 owner 承認の設計案 2.1・`api-user/src/camper.ts`）。
//
//   npx tsx scripts/gen-camper-spots.ts          # api-user/src/data/camperSpots.json を書き直す
//   npx tsx scripts/gen-camper-spots.ts --check  # 書き直さずに、いまのファイルと同じか確かめる
//
// 写しにするのは台帳が 8MB あるから（`gen-badge-ledger.ts` と同じ理由）。持つのは当たるスポットだけ:
//
//   - 森（forest）   … category「森林」「樹木」
//   - 水辺（water）  … category「海岸・湖沼・湖・滝・渓谷・渓流・峡谷・湿原・湧水・運河・池・湾・火口湖・岬・海峡」
//   - 祭り（festival）… category「祭り」
//   - 港（harbor）・自転車道（cycling）・焼き物の町（pottery）… **台帳の category に無いので、人が選んだ一覧**
//     （下の `CURATED`。名前は読む人のための控え。足す・外すときはここを直して書き直す）
//
// 2026-10-18 判断: 公開（published）と下書き（review）のどちらのスポットも入れる。写真の `spotId` は形だけ確かめて
// 保存される（`sanitizeSpotId`）ので、review のスポットを選んだ写真もありうる。設計案の候補（門司港レトロ・益子など）も
// review に居る。数（設計案は published だけで数えた: 森 44・水辺 約 540）は review の分だけ増える。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const CAMPER_SPOT_CLASSES = ["forest", "water", "harbor", "cycling", "pottery", "festival"] as const;
export type CamperSpotClass = (typeof CAMPER_SPOT_CLASSES)[number];

const BY_CATEGORY: Record<string, CamperSpotClass> = {
    森林: "forest", 樹木: "forest",
    海岸: "water", 湖沼: "water", 湖: "water", 滝: "water", 渓谷: "water", 渓流: "water", 峡谷: "water", 湿原: "water",
    湧水: "water", 運河: "water", 池: "water", 湾: "water", 火口湖: "water", 岬: "water", 海峡: "water",
    祭り: "festival",
};

/** 人が選んだ一覧（2026-10-18・名前・別名に「港」「しまなみ」「焼」などを含むスポットから選んだ。レビューで直してよい） */
export const CURATED: Record<"harbor" | "cycling" | "pottery", Record<string, string>> = {
    harbor: {
        sp_350f9317cee7: "氷見漁港",
        sp_cb870f9cd960: "三角西港",
        sp_b1319d5a87bc: "横浜港大さん橋 国際客船ターミナル",
        sp_2f43278876a7: "横浜赤レンガ倉庫（新港埠頭）",
        sp_957a614c8d95: "港の見える丘公園",
        sp_da12fa31d382: "旧堺燈台（堺旧港）",
        sp_85723aec6024: "鞆の浦（鞆港）",
        sp_c61421f3f248: "敦賀赤レンガ倉庫",
        sp_6317afd95694: "名古屋港水族館",
        sp_edbacca2c669: "千葉ポートタワー（千葉港）",
        sp_65bc7439255a: "水木しげるロード（境港）",
        sp_df6dbc0b0d5a: "神戸 メリケンパーク",
        sp_38ff5c9b2789: "門司港レトロ",
        sp_5817137fd9db: "御手洗の町並み（潮待ちの港）",
        sp_ac7a5bce5cd6: "那珂湊おさかな市場（那珂湊漁港）",
        sp_943d7b2e8599: "直島 赤かぼちゃ（宮浦港）",
        sp_868804e11fb4: "佐渡 小木のたらい舟（小木港）",
        sp_8449719d9319: "日間賀島（東港・西港）",
        sp_abe15797fce0: "岡村島（岡村港）",
        sp_c6f40677168b: "ニューハウン",
    },
    cycling: {
        sp_db4f3aba96a1: "来島海峡大橋（しまなみ海道）",
        sp_70f7774127a6: "多々羅大橋（しまなみ海道）",
        sp_ced657ce827b: "亀老山展望公園（しまなみ海道）",
        sp_abe15797fce0: "岡村島（とびしま海道）",
        sp_d38b34f0e44d: "蓬萊橋（歩行者と自転車専用の木橋）",
        sp_3287c9ff7efe: "旧草嶺トンネル（自転車道）",
    },
    pottery: {
        sp_efd4b4bd39af: "有田 陶山神社",
        sp_21367554ed20: "有田の町並み",
        sp_85abc158eade: "九州陶磁文化館（有田）",
        sp_ec73ef93be36: "大川内山（伊万里）",
        sp_25ca6db6a76f: "波佐見焼",
        sp_2ca214092ef1: "砥部焼",
        sp_5a015fefacc9: "益子の窯元と町並み",
        sp_7cc7e3722510: "常滑 やきもの散歩道",
        sp_bbb0a3932880: "備前焼の里 伊部",
        sp_f0e6542b74be: "越前陶芸村",
        sp_ee87995b90b5: "壺屋やちむん通り",
        sp_aa09679775e5: "デルフト",
    },
};

type LedgerSpot = {
    spotId?: unknown;
    category?: unknown;
    coords?: { lat?: unknown; lng?: unknown } | null;
};

export type CamperSpots = {
    classes: CamperSpotClass[];
    /** [spotId, 緯度, 経度（小数第3位）, 当たる区分のビット（`classes` の添字）] */
    spots: [string, number, number, number][];
};

export function buildCamperSpots(rows: LedgerSpot[]): CamperSpots {
    const classes = [...CAMPER_SPOT_CLASSES];
    const bit = (c: CamperSpotClass) => 1 << classes.indexOf(c);
    const spots: CamperSpots["spots"] = [];
    for (const s of rows) {
        const spotId = typeof s.spotId === "string" ? s.spotId : "";
        if (!/^sp_[0-9a-f]{12}$/.test(spotId)) continue;
        let mask = 0;
        const byCat = typeof s.category === "string" ? BY_CATEGORY[s.category.trim()] : undefined;
        if (byCat) mask |= bit(byCat);
        for (const k of ["harbor", "cycling", "pottery"] as const) if (CURATED[k][spotId]) mask |= bit(k);
        if (!mask) continue;
        const lat = Number(s.coords?.lat), lng = Number(s.coords?.lng);
        const ok = Number.isFinite(lat) && Number.isFinite(lng);
        spots.push([spotId, ok ? Math.round(lat * 1000) / 1000 : 999, ok ? Math.round(lng * 1000) / 1000 : 999, mask]);
    }
    spots.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { classes, spots };
}

function main() {
    const root = resolve(__dirname, "..");
    const rows = JSON.parse(readFileSync(resolve(root, "content/spots.json"), "utf8")) as LedgerSpot[];
    const out = resolve(root, "api-user/src/data/camperSpots.json");
    const json = JSON.stringify(buildCamperSpots(rows)) + "\n";
    if (process.argv.includes("--check")) {
        let cur = "";
        try { cur = readFileSync(out, "utf8"); } catch { /* 無ければ違う扱い */ }
        if (cur !== json) {
            console.log("[camper-spots] 写しが古くなっています。npx tsx scripts/gen-camper-spots.ts で書き直せます");
            process.exit(1);
        }
        console.log("[camper-spots] 写しは最新です");
        return;
    }
    writeFileSync(out, json);
    const led = JSON.parse(json) as CamperSpots;
    console.log(`[camper-spots] ${out}: スポット ${led.spots.length} 件・${Buffer.byteLength(json)} バイト`);
}

if (require.main === module) main();
