#!/usr/bin/env tsx
/**
 * **公開範囲を絞った写真で、実体が `uploads/` に残っているものを `private/` へ移す**
 * （`docs/restricted-image-delivery.md` の案A・署名を入れる前の片付け）。
 *
 * ## なぜ要るのか（2026-10-18 判断）
 *
 * `/private/*` を署名必須にしても、**`uploads/` に残った絞った写真は署名なしで取れたまま**。
 * 残りうる行は2種類ある:
 *
 *  - 2026-09-28 に IAM（`s3:GetObject`・`private/*` の `s3:PutObject`）を足す前に、
 *    あとから絞った写真（そのころ移動は必ず AccessDenied で、公開範囲の変更ごと断っていたが、
 *    それより前の行は確かめていない）
 *  - 投稿のとき最初から絞った写真を `private/` へ移すようになる前（`upload.ts`）に上げたもの
 *
 * 件数は本番を読めないので**確かめていない**。下見（既定）はそれを数えるだけ。
 *
 * ## 何を使い回すか
 *
 *  - 計画: `planMove`（`api-user/src/privateMove.ts`。`MEDIA_FIELDS` と `extraImages` を全部）
 *  - 順番: `photoUpdate.ts` と同じ **コピー（`copyAll`）→ 行を書き換え → 最後に元を消す
 *    （`dropUnusedKeys`）**。逆だと途中で落ちたときに行が存在しない実体を指す
 *  - 元を消すと `s3DeleteMany` が**エッジの無効化まで**行く（1年で配っているので、消すだけでは
 *    古い URL が取れ続ける）。自分のほかの行が使っている実体は消さない（`storyKeep` の共有など）
 *
 * ## やらないこと
 *
 *  - **ストーリーは移さない**（`story: true`）。置き場を変えるのは第2段（札 #294）で、
 *    ストーリーの読み手（`getStories` など）はまだ署名しない——今移すと割れる
 *  - 公開の写真には触らない（`audience` の無い行）
 *
 * 使い方（Maintenance の `move-restricted-to-private` / `-staging` から流す）:
 *
 *     npx tsx scripts/move-restricted-to-private.ts            # 下見（件数を出すだけ）
 *     npx tsx scripts/move-restricted-to-private.ts --apply    # 移す
 *
 * 環境変数: PHOTOS_TABLE・UPLOAD_BUCKET（必須）、CLOUDFRONT_DISTRIBUTION_ID（`--apply` では必須）
 */
import { planMove, type Move } from "../api-user/src/privateMove";

/**
 * 公開範囲を絞った行か。`api/src/photos.ts` の `isRestricted` と同じ線
 * ——**知らない値でも絞った側に倒す**（綴りの違う行を公開の置き場に残さない）。
 */
export function isRestrictedRow(item: Record<string, unknown>): boolean {
    const a = item.audience;
    return typeof a === "string" ? a.trim() !== "" : a != null;
}

export type BackfillEntry = {
    id: string;
    userId: string;
    moves: Move[];
    rewritten: Record<string, unknown>;
};

export type BackfillPlan = {
    /** 絞った写真の行（ストーリーを除く） */
    restricted: number;
    /** `uploads/` に実体が残っていて、移す行 */
    entries: BackfillEntry[];
    /** 移す実体の数（派生・2枚目以降を含む） */
    objects: number;
    /** 飛ばした行（ストーリー・持ち主の分からない行）。理由ごとの数 */
    skipped: { story: number; noOwner: number };
};

/** 移す計画を立てる（**純関数**。S3 も DynamoDB も触らない） */
export function planBackfill(items: Record<string, unknown>[]): BackfillPlan {
    const plan: BackfillPlan = { restricted: 0, entries: [], objects: 0, skipped: { story: 0, noOwner: 0 } };
    for (const item of items) {
        if (!isRestrictedRow(item)) continue;
        if (item.story === true) { plan.skipped.story++; continue; }
        plan.restricted++;
        const { moves, rewritten } = planMove(item, true);
        if (moves.length === 0) continue;   // もう `private/` に在る
        // 元を消すとき「自分のほかの行が使っていないか」を持ち主で引く（`dropUnusedKeys`）。
        // 持ち主が分からない行は、消してよいかを確かめられないので移さない
        if (typeof item.userId !== "string" || !item.userId || typeof item.id !== "string") {
            plan.skipped.noOwner++;
            continue;
        }
        plan.entries.push({ id: item.id, userId: item.userId, moves, rewritten });
        plan.objects += moves.length;
    }
    return plan;
}

/** 行の書き換え（移した先の URL を SET）。**同じ更新で全部**書く（分けると間で落ちたときにちぐはぐ） */
export function rewriteUpdate(entry: BackfillEntry) {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    Object.entries(entry.rewritten).forEach(([field, value], n) => {
        names[`#mv${n}`] = field;
        values[`:mv${n}`] = value;
        sets.push(`#mv${n} = :mv${n}`);
    });
    return {
        Key: { id: entry.id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // 行が消えていたら作らない（UpdateItem はキーが無ければ行を作る）。
        // 流している間に公開へ戻されていたら書かない（戻した行を `private/` へ向けない）
        ConditionExpression: "attribute_exists(id) AND attribute_exists(audience)",
    };
}

async function main() {
    const apply = process.argv.includes("--apply");
    const table = process.env.PHOTOS_TABLE ?? "";
    const bucket = process.env.UPLOAD_BUCKET ?? "";
    if (!table || !bucket) {
        console.error("PHOTOS_TABLE と UPLOAD_BUCKET を渡してください（どの環境かを明示する）");
        process.exit(1);
    }
    // **無効化できないなら移さない。** 元を消しても、エッジに1年残って取れ続ける
    if (apply && !process.env.CLOUDFRONT_DISTRIBUTION_ID) {
        console.error("--apply には CLOUDFRONT_DISTRIBUTION_ID が要ります（古い URL をエッジから消すため）");
        process.exit(1);
    }

    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" }));

    console.log(`対象: ${table} / ${bucket}`);
    console.log(apply ? "モード: 適用（移します）" : "モード: 下見（件数を出すだけ・何も変えません）");

    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: table,
            FilterExpression: "attribute_exists(audience)",
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    const plan = planBackfill(items);
    console.log(`\n絞った写真の行: ${plan.restricted} 件`);
    console.log(`uploads/ に実体が残っている行: ${plan.entries.length} 件（移す実体 ${plan.objects} 個）`);
    console.log(`飛ばした行: ストーリー ${plan.skipped.story} 件・持ち主の分からない行 ${plan.skipped.noOwner} 件`);
    if (!apply) {
        console.log("\n下見なので何も変えていません。--apply で移します。");
        return;
    }

    // **パスを変数にする。** 環境変数を読む側（`requireEnv`）は読み込んだ時点で止めるので、
    // 下見と試験では読み込まない
    const moveMod = "../api-user/src/s3Move";
    const dropMod = "../api-user/src/dropUnused";
    const { copyAll } = await import(moveMod) as { copyAll: (m: Move[], p?: string) => Promise<boolean> };
    const { dropUnusedKeys } = await import(dropMod) as {
        dropUnusedKeys: (u: string, k: string[], p: string, s?: string) => Promise<void>;
    };

    let moved = 0;
    let failed = 0;
    for (const entry of plan.entries) {
        const tag = `move-restricted(${entry.id})`;
        // 1. コピー。1つでも失敗したら行も元も触らない（孤児が残るだけ）
        if (!await copyAll(entry.moves, tag)) { failed++; continue; }
        // 2. 行を書き換える
        try {
            await ddb.send(new UpdateCommand({ TableName: table, ...rewriteUpdate(entry) }));
        } catch (e) {
            console.warn(`${tag}: 行を書き換えられませんでした（元は消しません）`, (e as Error)?.name);
            failed++;
            continue;
        }
        // 3. 最後に元を消す（自分のほかの行が使っていないものだけ・エッジの無効化まで）
        await dropUnusedKeys(entry.userId, entry.moves.map((m) => m.from), tag, entry.id);
        moved++;
    }
    console.log(`\n移した行: ${moved} 件 / 失敗: ${failed} 件`);
    if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && /move-restricted-to-private\.ts$/.test(process.argv[1])) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
