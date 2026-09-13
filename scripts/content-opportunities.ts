#!/usr/bin/env tsx
/**
 * **どこを直すと「検索に出せるページ」が増えるか**を本番データで数える（読み取り専用）。
 *
 * このサイトの検索での面積は、サイトマップに載る件数そのもの
 * （CLAUDE.md: 「この 50 が検索での面積」）。写真を増やす以外に面積を増やす道は
 * **集約ページを線の上に押し上げること**で、線は種別で違う
 * （タグ・カテゴリ・機材は3枚、撮影地だけ2枚）。
 *
 * いちばん効くのは「**あと1枚**」——1枚の写真にタグや撮影地を足すだけで、
 * ページ1枚が丸ごと検索に出せるようになる。実データ（30枚）で **17ページ**が
 * その状態だった。
 *
 * **手で数えない。** 撮影地は `photosInCollection` が緩い一致で束ねるので、
 * 完全一致で数えると「全部 noindex」に見えて結論を誤る（実際に一度誤った）。
 * この道具は**リポジトリ本体の関数**（`collectEntries` / `isIndexableCollection`）を
 * そのまま呼ぶ。
 *
 * 読むのは DynamoDB（`app/data/photos.json` はコミットされた古い断面で、
 * 派生もタグの最新も持たない）。**Scan だけ・書き込みはしない。**
 *
 * 使い方: Actions → Maintenance → task=content-opportunities
 *   環境変数: PHOTOS_TABLE（必須）/ AWS_REGION
 */
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { Photo } from "../lib/data/photos";
import { contentOpportunities } from "../lib/utils/contentOpportunities";

const TABLE = process.env.PHOTOS_TABLE;
if (!TABLE) {
    console.error("PHOTOS_TABLE が未設定です（本番値へのフォールバックは置かない方針）");
    process.exit(1);
}
const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || "ap-northeast-1" });

async function loadPhotos(): Promise<Photo[]> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }));
        for (const it of res.Items ?? []) items.push(unmarshall(it));
        lastKey = res.LastEvaluatedKey as never;
    } while (lastKey);
    // テーブルには like#/notifs#/comments# などが同居する。写真は `src` を持つ
    return items.filter((i) => typeof i.src === "string" && i.story !== true) as unknown as Photo[];
}

function main(photos: Photo[]): void {
    const r = contentOpportunities(photos);
    console.log(`公開写真 ${r.published}枚`);
    console.log(`  撮影地が空        ${r.photosWithoutLocation}枚  ← /map と /location/* に出ない`);
    // **数だけ出しても「N枚ある」で終わる。** 行き先は本人のタグに
    // 書いてあることが多いので、同じタグを共有する塊にして並べる
    for (const g of r.missingLocation) {
        console.log(g.sharedTag
            ? `    「${g.sharedTag}」を持つ ${g.photos.length}枚:`
            : `    共通のタグが無い ${g.photos.length}枚:`);
        for (const ph of g.photos) {
            // **日本語に padEnd は効かない**（全角1文字を1と数えるので揃わない）。区切りで出す
            console.log(`      ${ph.title || "(無題)"} — ${ph.tags.join(" / ")}`);
        }
    }
    console.log(`  説明が100字未満   ${r.photosWithShortDescription}枚  ← 検索結果のスニペットが痩せる`);
    console.log("");
    console.log("集約ページ（検索に載る / 全部）");
    for (const t of ["location", "tag", "category", "camera"] as const) {
        console.log(`  ${t.padEnd(9)} ${String(r.indexable[t]).padStart(3)} / ${r.total[t]}`);
    }
    const now = Object.values(r.indexable).reduce((a, b) => a + b, 0);
    console.log("");
    if (r.almost.length === 0) {
        console.log("あと1枚で検索に載るページはありません。");
        return;
    }
    console.log(`**あと1枚で検索に載るページ: ${r.almost.length}**`);
    console.log(`  全部埋めると集約ページは ${now} → ${now + r.almost.length} に増える`);
    console.log("  （撮影地は線が2枚でいちばん安いので上に出している）");
    for (const o of r.almost) {
        console.log(`  ${o.type.padEnd(9)} ${o.label}  いま${o.count}枚`);
    }
    console.log("");
    console.log("直し方: その集約に入る写真をもう1枚作る（同じタグを付ける／同じ撮影地を入れる）。");
    console.log("        撮影地が空の写真に地名を入れると、撮影地のページが一度に動くことが多い。");
}

void loadPhotos().then(main).catch((e) => {
    console.error("読み取りに失敗しました:", e);
    process.exit(1);
});

export { main };
