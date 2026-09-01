#!/usr/bin/env node
/**
 * find-orphan-uploads.js — どの行からも参照されていないアップロード実体を探す（ORPHAN-2）
 *
 * **孤児を後から掃除する経路がどこにも無かった。**
 * 保存に失敗した項目を残してタブを閉じるだけで、実体だけが S3 に残り確定する
 * （`beforeunload` / `pagehide` のハンドラは0件）。しかも残るのは
 * **EXIF を落とす前の原本（`srcOriginal`）を含む**ので、GPS の付いた画像が
 * 公開URLで取れる状態のまま溜まっていく。
 *
 * 台帳では「Lambda の IAM に `s3:ListBucket` が無いので走査ツールも書けない」
 * として止めていたが、**Lambda で走らせる必要は無い**——資格情報を持つ CI から
 * 流せばよい（診断タスクと同じ考え方）。
 *
 * 安全側の作り:
 *   - **既定はドライラン**。`--apply` を付けたときだけ消す
 *   - **新しいものは触らない**（既定7日）。アップロード中・保存待ちの実体を
 *     消さないため。「保存に失敗した」と「まだ保存していない」は S3 からは
 *     区別できないので、時間で分ける
 *   - 参照の集め方は `api-user/src/mediaKeys.ts` と同じ形（URL でも生キーでも
 *     `uploads/` 配下のキーに揃え、`..` を含むものは扱わない）
 *   - **1件でも読めなければ消さない**。参照一覧が欠けたまま消すと、
 *     生きている写真の実体を消す
 *
 * 使い方:
 *   node scripts/find-orphan-uploads.js              # 数えるだけ
 *   node scripts/find-orphan-uploads.js --apply      # 実際に消す
 *   ORPHAN_MIN_AGE_DAYS=14 node scripts/find-orphan-uploads.js
 */
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { requireEnv } = require("./lib/env");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const MIN_AGE_DAYS = Number(process.env.ORPHAN_MIN_AGE_DAYS || 7);
const APPLY = process.argv.includes("--apply");

/** `api-user/src/mediaKeys.ts` と同じ導出（あちらは TS・こちらは CJS なので複製） */
const MEDIA_FIELDS = ["key", "src", "srcOriginal", "srcAvif", "src256", "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif"];

function deriveUploadKey(v) {
    if (typeof v !== "string" || !v) return "";
    const decodeOnce = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
    if (v.startsWith("uploads/")) {
        const key = decodeOnce(v);
        return key.includes("..") ? "" : key;
    }
    try {
        const path = decodeOnce(new URL(v).pathname).replace(/^\//, "");
        if (path.includes("..")) return "";
        if (path.startsWith("uploads/")) return path;
    } catch { /* URL でなければ無視 */ }
    return "";
}

/**
 * キーから写真の識別子（UUID）を取り出す。
 *
 * `uploads/<uuid>.jpg` / `uploads/<uuid>_thumb.webp` /
 * `uploads/originals/<uuid>.jpeg` のどれも同じ写真のもの。
 */
function uuidOf(key) {
    const base = String(key).split("/").pop() ?? "";
    const m = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0].toLowerCase() : "";
}

/**
 * 参照されているキーと、**生きている写真の識別子**を集める
 * （1ページでも失敗したら投げる）。
 *
 * **キーの一致だけでは足りない。** 実測（本番・2026-09-01）で、
 * `uploads/originals/<uuid>` の原本が34件中20件以上「孤児」と出た。
 * ところがその UUID の写真ページは実在する——**行が原本を指していない
 * だけで、写真は生きている**（`srcOriginal` を持たない古い行がある）。
 * キーだけで判定すると、**生きている写真の原本を消す**。
 * 原本は表示に使わないので画面は壊れず、消したことにも気づけない。
 *
 * そこで「同じ UUID の実体が1つでも参照されているか」も見る。
 * 消えた写真の実体は UUID ごと参照されなくなるので、本当の孤児だけが残る。
 */
async function referencedKeys(ddb, table) {
    const keys = new Set();
    const liveUuids = new Set();
    let lastKey;
    let items = 0;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey }));
        for (const raw of res.Items ?? []) {
            const item = unmarshall(raw);
            items++;
            const id = uuidOf(String(item.id ?? ""));
            if (id) liveUuids.add(id);
            for (const f of MEDIA_FIELDS) {
                const k = deriveUploadKey(item[f]);
                if (!k) continue;
                keys.add(k);
                const u = uuidOf(k);
                if (u) liveUuids.add(u);
            }
        }
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return { keys, liveUuids, items };
}

async function listUploads(s3, bucket) {
    const objects = [];
    let token;
    do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "uploads/", ContinuationToken: token }));
        for (const o of res.Contents ?? []) objects.push({ key: o.Key, size: o.Size ?? 0, at: o.LastModified });
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return objects;
}

async function main() {
    const table = requireEnv("PHOTOS_TABLE");
    const bucket = requireEnv("UPLOAD_BUCKET");
    const s3 = new S3Client({ region: REGION });
    const ddb = new DynamoDBClient({ region: REGION });

    const { keys, liveUuids, items } = await referencedKeys(ddb, table);
    console.log(`[orphan] 参照キー ${keys.size} 件 / 生きている写真 ${liveUuids.size} 件（${items} 行から）`);

    const objects = await listUploads(s3, bucket);
    console.log(`[orphan] S3 の uploads/ 配下 ${objects.length} 件`);

    const cutoff = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
    const orphans = [];
    let recent = 0;
    let liveButUnreferenced = 0;
    for (const o of objects) {
        if (keys.has(o.key)) continue;
        // **同じ写真の実体が生きているなら触らない。** 行が原本を指して
        // いないだけ（古い行は `srcOriginal` を持たない）で、写真は生きている
        const u = uuidOf(o.key);
        if (u && liveUuids.has(u)) { liveButUnreferenced++; continue; }
        // **新しいものは触らない。** 「保存に失敗した」と「まだ保存していない」は
        // S3 からは区別できない。アップロード中の実体を消すと、保存の直前で
        // 画像が消える（利用者には理由が分からない）
        if (o.at && o.at.getTime() > cutoff) { recent++; continue; }
        orphans.push(o);
    }
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    console.log(`[orphan] 孤児 ${orphans.length} 件 / ${mb(orphans.reduce((a, o) => a + o.size, 0))} MB`);
    console.log(`[orphan] ${MIN_AGE_DAYS}日以内なので触らないもの: ${recent} 件`);
    console.log(`[orphan] 行から参照されていないが、写真は生きているので触らないもの: ${liveButUnreferenced} 件`);
    for (const o of orphans.slice(0, 20)) {
        console.log(`  ${o.key}  ${mb(o.size)}MB  ${o.at ? o.at.toISOString().slice(0, 10) : "-"}`);
    }
    if (orphans.length > 20) console.log(`  …ほか ${orphans.length - 20} 件`);

    if (!APPLY) {
        console.log("[orphan] ドライランのため何も消していません（--apply で実行）。");
        return;
    }
    if (orphans.length === 0) return;
    let failed = 0;
    for (let i = 0; i < orphans.length; i += 1000) {
        const chunk = orphans.slice(i, i + 1000);
        const res = await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((o) => ({ Key: o.key })), Quiet: true },
        }));
        failed += (res.Errors ?? []).length;
    }
    console.log(`[orphan] 削除 ${orphans.length - failed} 件 / 失敗 ${failed} 件`);
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { deriveUploadKey, MEDIA_FIELDS, uuidOf };
