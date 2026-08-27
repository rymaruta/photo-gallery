/**
 * generate-thumbnails.js — 既存写真のサムネイル生成＋表示メタデータ補完（移行スクリプト）
 *
 * S3 の元画像から次を生成して DynamoDB に書き戻す:
 *   - thumbSrc        : 512px WebP サムネイル（同バケットに保存）
 *   - width / height  : 元画像の表示寸法（EXIF 回転を反映）
 *   - aspectRatio     : width / height
 *   - dominantColor   : 支配的な色（#rrggbb）… グリッドの色プレースホルダ(LQIP)に使用
 * （新規アップロードはクライアント側で thumbSrc 等を生成するため、これは過去分の移行用）
 *
 * 使い方:
 *   node scripts/generate-thumbnails.js            # 実行
 *   DRY_RUN=1 node scripts/generate-thumbnails.js  # 対象の確認のみ
 *
 * 環境変数:
 *   AWS_REGION      (default: ap-northeast-1)
 *   PHOTOS_TABLE    (必須)
 *   UPLOAD_BUCKET   (必須)
 *   PUBLIC_BASE_URL (任意・保存するURLの土台。未設定なら CLOUDFRONT_URL)
 *   CLOUDFRONT_URL  (必須)
 *
 * 冪等: thumbSrc とメタデータが揃っている写真はスキップするので何度実行しても安全。
 * サムネだけ在ってメタが無い写真は、サムネ再生成せずメタのみ補完する。
 * 1件の失敗は記録して続行する（全体を止めない）。
 */

const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");

// .env.local から AWS 認証情報を読み込む（ローカル実行用。CI では環境変数で渡る）
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = requireEnv("PHOTOS_TABLE");
const BUCKET = requireEnv("UPLOAD_BUCKET");
/**
 * 保存する画像URLの土台。
 *
 * ここで作った URL は `thumbSrc` などとして **DynamoDB に恒久保存**される。
 * 以前は CloudFront の既定ドメイン（d1s3dwwzgxf5ni.cloudfront.net）を渡して
 * いたため、同じサイトの画像が2つのホスト名で配信されていた——実測で
 * 30件中11件が cloudfront.net、19件が journey-photo.com。サイトマップは
 * 両方を `<image:loc>` に載せるので、画像のインデックスが2ホストに割れる。
 * 訪問者にも余計な DNS+TLS が1往復増える。
 *
 * 以後は配信に使うURL（siteUrl）を渡す。`PUBLIC_BASE_URL` を優先し、
 * 無ければ従来どおり `CLOUDFRONT_URL` を使う（保守用ワークフローを
 * 手で叩く経路を壊さないため）。読み取り側は URL のパスだけを見るので
 * （keyFromSrc）、既に保存済みのURLとの互換は保たれる。
 */
const CLOUDFRONT_URL = (process.env.PUBLIC_BASE_URL || requireEnv("CLOUDFRONT_URL")).replace(/\/$/, "");
const DRY_RUN = process.env.DRY_RUN === "1";

const THUMB_MAX_PX = 512;
const THUMB_QUALITY = 75;

// レスポンシブ/AVIF 派生の設定
const THUMB_SM_PX = 256;    // モバイル2列用の小サムネ
const DETAIL_MAX_PX = 1600; // 詳細ページ用の大 AVIF
const AVIF_QUALITY = 50;    // AVIF は同画質で WebP より小さいので低めでよい

// 動画やアニメGIFはサムネ生成の対象外（クライアント側の挙動と揃える）
const SKIP_EXTENSIONS = new Set(["mp4", "webm", "mov", "gif"]);

/** src の URL から S3 キーを取り出す（例: https://cdn/uploads/x.jpg → uploads/x.jpg） */
function keyFromSrc(src) {
    try {
        const pathname = decodeURIComponent(new URL(src).pathname);
        return pathname.replace(/^\/+/, "") || null;
    } catch {
        return null;
    }
}

/** 元キーに接尾辞＋拡張子を付けた派生キーを作る（例: uploads/x.jpg,"_thumb","webp" → uploads/x_thumb.webp） */
function derivativeKey(key, suffix, ext) {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
    const base = key.slice(dir.length).replace(/\.[^.]+$/, "");
    return `${dir}${base}${suffix}.${ext}`;
}

/** 元キーからサムネイルのキーを作る（例: uploads/x.jpg → uploads/x_thumb.webp） */
function thumbKeyFor(key) {
    return derivativeKey(key, "_thumb", "webp");
}

// サムネ以外に補完する表示メタデータのフィールド
const META_FIELDS = ["dominantColor", "width", "height", "aspectRatio", "blurDataURL"];

// 撮影日(date)の補完はここには**無い**。復元には EXIF 付きの元画像
// （srcOriginal）が要るが、**今のどの保存経路も srcOriginal を書いていない**
// ——アップロードは lib/utils/image.ts の toUploadSafeFile で EXIF を落として
// から上げるので、原本は S3 に存在しない（GPS 入りの原本を残さないための設計）。
// つまり補完対象は永久に0件で、その分岐は一度も動いていなかった。
// 撮影日は今、**アップロード時にブラウザが EXIF から読んで date として送る**
// （app/user/upload/page.tsx の dateTimeOriginal）。
// 復活させるなら、原本を残す是非から決め直すこと。
// レスポンシブ/AVIF 派生の URL フィールド
const DERIVATIVE_FIELDS = ["thumbAvif", "thumbSm", "thumbSmAvif", "srcAvif"];

// ぼかしプレビューの元サイズ（長辺px）。極小にして base64 を軽く保つ
const BLUR_MAX_PX = 20;
const BLUR_QUALITY = 40;

const isBlank = (v) => v === undefined || v === null || v === "";

/** サムネ生成対象になり得る「写真」か（src を持ち、動画/GIF でない） */
function isProcessableImage(item) {
    if (!item || typeof item.src !== "string" || !item.src) return false; // like#/go# マーカー等
    // ストーリーと下書きには派生画像を作らない。
    // 派生は max-age=31536000 で公開バケットに焼かれる一方、ストーリーの
    // 削除・期限切れ処理は原本しか消さないため、24時間で消えるはずのものが
    // 公開URLで永久に残ってしまう。下書きも公開前に取得できてしまう。
    if (item.story === true) return false;
    if (item.published === false) return false;
    const key = keyFromSrc(item.src);
    if (!key) return false;
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return !SKIP_EXTENSIONS.has(ext);
}

/** サムネイル未生成か */
function needsThumb(item) {
    return isProcessableImage(item) && isBlank(item.thumbSrc);
}

/** 表示メタデータ（寸法・支配色）が未補完か */
function needsMeta(item) {
    return isProcessableImage(item) && META_FIELDS.some((f) => isBlank(item[f]));
}

/** レスポンシブ/AVIF 派生（256/AVIF/詳細AVIF）が未生成か */
function needsDerivatives(item) {
    return isProcessableImage(item) && DERIVATIVE_FIELDS.some((f) => isBlank(item[f]));
}

/** この写真に対して何らかの処理（サムネ / メタ / 派生）が必要か */
function shouldProcess(item) {
    return needsThumb(item) || needsMeta(item) || needsDerivatives(item);
}

/** 0-255 のチャンネル値を 2 桁 16 進に */
function hexFromChannel(c) {
    return Math.max(0, Math.min(255, Math.round(c ?? 0))).toString(16).padStart(2, "0");
}

/**
 * sharp の metadata()/stats() の生値から DynamoDB に書く表示メタを作る（純関数・テスト可能）。
 * EXIF orientation 5-8 は 90/270 度回転のため、表示上の幅・高さを入れ替える。
 */
function buildMetaFields({ width, height, orientation, dominant } = {}) {
    let w = width, h = height;
    if (orientation && orientation >= 5) { const t = w; w = h; h = t; }
    const out = {};
    if (typeof w === "number" && w > 0) out.width = w;
    if (typeof h === "number" && h > 0) out.height = h;
    if (out.width && out.height) out.aspectRatio = Number((out.width / out.height).toFixed(4));
    if (dominant) out.dominantColor = `#${hexFromChannel(dominant.r)}${hexFromChannel(dominant.g)}${hexFromChannel(dominant.b)}`;
    return out;
}

/** 元画像バッファから表示メタを算出する（寸法・支配色・ぼかしプレビュー） */
async function computeMetaFromBuffer(sharp, buf) {
    const meta = await sharp(buf).metadata();
    const stats = await sharp(buf).stats();
    const out = buildMetaFields({
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
        dominant: stats.dominant,
    });
    // 極小ぼかしプレビュー（blur-up 用）。EXIF 回転を反映しつつ 20px WebP に。
    const blur = await sharp(buf)
        .rotate()
        .resize({ width: BLUR_MAX_PX, height: BLUR_MAX_PX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: BLUR_QUALITY })
        .toBuffer();
    out.blurDataURL = `data:image/webp;base64,${blur.toString("base64")}`;
    return out;
}

/**
 * レスポンシブ/AVIF 派生を生成して S3 にアップロードし、URL フィールドを返す。
 * 512 AVIF / 256 WebP / 256 AVIF / 詳細(≤1600) AVIF。EXIF 回転を反映。
 */
async function generateDerivatives({ sharp, s3, PutObjectCommand }, buf, key) {
    const variants = [
        { field: "thumbAvif", suffix: "_thumb", ext: "avif", type: "image/avif", px: THUMB_MAX_PX, enc: (p) => p.avif({ quality: AVIF_QUALITY }) },
        { field: "thumbSm", suffix: "_thumb_sm", ext: "webp", type: "image/webp", px: THUMB_SM_PX, enc: (p) => p.webp({ quality: THUMB_QUALITY }) },
        { field: "thumbSmAvif", suffix: "_thumb_sm", ext: "avif", type: "image/avif", px: THUMB_SM_PX, enc: (p) => p.avif({ quality: AVIF_QUALITY }) },
        { field: "srcAvif", suffix: "_lg", ext: "avif", type: "image/avif", px: DETAIL_MAX_PX, enc: (p) => p.avif({ quality: AVIF_QUALITY }) },
    ];
    const fields = {};
    for (const v of variants) {
        const out = await v.enc(
            sharp(buf).rotate().resize({ width: v.px, height: v.px, fit: "inside", withoutEnlargement: true })
        ).toBuffer();
        const outKey = derivativeKey(key, v.suffix, v.ext);
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: outKey,
            Body: out,
            ContentType: v.type,
            CacheControl: "max-age=31536000",
        }));
        fields[v.field] = `${CLOUDFRONT_URL}/${outKey}`;
    }
    return fields;
}

async function main() {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
    const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
    const sharp = require("sharp");

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { removeUndefinedValues: true },
    });
    const s3 = new S3Client({ region: REGION });

    console.log(`\n[thumbs] table=${TABLE} bucket=${BUCKET} region=${REGION}${DRY_RUN ? " (DRY_RUN)" : ""}`);

    // 全件スキャンして対象を絞る
    const items = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const targets = items.filter(shouldProcess);
    console.log(`[thumbs] ${items.length} 件中、処理対象 ${targets.length} 件`);
    if (DRY_RUN) {
        for (const t of targets) {
            const jobs = [needsThumb(t) && "thumb", needsMeta(t) && "meta", needsDerivatives(t) && "deriv"].filter(Boolean).join("+");
            console.log(`  - ${t.id}  ${keyFromSrc(t.src)}  [${jobs}]`);
        }
        console.log("[thumbs] DRY_RUN=1 のため生成せず終了");
        return;
    }

    let ok = 0, failed = 0, skipped = 0, missing = 0;
    for (const [i, item] of targets.entries()) {
        const key = keyFromSrc(item.src);
        const doThumb = needsThumb(item);
        const doMeta = needsMeta(item);
        const doDerivatives = needsDerivatives(item);
        try {
            // 1) 元画像を取得（サムネ・メタどちらにも必要）
            const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            const buf = Buffer.from(await obj.Body.transformToByteArray());

            // 書き込むフィールドを組み立てる
            const fields = {};
            let thumbInfo = "";

            if (doThumb) {
                // 512px WebP を生成（EXIF の向きを反映しつつメタデータは持ち越さない）
                const thumbKey = thumbKeyFor(key);
                const thumb = await sharp(buf)
                    .rotate()
                    .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
                    .webp({ quality: THUMB_QUALITY })
                    .toBuffer();
                await s3.send(new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: thumbKey,
                    Body: thumb,
                    ContentType: "image/webp",
                    CacheControl: "max-age=31536000",
                }));
                fields.thumbSrc = `${CLOUDFRONT_URL}/${thumbKey}`;
                thumbInfo = ` ${(buf.length / 1024).toFixed(0)}KB → ${(thumb.length / 1024).toFixed(0)}KB`;
            }

            if (doMeta) {
                Object.assign(fields, await computeMetaFromBuffer(sharp, buf));
            }

            if (doDerivatives) {
                // レスポンシブ/AVIF 派生（512 AVIF・256 WebP・256 AVIF・詳細 AVIF）
                Object.assign(fields, await generateDerivatives({ sharp, s3, PutObjectCommand }, buf, key));
            }

            // 2) DynamoDB へ動的 SET（更新するフィールドだけ書く）
            //
            // updatedAt は sitemap の lastmod に使われる＝「中身が変わった日」。
            // このスクリプトはサムネや代表色といった表示用の補完をするだけで、
            // 本文・撮影地・タイトルは触らない。それでも無条件に updatedAt を
            // 書いていたので、移行を1回流すだけで全写真が「今日更新」になり、
            // lastmod ごと信用されなくなっていた。
            // このスクリプトが書くのは表示用の補完だけになったので、
            // updatedAt は**一切触らない**（触ると sitemap の lastmod が
            // 「今日更新」に化ける）。中身を変える経路——撮影日の復元——は
            // 動かないまま残っていたので消した（上の needsShotDate のコメント）。
            const names = {}, values = {};
            const sets = [];
            for (const [k, v] of Object.entries(fields)) {
                names[`#${k}`] = k;
                values[`:${k}`] = v;
                sets.push(`#${k} = :${k}`);
            }
            if (sets.length === 0) { skipped++; continue; } // 書くものが無い（updatedAt も動かさない）
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: item.id },
                UpdateExpression: "SET " + sets.join(", "),
                // 削除済み写真への復活書き込みを防ぐ
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
                ExpressionAttributeValues: values,
            }));

            ok++;
            const jobs = [doThumb && "thumb", doMeta && "meta", doDerivatives && "deriv"].filter(Boolean).join("+");
            console.log(`  [${i + 1}/${targets.length}] ✅ ${item.id}  [${jobs}]${thumbInfo}`);
        } catch (err) {
            // 原本が S3 に無い行は、この道具では直しようがない。
            // 失敗に数えると、下の判定で毎回ジョブが赤くなる
            // （退会処理が途中で切れると「S3は消えたが行は残る」が普通に起きる）。
            if (isMissingObject(err)) {
                missing++;
                console.warn(`  [${i + 1}/${targets.length}] ⚠️ ${item.id} (${key}): 原本が見つかりません`);
                continue;
            }
            failed++;
            console.error(`  [${i + 1}/${targets.length}] ❌ ${item.id} (${key}): ${err.message ?? err}`);
        }
    }

    console.log(`\n[thumbs] 完了: 成功 ${ok} / スキップ ${skipped} / 実体なし ${missing} / 失敗 ${failed}`);
    if (exitCodeFor({ failed }) !== 0) process.exit(1);
}

/**
 * 「原本が S3 に無い」エラーか。
 *
 * 退会処理は S3 を先に消して DynamoDB を後で消す。途中で実行時間を
 * 使い切ると「実体は無いが行は残る」が残る（api-user/src/account.ts の
 * コメントがその前提で書かれている）。この道具では直しようがない。
 */
function isMissingObject(err) {
    const name = err?.name ?? "";
    const status = err?.$metadata?.httpStatusCode;
    return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * このジョブを失敗として終わらせるか（0 = 正常終了）。
 *
 * **ここは一度作りを誤って、本番のデプロイを止めかけた。**
 * 「対象があったのに1件も成功しなかったら exit 1」にしていたが、
 * 一度うまく回ったあとの定常状態は「直しようのない行だけが対象」なので、
 * **以後どのデプロイも赤くなる**状態だった。
 * `.github/workflows/deploy.yml` はこのステップの後に build と S3 反映を
 * 置いていて、削除のたびに走る site-rebuild（cron を止めた今、消えた
 * ページを S3 から消す唯一の経路）も同じ道を通る——つまり
 * 「消したはずの内容が公開されたまま、直すデプロイも打てない」になる。
 *
 * 直し方は2つ。呼び出し側を continue-on-error にして**止まらなくし**、
 * ここは「人が見に行くべきか」の合図だけにする。
 * 判定は `failed` ひとつで足りる:
 *   - スキップ … 撮影日が EXIF に無い等。何度流しても書くものが無い
 *   - 実体なし … 原本が消えている。この道具では直せない（isMissingObject）
 * のどちらも失敗に数えていないので、残った failed は
 * 「資格情報・ネットワーク・sharp」など**人が見る価値のあるもの**だけ。
 *
 * 条件を足すほど間違える。実際、最初は targets/ok/skipped/missing の
 * 4つを見る式にしたが、`missing > 0` の枝は `failed === 0` のとき
 * 冗長で、変異させても赤くならない＝確かめようがなかった。
 */
function exitCodeFor({ failed }) {
    return failed > 0 ? 1 : 0;
}

module.exports = {
    keyFromSrc, thumbKeyFor, derivativeKey, shouldProcess,
    needsThumb, needsMeta, needsDerivatives, buildMetaFields, hexFromChannel,
    isMissingObject, exitCodeFor,
};

if (require.main === module) {
    main().catch((err) => {
        console.error("[thumbs] unexpected error:", err);
        process.exit(1);
    });
}
