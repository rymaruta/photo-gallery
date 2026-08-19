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
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const sharp = require("sharp");

const REGION = "ap-northeast-1";
const BUCKET = process.env.UPLOAD_BUCKET || "prod-journey-photo-upload";
const APPLY = process.argv.includes("--apply");

// フロントの lib/utils/image.ts と同じ値
const AVATAR_MAX_PX = 512;
const COVER_MAX_PX = 1280;
// これ以下なら触らない（再エンコードで劣化させないため）
const SKIP_BYTES = 120 * 1024;

const s3 = new S3Client({ region: REGION });

const fmtKB = (n) => `${Math.round(n / 1024)}KB`;

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
                    // 画像はキーが固定でハッシュが付かないため、長期キャッシュにはしない
                    CacheControl: "public, max-age=86400",
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
})().catch((e) => { console.error("エラー:", e); process.exit(1); });
