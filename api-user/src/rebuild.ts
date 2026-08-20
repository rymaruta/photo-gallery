// 静的サイトの再ビルドを頼む。
//
// なぜ要るか:
//   このサイトは静的エクスポートで、写真ページもプロフィールページも
//   ビルド時のHTMLとして S3 に置かれている。退会・写真削除・非公開に
//   しても、DynamoDB と S3 の実体が消えるだけで、**既に配ってある
//   HTML はそのまま残る**。写真ページには本文・撮影地・EXIF・
//   表示名入りの JSON-LD まで焼き込まれているので、「消したのに
//   検索から見える」状態が続く。しかも定期ビルドは Actions の枠の
//   都合で止めてあるので、誰かが main に push するまで直らない。
//
// やり方:
//   GitHub の repository_dispatch を1回叩く。ワークフロー側は
//   concurrency でまとめられるので、連続削除でも枠を食い潰さない。
//
// 設定が無ければ何もしない:
//   トークン未設定の環境（staging・ローカル・テスト）で失敗させたくない。
//   削除そのものは成功しているので、ここで例外を投げるのは筋が悪い。
//   代わりに警告を1行出す。

const REBUILD_REPO = process.env.REBUILD_REPO ?? "";
const REBUILD_TOKEN = process.env.REBUILD_DISPATCH_TOKEN ?? "";

/**
 * 依頼の最短間隔（`coalesce` を指定したときだけ効く）。
 *
 * ここは一度作りを誤った。すべての依頼に一律でクールダウンをかけたところ、
 * 当たった依頼は**見送られるだけで後から実行されない**ので、
 * 「12:00 に写真削除 → 12:04 に別の人が退会」だと退会分の掃除が
 * 永久に走らなくなった（定期ビルドは止めてある。本人はもうアカウントが
 * 無いので手動実行もできない）。
 *
 * 連打の畳み込みは**ワークフロー側で既に済んでいる**——同じ
 * concurrency グループで待機中の実行は GitHub が常に1つにまとめ、
 * その1本は最新のデータで走る。だからここで要るのは
 * 「データを壊さずに何度でも起こせる操作」を抑えることだけ。
 *
 *   - 削除・退会 … 実データを1件消さないと起こせない → 素通し
 *   - 公開状態や本文の編集 … 何度でも押せる → coalesce する
 */
const REBUILD_COOLDOWN_MS = 10 * 60 * 1000;
const LOCK_ID = "rebuild#lock";

async function lockTable() {
    const { ddb, PHOTOS_TABLE } = await import("./dynamodb");
    const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
    return { ddb, PHOTOS_TABLE, UpdateCommand };
}

/**
 * 直近に依頼していなければ印を付けて true を返す（＝自分が依頼してよい）。
 * 条件付き書き込みなので、同時に走っても通るのは1つだけ。
 */
async function claimRebuildSlot(now: number): Promise<boolean> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: LOCK_ID },
            UpdateExpression: "SET lastAt = :now",
            ConditionExpression: "attribute_not_exists(lastAt) OR lastAt < :cutoff",
            ExpressionAttributeValues: { ":now": now, ":cutoff": now - REBUILD_COOLDOWN_MS },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
        // 判定できないときは通す。掃除が遅れる方が、掃除されないより困る
        console.error("claimRebuildSlot error:", e);
        return true;
    }
}

/**
 * 取った印を戻す。依頼そのものが失敗したのに印だけ残ると、
 * 次の依頼まで見送られて掃除が落ちる（トークン失効中に削除した分が
 * 直したあとも走らない、という形で踏む）。
 */
async function releaseRebuildSlot(): Promise<void> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: LOCK_ID },
            UpdateExpression: "REMOVE lastAt",
        }));
    } catch (e) {
        console.error("releaseRebuildSlot error:", e);
    }
}

type RebuildOptions = {
    /**
     * true なら直近の依頼があるとき見送る。
     * 「何度でも無料で起こせる操作」にだけ付けること。
     * 削除・退会に付けてはいけない——その分の掃除が永久に落ちる。
     */
    coalesce?: boolean;
};

/** 呼び出し元を止めない。成否だけ返す（ログ用） */
export async function requestSiteRebuild(reason: string, options: RebuildOptions = {}): Promise<boolean> {
    if (!REBUILD_REPO || !REBUILD_TOKEN) {
        console.warn(`requestSiteRebuild: 未設定のため再ビルドを頼めません（${reason}）。` +
            "REBUILD_REPO と REBUILD_DISPATCH_TOKEN を設定すると、削除後に静的ページも消えます。");
        return false;
    }
    const claimed = options.coalesce === true;
    if (claimed && !(await claimRebuildSlot(Date.now()))) {
        console.log(`requestSiteRebuild: 直近に依頼済みのため見送ります（${reason}）`);
        return false;
    }
    try {
        const res = await fetch(`https://api.github.com/repos/${REBUILD_REPO}/dispatches`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${REBUILD_TOKEN}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "photo-gallery-api",
            },
            body: JSON.stringify({ event_type: "site-rebuild", client_payload: { reason } }),
        });
        if (!res.ok) {
            console.error(`requestSiteRebuild: ${res.status} ${await res.text().catch(() => "")}`);
            if (claimed) await releaseRebuildSlot();
            return false;
        }
        console.log(`requestSiteRebuild: 再ビルドを依頼しました（${reason}）`);
        return true;
    } catch (e) {
        console.error("requestSiteRebuild error:", e);
        if (claimed) await releaseRebuildSlot();
        return false;
    }
}
