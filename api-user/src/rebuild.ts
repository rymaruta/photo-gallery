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

type Claim =
    /** 印を書けた。`stamp` は書いた値——戻すときはこれと一致する場合だけ消す */
    | { allowed: true; stamp: number }
    /** 通してよいが印は書けていない（判定不能）。戻すものが無い */
    | { allowed: true; stamp: null }
    /** 直近に誰かが依頼済み */
    | { allowed: false; stamp: null };

/**
 * 直近に依頼していなければ印を付ける。
 * 条件付き書き込みなので、同時に走っても通るのは1つだけ。
 *
 * 「通してよいか」と「印を書けたか」は別に返す。ひとまとめにしていた頃は、
 * 判定に失敗して素通しした（＝何も書いていない）呼び出しが、あとで
 * releaseRebuildSlot を呼び、**別の呼び出しが取った有効な印を消して**いた。
 */
async function claimRebuildSlot(now: number): Promise<Claim> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: LOCK_ID },
            UpdateExpression: "SET lastAt = :now",
            ConditionExpression: "attribute_not_exists(lastAt) OR lastAt < :cutoff",
            ExpressionAttributeValues: { ":now": now, ":cutoff": now - REBUILD_COOLDOWN_MS },
        }));
        return { allowed: true, stamp: now };
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            return { allowed: false, stamp: null };
        }
        // 判定できないときは通す。掃除が遅れる方が、掃除されないより困る
        console.error("claimRebuildSlot error:", e);
        return { allowed: true, stamp: null };
    }
}

/**
 * 取った印を戻す。依頼そのものが失敗したのに印だけ残ると、
 * 次の依頼まで見送られて掃除が落ちる（トークン失効中に削除した分が
 * 直したあとも走らない、という形で踏む）。
 *
 * **自分が書いた印のときだけ**消す。無条件に消していた頃は、
 * 判定に失敗して素通しした呼び出しの失敗が、同じ瞬間に印を取って
 * 実際にビルドを始めた別の呼び出しの印まで消していた
 * （＝ロックが無いより弱く、続けて2本走る）。
 */
async function releaseRebuildSlot(stamp: number): Promise<void> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: LOCK_ID },
            UpdateExpression: "REMOVE lastAt",
            ConditionExpression: "lastAt = :mine",
            ExpressionAttributeValues: { ":mine": stamp },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
        console.error("releaseRebuildSlot error:", e);
    }
}

/**
 * 1か月に頼んでよい**依頼**の本数。
 *
 * **クールダウンでは費用は止まらない。** deploy.yml の concurrency は
 * 同じグループの**待機中**の実行を常に1つに畳むので、依頼を何本投げても
 * 走るのは「1本ずつ、8分かけて」——つまり本数の天井は依頼の間隔ではなく
 * ビルドの長さで決まる。連打を10分に1回へ絞っても、上限に張り付いた状態は
 * 変わらない。
 *
 * 効くのは**総量の予算**。Actions の枠は月2,000分で、1本8分なので約250本。
 * API のデプロイなど他のワークフローの分を残して 200 にする。
 *
 * **数えているのは依頼であってビルドではない。** 畳み込みがある以上、
 * 依頼200本が実行200本とは限らない（削除が一気に200件走れば、実行は
 * 30本＝240分で済むこともある）。つまりこの予算は**安全側に外れる**——
 * 枠が余っているのに見送る月がありうる。逆向き（枠を超えて通す）に
 * 外れないことを優先している。実行本数で数えるなら、加算する場所は
 * ここではなくビルド開始時（scripts/sync-photos-from-ddb.js は既に
 * 同じテーブルへ書いている）だが、その形だと確保が原子的でなくなり、
 * 同時に来た依頼が揃って通る。
 *
 * 枠を上げたときは `REBUILD_MONTHLY_MAX` を上げる。渡し方は
 * serverless.yml の `rebuildMonthlyMax`（GitHub のリポジトリ変数
 * `REBUILD_MONTHLY_MAX` から deploy-api.yml が渡す）。
 * **Lambda コンソールで直接いじっても次のデプロイで消える。**
 *
 * 読めない値は既定に落とす。`??` だけだと、serverless.yml の
 * `${param:... , ''}` と同じ書き方で空文字が入ったときに `Number("")` が
 * **0** になり、予算が最初から尽きた状態（＝掃除が二度と走らない）になる。
 *
 * 予算は月ごとの別アイテム（`rebuild#budget#YYYY-MM`）で数える。
 * 同じアイテムに持たせると「月が変わったら 0 に戻す」判定が要り、
 * 条件付き加算1回では書けない。月が変われば新しいアイテムになるだけ。
 */
const REBUILD_MONTHLY_MAX = (() => {
    const n = Number(process.env.REBUILD_MONTHLY_MAX);
    return Number.isFinite(n) && n > 0 ? n : 200;
})();
const budgetId = (now: number) => `rebuild#budget#${new Date(now).toISOString().slice(0, 7)}`;

type BudgetClaim =
    /** 1加算できた。失敗したら戻すこと */
    | { allowed: true; counted: true }
    /** 通してよいが加算はできていない（判定不能）。戻すものが無い */
    | { allowed: true; counted: false }
    /** 今月の上限に達している */
    | { allowed: false; counted: false };

/**
 * 今月の予算を1本ぶん確保する。
 *
 * **取れなかったときは掃除が落ちる。** それでも置くのは、枠を使い切ると
 * **どのデプロイも打てなくなる**（＝掃除どころではなくなる）から。
 * 落ちたことはエラーで残すので、枠を上げるか手で1回流せば追いつける。
 *
 * 「通してよいか」と「加算できたか」は別に返す。claimRebuildSlot が同じ所を
 * 一度間違えている——判定に失敗して素通しした（＝何も書いていない）呼び出しが、
 * あとで解放を呼んで**他人の分まで巻き戻して**いた。ここで同じ形にすると、
 * スロットル中に削除→依頼失敗を繰り返すたびに `count` が実際の使用量より
 * 減っていき、上限を超えて依頼が通る（＝この予算が防ごうとしたもの）。
 */
async function claimMonthlyBudget(now: number): Promise<BudgetClaim> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: budgetId(now) },
            UpdateExpression: "ADD #c :one",
            ConditionExpression: "attribute_not_exists(#c) OR #c < :max",
            ExpressionAttributeNames: { "#c": "count" },   // count は予約語
            ExpressionAttributeValues: { ":one": 1, ":max": REBUILD_MONTHLY_MAX },
        }));
        return { allowed: true, counted: true };
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            return { allowed: false, counted: false };
        }
        // 判定できないときは通す（claimRebuildSlot と同じ考え方。
        // 掃除が遅れる方が、掃除されないより困る）
        console.error("claimMonthlyBudget error:", e);
        return { allowed: true, counted: false };
    }
}

/** 依頼そのものが失敗したら予算を戻す（印を戻すのと同じ理由） */
async function releaseMonthlyBudget(now: number): Promise<void> {
    try {
        const { ddb, PHOTOS_TABLE, UpdateCommand } = await lockTable();
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: budgetId(now) },
            UpdateExpression: "ADD #c :minus",
            // 0 を下回らせない（戻し忘れより、戻しすぎの方が直しにくい）
            ConditionExpression: "#c > :z",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":minus": -1, ":z": 0 },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
        console.error("releaseMonthlyBudget error:", e);
    }
}

/**
 * 依頼の再試行。**ここだけ1発勝負だった。**
 *
 * DynamoDB の競合は3回、トランザクションは3回＋バックオフ、S3 の失敗は
 * 500 を返して押し直させる——なのに「消したのに検索に残る」を止めている
 * 唯一の手段が、GitHub の 502 ひとつで落ちて `console.error` 1行だった。
 * 呼び出し元は戻り値を見ないし、定期ビルドは止めてあるので、落ちた1本は
 * **誰かが次に何かを消すまで永久に走らない**。
 *
 * 待ちを入れるのは follow.ts / account.ts と同じ理由（撃ち直しで混雑を
 * 悪化させない）。ただし削除の応答を待たせているので、回数は控えめにする。
 */
const DISPATCH_RETRIES = 2;
const DISPATCH_RETRY_BASE_MS = 200;

/**
 * **依頼に使ってよい時間の上限。**
 *
 * ここを呼ぶ削除系の Lambda は `serverless.yml` で timeout を指定しておらず、
 * 既定の6秒で走っていた（既定が6秒であることは、同じファイルで
 * `timeout: 29` を明示している `deleteAccount` のコメントが書いている。
 * あちらが6秒で走るという意味ではない）。ところが `fetch` には期限が無いので、
 * GitHub が応答を返さないと**削除そのものが6秒で殺される**。
 * データはもう消えているのに 500 が返り、押し直すと今度は
 * 404「写真が見つかりません」になる——「掃除が落ちる」より悪い。
 * しかも殺されると下の解放に到達しないので、月の予算が1本ずつ減り続ける。
 *
 * 再試行を足したこと自体でこの窓が3倍になったが、**期限が無いのは
 * 元からだった**（1本でも6秒使い切れた）。1本ごとの上限と全体の締切を
 * 両方置く。掃除が落ちるのは元の挙動と同じで、削除が失敗するよりよい。
 *
 * 数字の根拠: 呼び出し元の余裕は6秒（下の `timeout: 15` で 15 秒に広げたが、
 * それに寄りかからない）。**応答しない相手には2本しか投げられない**——
 * 1本目に 1.5 秒、待ち 0.2 秒、2本目は残りの 1.3 秒で締切、という並びに
 * なる。これは意図した形で、投げ直しが効くのは「速い 5xx がすぐ返る」場合
 * （3本とも余裕で収まる）。相手が黙っているときに粘っても掃除は走らない。
 *
 * 最初は 800ms / 1.5秒にしたが、Lambda のコールドスタートで
 * DNS + TCP + TLS + GitHub の処理を 800ms に収めるのは攻めすぎだった
 * （そこで落ちると誰の目にも触れない。呼び出し元は戻り値を見ていない）。
 */
export const DISPATCH_ATTEMPT_TIMEOUT_MS = 1500;
const DISPATCH_TOTAL_BUDGET_MS = 3000;

/** やり直して直る見込みがあるか（設定の誤りは何度投げても同じ） */
function isRetryableStatus(status: number): boolean {
    return status >= 500 || status === 429 || status === 408;
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
    let stamp: number | null = null;
    if (options.coalesce === true) {
        const claim = await claimRebuildSlot(Date.now());
        if (!claim.allowed) {
            // 見送った分は**後から実行されない**。
            //
            // 一度「見送った」印を lock に書いたが、それを読む所がどこにも
            // 無く、書くだけの死にコードだった（見送りのたびに DynamoDB へ
            // 1回書くだけ）。読む側を作らないなら置かない。
            //
            // 実際の取りこぼしは、ビルド開始時に
            // scripts/sync-photos-from-ddb.js が印を下ろすことで
            // 「10分」から「テーブルを読み終わるまで」に縮めてある。
            // それでも scan の最中に着地した編集は次の依頼まで載らない。
            // ここを完全に閉じるには定期ビルドか掃除役が要る（Actions の枠の
            // 判断が要るので、勝手には足さない）。
            console.log(`requestSiteRebuild: 直近に依頼済みのため見送ります（${reason}）`);
            return false;
        }
        stamp = claim.stamp;
    }
    // **総量の予算は coalesce の有無に関わらず見る。**
    // 削除経路は素通し（見送った分が後から実行されないため）だが、
    // 「上げて消す」を繰り返せば依頼は無限に作れるので、費用の歯止めは
    // ここにしか置けない。
    const budgetAt = Date.now();
    const budget = await claimMonthlyBudget(budgetAt);
    if (!budget.allowed) {
        console.error(
            `requestSiteRebuild: 今月の再ビルド上限（${REBUILD_MONTHLY_MAX}本）に達したため見送りました（${reason}）。` +
            "静的ページの掃除が遅れます。Actions の枠を上げるか、Deploy Site を手で1回流してください。",
        );
        if (stamp !== null) await releaseRebuildSlot(stamp);
        return false;
    }
    let lastError = "";
    const deadline = Date.now() + DISPATCH_TOTAL_BUDGET_MS;
    for (let attempt = 0; attempt <= DISPATCH_RETRIES; attempt++) {
        if (attempt > 0) {
            // 待つのは「締切までの残り」を超えない範囲だけ
            const wait = Math.min(DISPATCH_RETRY_BASE_MS * 2 ** (attempt - 1), deadline - Date.now());
            if (wait <= 0) break;
            await new Promise((r) => setTimeout(r, wait));
        }
        if (Date.now() >= deadline) break;
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
                // 1本ごとの上限。これが無いと、応答を返さない相手に
                // 呼び出し元の残り時間を全部使われる
                signal: AbortSignal.timeout(Math.min(DISPATCH_ATTEMPT_TIMEOUT_MS, Math.max(1, deadline - Date.now()))),
            });
            if (res.ok) {
                console.log(`requestSiteRebuild: 再ビルドを依頼しました（${reason}）`);
                return true;
            }
            lastError = `${res.status} ${await res.text().catch(() => "")}`;
            // **やり直して直るものだけやり直す。** 401/403（トークン失効・権限）や
            // 404（リポジトリ名違い）は何度投げても同じで、削除の応答を待たせるだけ。
            if (!isRetryableStatus(res.status)) break;
            console.warn(`requestSiteRebuild: ${lastError}（${attempt + 1}回目・やり直します）`);
        } catch (e) {
            // 通信そのものの失敗。GitHub 側の一時障害と区別が付かないのでやり直す
            lastError = e instanceof Error ? e.message : String(e);
            if (attempt === DISPATCH_RETRIES) break;
            console.warn(`requestSiteRebuild: ${lastError}（${attempt + 1}回目・やり直します）`);
        }
    }
    // ここまで来たら諦める。**この1本が落ちると、掃除は誰かが次に何かを
    // 消すまで走らない**（定期ビルドは止めてある）ので、消した写真のページが
    // 検索に残り続ける。呼び出し元は削除自体を成功させる（データはもう消えて
    // いるので 500 は嘘になる）ぶん、ここのログが唯一の手がかりになる。
    console.error(
        `requestSiteRebuild: 再ビルドを頼めませんでした（${reason}）: ${lastError}。` +
        "静的ページが残ります。Actions から Deploy Site を手で1回流してください。",
    );
    // **この2本は締切の外。** 締切が守るのは fetch のループだけで、
    // ここまで来てから殺されれば印と予算は残る（窓は狭まったが閉じていない）。
    // 閉じるには呼び出し元から残り時間を渡す形が要るので、別枠。
    if (stamp !== null) await releaseRebuildSlot(stamp);
    if (budget.counted) await releaseMonthlyBudget(budgetAt);
    return false;
}
