#!/usr/bin/env tsx
/**
 * VERIFY-1: **presign が本当に使えるか**を、本物の S3 に対して確かめる。
 *
 * `0b7c1c8` で presign に `ContentLength` を、`738bef3` で `ContentType` を
 * 署名対象へ入れた。どちらも「クライアントが送る値と一致しなければ 403」に
 * なる縛りなので、**外すと全アップロードが 403 になる**。台帳では
 * 「staging で1枚上げて確かめること」として、ずっと未確認のまま残っていた。
 *
 * ここで確かめるのは3つ:
 *   1. ハンドラが出した presign に、ブラウザと同じ形で PUT すると **通る**
 *   2. 長さが1バイト違うと **断られる**（＝ContentLength が効いている）
 *   3. 種別が違うと **断られる**（＝ContentType が効いている）
 *
 * 2 と 3 が通ってしまうと「縛ったつもりで何も縛れていない」ので、
 * **成功だけを見ても意味が無い**。
 *
 * **ハンドラを直接呼ぶ。** URL を組み立て直すと、確かめたい当のもの
 * （`signableHeaders` の指定）を写し間違えても気づけない。
 *
 * ブラウザ側の前提（`fetch` が送る Content-Length が `File.size` と一致する）は
 * 別途 Chromium で実測済み。ここはサーバー側と S3 の側を見る。
 *
 * **staging 専用。** バケット名が `staging-` で始まらなければ何もしない。
 */
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.UPLOAD_BUCKET ?? "";
if (!BUCKET.startsWith("staging-")) {
    console.error(`verify-upload: UPLOAD_BUCKET が staging- で始まりません（${BUCKET || "(未設定)"}）。中止します。`);
    process.exit(1);
}

// **パスを変数にする。** リテラルで書くと、ルートの tsconfig が
// `api-user/` を型検査に引き込む（あちらは意図的に除外されていて、
// `aws-lambda` の型も root には入っていない）。ルートの `tsc` が
// このスクリプト1本のために赤くなるのは割に合わない。
// 実行は tsx なので、変数でも普通に読める。
const HANDLER = "../api-user/src/upload";
const { presignedUrl } = await import(HANDLER) as {
    presignedUrl: (e: unknown, c: unknown, cb: unknown) => Promise<{ statusCode: number; body: string }>;
};
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

/** 本物のハンドラを、認証済みの呼び出しに見せかけて叩く */
async function presign(fileName: string, fileType: string, fileSize: number) {
    const event = {
        requestContext: { authorizer: { jwt: { claims: { sub: process.env.VERIFY_USER_ID } } } },
        body: JSON.stringify({ fileName, fileType, fileSize }),
    };
    const res = await presignedUrl(event, {}, () => { });
    if (res.statusCode !== 200) throw new Error(`presign が ${res.statusCode}: ${res.body}`);
    return JSON.parse(res.body) as { presignedUrl: string; key: string; contentType: string };
}

/** ブラウザと同じ形で PUT する（Content-Length は body の長さで自動的に付く） */
const put = (url: string, body: Uint8Array, contentType: string) =>
    // `BodyInit` は ArrayBufferView を受けるが、TS の DOM 型では
    // `Uint8Array<ArrayBufferLike>` が合わないので実体を渡す
    fetch(url, {
        method: "PUT",
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
        headers: { "Content-Type": contentType, "Cache-Control": "max-age=31536000" },
    });

const cleanup: string[] = [];
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
    console.log(`  ${ok ? "○" : "✕"} ${label}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures++;
};

async function run(label: string, fileName: string, fileType: string, bytes: Uint8Array) {
    console.log(`\n=== ${label}（${bytes.length} バイト / ${fileType}）`);
    const p = await presign(fileName, fileType, bytes.length);
    cleanup.push(p.key);

    // 1. 申告どおりに送れば通る
    const ok = await put(p.presignedUrl, bytes, p.contentType);
    check(ok.status === 200, "申告どおりの PUT が通る", `status=${ok.status}`);
    if (ok.status === 200) {
        const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: p.key }));
        check(head.ContentLength === bytes.length, "S3 に入った長さが一致", `${head.ContentLength}`);
        check(head.ContentType === p.contentType, "S3 に入った種別が一致", `${head.ContentType}`);
        check(head.CacheControl === "max-age=31536000", "Cache-Control が付いている", `${head.CacheControl}`);
    }

    // 2. 長さが違えば断られる（ContentLength の縛りが効いているか）
    const p2 = await presign(fileName, fileType, bytes.length);
    cleanup.push(p2.key);
    const shortRes = await put(p2.presignedUrl, bytes.slice(0, bytes.length - 1), p2.contentType);
    check(shortRes.status !== 200, "1バイト短いと断られる", `status=${shortRes.status}`);

    // 3. 種別が違えば断られる（ContentType の縛りが効いているか）。
    //    これが通ると `uploadPolicy.ts` が SVG を弾く理由が素通りになる
    const p3 = await presign(fileName, fileType, bytes.length);
    cleanup.push(p3.key);
    const typeRes = await put(p3.presignedUrl, bytes, "text/html");
    check(typeRes.status !== 200, "別の種別だと断られる", `status=${typeRes.status}`);
}

// 中身は問わない（S3 は形式を見ない）。長さと種別だけが要点
const jpeg = new Uint8Array(2048).fill(0x41);
const mp4 = new Uint8Array(1_500_000).fill(0x42);   // ストーリーの動画に近い大きさ

try {
    console.log(`verify-upload: bucket=${BUCKET}`);
    await run("写真", "verify.jpg", "image/jpeg", jpeg);
    await run("ストーリーの動画", "verify.mp4", "video/mp4", mp4);
} finally {
    // **必ず片付ける。** 残すと孤児として orphan-uploads に拾われる
    for (const Key of cleanup) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })); }
        catch (e) { console.error(`  片付けに失敗: ${Key}:`, e); }
    }
    console.log(`\n片付け: ${cleanup.length} 件の一時オブジェクトを削除`);
}

if (failures > 0) {
    console.error(`\n**${failures} 件が想定と違います。** アップロードが壊れている可能性があります。`);
    process.exit(1);
}
console.log("\nすべて想定どおり。presign の署名は効いており、申告どおりの PUT は通ります。");
