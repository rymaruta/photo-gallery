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
            if (stamp !== null) await releaseRebuildSlot(stamp);
            if (budget.counted) await releaseMonthlyBudget(budgetAt);
            return false;
        }
        console.log(`requestSiteRebuild: 再ビルドを依頼しました（${reason}）`);
        return true;
    } catch (e) {
        console.error("requestSiteRebuild error:", e);
        if (stamp !== null) await releaseRebuildSlot(stamp);
        if (budget.counted) await releaseMonthlyBudget(budgetAt);
        return false;
    }
}
