/**
 * diagnose-image-perf.js — 写真表示の速さに効く材料が揃っているかを本番データで測る（読み取り専用）。
 *
 * ローカルの app/data/photos.json はビルド時に再生成されるため実態と違う。
 * DynamoDB を直接見て、サムネイル・AVIF・ぼかし・寸法がどれだけ埋まっているかを出す。
 * あわせて実際の配信サイズも測り、1画面ぶんの転送量を見積もる。
 */

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const REGION = "ap-northeast-1";
const PHOTOS_TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const ddb = new DynamoDBClient({ region: REGION });

const FIELDS = [
    ["thumbSrc", "一覧用サムネ(512px WebP)"],
    ["thumbSm", "一覧用サムネ(256px)"],
    ["thumbAvif", "サムネのAVIF"],
    ["thumbSmAvif", "小サムネのAVIF"],
    ["srcAvif", "本体のAVIF"],
    ["blurDataURL", "読み込み中のぼかし"],
    ["dominantColor", "読み込み前の下地色"],
    ["width", "幅（ガタつき防止）"],
    ["height", "高さ（ガタつき防止）"],
];

async function head(url) {
    try {
        const res = await fetch(url, { method: "HEAD" });
        const len = Number(res.headers.get("content-length") || 0);
        return { ok: res.status === 200, bytes: len, type: res.headers.get("content-type") || "-" };
    } catch { return { ok: false, bytes: 0, type: "-" }; }
}

const fmtKB = (n) => `${Math.round(n / 1024)}KB`;

(async () => {
    const items = [];
    let key;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: PHOTOS_TABLE, ExclusiveStartKey: key }));
        items.push(...(res.Items ?? []).map((i) => unmarshall(i)));
        key = res.LastEvaluatedKey;
    } while (key);

    const photos = items.filter((p) => p.src && !p.story && p.published !== false && !String(p.id ?? "").includes("#"));
    console.log(`公開写真: ${photos.length}枚\n`);

    console.log("表示を速くする材料:");
    for (const [f, label] of FIELDS) {
        const n = photos.filter((p) => p[f] !== undefined && p[f] !== null && p[f] !== "").length;
        const mark = n === photos.length ? "OK  " : n === 0 ? "なし" : "一部";
        console.log(`  ${mark} ${label.padEnd(24)} ${n}/${photos.length}`);
    }

    // 実際の転送量。一覧の1画面（先頭9枚）でどれだけ落とすか
    const sample = photos.slice(0, 9);
    console.log(`\n一覧の1画面ぶん（先頭${sample.length}枚）の実測:`);
    let thumbTotal = 0, fullTotal = 0;
    for (const p of sample) {
        const full = await head(p.src);
        const thumbUrl = p.thumbSmAvif || p.thumbAvif || p.thumbSm || p.thumbSrc;
        const thumb = thumbUrl ? await head(thumbUrl) : null;
        fullTotal += full.bytes;
        thumbTotal += thumb?.ok ? thumb.bytes : full.bytes;
        console.log(`  ${String(p.id).slice(0, 8)} 本体 ${fmtKB(full.bytes)} (${full.type}) / 一覧用 ${thumb?.ok ? fmtKB(thumb.bytes) : "無し（本体を使用）"}`);
    }
    console.log(`\n  一覧で落ちる合計: ${fmtKB(thumbTotal)}`);
    console.log(`  本体をそのまま出した場合: ${fmtKB(fullTotal)}`);
    if (thumbTotal < fullTotal) {
        console.log(`  → ${Math.round((1 - thumbTotal / fullTotal) * 100)}% 削減できている`);
    } else {
        console.log("  → 削減できていない（サムネが使われていない）");
    }
})().catch((e) => { console.error("エラー:", e); process.exit(1); });
