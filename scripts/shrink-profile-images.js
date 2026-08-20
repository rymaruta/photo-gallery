/**
 * shrink-profile-images.js
 *
 * S3 に原寸のまま保存されているプロフィール画像を、表示サイズに合わせて縮小する。
 *
 * 経緯: /user/profile のアップロードが圧縮を通しておらず、カメラ写真（数MB）が
 * そのまま保存されていた。それを32〜48pxのアイコンとして配信していたため、
 * 一覧に人が並ぶだけで数十MBのダウンロードになっていた。
 * アップロード側は修正済みなので、これは既存分の後始末。
 *
 * キー: profiles/{userId} = アイコン / profiles/{userId}/cover = カバー写真
 *
 * 既定はドライラン（何バイト減るかだけ出す）。--apply で実際に置き換える。
 * 冪等: 既に十分小さいものはスキップするので、何度実行しても問題ない。
 *
 * 縮小とは別に、Cache-Control の修復も行う。アイコンは profiles/{userId} という
 * ハッシュの付かない固定キーなので no-store でなければならない（アップロード側の
 * api-user/src/profile.ts もそう署名している）。過去にこのスクリプトが
 * max-age=86400 を書いてしまった分があり、縮小済みで小さいものは上の
 * スキップ条件に当たって二度と直らないため、中身に触らず属性だけ差し替える。
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const sharp = require("sharp");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const BUCKET = requireEnv("UPLOAD_BUCKET");
const APPLY = process.argv.includes("--apply");

// フロントの lib/utils/image.ts と同じ値
const AVATAR_MAX_PX = 512;
const COVER_MAX_PX = 1280;
// これ以下なら触らない（再エンコードで劣化させないため）
const SKIP_BYTES = 120 * 1024;

const s3 = new S3Client({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || "";

const fmtKB = (n) => `${Math.round(n / 1024)}KB`;

// アイコン・カバーに付けるべき Cache-Control（固定キーなのでキャッシュさせない）
const WANT_CACHE_CONTROL = "no-store";

async function listProfileObjects() {
    const out = [];
    let token;
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: BUCKET, Prefix: "profiles/", ContinuationToken: token,
        }));
        for (const o of res.Contents ?? []) {
            if (o.Key && !o.Key.endsWith("/")) out.push({ key: o.Key, size: o.Size ?? 0 });
        }
        token = res.NextContinuationToken;
    } while (token);
    return out;
}

(async () => {
    console.log(`バケット: ${BUCKET}`);
    console.log(APPLY ? "モード: 適用（S3を書き換えます）" : "モード: ドライラン（変更しません）");

    const objects = await listProfileObjects();
    console.log(`\nプロフィール画像: ${objects.length}件`);

    let touched = 0, skipped = 0, failed = 0, before = 0, after = 0;

    for (const obj of objects) {
        const isCover = obj.key.endsWith("/cover");
        const maxPx = isCover ? COVER_MAX_PX : AVATAR_MAX_PX;

        if (obj.size <= SKIP_BYTES) { skipped++; continue; }

        try {
            const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.key }));
            const body = Buffer.concat(await got.Body.toArray());
            const meta = await sharp(body).metadata();

            // 既に小さいなら触らない
            if ((meta.width ?? 0) <= maxPx && (meta.height ?? 0) <= maxPx) { skipped++; continue; }

            const resized = await sharp(body)
                .rotate() // EXIF の向きを反映してから落とす
                .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
                .webp({ quality: 82 })
                .toBuffer();

            // 逆に大きくなるなら意味がないので置き換えない
            if (resized.length >= body.length) { skipped++; continue; }

            before += body.length;
            after += resized.length;
            console.log(`  ${obj.key}: ${meta.width}x${meta.height} ${fmtKB(body.length)} → ${fmtKB(resized.length)}`);

            if (APPLY) {
                await s3.send(new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: obj.key,
                    Body: resized,
                    ContentType: "image/webp",
                    // アップロード側（api-user/src/profile.ts）が no-store で署名しているのに
                    // 合わせる。アイコンは profiles/{userId} という固定キーでハッシュが付かず、
                    // キャッシュさせるとアイコンを変えても古いものが出続けてしまう。
                    CacheControl: "no-store",
                }));
            }
            touched++;
        } catch (e) {
            failed++;
            console.log(`  ${obj.key}: 失敗 ${e.name} — ${e.message.split("\n")[0]}`);
        }
    }

    console.log(`\n縮小対象 ${touched}件 / そのまま ${skipped}件 / 失敗 ${failed}件`);
    if (touched > 0) {
        console.log(`合計 ${fmtKB(before)} → ${fmtKB(after)}（${Math.round((1 - after / before) * 100)}% 削減）`);
    }
    if (!APPLY && touched > 0) console.log("ドライランのため書き換えていません。");

    // Cache-Control の修復。縮小の対象外（既に小さい）でも、属性が違えば直す。
    // 中身は触らないので、再エンコードによる劣化は起きない。
    let fixed = 0;
    console.log("");
    for (const obj of objects) {
        let head;
        try {
            head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: obj.key }));
        } catch (e) {
            failed++;
            console.log(`  ${obj.key}: Cache-Control の確認に失敗 ${e.name}`);
            continue;
        }
        if ((head.CacheControl ?? "") === WANT_CACHE_CONTROL) continue;

        console.log(`  ${obj.key}: Cache-Control "${head.CacheControl ?? "(未設定)"}" → "${WANT_CACHE_CONTROL}"`);
        fixed++;
        if (!APPLY) continue;
        try {
            await s3.send(new CopyObjectCommand({
                Bucket: BUCKET,
                Key: obj.key,
                // "/" は区切りとして残し、それ以外の記号だけ escape する
                CopySource: `${BUCKET}/${obj.key.split("/").map(encodeURIComponent).join("/")}`,
                MetadataDirective: "REPLACE",
                ContentType: head.ContentType ?? "image/webp",
                CacheControl: WANT_CACHE_CONTROL,
            }));
        } catch (e) {
            failed++;
            console.log(`  ${obj.key}: Cache-Control の修復に失敗 ${e.name} — ${e.message.split("\n")[0]}`);
        }
    }
    console.log(fixed > 0
        ? `Cache-Control の修復: ${fixed}件${APPLY ? "" : "（ドライランのため未適用）"}`
        : "Cache-Control はすべて no-store（修復不要）");

    // 書き換えたオブジェクトをエッジから追い出す。
    // アイコンは profiles/{userId} という固定キーなので、無効化しないと
    // 既にキャッシュされている古い画像が配信され続ける。
    if (APPLY && (touched > 0 || fixed > 0) && DIST_ID) {
        await cf.send(new CreateInvalidationCommand({
            DistributionId: DIST_ID,
            InvalidationBatch: {
                CallerReference: `shrink-profiles-${Date.now()}`,
                Paths: { Quantity: 1, Items: ["/profiles/*"] },
            },
        }));
        console.log("CloudFront の /profiles/* を無効化しました。");
    } else if (APPLY && touched > 0) {
        console.log("CLOUDFRONT_DISTRIBUTION_ID が無いため無効化はスキップ（古い画像が残る可能性）。");
    }
})().catch((e) => { console.error("エラー:", e); process.exit(1); });
