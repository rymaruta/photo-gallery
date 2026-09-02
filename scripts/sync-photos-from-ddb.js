/**
 * sync-photos-from-ddb.js
 *
 * DynamoDB の写真テーブル（PHOTOS_TABLE）から全写真を取得して
 * app/data/photos.json に書き出す。
 * 静的エクスポートビルド前に実行することで、/photo/[id] の SSG に使う。
 *
 * 使い方:
 *   AWS_PROFILE=xxx node scripts/sync-photos-from-ddb.js
 *   または GitHub Actions で AWS 環境変数を設定した状態で実行
 *
 * 環境変数:
 *   AWS_REGION          (default: ap-northeast-1)
 *   PHOTOS_TABLE        (必須)
 *   USERS_TABLE         (CI では必須。表示名の突き合わせに使う)
 *   DRY_RUN=1           ファイルを書かずに件数だけ確認
 *   CI                  取得に失敗したらビルドを止める（Actions では自動で入る）
 *
 * 安全装置（どちらもデプロイ事故を防ぐためのもの）:
 *   1. 取得に失敗したとき、CI では異常終了する。
 *      以前は常に exit 0 で、失敗しても古い photos.json のままビルドが緑で通り、
 *      デプロイが「新しい写真のページ」を S3 から消していた（HTML は猶予なしで削除）。
 *      ローカルは今まで通り警告のみ（認証情報なしでもビルドを回せるように）。
 *   2. 件数が0、または既存ファイルの半分未満に減る書き込みは拒否する。
 *      空のテーブルを指したスキャンで photos.json が空になり、次のビルドで
 *      全ページが消えるのを防ぐ。意図した大量削除のときは --force を付ける。
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");

// .env.local から AWS 認証情報を読み込む
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = requireEnv("PHOTOS_TABLE");
const OUTPUT = path.resolve(__dirname, "../app/data/photos.json");
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.argv.includes("--force");
const IS_CI = !!process.env.CI;
// 「この環境にはまだ写真が無い」を許す。新しく作った環境の最初のビルド用。
// 本番では絶対に立てない（0件を通すと全ページが消える）。
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_PHOTOS === "1";

// 既存ファイルからここまで減る書き込みは事故とみなす（0.5 = 半減）
const SHRINK_LIMIT = 0.5;

/** 既存の photos.json の件数。無い・壊れているときは null（＝比較しない） */
function existingCount(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(parsed) ? parsed.length : null;
    } catch {
        return null;
    }
}

/**
 * この書き込みを許してよいか。
 * 「取得できた件数が急に減った」は、テーブルを間違えた・権限が欠けた・
 * スキャンが途中で切れた、のどれかである可能性が高い。上書きすると
 * 次のビルドでページが消え、デプロイがそれを S3 からも削除してしまう。
 */
function checkWriteSafety(nextCount, prevCount, { allowEmpty = ALLOW_EMPTY } = {}) {
    if (FORCE) return { ok: true, reason: "--force" };
    // 作りたての環境はテーブルが空。リポジトリにコミットされている photos.json は
    // 本番の写真なので、ここで拒否すると staging が本番の写真を並べてしまう。
    // 「空でよい」と明示された環境だけ、0件と大幅減を許す。
    if (allowEmpty) return { ok: true, reason: "ALLOW_EMPTY_PHOTOS=1" };
    if (nextCount === 0) return { ok: false, reason: "取得できた写真が0件です" };
    if (prevCount === null || prevCount === 0) return { ok: true, reason: "比較対象なし" };
    if (nextCount < prevCount * SHRINK_LIMIT) {
        return { ok: false, reason: `${prevCount}件 → ${nextCount}件 と大きく減っています` };
    }
    return { ok: true, reason: "" };
}

/**
 * 公開してはいけない項目。
 *
 * photos.json はビルドの入力であり、そのまま
 *   - クライアントのJSバンドル（lib/routes.ts が丸ごと import している）
 *   - 各ページの静的HTML
 * に展開される。つまりここに残った値は全員に配られる。
 *
 * - srcOriginal … EXIF を落とす**前**の原本のURL。GPS が入ったまま。
 *   撮影日のバックフィル（scripts/generate-thumbnails.js）は DynamoDB を
 *   直接読むので、photos.json から落としても支障は無い。
 * - key … S3 のオブジェクトキー。バケット構造を公開する理由が無い。
 */
// `staticStale` は「静的ページの掃除が届いていない」という内部の印。
// 付くのは非公開の写真だけなので普段は載らないが、再公開の順序次第で
// 残りうる。公開する JSON に内部の事情を出さない
// 公開JSONに載せない項目。
//
// `commentCount` は**秘密ではなく、古くなる数**。定期ビルドを止めている今、
// ビルド時の値が静的HTMLに焼かれ、以後どれだけ増えてもそのまま出続ける。
// 読み手（モーダルのキャプション・写真ページのコメント欄）はどちらも
// 「0 なら描かない」形なので、載せなければ **APIが答えるまで数字を
// 出さない**（＝間違った数を出さない）になる。
//
// **`likes` は落とさない（訂正）。** 同じ理由で一度落としたが、読み手を
// 数え違えていた。`likes` には「0 なら描かない」で済まない使い手が2つある:
//
//   1. `lib/hooks/useGallery.ts` の「人気順」——`(b.likes ?? 0) - (a.likes ?? 0)`。
//      無ければ全部 0 同士で**黙って並べ替えが効かなくなる**。しかも
//      `/photos` が落ちた回は `usePhotos` が差し替えないので**永久に**。
//      利用者からは「人気順を選んだのに新着順のような並び」としか見えない。
//   2. `app/users/UserProfileClient.tsx` の「いいね」ピル——ガード無しで
//      `totalLikes` を描く。プロフィールは静的生成されるので、
//      **全員のHTMLが「いいね 0」と言い切る**（クローラが見るのはこれ）。
//      古い数から「確実に嘘の 0」への入れ替えになる。
//
// 落とすなら、この2つを「未取得」と「0」で分けてからにすること。
const PRIVATE_FIELDS = ["srcOriginal", "key", "staticStale", "commentCount"];

function stripPrivateFields(item) {
    const out = { ...item };
    for (const f of PRIVATE_FIELDS) delete out[f];
    return out;
}

async function scan() {
    const client = new DynamoDBClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
    });

    const items = [];
    let lastKey;
    let page = 0;
    do {
        page++;
        process.stdout.write(`  Scanning page ${page}...\r`);
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
        }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    // 公開済みの「写真」のみ絞り込んで createdAt 降順でソート。
    // テーブルには like#/go# マーカーや golist#/notifs# 文書が同居しているため、
    // src を持つ item（=写真）だけを photos.json に出す（プライバシー保護）。
    return items
        .filter(item => item.src && item.published !== false && item.story !== true)
        .map(stripPrivateFields)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * 再ビルドの「直近に依頼済み」印を下ろす。
 *
 * Lambda 側（api-user/src/rebuild.ts）は、編集による依頼を10分間畳んでいる。
 * 畳まれた依頼は後から実行されないので、そのまま放っておくと
 * 「12:00:00 に誰かが編集してビルドが始まり、12:00:20 に別の人が
 * 説明に書いた電話番号を消して保存」した分が、次に誰かが編集するまで
 * 静的HTMLに残り続ける（定期ビルドは止めてある）。
 *
 * このビルドはたった今テーブルを読んだので、ここまでの編集は反映される。
 * 印を下ろしておけば、これ以降の編集はすぐ次のビルドを起こせる
 * ——畳まれる窓が「10分」から「読み終わるまで」に縮む。
 *
 * 権限が無い環境（デプロイ用ロールが読み取りのみ）では警告1行で通す。
 * 失敗してもビルドは正しい。畳まれる窓が今までどおり10分に戻るだけ。
 */

/**
 * 直近に同期できた写真の件数を控える文書のID。
 *
 * 単一テーブルの他の管理用文書（rebuild#lock）と同じ扱い。
 * `src` を持たないので photos.json には出ない（下の絞り込みで落ちる）。
 */
const SYNC_STATS_ID = "syncstats#photos";

/**
 * 「急に減った」の比較先。
 *
 * 以前は git にコミットされている app/data/photos.json の件数と比べていた。
 * CI はこのファイルを毎回作り直すがコミットはしないので、**比較先は
 * 最後に手でコミットした30件のまま固定**だった。本番が120枚に育ったあと
 * 50件しか取れなくても `50 >= 30 * 0.5` で通ってしまう。
 * 「半分にはできない」と読めて、実際は「15件を下回れない」でしかなかった。
 *
 * 前回うまくいった件数をテーブルに控えて、それと比べる。
 * 読めなければ null を返し、呼び出し側が従来どおりファイルの件数に落とす
 * （初回や権限が無い環境で、守りが強くなりすぎて止まらないように）。
 */
/**
 * 写真の行に焼かれた表示名を、users テーブルの**いまの値**で置き換える。
 *
 * `upload.ts` は投稿時に表示名を写真の行へ焼き込むが、改名は users テーブルの
 * 1行しか触らない。写真の行を書き換える経路はどこにも無く、**このスクリプトも
 * users を見ていなかった**ので、何度ビルドしても旧名が焼き直されていた。
 *
 * 古い名前が出るのは他人に見えるものばかり:
 *   `lib/utils/seo.ts`        JSON-LD の creditText / creator.name
 *   `app/users/[id]/page.tsx` <title> / description / OGP / Person
 *
 * **なぜ Lambda 側で直さないか。** 一度 `updateMyProfile` から写真の行を
 * 書き直す形にして、レビュー2周で回帰を8件出した——Lambda のタイムアウト
 * （6秒）は try/catch で捕まえられないので「保存できているのに失敗と出る」／
 * ページングのカーソル／ストーリーまで書き換える／「同じ名前で保存し直せば
 * やり直せる」は画面が差分ゼロで API を呼ばないので不可能、など。
 * **ここには書き込み経路が無く、6秒の制限もカーソルも無い。** 冪等で、
 * 失敗しても写真の同期そのものは続く。
 *
 * DynamoDB の行そのものは古いままなので、実行時 API（`GET /photos`）が返す
 * 写しは直らない。出るのはモーダルと写真ページの投稿者リンクで、
 * プロフィール画面の見出しは API のプロフィールを優先するので新しい名前。
 */
async function freshDisplayNames(ddb, photos) {
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) {
        // **CI では止める。** 渡し忘れても「警告1行 → 緑 → 旧名を焼き直す」で
        // 症状が出ないので、気づく手段が無い（実際にこの形で1周落とした）。
        // PHOTOS_TABLE を requireEnv で止めているのと同じ扱いにする。
        // ローカル（認証情報なしでビルドを回す）だけ警告で先へ進む。
        // CI かどうかは**呼ぶたびに読む**（module 読み込み時の IS_CI ではなく）。
        // 定数にすると、CI 上でテストを回したときに未設定の場面が
        // process.exit を踏んでワーカーごと落ちる。
        if (process.env.CI) {
            console.error("[sync] USERS_TABLE が未設定です。ワークフローの env を確認してください。");
            process.exit(1);
        }
        console.warn("[sync] USERS_TABLE が未設定のため、表示名の更新は飛ばします");
        return photos;
    }
    const ids = [...new Set(photos.map((p) => p.userId).filter((v) => typeof v === "string" && v))];
    if (ids.length === 0) return photos;

    const names = new Map();
    try {
        // 人数ぶんの GetItem。写真30枚でも投稿者は数人なので件数は小さい
        for (const userId of ids) {
            const res = await ddb.send(new GetCommand({
                TableName: usersTable,
                Key: { userId },
                ProjectionExpression: "displayName, deletedAt",
            }));
            const item = res.Item;
            // 退会した人の名前は入れ直さない（写真側の値もそのまま残す。
            // 消す判断はここではなく、退会処理と読み出し側が持っている）
            if (!item || item.deletedAt) continue;
            const name = typeof item.displayName === "string" ? item.displayName.trim() : "";
            names.set(userId, name || undefined);
        }
    } catch (err) {
        // **写真の同期は止めない。** 名前が古いままなのは今までどおりで、
        // ここで落とすとビルドごと止まる（消した写真のページが残る方が悪い）
        console.warn("[sync] 表示名の突き合わせに失敗:", err.message ?? err);
        return photos;
    }

    let changed = 0;
    const out = photos.map((p) => {
        if (!names.has(p.userId)) return p;
        const next = names.get(p.userId);
        const cur = typeof p.displayName === "string" ? p.displayName : undefined;
        if (cur === next) return p;
        changed++;
        const copy = { ...p };
        if (next) copy.displayName = next;
        else delete copy.displayName;
        return copy;
    });
    if (changed > 0) console.log(`[sync] 表示名を更新: ${changed}件（投稿者 ${ids.length}人）`);
    return out;
}

async function readLastSyncedCount(ddb) {
    try {
        const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: SYNC_STATS_ID } }));
        const n = res.Item?.count;
        return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
    } catch (err) {
        console.warn(`[sync] 前回の件数を読めませんでした（ファイルの件数と比べます）: ${err.message ?? err}`);
        return null;
    }
}

/** 書き込みが通ったあとに控えを更新する。失敗しても本体は成功扱い */
async function writeLastSyncedCount(ddb, count) {
    try {
        await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { id: SYNC_STATS_ID },
            // **属性名は両方とも逃がす。** `count` だけでなく `at` も
            // DynamoDB の予約語で、裸で書くと毎回 ValidationException になる。
            // この関数は失敗を warn で握るので、ビルドは緑のまま通り、
            // 「syncstats#photos の行が一度も作られない」→ readLastSyncedCount が
            // 毎回 null → 比較先が**コミット済みの photos.json（30件）に固定**
            // されていた。つまり「半減したら止める」の基準が 15 件のままで、
            // このファイルのコメントが直したと書いている状態そのものだった。
            UpdateExpression: "SET #c = :c, #at = :at",
            ExpressionAttributeNames: { "#c": "count", "#at": "at" },
            ExpressionAttributeValues: { ":c": count, ":at": new Date().toISOString() },
        }));
    } catch (err) {
        console.warn(`[sync] 件数の控えを更新できませんでした（続行）: ${err.message ?? err}`);
    }
}

async function clearRebuildLock() {
    try {
        const client = new DynamoDBClient({ region: REGION });
        const ddb = DynamoDBDocumentClient.from(client);
        await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { id: "rebuild#lock" },
            UpdateExpression: "REMOVE lastAt",
        }));
        console.log("[sync] 再ビルドの畳み込み印を下ろしました（rebuild#lock）");
    } catch (err) {
        console.warn(`[sync] rebuild#lock を下ろせませんでした（続行）: ${err.message ?? err}`);
    }
}

async function main() {
    console.log(`\n[sync] DynamoDB → ${path.relative(process.cwd(), OUTPUT)}`);
    console.log(`  table : ${TABLE}`);
    console.log(`  region: ${REGION}`);

    let photos;
    try {
        photos = await scan();
    } catch (err) {
        console.error("\n[sync] DynamoDB scan failed:", err.message ?? err);
        console.warn("[sync] photos.json は更新しません（既存ファイルを維持）");
        // CI で古いスナップショットのままビルドを通すと、デプロイが
        // 「その後に増えた写真のページ」を S3 から消してしまう。止める。
        process.exit(IS_CI ? 1 : 0);
    }

    console.log(`\n[sync] ${photos.length} 件取得（公開済みのみ）`);

    if (DRY_RUN) {
        console.log("[sync] DRY_RUN=1 のためファイル書き込みをスキップ");
        return;
    }

    // 比較先は「前回うまくいった件数」。読めなければファイルの件数に落とす。
    const client = new DynamoDBClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(client);
    photos = await freshDisplayNames(ddb, photos);
    const lastSynced = await readLastSyncedCount(ddb);
    const prev = lastSynced ?? existingCount(OUTPUT);
    console.log(`[sync] 比較先: ${lastSynced !== null ? `前回の同期 ${lastSynced}件` : `ファイルの ${prev}件`}`);
    const safety = checkWriteSafety(photos.length, prev);
    if (!safety.ok) {
        console.error(`\n[sync] 書き込みを中止しました: ${safety.reason}`);
        console.error("[sync] テーブル名・リージョン・認証情報を確認してください。");
        console.error("[sync] 意図した削除であれば --force を付けて再実行します。");
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(photos, null, 2) + "\n", "utf-8");
    console.log(`[sync] ${OUTPUT} に書き込みました`);

    await writeLastSyncedCount(ddb, photos.length);
    await clearRebuildLock();
}

if (require.main === module) {
    main().catch((err) => {
        console.error("[sync] unexpected error:", err);
        process.exit(IS_CI ? 1 : 0);
    });
}

module.exports = { checkWriteSafety, existingCount, readLastSyncedCount, writeLastSyncedCount, SYNC_STATS_ID, stripPrivateFields, PRIVATE_FIELDS, freshDisplayNames };
