/**
 * deploy-static-site.js
 *
 * Deploys the Next.js static export (out/) to an S3 bucket using AWS SDK v3.
 * Usage: node scripts/deploy-static-site.js --bucket <bucket-name>
 *
 * After upload, invalidates the CloudFront distribution (if CLOUDFRONT_DISTRIBUTION_ID is set).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// .env.local から AWS 認証情報を読み込む
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { lookup: mimeLookup } = require("mime-types");

// Parse --bucket argument（バリデーションは直接実行時のみ。テストからの
// require では判定関数だけを使うため process.exit しない）
const args = process.argv.slice(2);
const bucketIndex = args.indexOf("--bucket");
const bucket = bucketIndex !== -1 ? args[bucketIndex + 1] : undefined;
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");

/**
 * デプロイのたびにエッジから追い出すパスを、実際に上げたファイルから決める。
 *
 * 以前は "/*" だった。写真も同じディストリビューションから配信していて
 * （src の多くが https://journey-photo.com/uploads/...）、しかも
 * max-age=31536000 を付けているのに、push と1日4回の定期ビルドのたびに
 * 全写真をパージしていた。各エッジで最初に見た人が毎回フル解像度の
 * JPEG を取り直すことになり、長いキャッシュ期間が意味を成していなかった。
 *
 * 対象はキャッシュさせていないファイル（HTML・sitemap・photos.json など）だけ。
 * /_next/static/ 配下は内容ハッシュ付きなので無効化は要らない。
 *
 * CloudFront のワイルドカードは末尾にしか置けないため、入れ子のページは
 * 「/photo/*」のようにディレクトリ単位へまとめる（課金もパス数単位なので
 * 1ページずつ並べるより安く、上限にも当たらない）。
 */
function invalidationPathsFor(keys) {
    const wildcards = new Set();
    const exact = new Set();

    /** 実パスを足す（拡張子なしのURLでも配信されるので両方消す） */
    const addExact = (k) => {
        if (k === "index.html") {
            exact.add("/"); // ルートは index.html の配信URL
            return;
        }
        exact.add(`/${k}`);
        if (k.endsWith(".html")) exact.add(`/${k.slice(0, -".html".length)}`);
    };

    // 対象を先頭ディレクトリごとにまとめる
    const byDir = new Map();
    for (const key of keys) {
        const k = key.split(path.sep).join("/");
        if (!(isHtmlOrTxt(k) || NO_CACHE_KEYS.has(k))) continue;
        const slash = k.indexOf("/");
        if (slash === -1) {
            addExact(k); // 直下のファイルはそのまま
            continue;
        }
        const dir = k.slice(0, slash);
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(k);
    }

    // ページ数の多いディレクトリからワイルドカードに割り当てる。
    // ワイルドカードには実行中の本数に上限があるので、枠は「効く順」に使う。
    // 枠に入らなかったディレクトリは実パスで消す（実パスは1リクエスト3,000本まで）。
    const dirs = [...byDir.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [dir, files] of dirs) {
        const worthWildcard = files.length > WILDCARD_MIN_FILES && wildcards.size < MAX_WILDCARD_PATHS;
        if (worthWildcard) wildcards.add(`/${dir}/*`);
        else files.forEach(addExact);
    }

    const out = [...wildcards, ...exact].sort();

    // 写真を巻き込んでいないことを必ず確かめる。ここを間違えると、
    // デプロイのたびに全写真がエッジから消えて遅くなる。
    //
    // 以前はこの検査の**後ろ**に「ワイルドカードが多すぎたら "/*" にする」
    // という逃げ道があり、検査を素通りしていた。しかも generateBuildId が
    // コミットごとに変わる＝全HTMLが変わるので、**実際のデプロイでは毎回**
    // その逃げ道に落ちていた（out/ の実データで確認: ワイルドカード12個 > 上限10）。
    // つまり「写真がエッジから消える問題を直した」はずが、直っていなかった。
    // 逃げ道は塞ぐ。多すぎる分は実パスに落とす。
    if (out.some((p) => p === "/*" || p.startsWith("/uploads"))) {
        throw new Error(`[deploy] 無効化パスが /uploads/ を巻き込みます: ${out.join(" ")}`);
    }
    return out;
}

// CloudFront の制限。実行中のワイルドカード無効化は15本まで
// （25本を1リクエストで投げて実際に弾かれた）。直前のデプロイ分がまだ
// 動いていることもあるので、サイトの実際のディレクトリ数(12前後)に対して
// ぎりぎりにならない範囲で余裕を残す。
const MAX_WILDCARD_PATHS = 12;
// これ以下のページ数ならワイルドカードを使わず実パスで消す
const WILDCARD_MIN_FILES = 5;
// 1回の無効化リクエストに入れられるパス数の上限
const MAX_PATHS_PER_REQUEST = 3000;

/**
 * 今回のビルドで中身が変わったファイルだけを返す。
 *
 * 定期ビルド（1日4回）の多くは前回とまったく同じ出力になる。それでも毎回
 * 無効化していたので、無効化のパス数（＝課金単位）を無駄に使い、
 * "/*" だった頃は写真まで巻き添えでエッジから消していた。
 *
 * S3 の ETag は単一パートのアップロードなら中身の MD5。ここで上げている
 * ファイルはどれも小さく単一パートなので、そのまま比較できる。
 */
function changedKeys(localFiles, remoteObjects) {
    const remote = new Map(remoteObjects.map((o) => [o.key, (o.etag ?? "").replace(/"/g, "")]));
    const changed = [];
    for (const file of localFiles) {
        const key = file.split(path.sep).join("/");
        // キャッシュさせていないものだけが無効化の対象
        // （/_next/static は内容ハッシュ付きなので名前が変われば別物になる）
        if (!(isHtmlOrTxt(key) || NO_CACHE_KEYS.has(key))) continue;
        const md5 = crypto.createHash("md5").update(fs.readFileSync(path.join(outDir, file))).digest("hex");
        if (remote.get(key) !== md5) changed.push(file);
    }
    return changed;
}

if (require.main === module) {
    if (!bucket) {
        console.error("Usage: node scripts/deploy-static-site.js --bucket <bucket-name>");
        process.exit(1);
    }
    if (!fs.existsSync(outDir)) {
        console.error(`ERROR: out/ directory not found. Run 'npm run build' first.`);
        process.exit(1);
    }
}

// photos.json を out/ にコピー（Lambda が S3 から読む用）。
// **main() から呼ぶ。** 以前はモジュールのトップレベルにあり、テストが
// このファイルを require しただけで out/app/data/ に書き込んでいた
// （収集・検証より前に走る副作用でもあった）。
function copyPhotosJsonIntoOut() {
    const photosJsonSrc = path.join(root, "app", "data", "photos.json");
    const photosJsonDest = path.join(outDir, "app", "data", "photos.json");
    if (fs.existsSync(photosJsonSrc)) {
        fs.mkdirSync(path.dirname(photosJsonDest), { recursive: true });
        fs.copyFileSync(photosJsonSrc, photosJsonDest);
        console.log(`[deploy] Copied app/data/photos.json → out/app/data/`);
    }
}

const region = "ap-northeast-1";
const s3 = new S3Client({ region });
const cf = new CloudFrontClient({ region });

/** Recursively collect all files under a directory, returning relative paths. */
function collectFiles(dir, base = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(full, base));
        } else {
            files.push(path.relative(base, full));
        }
    }
    return files;
}

function isHtmlOrTxt(filePath) {
    return filePath.endsWith(".html") || filePath.endsWith(".txt");
}

// ハッシュ名でないため内容が変わりうるファイル。ブラウザに長期キャッシュさせない。
// （sw.js が immutable だと Service Worker の更新が届かなくなる）
// サイトマップは写真を追加するたびに変わるため、immutable だと検索エンジンに
// 更新が届かなくなる。robots.txt は .txt なので isHtmlOrTxt 側でカバー済み。
const NO_CACHE_KEYS = new Set([
    "sw.js",
    "manifest.webmanifest",
    "app/data/photos.json",
    "sitemap.xml",
    "sitemap-images.xml",
    // フィードも写真を追加するたびに変わる。入れないと 1時間 immutable で
    // 配られ、しかも**更新しても CloudFront を無効化しない**
    // （無効化の対象は .html/.txt とこの一覧だけ）
    "feed.xml",
]);

async function uploadFile(filePath) {
    const fullPath = path.join(outDir, filePath);
    const key = filePath.split(path.sep).join("/"); // S3 uses forward slashes
    const body = fs.readFileSync(fullPath);
    const contentType = mimeLookup(filePath) || "application/octet-stream";
    // 長いキャッシュを許すのは内容ハッシュ付きのものだけ（_next/static/**）。
    //
    // 以前は「HTML でなければ1年 immutable」だったので、public/ にある
    // 固定名のファイル（favicon.ico・icon-512.png・images/*）まで
    // 1年 immutable で配っていた。差し替えても、既に取得した人の
    // ブラウザは再検証すらしないので新しいものが永久に届かない
    // （ホーム画面に追加した PWA のアイコンが変わらない）。
    // しかも無効化の対象からも外していたので、直す手段が無かった。
    const cacheControl = isHtmlOrTxt(filePath) || NO_CACHE_KEYS.has(key)
        ? "no-cache, no-store, must-revalidate"
        : key.startsWith("_next/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600";

    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
    }));
}

async function listS3Objects() {
    const objects = [];
    let continuationToken;
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
        }));
        for (const obj of res.Contents ?? []) {
            // ETag は単一パートのアップロードなら中身の MD5。
            // 「今回のビルドで実際に変わったファイル」を見分けるのに使う。
            if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified, etag: obj.ETag });
        }
        continuationToken = res.NextContinuationToken;
    } while (continuationToken);
    return objects;
}

// 旧アセットの削除猶予期間。
// キャッシュされた古い HTML（ブラウザ・アプリ内ブラウザ・CDNエッジ）は
// 旧ハッシュ名の JS/CSS を参照し続けるため、即削除するとその HTML を持つ
// 端末で JS が 404 になり「表示はされるが一切タップできない」状態になる。
// HTML は no-cache なので即削除してよいが、アセットは猶予期間だけ残す。
const ASSET_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30日（コスト僅少・安全側に倒す）

// 削除対象の判定（純関数・テスト対象）。
// - 今回のビルドに含まれるキーは絶対に削除しない
// - ビルドに無い HTML/txt は即削除（HTML は no-store 配信のため安全）
// - ビルドに無いアセットは猶予期間内なら保持（古い HTML を持つ端末の 404 防止）
function classifyStaleObjects(localKeys, remoteObjects, now, graceMs) {
    const localSet = new Set(localKeys.map(k => k.split(path.sep).join("/")));
    const toDelete = [];
    let kept = 0;
    for (const obj of remoteObjects) {
        if (localSet.has(obj.key)) continue;
        const isHtml = isHtmlOrTxt(obj.key);
        const age = obj.lastModified ? now - obj.lastModified.getTime() : Infinity;
        if (isHtml || age > graceMs) {
            toDelete.push(obj.key);
        } else {
            kept++;
        }
    }
    return { toDelete, kept };
}

/**
 * 一度のデプロイで消してよいページ（`.html`）の割合。
 *
 * **消す量に歯止めが無かった。** sync 側には「既存より半分以下になる
 * 書き込みは事故とみなす」ガード（SHRINK_LIMIT）があるのに、deploy 側は
 * out/ に無い HTML を**猶予期間なしで全部消す**だけだった。踏み方は2つ:
 *
 *  1. 手元で `npm run build` すると、DynamoDB に繋がらなくても sync は
 *     0 を返す（IS_CI でないため）。古い photos.json のままビルドが通り、
 *     そのまま web:deploy:prod を打つと、スナップショット以降に増えた
 *     写真の `photo/<id>.html` が全部消える
 *  2. next build が途中で失敗しても out/ は残る（→ prepare-static-build.js
 *     で消すようにした）
 *
 * どちらも「out/ が本番より貧しい」形なので、**割合で止める**のが一番効く。
 *
 * **閾値は 0.25。** 0.5 にしていたときは効き方が逆だった:
 *  - 止めたい「古い photos.json」は、スナップショット以降に40枚以上
 *    増えていないと 50% に届かない（1人100枚上限のこのサイトでは
 *    事実上到達不能）。10枚の取りこぼしは素通りしていた
 *  - 逆に**退会の掃除は必ず落ちる**。今の本番は1人が30枚全部を持って
 *    いるので、その人が退会すると 88% 削除になる。掃除が失敗すると
 *    退会したユーザーの写真ページが CDN に残り続ける——**失敗の方が悪い**
 *
 * なので削除起点の掃除（退会・写真削除の repository_dispatch）では
 * ワークフローが ALLOW_BULK_DELETE=1 を渡す。手元やブランチ push からの
 * デプロイでは、削除はほぼ 0 のはずなので 0.25 でも十分に緩い。
 */
const BULK_DELETE_RATIO = 0.25;
/**
 * **この件数未満なら**割合を見ない（小さなサイトで普通の削除を止めない）。
 *
 * 以前このコメントは「これ以下の件数なら」と書いていたが、実装は
 * `htmlToDelete.length < min` なので**ちょうど5件のときは割合判定に入る**。
 * 実装の方を正とする——この関数は「消しすぎ」を止める安全装置なので、
 * 迷ったら見に行く側に倒すのが筋（緩める変更は、止めたかった事故を通す）。
 */
const BULK_DELETE_MIN = 5;

/**
 * 消しすぎていないか。止めるべきなら理由の文字列、問題なければ null。
 * HTML だけを見る（アセットは 30日の猶予があり、消えても表示は壊れない）。
 */
function bulkDeleteGuard(toDelete, remoteObjects, { ratio = BULK_DELETE_RATIO, min = BULK_DELETE_MIN } = {}) {
    // **`.html` だけ数える（RSC の `.txt` を混ぜない）。**
    // 1ページにつき html 1 + txt 8 が出るので、比率そのものは変わらないが、
    // Next が RSC の出力名を変える更新では **1,000件超の .txt が一斉に
    // stale になり必ず発火する**——しかもメッセージは「photos.json が古い」
    // なので、正しい原因に辿り着けない。ページ数で数える。
    const isPage = (k) => k.endsWith(".html");
    const htmlToDelete = toDelete.filter(isPage);
    const remoteHtml = remoteObjects.filter((o) => isPage(o.key)).length;
    if (htmlToDelete.length < min || remoteHtml === 0) return null;
    if (htmlToDelete.length <= remoteHtml * ratio) return null;
    return `[deploy] 中止: 公開中の HTML ${remoteHtml} 件のうち ${htmlToDelete.length} 件を消そうとしています`
        + `（上限 ${Math.round(ratio * 100)}%）。\n`
        + `  out/ が本番より貧しい可能性があります。よくある原因:\n`
        + `    - DynamoDB に繋がらないまま古い app/data/photos.json でビルドした\n`
        + `    - next build が失敗して、前回の out/ が残っている\n`
        + `    - Next の RSC 出力名が変わる更新（この場合は正常。逃げ道を使ってよい）\n`
        + `  意図した削除なら ALLOW_BULK_DELETE=1 を付けて再実行してください。`;
}

async function deleteStaleKeys(localKeys, remoteObjects) {
    const { toDelete, kept } = classifyStaleObjects(localKeys, remoteObjects, Date.now(), ASSET_GRACE_MS);
    const guard = process.env.ALLOW_BULK_DELETE === "1" ? null : bulkDeleteGuard(toDelete, remoteObjects);
    if (guard) throw new Error(guard);
    if (kept > 0) console.log(`[deploy] Keeping ${kept} stale asset(s) within ${ASSET_GRACE_MS / 86400000}-day grace period.`);
    if (toDelete.length === 0) return [];
    // DeleteObjects accepts up to 1000 keys at a time
    for (let i = 0; i < toDelete.length; i += 1000) {
        const batch = toDelete.slice(i, i + 1000).map(Key => ({ Key }));
        await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch },
        }));
        console.log(`[deploy] Deleted ${batch.length} stale object(s).`);
    }
    return toDelete;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 同時実行数を絞ってタスクを処理する。S3 への一斉 PutObject は 503(SlowDown) を誘発し、
// その最中に CloudFront が取得した 5xx がエッジにキャッシュされると「一部チャンクだけ
// 503 → Safari が実行拒否 → 水和不全」を招く。バーストを避けるため上限付きで流す。
async function runPool(items, worker, concurrency = 12) {
    let i = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            await worker(items[idx]);
        }
    });
    await Promise.all(runners);
}

// 本番URLへのフォールバックは置かない（CLAUDE.md）。未設定なら配信チェックを
// 飛ばす——飛ぶのはログと **5xx 検知時の1回だけの再インバリデーション**
// （キャッシュされた 5xx の洗い流し）。デプロイ自体は完了する。
// deploy.yml は config ジョブの siteUrl を必ず渡している。手元から流す場合は
// CLAUDE.md の手順どおり SITE_URL も渡すこと。
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

/**
 * トップページの OGP 画像が実際に取れるかを見る（アドバイザリ）。
 *
 * **ここは一度「存在しないファイル」で長く壊れていた**——
 * `/images/og-image.jpg` はリポジトリにもビルド成果物にも無いのに、
 * 16ページが OGP 画像として出しており、トップを SNS に貼っても画像が
 * 出なかった。誰も見ていない場所だったので気づけなかった。
 *
 * 今は「一番新しい公開写真」をビルド時に焼き込む形なので、**利用者が
 * その写真を削除すると次のサイトビルドまで壊れたまま**になる（削除は
 * S3 の実体も消す。定期ビルドは止めてある）。デプロイのたびに1本
 * HEAD を投げておけば、少なくとも次のデプロイで気づける。
 *
 * 配信チェックと同じ扱いで**デプロイは止めない**（CI ランナーの IP が
 * WAF に弾かれることがあり、それでデプロイを失敗させたくない）。
 */
async function verifyOgImage(opts = {}) {
    // `html` / `fetchImpl` はテストからの差し替え口（本番の呼び出しは
    // 引数なし＝ディスクと実 fetch）
    const doFetch = opts.fetchImpl || fetch;
    let html = opts.html;
    if (html === undefined) {
        if (!SITE_URL) return "skipped";   // 配信チェックと同じ理由（未設定なら飛ばす）
        const indexHtml = path.join(outDir, "index.html");
        if (!fs.existsSync(indexHtml)) return "skipped";
        html = fs.readFileSync(indexHtml, "utf8");
    }
    const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (!m) {
        console.warn("[deploy] advisory: トップページに og:image がありません（SNS に貼っても画像が出ません）。");
        return "missing";
    }
    const url = m[1];
    // **相対 URL は「取れない」に倒す。** `fetch` は相対を投げるので、
    // 下の catch が「通信に失敗しました」と言う——**このチェックが存在する
    // 理由そのもの（`/images/og-image.jpg` を指したまま放置されていた）が、
    // 一番わかりにくいログで出る**。最後の砦として先に弾く
    try {
        new URL(url);
    } catch {
        console.warn(`[deploy] advisory: og:image が絶対URLではありません — ${url}`);
        console.warn("[deploy] advisory: OGP 画像は絶対URLでないと SNS から取得できません。");
        return "broken";
    }
    try {
        // HEAD が塞がれている配信もあるので、405/501 のときだけ GET で見直す
        // **必ず打ち切る。** タイムアウトが無いと、応答を返さないホスト
        // （CI ランナーが WAF に握られる場面＝この関数が想定している状況
        // そのもの）で **Node の既定 300 秒**待つ。実測で 300.9 秒。
        // デプロイの最後なので成功しているのにジョブが5分伸びる——Actions の
        // 枠は逼迫している（2026-08 に 1,804/2,000 分）ので実費になる。
        const withTimeout = () => ({ redirect: "follow", signal: AbortSignal.timeout(5000) });
        let res = await doFetch(url, { method: "HEAD", ...withTimeout() });
        if (res.status === 405 || res.status === 501) {
            res = await doFetch(url, withTimeout());
        }
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (res.status === 200 && ct.startsWith("image/")) {
            console.log(`[deploy] (advisory) og:image OK — ${url}`);
            return "ok";
        }
        console.warn(`[deploy] advisory: og:image が取れません（status=${res.status} ct=${ct || "-"}） — ${url}`);
        console.warn("[deploy] advisory: 元の写真が削除された可能性があります。サイトを再ビルドすると新しい写真に入れ替わります。");
        return "broken";
    } catch (e) {
        console.warn(`[deploy] advisory: og:image の確認に失敗しました（${e.message.split("\n")[0]}） — ${url}`);
        return "error";
    }
}

/**
 * デプロイ後の配信チェック（アドバイザリ＝参考ログのみ・デプロイは止めない）。
 *
 * 配信ドメイン経由で JS/CSS チャンクを取得し、200 かつスクリプト/スタイルの
 * Content-Type かを確認する。ただし GitHub Actions ランナーの IP は CloudFront/WAF に
 * レート/評価で一時的に 403(HTML) ブロックされることがあり、実ユーザーの健全性を
 * 正しく測れない（全アセットが一律 403 になる＝サイト障害ではなくランナー IP ブロック）。
 * そのためここでは**検知してログするだけ**でデプロイは失敗させない。
 * 実際の保護は「アップロード同時実行の制限＋CloudFront インバリデーション＋
 * デプロイ前の Chromium/WebKit スモーク＋クライアントの自己修復ウォッチドッグ」で担う。
 * 5xx が主因のときだけ 1 回だけ再インバリデーションして 5xx を洗い流す（それでも失敗はしない）。
 */
async function verifyAssets(assetKeys, cfDistId) {
    if (!SITE_URL) {
        console.warn("[deploy] advisory: SITE_URL が未設定のため配信チェックを飛ばします（デプロイ自体は完了）。");
        return;
    }
    const targets = assetKeys
        .map((k) => k.split(path.sep).join("/"))
        .filter((k) => /\.(js|css)$/.test(k));
    if (targets.length === 0) return;

    // **並列で見る。** 直列だと 1件あたり最大 2回×1.5秒 の待ちが積み上がり、
    // 403 が続く回は**1回のデプロイで最大4.5分**を「参考ログ」のためだけに使う。
    // 同じファイルの runPool をそのまま使う（アップロードと同じ仕掛け）。
    async function scan() {
        const bad = [];
        let has5xx = false;
        await runPool(targets, async (key) => {
            const url = `${SITE_URL}/${key}`;
            let ok = false;
            let info = "";
            for (let attempt = 0; attempt < 2 && !ok; attempt++) {
                try {
                    const res = await fetch(url, { redirect: "follow" });
                    const ct = (res.headers.get("content-type") || "").toLowerCase();
                    const scriptish = ct.includes("javascript") || ct.includes("text/css");
                    if (res.status === 200 && scriptish) { ok = true; break; }
                    if (res.status >= 500) has5xx = true;
                    info = `status=${res.status} ct=${ct || "-"}`;
                } catch (e) {
                    info = e.message.split("\n")[0];
                }
                if (!ok) await sleep(1500);
            }
            if (!ok) bad.push(`${key} (${info})`);
        }, 8);
        // 並列にすると順序が入れ替わるので、ログの読みやすさのために揃える
        bad.sort();
        return { bad, has5xx };
    }

    console.log(`[deploy] (advisory) checking ${targets.length} JS/CSS asset(s) via ${SITE_URL} ...`);
    let { bad, has5xx } = await scan();

    // 5xx（本当の可用性障害）が見えたときだけ、キャッシュされた 5xx を洗い流す再インバリデーション。
    if (bad.length && has5xx && cfDistId) {
        console.warn(`[deploy] advisory: ${bad.length} asset(s) returned 5xx — re-invalidating once to flush cached errors.`);
        try {
            // 失敗したアセットだけを消す。"/*" だと写真まで巻き添えでエッジから
            // 消える（このスクリプトが避けているはずのこと）。
            const rehealPaths = [...new Set(bad.map((b) => `/${b.split(" ")[0]}`))];
            await cf.send(new CreateInvalidationCommand({
                DistributionId: cfDistId,
                InvalidationBatch: {
                    CallerReference: `reheal-${Date.now()}`,
                    Paths: { Quantity: rehealPaths.length, Items: rehealPaths },
                },
            }));
        } catch (e) {
            console.warn("[deploy] advisory: re-invalidation failed:", e.message);
        }
        ({ bad, has5xx } = await scan());
    }

    if (bad.length === 0) {
        console.log("[deploy] advisory check: all sampled assets 200 + script/style MIME.");
    } else {
        // 一律 403(HTML) はほぼ確実にランナー IP の一時ブロック。デプロイは止めない。
        console.warn(
            `[deploy] advisory: ${bad.length}/${targets.length} asset(s) not 200 from THIS runner ` +
            `(CI ランナー IP は WAF/エッジに一時的に 403 されることがある — サイト障害とは限らず、デプロイは失敗させません):`,
            bad.slice(0, 8),
        );
    }
}

/**
 * 配ってはいけないものが出力に混ざっていないか、上げる前に見る。
 *
 * このサイトは「EXIF を落とし、座標は約1kmに丸めて公開する」前提で作られている。
 * ところが一度、EXIF を落とす**前**の原本のURL（srcOriginal）が photos.json 経由で
 * 全ページのHTMLに埋まっていた。同期スクリプトと読み出し側の両方で落とすように
 * したが、どちらかが将来また素通ししたときに気づける場所が無い。
 *
 * ここは「S3 に上げる直前」＝最後に止められる場所。見つけたら止める。
 * 設定ミスは「本番に出す」ではなく「デプロイが落ちる」に倒す。
 */
const FORBIDDEN_IN_OUTPUT = [
    // EXIF を落とす前の原本（GPS が入ったまま）
    "srcOriginal",
    "uploads/originals",
    // 内部文書のID。写真以外が同じテーブルに同居しているので、
    // 出ているなら公開データの絞り込みが漏れている
    "notifs#",
    "comments#",
    "followstats#",
];

/**
 * **「どこかに出てくる」では見ない。JSON の中の位置まで見る。**
 *
 * 素の `includes` だと、**利用者が書いた文章がそのまま引っかかる**。
 * タイトルや説明はページに焼かれるので、「コメント欄 comments# の使い方」
 * と書いた写真が1枚あるだけで、S3 へ上げる直前にここが例外を投げ、
 * **デプロイが丸ごと中止**される（実ビルドで確認: `index.txt`・
 * 各集約ページの HTML と RSC の `.txt` に出て、5ファイル以上で当たった）。
 * 新しい写真も、削除・非公開の反映も出せなくなる。
 *
 * 一方、本物の漏れは必ず JSON の**キー**か**文字列の先頭**として出る。
 * 実ビルドで確かめた出方は2通り（生の JSON と、RSC の中の escape 済み）:
 *
 *     "published":true          … photos.json / 埋め込み JSON
 *     \"published\":true         … RSC の .txt / HTML の中
 *
 * なので、
 *   - `srcOriginal` … キーの位置（引用符で囲まれ、直後が `:`）
 *   - `notifs#` ほか … **ID そのもの**（引用符 → 接頭辞 → ID → 引用符）
 * だけを見る。利用者の文章は、途中に出ても（引用符が前に来ない）、
 * 先頭に出ても（ID の形で閉じない）当たらない。
 *
 * **`uploads/originals` はそのまま部分一致で見る。** これは原本の URL の
 * 一部で、GPS の入った実体そのものを指す——形が変わって漏れても拾いたい
 * ので、ここだけは広く取る（利用者が散文でこの並びを書くことは無い）。
 */
const KEY_SHAPED = new Set(["srcOriginal"]);
const BROAD = new Set(["uploads/originals"]);

/**
 * 引用符の出方。実ビルドで確かめた3通り:
 *
 *     "srcOriginal":            … photos.json / 埋め込み JSON
 *     \"srcOriginal\":           … RSC の .txt と HTML の中
 *     &quot;srcOriginal&quot;:   … HTML のテキストノード・属性（React が逃がす）
 *
 * 3つ目を落としていた（レビューで実ビルドの出力から見つかった）。
 * 網を狭めた側は、狭めた分がそのまま見逃しになる。
 */
const QUOTE = '(?:(?:\\\\)?"|&quot;)';

/**
 * 内部文書のIDの本体。`comments#<写真ID>` のように**必ず ID が続いて閉じる**。
 *
 * 直前の引用符だけを見ていたときは、**キャプションが禁止語で始まると
 * 止まっていた**（`"location":"notifs# の話"` は値の先頭なので引用符が来る）。
 * ID の形（英数字とハイフン）と閉じ引用符まで見れば、日本語の文章とは分かれる。
 */
const ID_BODY = '[A-Za-z0-9_-]{1,80}';

function forbiddenPattern(needle) {
    if (BROAD.has(needle)) return null;                     // 部分一致のまま
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return KEY_SHAPED.has(needle)
        ? new RegExp(`${QUOTE}${esc}${QUOTE}\\s*:`)              // キーの位置
        : new RegExp(`${QUOTE}${esc}${ID_BODY}${QUOTE}`);      // ID そのもの
}

function assertNoForbiddenContent(files) {
    const hits = [];
    for (const file of files) {
        const key = file.split(path.sep).join("/");
        if (!(isHtmlOrTxt(key) || key === "app/data/photos.json")) continue;
        const text = fs.readFileSync(path.join(outDir, file), "utf8");
        for (const needle of FORBIDDEN_IN_OUTPUT) {
            const re = forbiddenPattern(needle);
            const found = re ? re.test(text) : text.includes(needle);
            if (found) hits.push(`${key}: ${needle}`);
        }
    }
    if (hits.length > 0) {
        throw new Error(
            "[deploy] 出力に公開してはいけない値が入っています。デプロイを中止します:\n  " +
            hits.slice(0, 20).join("\n  ") +
            (hits.length > 20 ? `\n  ...ほか ${hits.length - 20} 件` : ""),
        );
    }
}


/**
 * 無効化すべきキーを決める。
 *
 * 「中身が変わったもの」だけでは足りない。**消したものも入れる**——
 * 消しただけではエッジに残った古い実体が返り続ける。今は HTML を
 * no-store で配っているから表面化していないだけで、キャッシュ設定を
 * 変えた瞬間に「消したページが出続ける」に化ける。削除は写真を消した
 * ときの掃除経路そのものなので、ここが効かないと消した内容が
 * 公開されたままになる。
 */
function invalidationTargets(localFiles, beforeUpload, deletedKeys) {
    return [...changedKeys(localFiles, beforeUpload), ...(deletedKeys ?? [])];
}

/**
 * 上げ先と robots.txt が食い違っていたら止める。
 *
 * ここは**両方向**の取り違えを見る:
 *   - 本番バケットに「全面拒否」を上げる → サイトが検索から消える
 *   - staging バケットに「許可」を上げる  → 同じ内容が2つのURLで拾われる
 *
 * どちらも NEXT_PUBLIC_ENV_NAME の注入忘れで起きる。`npm run web:deploy:prod`
 * は**ビルドせずアップロードだけ**するので、環境変数の無いビルド成果物が
 * そのまま本番へ行く経路が実在した。CI の必須チェックだけでは塞げない。
 */
function assertRobotsMatchesTarget(bucketName, robotsText) {
    const isProdTarget = String(bucketName ?? "").startsWith("prod-");
    // Next.js の robots.txt は "User-Agent: *" と "Disallow: /" だけを出す
    const blocksEverything = /^\s*Disallow:\s*\/\s*$/mi.test(robotsText ?? "");
    if (isProdTarget && blocksEverything) {
        throw new Error(
            "[deploy] 本番バケットに『全面拒否』の robots.txt を上げようとしています。\n" +
            "  NEXT_PUBLIC_ENV_NAME=prod を付けてビルドし直してください。",
        );
    }
    if (!isProdTarget && !blocksEverything) {
        throw new Error(
            `[deploy] ${bucketName} に『クロール許可』の robots.txt を上げようとしています。\n` +
            "  本番以外は全面拒否で配信します。NEXT_PUBLIC_ENV_NAME を確認してください。",
        );
    }
}

async function main() {
    console.log(`\n[deploy] Uploading ${outDir} → s3://${bucket}/`);

    copyPhotosJsonIntoOut();
    const allFiles = collectFiles(outDir);
    // robots.txt は必ずある（app/robots.ts が静的に出す）。無い＝ビルドが
    // 途中で終わっているので、それも止める。
    const robotsPath = path.join(outDir, "robots.txt");
    if (!fs.existsSync(robotsPath)) {
        throw new Error("[deploy] out/robots.txt がありません。ビルドが完了していない可能性があります。");
    }
    assertRobotsMatchesTarget(bucket, fs.readFileSync(robotsPath, "utf8"));
    assertNoForbiddenContent(allFiles);
    const assets = allFiles.filter(f => !isHtmlOrTxt(f));
    const htmlFiles = allFiles.filter(f => isHtmlOrTxt(f));

    // アップロード前の状態を控えておく。「実際に中身が変わったファイル」だけを
    // 無効化するために使う（定期ビルドの多くは出力が前回と同じ）。
    const beforeUpload = await listS3Objects();

    // Step 1: Upload new hashed assets first (JS/CSS/images), no --delete yet.
    //         Old assets stay so in-flight requests to current HTML still work.
    //         同時実行を絞って S3 503(SlowDown) を避ける（→ CloudFront に 5xx がキャッシュされ
    //         「一部チャンクだけ 503 で Safari が水和できない」事故を防ぐ）。
    console.log(`[deploy] Step 1/3: uploading ${assets.length} asset(s)...`);
    await runPool(assets, uploadFile, 12);

    // Step 2: Swap HTML — users now receive HTML pointing at the new assets.
    console.log(`[deploy] Step 2/3: uploading ${htmlFiles.length} HTML/txt file(s)...`);
    for (const f of htmlFiles) await uploadFile(f);

    // Step 3: Remove stale objects (assets get a grace period; see deleteStaleKeys).
    console.log("[deploy] Step 3/3: removing stale S3 objects...");
    const remoteObjects = await listS3Objects();
    const deletedKeys = await deleteStaleKeys(allFiles, remoteObjects);

    console.log("\n[deploy] S3 sync complete.");

    // CloudFront invalidation
    const cfDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
    if (cfDistId) {
        const changed = invalidationTargets(allFiles, beforeUpload, deletedKeys);
        const invalidationPaths = invalidationPathsFor(changed);
        if (invalidationPaths.length === 0) {
            console.log("[deploy] 中身の変わったページはありません。CloudFront の無効化はしません。");
        } else {
            console.log(`[deploy] ${changed.length} file(s) changed. Invalidating CloudFront distribution ${cfDistId}...`);
            // 1リクエストあたりのパス数には上限がある。超える分は分けて投げる
            for (let i = 0; i < invalidationPaths.length; i += MAX_PATHS_PER_REQUEST) {
                const chunk = invalidationPaths.slice(i, i + MAX_PATHS_PER_REQUEST);
                await cf.send(new CreateInvalidationCommand({
                    DistributionId: cfDistId,
                    InvalidationBatch: {
                        CallerReference: `${Date.now()}-${i}`,
                        Paths: { Quantity: chunk.length, Items: chunk },
                    },
                }));
            }
            console.log(`[deploy] CloudFront invalidation created (${invalidationPaths.length} paths): ${invalidationPaths.join(" ")}`);
            await sleep(5000); // 反映の初期待ち（この後の検証は参考ログのみ）
        }
    } else {
        console.log("[deploy] CLOUDFRONT_DISTRIBUTION_ID not set — skipping invalidation.");
    }

    // Step 4: 配信の健全性を参考チェック（アドバイザリ）。CI ランナー IP は WAF/エッジに
    //         一時的に 403 されうるため、ここではログするだけでデプロイは止めない
    //         （5xx が見えたときのみ一度だけ再インバリデーション）。
    await verifyAssets(assets, cfDistId);
    // トップの OGP 画像は「一番新しい公開写真」なので、その写真が消えると
    // 次のビルドまで壊れたままになる（削除は S3 の実体も消す）
    await verifyOgImage();

    console.log("\n[deploy] Done.\n");
}

// テストから判定ロジックを検証できるようにエクスポート
module.exports = {
    verifyOgImage,
    assertNoForbiddenContent, assertRobotsMatchesTarget, invalidationTargets,
    FORBIDDEN_IN_OUTPUT, forbiddenPattern, classifyStaleObjects, isHtmlOrTxt, ASSET_GRACE_MS, invalidationPathsFor, changedKeys,
    bulkDeleteGuard, BULK_DELETE_RATIO, BULK_DELETE_MIN, deleteStaleKeys };

if (require.main === module) main().catch(err => {
    console.error("[deploy] ERROR:", err.message ?? err);
    process.exit(1);
});
