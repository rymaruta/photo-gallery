/**
 * restrict-originals.js — uploads/originals/* の公開配信を止める
 *
 * 何が問題だったか:
 *   uploads/originals/ には「EXIF を落とす前の原本」が置かれている。
 *   GPS がそのまま入っており、コード側も2箇所で「公開URLで取得できる状態は
 *   避ける」と明記している。ところが写真と同じアップロード用バケットにあり、
 *   CloudFront の /uploads/* ビヘイビアがそのまま配信していた。
 *   URL は photos.json と静的HTMLから消したが（コミット cdeb4cc）、
 *   それは「隠した」だけで、キーを知っていれば誰でも取れる状態が続いている。
 *
 * ここでやること:
 *   1. バケットポリシーに Deny を1つ足す（冪等）
 *      - 対象は uploads/originals/* だけ
 *      - プリンシパルは CloudFront のサービスプリンシパルだけに絞る。
 *        IAM ユーザー経由の運用（撮影日のバックフィル・退会時の削除）は
 *        今後も動かす必要があるため、そちらは塞がない。
 *   2. エッジに載っている分を無効化する（/uploads/originals/*）
 *
 * 消さない。止めるだけ。消すかどうかは後で判断できるようにしておく
 * （原本は撮影日の復元に使える唯一の情報源でもある）。
 *
 * 使い方:
 *   node scripts/restrict-originals.js            # ドライラン（既定）
 *   node scripts/restrict-originals.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION                   (default: ap-northeast-1)
 *   UPLOAD_BUCKET                (必須)
 *   CLOUDFRONT_DISTRIBUTION_ID   (必須)
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

const PREFIX = "uploads/originals/";
const STATEMENT_SID = "DenyCloudFrontReadOfOriginals";

const DEFAULT_PRINCIPAL = { Service: "cloudfront.amazonaws.com" };

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * その Action が GetObject を許すか。
 *
 * **末尾 `*` のワイルドカードも見る。** 完全一致だけを見ていた頃は
 * `s3:Get*` や `s3:GetObject*`（IAM でごく普通の書き方）を素通りさせ、
 * 匿名公開があっても「完了」と出していた——このファイルが「一番まずい形」と
 * 呼んでいるもの。`readerPrincipals` と `hasAnonymousRead` で**同じ述語を
 * 使う**こと（片方だけ広げると、また食い違う）。
 */
function grantsGetObject(action) {
    const actions = asArray(action).map(String);
    return actions.some((a) => {
        if (a === "*" || a === "s3:*" || a === "s3:GetObject") return true;
        // "s3:Get*" → "s3:Get" が "s3:GetObject" の頭と一致するか
        if (a.endsWith("*")) return "s3:GetObject".startsWith(a.slice(0, -1));
        return false;
    });
}

/**
 * その文が originals の prefix に掛かるか。
 *
 * **Resource を見ないと、関係ない公開でスクリプトが止まる。** サムネイルだけ
 * 匿名公開しているバケットで中断すると、原本は配信から外れないまま放置される
 * （直す気で走らせたのに、何も変わらず終わる）。
 */
function coversOriginals(resource, bucket) {
    const list = asArray(resource).map(String);
    if (list.length === 0) return true;   // Resource が無い形は広いものとして扱う
    return list.some((r) => {
        const m = /^arn:aws:s3:::([^/]+)(\/.*)?$/.exec(r);
        if (!m) return false;
        if (bucket && m[1] !== bucket && m[1] !== "*") return false;
        const path = (m[2] ?? "/*").slice(1);          // 先頭の / を落とす
        if (path === "*" || path === "") return true;
        if (path.endsWith("*")) return PREFIX.startsWith(path.slice(0, -1)) || path.slice(0, -1).startsWith(PREFIX);
        return path.startsWith(PREFIX);
    });
}

/**
 * 「配信を許している相手」を今のポリシーから読み取る。
 *
 * 決め打ちにしない理由: CloudFront から S3 を読ませる方式は2通りある。
 *   - OAC（今の方式）  … Principal: { Service: "cloudfront.amazonaws.com" }
 *   - OAI（古い方式）  … Principal: { AWS: "arn:aws:iam::cloudfront:user/..." }
 * 片方だけを Deny しても、もう片方で配信されていれば穴は開いたまま。
 * しかも「入れたのに塞がっていない」という一番まずい形になる。
 * 実際に GetObject を許している文の Principal をそのまま拒否対象にする。
 */
function readerPrincipals(policy) {
    const aws = new Set();
    const services = new Set();
    for (const s of policy?.Statement ?? []) {
        if (s?.Sid === STATEMENT_SID) continue;
        if (s?.Effect !== "Allow") continue;
        if (!grantsGetObject(s.Action)) continue;
        // **匿名（`Principal: "*"` / `{AWS: "*"}`）はここでは拾わない。**
        //
        // 一度「拾って Deny に載せる」ようにしたが、**誤りだった**。
        // リソースベースポリシーの明示的 Deny は、あらゆる Allow を上書きする。
        // `Deny` に `{AWS: ["*"]}` を書くと、匿名だけでなく**このアカウントの
        // IAM ユーザーも root も**その prefix を読めなくなる——すぐ下の
        // 「止めるのは配信経由の読み取りだけ」が守っている契約
        // （「"*" にすると原本から撮影日を復元する手段まで失う」）に正面から
        // 反する。戻すにはバケットポリシーを手で編集するしかない。
        //
        // 匿名の許可がある場合は、この Deny では正しく塞げない。
        // 呼び出し側が `hasAnonymousRead` で見つけて**止める**（下）。
        // `*` は絶対に写さない（オブジェクト形式 `{AWS: "*"}` でも同じ）。
        // 写した瞬間に自分のアカウントごと締め出す Deny ができる。
        // 匿名の許可がある場合は hasAnonymousRead が呼び出し側で止める。
        for (const v of asArray(s.Principal?.AWS)) {
            if (String(v) !== "*") aws.add(String(v));
        }
        for (const v of asArray(s.Principal?.Service)) services.add(String(v));
    }
    if (aws.size === 0 && services.size === 0) return DEFAULT_PRINCIPAL;
    const out = {};
    if (aws.size) out.AWS = [...aws];
    if (services.size) out.Service = [...services];
    return out;
}

/**
 * バケットポリシーに Deny を足す（冪等）。
 * 既に同じ Sid があれば内容を差し替える。他の文は触らない。
 */
function withDenyStatement(policy, bucket) {
    const next = {
        Version: policy?.Version ?? "2012-10-17",
        Statement: [...(policy?.Statement ?? [])].filter((s) => s?.Sid !== STATEMENT_SID),
    };
    next.Statement.push({
        Sid: STATEMENT_SID,
        Effect: "Deny",
        // 配信経由の読み取りだけを止める。IAM ユーザーでの運用
        // （撮影日のバックフィル・退会時の削除）は動き続ける必要がある。
        Principal: readerPrincipals(policy),
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/${PREFIX}*`,
    });
    return next;
}

/**
 * 匿名に読み取りを許している文があるか。
 *
 * `Principal` は文字列でも書ける（`"Principal": "*"`）ので、
 * オブジェクト形式だけ見ていると**無いものとして飛ばす**。飛ばすと
 * Deny が CloudFront 宛てだけになり、**GPS 入りの原本が S3 直 URL の
 * 匿名 GET で取れたまま**、しかもスクリプトは成功で終わる——
 * このファイルの冒頭が「一番まずい形」と書いているそれ。
 *
 * ただし**見つけても Deny には載せない**（載せると自分のアカウントごと
 * 締め出す。上の readerPrincipals を見よ）。ここは「この Deny では
 * 塞げない状態だ」と気づくためだけに使い、呼び出し側は**適用せずに止める**。
 * 匿名公開そのものを消す（Block Public Access を有効にする）のが筋。
 */
function hasAnonymousRead(policy, bucket) {
    for (const s of policy?.Statement ?? []) {
        if (s?.Sid === STATEMENT_SID) continue;
        if (s?.Effect !== "Allow") continue;
        if (!grantsGetObject(s.Action)) continue;
        // **originals に掛からない公開では止めない。** サムネイルだけ公開して
        // いるバケットで中断すると、原本は配信から外れないまま放置される。
        if (!coversOriginals(s.Resource, bucket)) continue;
        if (s.Principal === "*") return true;
        if (asArray(s.Principal?.AWS).some((v) => String(v) === "*")) return true;
    }
    return false;
}

/**
 * 何をするかを決める（適用する / 止める）。
 *
 * **`main()` から切り出してある。** 中に書いていた頃は、
 * `if (hasAnonymousRead(...))` を `if (false)` に変えても17件すべて緑だった
 * ——**このスクリプトの目的そのもの（適用せずに落とす）が1本も守られて
 * いなかった**。`main` は export できないので、判断だけ外に出す。
 */
function planPolicyChange(policy, bucket) {
    if (hasAnonymousRead(policy, bucket)) {
        return {
            abort: true,
            reason:
                `このバケットは匿名（Principal: "*"）に ${PREFIX} の読み取りを許しています。\n` +
                "その状態では、ここで入れる Deny は原本を塞げません" +
                "（塞ごうとすると自分のアカウントごと締め出します）。\n" +
                "先に匿名公開そのものを消してください" +
                "（S3 の Block Public Access を有効にするか、その Allow 文を削る）。",
        };
    }
    return { abort: false, next: withDenyStatement(policy, bucket) };
}

/** ドライランでも実行でも同じ判定を使う（差分の説明用） */
function describeChange(policy) {
    const had = (policy?.Statement ?? []).some((s) => s?.Sid === STATEMENT_SID);
    return had ? "既に Deny があるため内容を上書きします" : "Deny を1つ追加します";
}

async function main() {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const BUCKET = requireEnv("UPLOAD_BUCKET");
    const DIST_ID = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");

    const {
        S3Client, GetBucketPolicyCommand, PutBucketPolicyCommand, ListObjectsV2Command,
    } = require("@aws-sdk/client-s3");
    const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");

    const s3 = new S3Client({ region: REGION });
    const cf = new CloudFrontClient({ region: REGION });

    console.log(`[originals] バケット: ${BUCKET}`);
    console.log(`[originals] 対象プレフィックス: ${PREFIX}`);
    console.log(`[originals] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    // 対象の実体を数える
    let count = 0;
    let bytes = 0;
    let token;
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token,
        }));
        for (const o of res.Contents ?? []) {
            count++;
            bytes += o.Size ?? 0;
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    console.log(`[originals] 対象オブジェクト: ${count} 件 / ${(bytes / 1024 / 1024).toFixed(1)} MB`);

    if (count === 0) {
        console.log("[originals] 対象がありません。ポリシーだけ入れておきます（今後の再発防止）。");
    }

    // 現在のポリシーを読む（未設定なら空から作る）
    let current = null;
    try {
        const res = await s3.send(new GetBucketPolicyCommand({ Bucket: BUCKET }));
        current = JSON.parse(res.Policy);
    } catch (e) {
        if (e?.name !== "NoSuchBucketPolicy") throw e;
        console.log("[originals] バケットポリシーは未設定です。");
    }

    // 匿名公開が残っているなら、この Deny では塞げない（理由は planPolicyChange）
    const plan = planPolicyChange(current, BUCKET);
    if (plan.abort) {
        console.error(`[originals] ${plan.reason}`);
        process.exitCode = 1;
        return;
    }

    const nextPolicy = plan.next;
    console.log(`[originals] ${describeChange(current)}`);
    console.log(JSON.stringify(nextPolicy.Statement.find((s) => s.Sid === STATEMENT_SID), null, 2));

    if (!apply) {
        console.log("\n[originals] ドライランのため何も変更していません。");
        return;
    }

    await s3.send(new PutBucketPolicyCommand({
        Bucket: BUCKET,
        Policy: JSON.stringify(nextPolicy),
    }));
    console.log("[originals] バケットポリシーを更新しました。");

    // 既にエッジに載っている分を追い出す。ポリシーだけではキャッシュ済みの
    // レスポンスが TTL の間そのまま返り続ける。
    await cf.send(new CreateInvalidationCommand({
        DistributionId: DIST_ID,
        InvalidationBatch: {
            CallerReference: `restrict-originals-${Date.now()}`,
            Paths: { Quantity: 1, Items: [`/${PREFIX}*`] },
        },
    }));
    console.log(`[originals] CloudFront を無効化しました: /${PREFIX}*`);
    console.log("\n[originals] 完了。配信が 403 になったことをブラウザで確かめてください。");
}

module.exports = { withDenyStatement, readerPrincipals, hasAnonymousRead, planPolicyChange, grantsGetObject, coversOriginals, describeChange, PREFIX, STATEMENT_SID };

if (require.main === module) {
    main().catch((e) => {
        console.error("[originals] 失敗:", e);
        process.exit(1);
    });
}
