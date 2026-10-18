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
    /** 読んだときの `src`。行の書き換えの条件にする（間に差し替えられていたら書かない） */
    oldSrc?: string;
    /** ストーリーから残した写真なら、元のストーリーの id（`storyKeep.ts`） */
    keptFrom?: string;
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
        plan.entries.push({
            id: item.id, userId: item.userId, moves, rewritten,
            ...(typeof item.src === "string" ? { oldSrc: item.src } : {}),
            ...(typeof item.keptFrom === "string" && item.keptFrom ? { keptFrom: item.keptFrom } : {}),
        });
        plan.objects += moves.length;
    }
    return plan;
}

/**
 * 🔴 **元のストーリーが生きている「残した写真」は移さない**（`photoUpdate.ts` の公開範囲の変更と同じ判定）。
 *
 * その間、写真とストーリーは**同じ S3 の実体を共有**していて、移すとストーリーの画像が割れるか、
 * 期限切れの掃除と競合して写真の実体を失いうる。ストーリーの行が消えれば（毎時の掃除）移せる。
 * **読めなければ飛ばす**（分からないなら触らない）。
 */
export async function skipKeptAlive(
    entries: BackfillEntry[],
    storyAlive: (storyId: string) => Promise<boolean>,
): Promise<{ entries: BackfillEntry[]; keptAlive: number; unknown: number }> {
    const out: BackfillEntry[] = [];
    let keptAlive = 0;
    let unknown = 0;
    for (const entry of entries) {
        if (!entry.keptFrom) { out.push(entry); continue; }
        let alive: boolean;
        try {
            alive = await storyAlive(entry.keptFrom);
        } catch {
            unknown++;
            continue;
        }
        if (alive) { keptAlive++; continue; }
        out.push(entry);
    }
    return { entries: out, keptAlive, unknown };
}

export type ApplyDeps = {
    copyAll: (moves: Move[], tag: string) => Promise<boolean>;
    update: (entry: BackfillEntry) => Promise<void>;
    dropUnused: (userId: string, keys: string[], tag: string, selfId: string) => Promise<void>;
    /** S3 にまだ在るか（HeadObject） */
    exists: (key: string) => Promise<boolean>;
};

/**
 * 移す。**コピー → 行の書き換え → 元を消す → 元が消えたかを確かめる**。
 *
 * 元が残っていたら（消せなかった・自分のほかの行が使っているので残した）、
 * **その行は「移した」に数えない**——公開の置き場に実体が残っていて、URL を知っていれば取れる。
 */
export async function applyEntries(entries: BackfillEntry[], deps: ApplyDeps) {
    let moved = 0;
    let failed = 0;
    const leftovers: string[] = [];
    /** 失敗した行の id（元が残った行を含む）。**やり直しでは拾わない**行があるので名前を出す */
    const failedIds: string[] = [];
    for (const entry of entries) {
        const tag = `move-restricted(${entry.id})`;
        // 1. コピー。1つでも失敗したら行も元も触らない（孤児が残るだけ）
        if (!await deps.copyAll(entry.moves, tag)) { failed++; failedIds.push(entry.id); continue; }
        // 2. 行を書き換える
        try {
            await deps.update(entry);
        } catch (e) {
            console.warn(`${tag}: 行を書き換えられませんでした（元は消しません）`, (e as Error)?.name);
            failed++;
            failedIds.push(entry.id);
            continue;
        }
        // 3. 最後に元を消す（自分のほかの行が使っていないものだけ・エッジの無効化まで）
        await deps.dropUnused(entry.userId, entry.moves.map((m) => m.from), tag, entry.id);
        // 4. 元が本当に消えたか。`dropUnusedKeys` は失敗を投げずに警告だけ出すので、ここで数える
        const left: string[] = [];
        for (const m of entry.moves) {
            let still: boolean;
            try {
                still = await deps.exists(m.from);
            } catch {
                still = true;   // 確かめられないなら「残っている」側に倒す
            }
            if (still) left.push(m.from);
        }
        if (left.length > 0) {
            console.warn(`${tag}: 元が uploads/ に残っています（${left.length} 個）`);
            leftovers.push(...left);
            failed++;
            failedIds.push(entry.id);
            continue;
        }
        moved++;
    }
    return { moved, failed, leftovers, failedIds };
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
    names["#src"] = "src";
    if (entry.oldSrc !== undefined) values[":oldSrc"] = entry.oldSrc;
    return {
        Key: { id: entry.id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // 行が消えていたら作らない（UpdateItem はキーが無ければ行を作る）。
        // 流している間に公開へ戻されていたら書かない（戻した行を `private/` へ向けない）。
        // **読んだあとに差し替えられていたら書かない**（`src` が違う＝新しい画像。古い計画で
        // 書くと、差し替えを黙って古い画像へ戻す）
        ConditionExpression: entry.oldSrc !== undefined
            ? "attribute_exists(id) AND attribute_exists(audience) AND #src = :oldSrc"
            : "attribute_exists(id) AND attribute_exists(audience) AND attribute_not_exists(#src)",
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
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } = await import("@aws-sdk/lib-dynamodb");
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

    const { failed } = await runBackfill({
        items,
        apply,
        storyAlive: async (storyId) =>
            !!(await ddb.send(new GetCommand({ TableName: table, Key: { id: storyId } }))).Item,
        makeDeps: async () => {
            // **パスを変数にする。** 環境変数を読む側（`requireEnv`）は読み込んだ時点で止めるので、
            // 下見と試験では読み込まない
            const moveMod = "../api-user/src/s3Move";
            const dropMod = "../api-user/src/dropUnused";
            const { copyAll } = await import(moveMod) as { copyAll: (m: Move[], p?: string) => Promise<boolean> };
            const { dropUnusedKeys } = await import(dropMod) as {
                dropUnusedKeys: (u: string, k: string[], p: string, s?: string) => Promise<void>;
            };
            const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
            const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
            return {
                copyAll: (moves, tag) => copyAll(moves, tag),
                update: async (entry) => { await ddb.send(new UpdateCommand({ TableName: table, ...rewriteUpdate(entry) })); },
                dropUnused: (userId, keys, tag, selfId) => dropUnusedKeys(userId, keys, tag, selfId),
                exists: async (key) => {
                    try {
                        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                        return true;
                    } catch (e) {
                        const name = (e as { name?: string })?.name;
                        if (name === "NotFound" || name === "NoSuchKey") return false;
                        // ⚠️ `s3:ListBucket` が無いと、無いキーにも 404 ではなく 403 が返る
                        // ＝全件「残っている」に見える（docs/restricted-image-delivery.md）
                        throw e;
                    }
                },
            };
        },
    });
    if (failed > 0) process.exitCode = 1;
}

/**
 * 計画 → 残した写真の除外 → （`--apply` のときだけ）移す、の配線（**main から切り出してある**）。
 *
 * main はこれに AWS の部品を渡すだけ。ここを差し替え可能な部品で流して、**除外した行が
 * 移す側に渡らないこと**などを確かめる（main の中に書いていた頃は、`applyEntries` に除外前の
 * 一覧を渡しても試験が通った・2026-10-18 のレビュー）。
 */
export async function runBackfill(opts: {
    items: Record<string, unknown>[];
    apply: boolean;
    storyAlive: (storyId: string) => Promise<boolean>;
    makeDeps: () => Promise<ApplyDeps>;
    log?: (line: string) => void;
}) {
    const log = opts.log ?? ((line: string) => console.log(line));
    const plan = planBackfill(opts.items);
    // 元のストーリーが生きている「残した写真」は飛ばす（下見でも読むだけで数える）
    const kept = await skipKeptAlive(plan.entries, opts.storyAlive);
    const objects = kept.entries.reduce((n, e) => n + e.moves.length, 0);
    log(`\n絞った写真の行: ${plan.restricted} 件`);
    log(`uploads/ に実体が残っている行: ${kept.entries.length} 件（移す実体 ${objects} 個）`);
    log(`飛ばした行: ストーリー ${plan.skipped.story} 件・持ち主の分からない行 ${plan.skipped.noOwner} 件・`
        + `元のストーリーが出ている残した写真 ${kept.keptAlive} 件・元のストーリーを読めなかった ${kept.unknown} 件`);
    if (!opts.apply) {
        log("\n下見なので何も変えていません。--apply で移します。");
        return { plan, kept, moved: 0, failed: 0, leftovers: [] as string[], failedIds: [] as string[] };
    }
    const result = await applyEntries(kept.entries, await opts.makeDeps());
    if (result.leftovers.length > 0) {
        log(`\nuploads/ に残った元: ${result.leftovers.length} 個（消せなかった・自分のほかの行が使っている）`);
    }
    log(`\n移した行: ${result.moved} 件 / 失敗: ${result.failed} 件`);
    if (result.failedIds.length > 0) {
        // 元が残った行は、行がもう private/ を指すので**やり直しでは拾わない**。orphan-uploads で拾う
        log(`失敗した行の id（元が残った行は orphan-uploads で拾う）: ${result.failedIds.join(", ")}`);
    }
    return { plan, kept, ...result };
}

if (process.argv[1] && /move-restricted-to-private\.ts$/.test(process.argv[1])) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
