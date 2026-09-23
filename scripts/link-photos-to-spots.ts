#!/usr/bin/env tsx
/**
 * 写真を撮影スポット台帳（`spot#<id>` 行）に**結び付ける前に、結果を見せる道具**。
 *
 *   tsx scripts/link-photos-to-spots.ts                 # 本番を読んで下見（書かない）
 *   tsx scripts/link-photos-to-spots.ts --from-json x.json  # 手元のデータで下見
 *   tsx scripts/link-photos-to-spots.ts --apply         # 確定ぶんだけ書き込む
 *
 * **既定は下見。** 一括変更の前に「どの写真が、どのスポットに、なぜ付くか」を
 * 全部出す。`--apply` を付けたときだけ書き込み、それも:
 *
 *   - **人が確認した記録がある写真にだけ** `spotId` を足す
 *     （`content/spot-links.json`。名称が一致しただけの写真は書かない）
 *   - **`location` は絶対に消さない**（`/location/*` は今までどおり生きる）
 *   - **既に `spotId` を持つ行は触らない**（`attribute_not_exists(spotId)`）
 *   - 公開・非公開の状態は一切変えない
 *
 * 判定そのものは `lib/utils/spots.ts` の `suggestSpotLinks` に一本化してある
 * （ここに写経しない。画面・アプリ・この道具が同じ規則で動く）。
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";
import type { Photo } from "../lib/data/photos";
import type { Spot } from "../lib/data/spots";
import { linkStates, isUsableConfirmation, type LinkSuggestion, type LinkVerdict } from "../lib/utils/spots";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";

/**
 * 人が確認した紐付けの記録。**`content/` に置く**
 * （`app/data/` はビルドが DynamoDB の内容で上書きする棚）。
 */
export const CONFIRMATIONS_PATH = "content/spot-links.json";

/** 記録を読む。**壊れている行は落とす**（確認者や根拠が空の行を信じない） */
export function loadConfirmations(path = CONFIRMATIONS_PATH): unknown[] {
    try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
        if (!Array.isArray(raw)) return [];
        const usable = raw.filter(isUsableConfirmation);
        if (usable.length !== raw.length) {
            console.warn(`${path}: 形の揃っていない記録を ${raw.length - usable.length} 件落としました`);
        }
        return usable;
    } catch {
        return [];
    }
}
const APPLY = process.argv.includes("--apply");
const fromJsonIndex = process.argv.indexOf("--from-json");
const FROM_JSON = fromJsonIndex >= 0 ? process.argv[fromJsonIndex + 1] : undefined;

/** 台帳の行の ID の頭（写真・コメント・通知と同じ単一テーブルに同居する） */
export const SPOT_ID_PREFIX = "spot#";

type Loaded = { photos: Photo[]; spots: Spot[] };

/** テーブル1回の Scan を、写真と台帳に仕分ける */
export function splitItems(items: Array<Record<string, unknown>>): Loaded {
    const photos: Photo[] = [];
    const spots: Spot[] = [];
    for (const item of items) {
        const id = typeof item.id === "string" ? item.id : "";
        if (id.startsWith(SPOT_ID_PREFIX)) {
            spots.push(item as unknown as Spot);
            continue;
        }
        // 写真の目印は `src`（マーカーや文書には無い）。sync-photos-from-ddb.js と同じ見方
        if (item.src) photos.push(item as unknown as Photo);
    }
    return { photos, spots };
}

async function loadFromDdb(table: string): Promise<Loaded> {
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    const items: Array<Record<string, unknown>> = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } =
            await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey as never }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return splitItems(items);
}

/** 下見の表（人が読む形）。**件数の要約も出す** */
export function formatPreview(suggestions: LinkSuggestion[]): string {
    const lines: string[] = [];
    const counts: Record<LinkVerdict, number> = { confirmed: 0, candidate: 0, ambiguous: 0, unlinked: 0 };
    const mark: Record<LinkVerdict, string> = {
        confirmed: "付ける", candidate: "確認待ち", ambiguous: "保留  ", unlinked: "対象外 ",
    };
    for (const s of suggestions) {
        counts[s.verdict]++;
        lines.push(`  [${mark[s.verdict]}] ${s.photoId}  「${s.location}」 → ${s.spotName ?? "—"}  （${s.reason}）`);
    }
    lines.push("");
    lines.push(`  付ける ${counts.confirmed} 件 / 確認待ち ${counts.candidate} 件 / `
        + `保留 ${counts.ambiguous} 件 / 対象外 ${counts.unlinked} 件`);
    lines.push("  **書き込むのは「付ける」だけ**——確認待ち・保留・対象外は未設定のまま残す");
    lines.push("  （撮影地の文字列はどれも消さない）");
    return lines.join("\n");
}

/**
 * 🔴 **書き込んでよい対象だけを通す関門。**
 *
 * owner の指示書 6:「単に警告メッセージを追加するだけでは不十分です。
 * **書き込み処理の側で、確認済みの対象以外は拒否してください**」。
 *
 * だから `--apply` の経路はこの関数を必ず通し、ここが返したものだけを書く。
 * 判定側（`linkStates`）が間違っても、ここで止まる（二重の守り）。
 */
export function writableLinks(suggestions: LinkSuggestion[]): LinkSuggestion[] {
    return suggestions.filter((s) => s.verdict === "confirmed" && !!s.spotId);
}

async function main(): Promise<void> {
    let loaded: Loaded;
    if (FROM_JSON) {
        const raw = JSON.parse(readFileSync(FROM_JSON, "utf8")) as Loaded;
        loaded = { photos: raw.photos ?? [], spots: raw.spots ?? [] };
        console.log(`手元のデータ: 写真 ${loaded.photos.length} 枚 / 台帳 ${loaded.spots.length} 件`);
    } else {
        const table = process.env.PHOTOS_TABLE;
        if (!table) {
            console.error("PHOTOS_TABLE が未設定です（例: PHOTOS_TABLE=prod-photo-gallery-photos）");
            process.exit(1);
        }
        loaded = await loadFromDdb(table);
        console.log(`${table}: 写真 ${loaded.photos.length} 枚 / 台帳 ${loaded.spots.length} 件`);
    }

    if (loaded.spots.length === 0) {
        console.log("\n台帳が空です。結び付けるものがありません（これは正常——Phase 1 は台帳を作るところまで）。");
    }

    // 人が確認した記録。**無ければ書き込む対象は0件になる**（それが正しい）
    const confirmations = loadConfirmations();
    console.log(`確認済みの記録: ${confirmations.length} 件（${CONFIRMATIONS_PATH}）`);
    const suggestions = linkStates(loaded.photos, loaded.spots, confirmations);
    console.log("");
    console.log(formatPreview(suggestions));

    if (!APPLY) {
        console.log("\n下見だけです。書き込むには --apply を付けてください。");
        return;
    }
    const table = process.env.PHOTOS_TABLE;
    if (!table || FROM_JSON) {
        console.error("--apply は本番/ステージングのテーブルにだけ使えます（--from-json とは併用できません）");
        process.exit(1);
    }
    // **関門を通す。** ここから下は `writable` しか見ない
    const writable = writableLinks(suggestions);
    if (writable.length === 0) {
        console.log("\n確認済みの紐付けがありません。書き込むものはありません。");
        console.log("（名称が一致しただけの候補は書きません——owner の指示書 6）");
        return;
    }
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    let written = 0;
    for (const s of writable) {
        if (!s.spotId) continue;
        try {
            await ddb.send(new UpdateCommand({
                TableName: table,
                Key: { id: s.photoId },
                UpdateExpression: "SET spotId = :sid, updatedAt = :now",
                // 既に紐づいている行は上書きしない（人が直したものを巻き戻さない）
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(spotId)",
                ExpressionAttributeValues: { ":sid": s.spotId, ":now": new Date().toISOString() },
            }));
            written++;
        } catch (err) {
            console.warn(`  飛ばしました ${s.photoId}: ${(err as Error).name}`);
        }
    }
    console.log(`\n${written} 件に spotId を付けました。撮影地の文字列は触っていません。`);
    console.log("書いたのは、人が確認した記録のあるものだけです。");
}

// 直接実行されたときだけ走らせる（テストからは関数だけ読む）
if (process.argv[1] && process.argv[1].endsWith("link-photos-to-spots.ts")) {
    main().catch((err) => { console.error(err); process.exit(1); });
}
