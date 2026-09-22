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
 *   - `confirmed` の写真にだけ `spotId` を足す
 *   - **`location` は絶対に消さない**（`/location/*` は今までどおり生きる）
 *   - **既に `spotId` を持つ行は触らない**（`attribute_not_exists(spotId)`）
 *   - 公開・非公開の状態は一切変えない
 *
 * 判定そのものは `lib/utils/spots.ts` の `suggestSpotLinks` に一本化してある
 * （ここに写経しない。画面・アプリ・この道具が同じ規則で動く）。
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync, existsSync } from "node:fs";
import type { Photo } from "../lib/data/photos";
import type { Spot } from "../lib/data/spots";
import { suggestSpotLinks, selectApplicableLinks, type LinkSuggestion, type ConfirmedSpotLink, type ApplyRejection } from "../lib/utils/spots";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const APPLY = process.argv.includes("--apply");
/** 人が承認した紐付けの台帳。**書き込んでよいのはここに載っているものだけ** */
const LINKS_FILE = process.env.SPOT_LINKS_FILE ?? "content/spot-links.json";
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

/**
 * 下見の表（人が読む形）。**件数の要約も出す**。
 *
 * 🔴 **この表は「これから書かれるもの」ではない。** 名前が1件だけ一致した写真は
 * `review`＝**人が見て決める候補**で、ここに出たからといって書き込まれない。
 * 書かれるのは `content/spot-links.json` に人が承認を書いたものだけ。
 */
export function formatPreview(suggestions: LinkSuggestion[]): string {
    const lines: string[] = [];
    const counts = { review: 0, ambiguous: 0, unmatched: 0 };
    for (const s of suggestions) {
        counts[s.verdict]++;
        const mark = s.verdict === "review" ? "要確認" : s.verdict === "ambiguous" ? "曖昧  " : "対象外";
        lines.push(`  [${mark}] ${s.photoId}  「${s.location}」 → ${s.spotName ?? "—"}  （${s.reason}）`);
    }
    lines.push("");
    lines.push(`  要確認 ${counts.review} 件 / 曖昧 ${counts.ambiguous} 件 / 対象外 ${counts.unmatched} 件`);
    lines.push("  **どれも自動では書き込まない。** 人が確かめたものを content/spot-links.json に");
    lines.push("  書いてから --apply を打つ（撮影地の文字列はどれも消さない）");
    return lines.join("\n");
}

/** 人が承認した紐付けの台帳。無ければ空（＝何も書かない） */
export function loadConfirmedLinks(file: string): ConfirmedSpotLink[] {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error(`${file} は配列であるべきです`);
    return raw as ConfirmedSpotLink[];
}

/** 書き込みを断ったものを人が読む形に */
export function formatRejections(rejected: ApplyRejection[]): string {
    if (rejected.length === 0) return "  断ったものはありません";
    return rejected.map((r) => `  [断った] ${r.photoId} → ${r.spotId ?? "—"}  （${r.reason}）`).join("\n");
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

    const suggestions = suggestSpotLinks(loaded.photos, loaded.spots);
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
    // 🔴 **書き込む根拠は人の承認だけ。** 機械の候補（`suggestions`）は
    // ここでは使わない——名前が一致しただけの写真を書いていた頃の形に戻さない。
    const confirmed = loadConfirmedLinks(LINKS_FILE);
    if (confirmed.length === 0) {
        console.error(`${LINKS_FILE} に承認された紐付けがありません。`);
        console.error("上の「要確認」を人が確かめ、photoId / spotId / confirmedBy / confirmedAt / evidence を書いてください。");
        process.exit(1);
    }
    const { apply, rejected } = selectApplicableLinks(loaded.photos, loaded.spots, confirmed);
    console.log(`\n承認 ${confirmed.length} 件のうち、書けるのは ${apply.length} 件:`);
    console.log(formatRejections(rejected));

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    let written = 0;
    for (const c of apply) {
        try {
            await ddb.send(new UpdateCommand({
                TableName: table,
                Key: { id: c.photoId },
                // **誰がいつ何を根拠に決めたかも一緒に残す。** 付いている理由を
                // 辿れないと、間違いを見つけても直す手がかりが無い
                UpdateExpression: "SET spotId = :sid, spotLinkedBy = :by, spotLinkedAt = :at, spotLinkEvidence = :ev, updatedAt = :now",
                // 既に紐づいている行は上書きしない（人が直したものを巻き戻さない）
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(spotId)",
                ExpressionAttributeValues: {
                    ":sid": c.spotId, ":by": c.confirmedBy, ":at": c.confirmedAt,
                    ":ev": c.evidence, ":now": new Date().toISOString(),
                },
            }));
            written++;
        } catch (err) {
            console.warn(`  飛ばしました ${c.photoId}: ${(err as Error).name}`);
        }
    }
    console.log(`\n${written} 件に spotId を付けました。撮影地の文字列は触っていません。`);
}

// 直接実行されたときだけ走らせる（テストからは関数だけ読む）
if (process.argv[1] && process.argv[1].endsWith("link-photos-to-spots.ts")) {
    main().catch((err) => { console.error(err); process.exit(1); });
}
