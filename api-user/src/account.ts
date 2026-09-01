import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand, GetCommand, DeleteCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { mediaKeys } from "./mediaKeys";
import { s3DeleteMany } from "./s3Delete";
import { requireEnv } from "./env";
import { requestSiteRebuild } from "./rebuild";
import { isDeletedProfile } from "./types";

// 退会（アカウント削除）。DELETE /user/account、認証必須、呼び出し元の sub のみ対象。
// 不可逆な破壊操作のため「確実に引ける範囲を確実に消す」方針:
//   - 自分の写真/ストーリー … GSI(userId-createdAt-index) で列挙 → S3 本体 + DDB item 削除
//   - アバター/カバー       … profiles/<uid>・profiles/<uid>/cover（決定的キー）
//   - プロフィール          … USERS_TABLE の {userId}
//   - 自分の各ドキュメント  … notifs#/followstats#/following#
//   - 自分の「フォロー中」   … following の各 target の follow# マーカー削除 + target.followers 減算
// 写真・アバターの削除失敗は数え、残っていれば Cognito を消す前に 500 で
// 止める（再実行で収束する。付帯文書だけベストエフォート続行）。成功時 { ok: true }。
//
// v1 スコープ外（消さない・許容）: 「いいね」マーカー / 各写真に散在する自分のコメント /
// 自分への被フォロー。いずれも per-user インデックスが無く全 Scan が必要なため今回は対象外。
// 写真が消えれば実害は軽微（孤立マーカー + 他人側の軽微なカウント残り）で、将来の定期
// リコンサイル（Scan バッチ）で掃除できる。

const USERS_TABLE = requireEnv("USERS_TABLE");

/**
 * フォロー解除の片付けを試す回数。
 * 一番多い失敗（相手が人気ユーザーのときの TransactionConflict）は
 * その場でやり直せば通る。通らなかった分は following# に残して次に託す。
 */
const FOLLOW_CLEANUP_ATTEMPTS = 3;

/**
 * やり直しの前に待つ時間（ミリ秒）。回を追うごとに倍にする。
 * TransactionConflict は待てば解けるが、スロットリングは待たずに
 * 撃ち直すと悪化する。同じループで両方を扱うので、短く待つ。
 */
const FOLLOW_RETRY_BASE_MS = 150;

/**
 * この時間を切ったらフォローの片付けを打ち切る（ミリ秒）。
 *
 * 打ち切らないと、フォローの多い人の退会で実行時間を使い切って
 * **ハンドラが返らない**。呼び出し側は !res.ok を見て Cognito の削除に
 * 進まないので、「写真もプロフィールも消えたのにログインできる
 * アカウントだけが残る」——このファイルが繰り返し避けようとしている状態
 * ——に落ちる。しかも静的ページの掃除依頼はこのループの**後ろ**にあるので、
 * それも飛ぶ。フォロワー数のズレより、そちらを優先して残す。
 */
const CLEANUP_RESERVE_MS = 6000;
// **未設定なら起動時に止める。** `?? ""` / `!` にしていた頃は、環境変数が
// 空でも S3 の削除を**黙って飛ばして** DynamoDB の行だけ消し、成功を返していた。
// GPS 入りの原本（srcOriginal）を含む実体が公開URLに残り、項目が消えている
// ので**どの削除経路からも二度と辿れない**。
// 取り返しのつかない削除なので「分からないなら止める」に倒す
// （profile.ts と同じ扱い。CLAUDE.md の方針）。
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

/** @returns 消せたら true（失敗は握らず呼び出し側で数える） */
async function s3Delete(key: string): Promise<boolean> {
    if (!key) return true;
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
        return true;
    } catch (e) {
        console.error(`deleteAccount: S3 delete failed for ${key}:`, e);
        return false;
    }
}



/** items を最大 limit 本の並列で処理する（Lambda の実行時間を使い切らないため） */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await fn(item);
        }
    });
    await Promise.all(workers);
}

/** @returns 消せたら true。ベストエフォートの掃除では戻り値を無視してよい */
async function ddbDelete(table: string, key: Record<string, unknown>): Promise<boolean> {
    try {
        await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
        return true;
    } catch (e) {
        console.error(`deleteAccount: DDB delete failed for ${JSON.stringify(key)}:`, e);
        return false;
    }
}

/**
 * 自分が押さえている `username#<handle>` の予約を解放する。
 *
 * `api-user/src/userProfile.ts` の `releaseUsername` と**対**。
 * 条件（`ownerId = :o`）まで含めて同じにすること——ここだけ無条件の
 * DeleteItem だった。墓石に handle を残すようにしたので、退会をやり直すと
 * ここが2回走りうる。条件が無いと、**その handle を後から取った別人の
 * 予約を消してしまう**。
 *
 * 戻り値は「解放できたか」ではなく「気にすべき失敗があったか」で見る。
 * 条件不成立（既に無い / 他人のもの）は目的が達成済みなので成功扱い。
 */
async function releaseOwnUsername(handle: string, ownerId: string): Promise<boolean> {
    try {
        await ddb.send(new DeleteCommand({
            TableName: USERS_TABLE,
            Key: { userId: `username#${handle}` },
            ConditionExpression: "ownerId = :o",
            ExpressionAttributeValues: { ":o": ownerId },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return true;
        console.error(`deleteAccount: release username failed for ${handle}:`, e);
        return false;
    }
}

/**
 * following# 文書の list 配列を読む。
 *
 * 失敗を「空」と混ぜてはいけない。エラーも空配列で返していた頃は、
 * `following#<uid>` の GetItem がスロットリングされると**ループが1回も
 * 回らないまま** following# を消していた。50人フォローしていた人が退会
 * すると、50個のマーカーが孤児になり、50人のフォロワー数が1多いまま
 * 誰にも直せなくなる（本人はもうアカウントが無い）。
 */
async function readList(id: string): Promise<{ list: unknown[]; ok: boolean }> {
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        const list = res.Item?.list;
        return { list: Array.isArray(list) ? list : [], ok: true };
    } catch (e) {
        console.error(`deleteAccount: read list failed for ${id}:`, e);
        return { list: [], ok: false };
    }
}

/**
 * follow# マーカーの削除と、相手の followers の減算を**1つの書き込みにする**。
 *
 * ここは2度作りを誤っている。
 *   1回目: どちらも無条件 → 途中で実行時間を使い切って再実行されると、
 *          既に消えたマーカーの分までもう一度減って**引きすぎ**た。
 *   2回目: 「消せたと確かめられたときだけ減らす」にしたが、
 *          タイムアウト（＝実際は削除成功）だと減らずに終わり、再実行しても
 *          今度は条件不成立で減らないので**引き足りない**まま固定された。
 *
 * どちらも「別々の書き込みなので、片方だけ効いた状態が残る」ことが原因。
 * DynamoDB のトランザクションなら、両方効くか両方効かないかのどちらかに
 * なる。タイムアウトで結果が分からなくても、やり直せば
 *   - 前回コミット済み → マーカーが無いので条件不成立 → 何も起きない
 *   - 前回未コミット   → 両方まとめて適用される
 * のどちらかに収束する。
 *
 * ただし **TransactionCanceledException = 条件不成立、ではない**。
 * ここも一度誤った。名前だけを見て「条件不成立だから引き算は不要」と
 * 決めつけ、マーカーを無条件に消していたので:
 *
 *   人気ユーザー T をフォロー中の U が退会 → ほぼ同時に別の人が T を
 *   フォロー（follow.ts の statBump が followstats#T へ素の UpdateItem を撃つ）→
 *   競合でトランザクション側がキャンセル（CancellationReasons[1].Code =
 *   "TransactionConflict"、**未コミット**）→ それをマーカー削除の合図と
 *   読んでマーカーだけ消す → T の followers は U の分が引かれないまま、
 *   マーカーも一覧も無い＝**誰にも直せない +1**。
 *
 * followstats#<人気ユーザー> は全フォロー/解除が触るので、競合は日常。
 * しかも TransactionCanceledException は SDK の自動再試行の対象外（400系）。
 * だから CancellationReasons を1つずつ読んで、
 * 「本当に条件不成立だったのか」を確かめる。
 *
 * 戻り値は「この呼び出しで処理し終えたか」。false ならやり直しが要る。
 */
type CancelReason = { Code?: string };

async function unfollowAtomically(target: string, uid: string): Promise<boolean> {
    try {
        await ddb.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Delete: {
                        TableName: PHOTOS_TABLE,
                        Key: { id: `follow#${target}#${uid}` },
                        ConditionExpression: "attribute_exists(id)",
                    },
                },
                {
                    Update: {
                        TableName: PHOTOS_TABLE,
                        Key: { id: `followstats#${target}` },
                        UpdateExpression: "SET followers = followers - :one",
                        // 相手の集計が無い・既に0なら減らさない。その場合は
                        // トランザクションごと落ちるので、下でマーカーだけ消す。
                        ConditionExpression: "attribute_exists(id) AND followers > :z",
                        ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                    },
                },
            ],
        }));
        return true;
    } catch (e) {
        const name = (e as { name?: string }).name ?? "";
        if (name !== "TransactionCanceledException") {
            console.error(`deleteAccount: unfollow transaction failed for ${target}:`, e);
            return false;
        }
        const reasons = (e as { CancellationReasons?: CancelReason[] }).CancellationReasons;
        if (!Array.isArray(reasons) || reasons.length < 2) {
            // 理由が分からないなら何も消さない。消してしまうと、
            // 未コミットだった場合に減算が永久に失われる。
            console.error(`deleteAccount: transaction cancelled without reasons for ${target}:`, e);
            return false;
        }
        const [markerReason, statsReason] = reasons;
        if (markerReason?.Code === "ConditionalCheckFailed") {
            // マーカーが既に無い＝前回の実行で処理済み。借りは無い。
            return true;
        }
        if (statsReason?.Code === "ConditionalCheckFailed") {
            // 相手の集計が無い / 既に0。減らすものが無い。
            //
            // 実在する主な理由は「相手が先に退会している」こと。退会は
            // 自分の followstats# を消す一方、自分への被フォローのマーカー
            // （follow#<自分>#<フォロワー>）は消さない（このファイル冒頭の
            // スコープ外の項）。だから「マーカーはあるが集計が無い」が残る。
            // followers は follow.ts の statBump が if_not_exists で必ず数値にし、
            // 減算側は followers > 0 条件付きなので負にはならない。
            // 0 なのは上記か過去の引きすぎで、どちらも「引かない」が正しい。
            // マーカーだけが残るので単体で消す。
            try {
                await ddb.send(new DeleteCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id: `follow#${target}#${uid}` },
                    ConditionExpression: "attribute_exists(id)",
                }));
                return true;
            } catch (e2) {
                if ((e2 as { name?: string }).name === "ConditionalCheckFailedException") return true;
                console.error(`deleteAccount: follow marker delete failed for ${target}:`, e2);
                return false;
            }
        }
        // TransactionConflict / ThrottlingError / ProvisionedThroughputExceeded /
        // ValidationError など。**未コミット**なので何も消さない。
        console.error(
            `deleteAccount: transaction cancelled for ${target} ` +
            `(${reasons.map((r) => r?.Code ?? "?").join(",")})`);
        return false;
    }
}

// DELETE /user/account — 退会（認証必須・自分のデータのみ削除）
export const deleteAccount: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event, context) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");

    try {
        // 1. 自分の写真・ストーリー（GSI で列挙）。GSI の射影に依存しないよう id を集めてから
        //    本体を GetItem し、S3 本体/サムネ + DDB item を削除する。
        let mediaFailures = 0;
        // この実行で「静的ページを持つ写真」を消したか。作り直しを頼むかの
        // 判定に使う（2回目の退会では false——1回目で全部消えているため）。
        //
        // **下書きとストーリーは数えない。** 静的ページの入力になる
        // photos.json は `src && published !== false && story !== true` で
        // 絞られる（scripts/sync-photos-from-ddb.js）ので、下書きしか無い人・
        // ストーリーしか無い人には作り直す HTML が1枚も無い。全部数えて
        // いたので、その人の退会で毎回8分のビルドが空振りしていた。
        //
        // **数ではなく真偽値。** 使い道は「1枚でもあるか」だけなので、
        // 数えると 8並列の worker から `+=` する形になり、すぐ下の
        // mediaFailures と同じ「await をまたいで古い値を書き戻す」事故の
        // 芽を残す。真偽値の代入なら取りこぼしようがない。
        let deletedPublicPhoto = false;
        let lastKey: Record<string, unknown> | undefined;
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :u",
                ExpressionAttributeValues: { ":u": uid },
                ExclusiveStartKey: lastKey,
            }));
            // 1ページ分をまとめて処理する。1枚ずつ直列に回すと、写真が数十枚で
            // 実行時間を使い切って途中終了していた。S3 は消してから DDB を消す
            // （逆にすると、途中で切れたときに GPS 入りの原本だけが公開のまま残る）。
            const projectedItems = ((res.Items ?? []) as Record<string, unknown>[])
                .filter((p) => String(p.id ?? ""));
            await mapWithConcurrency(projectedItems, 8, async (projected) => {
                const id = String(projected.id);
                let item = projected;
                // この写真の失敗数。共有カウンタへは**最後に1回・同期的に**
                // 足す。`mediaFailures += await ...` は左辺を await の前に
                // 読むので、8並列では他の worker が足した分を古い値で
                // 上書きして**失敗が 0 に戻り**、500 で止まるべき退会が
                // 200 で通っていた（de7b871 レビューが実ハンドラで再現）。
                let itemFailures = 0;

                try {
                    const full = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
                    if (full.Item) item = full.Item as Record<string, unknown>;
                } catch (e) {
                    console.error(`deleteAccount: get photo failed for ${id}:`, e);
                    // GSI の射影は全項目を持つとは限らない。読めなかった写真は
                    // srcOriginal（GPS入り原本）を消し漏らしうるので失敗に数える
                    itemFailures++;
                }
                itemFailures += await s3DeleteMany(mediaKeys(item), "deleteAccount");
                // その写真に付いたコメントも消す。写真だけ消していたので、
                // 退会後も「本文・投稿者名・投稿者のsub」が誰でも読めるまま
                // 残っていた（一覧APIは公開で、写真の存在確認もしない）。
                // 消したい本人からは、もう手の届かない場所に残る。
                //
                // **行（と comments#）を消すのは、その写真の S3 が全部消えた
                // ときだけ。** 行は S3 キーの唯一の手がかりなので、失敗した
                // まま消すと、500 → 再実行しても GSI に出てこず
                // 「消し残しの原本が公開URLに孤児で残る」——このコミット群が
                // 塞ぎに行った穴そのものに戻る（de7b871 レビューが再現）。
                // comments# は行より先に消す（逆だと comments# の失敗を
                // 再実行で拾う手がかりが無くなる）。
                if (itemFailures === 0) {
                    if (!await ddbDelete(PHOTOS_TABLE, { id: `comments#${id}` })) itemFailures++;
                }
                if (itemFailures === 0) {
                    if (!await ddbDelete(PHOTOS_TABLE, { id })) itemFailures++;
                    // 静的ページの入力（photos.json）と同じ条件
                    else if (item.src && item.published !== false && item.story !== true) {
                        deletedPublicPhoto = true;
                    }
                }
                mediaFailures += itemFailures;
            });
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        // 2. アバター/カバー（決定的キー・探索不要）。GPS は無いが、
        //    消し残しは公開URLに残り続けるので写真と同じく失敗に数える
        //    （キーが決定的なので再実行で必ずやり直せる）
        if (!await s3Delete(`profiles/${uid}`)) mediaFailures++;
        if (!await s3Delete(`profiles/${uid}/cover`)) mediaFailures++;

        // 写真の削除に失敗が残っていたら、**Cognito を消す前に**止める。
        //
        // ステップ4（フォロー掃除）は失敗しても 200 で通す——残るのは
        // 「相手のフォロワー数が1多い」だけで、影響が軽いから成り立つ判断。
        // 写真は違う。消し残しは **GPS 入りの原本が公開URLに残る**ことを
        // 意味し、200 を返すとクライアントは Cognito のアカウント削除まで
        // 進むので、やり直せる人がいなくなる。ここで 500 を返せば
        // アカウントは残っていて、退会をもう一度押せば続きから消える
        // （このループは冪等——消えた写真はもう一覧に出ない）。
        // 恒常的な失敗（権限の破壊など）で退会がブロックされるのは
        // 受け入れる。写真が消せない状態でアカウントだけ消す方が悪い。
        if (mediaFailures > 0) {
            console.error(`deleteAccount: ${mediaFailures} media deletion(s) failed for ${uid}; aborting before Cognito delete`);
            return jsonError(500, "画像の削除を完了できませんでした。アカウントはまだ削除されていません。時間をおいてもう一度お試しください");
        }

        // 3. プロフィール（USERS_TABLE）
        //    ユーザー名の予約（username#<handle>）も一緒に消す。残すと
        //    **その handle は誰にも取れないまま永久に残る**（A-5 と同じ型）。
        //
        //    **プロフィールを読めなかったら、ここで止める。** 以前は catch で
        //    握って先へ進んでいたが、そうすると handle が分からないまま墓石で
        //    行を上書きしてしまい、予約を解放する手がかりが消える——退会を
        //    やり直しても拾えない。読めないなら 500（アカウントはまだ生きて
        //    いるので、押し直せば続きから消える）。写真の消し残しで止めるのと
        //    同じ考え方。
        let handle = "";
        let profileWasLive = false;
        try {
            const prof = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: uid } }));
            handle = typeof prof.Item?.username === "string" ? prof.Item.username : "";
            profileWasLive = !!prof.Item && !isDeletedProfile(prof.Item);
        } catch (e) {
            console.error("deleteAccount: read profile failed:", e);
            return jsonError(500, "プロフィールを読めませんでした。アカウントはまだ削除されていません。時間をおいてもう一度お試しください");
        }
        // **解放が落ちたら止める。** 200 を返すと呼び出し側は Cognito の
        // ユーザーを削除してサインアウトするので、以後この sub の JWT を
        // 取れる人は誰もいない——`DELETE /user/account` を呼び直せる主体が
        // 消える。つまり 500 を返さないかぎり「やり直し」は起きず、
        // 墓石に handle を残しても誰も読みに来ない（0773ee1 の穴。
        // ownerId 条件も墓石の handle も、やり直しが起きる前提でだけ
        // 意味を持っていた）。
        //
        // ここで恒常的に失敗しうるのは IAM だけで、それは直後の墓石 Put も
        // 同じステートメントに依存する＝どのみち 500 になる。条件不成立は
        // 成功扱いなので、残りは全部一時的な失敗。押し直せば続きから消える。
        // 墓石より**前**で止めるので、やり直しは生きたプロフィール行から
        // handle を読み直せる。
        if (handle && !await releaseOwnUsername(handle, uid)) {
            return jsonError(500, "ユーザー名の解放を完了できませんでした。アカウントはまだ削除されていません。時間をおいてもう一度お試しください");
        }
        // **消すのではなく、退会済みの印（墓石）に置き換える。**
        //
        // ただ消すと、消したはずのアカウントが復活しえた。API Gateway の
        // JWT オーソライザは署名と exp しか見ないので、Cognito のユーザーを
        // 消しても既に配ったトークンは期限まで通る。別の端末に残っていた
        // タブが GET /user/profile を叩くと「行が無い人」に見え、
        // userProfile.ts の createProfileIfMissing（PostConfirmation の
        // 取りこぼしを救う仕組み）が行を作り直す。作られた行は実在判定を
        // 通すので、**消えた ID がフォローできる**状態になり、誰も掃除しない。
        //
        // ttl は DynamoDB の TTL 用（epoch 秒）。**このテーブルの TTL は
        // まだ有効化していない**ので、今のところ墓石は消えない。userId だけの
        // 小さな行なので当面はそれでよい。
        //
        // **TTL を有効にする前に、コメントの掃除役を入れること。**
        // comments.ts の getComments は、表示のたびにこの墓石を引いて
        // 退会した人の名前を伏せている（notify.ts の deletedUserIds）。
        // 墓石が消えると集合から外れ、**365日後に退会した人の実名が
        // 古いコメント上で公開に戻る**。fail-open なので警告も出ない。
        // 掃除したくなったら、まず本文と name をコメント文書から消す役を
        // 作り、そのあとで TTL を1回だけ有効にする:
        //   aws dynamodb update-time-to-live \
        //     --table-name prod-photo-gallery-users \
        //     --time-to-live-specification "Enabled=true,AttributeName=ttl"
        const deletedAt = new Date();
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: {
                userId: uid,
                deletedAt: deletedAt.toISOString(),
                ttl: Math.floor(deletedAt.getTime() / 1000) + 365 * 24 * 60 * 60,
                // **handle は墓石に残す。** 予約の解放が落ちたときに、退会を
                // やり直して拾えるようにするため（残さないと永久に解放できない）。
                // 解放は ownerId 一致が条件なので、その handle を後から取った
                // 別人の予約を消してしまうことはない。
                // 検索に漏れないことは userSearch.ts の toHit が墓石を弾いて
                // 担保する（そこにテストがある）。
                ...(handle ? { username: handle } : {}),
            },
        }));

        // 静的ページの掃除を頼む。DynamoDB と S3 を消しても、既に配ってある
        // 写真ページ・プロフィールページのHTMLは残っている（本文も撮影地も
        // 表示名入りの JSON-LD も焼き込まれている）。定期ビルドは止めてあるので、
        // ここで頼まないと誰かが push するまで消えない。
        //
        // **ステップ4/5（フォローの掃除）より前に頼む。** 以前は最後に置いて
        // いたが、間のループは最大3周×2000件で待ち時間も挟むと明記されていて、
        // 実行時間を使い切って落ちうる。そこで落ちると、やり直しの回は
        // 「何も消していない」ので下の条件に掛からず、**二度と頼まれない**
        // （0773ee1 で入れた条件の穴。それ以前は毎回無条件に頼んでいたので
        //  拾えていた）。フォロワー数は静的ページに焼かれていないので、
        // ステップ4/5 の前後で作り直す中身は変わらない。
        //
        // 待つ。Lambda はハンドラが返った瞬間に実行環境を凍らせるので、
        // 投げっぱなしにすると TLS ハンドシェイクの途中で止まり、依頼は届かない
        // （しかも何も記録されないので、届いたように見える）。
        // この関数は例外を飲んで真偽値を返すので、待っても失敗にはならない。
        //
        // **この実行で何も消していないなら頼まない。** 2回目の退会（1回目が
        // Cognito 削除で落ちた等）では写真もプロフィールも既に消えていて、
        // 作り直す中身が無い。無条件に投げていたので Actions の枠を空振りで
        // 使っていた（定期ビルドを止めている今は効く）。
        //
        // `profileWasLive` は残す。1回目が「写真は消したが墓石を書く前に
        // 落ちた」ときの拾い直しがここにしか無いため（そのときやり直しの回は
        // deletedPublicPhoto が false になる）。代償として、公開写真を一度も持たなかった
        // 人の退会では作り直す中身が無いのに1回頼む——消しそこねて HTML が
        // 残り続けるよりは、空振り1回の方がよい。
        if (deletedPublicPhoto || profileWasLive) {
            await requestSiteRebuild(`account deleted: ${uid}`);
        }

        // 4. 自分の「フォロー中」: follow# マーカーを消し、消せたときだけ
        //    相手の followers を戻す。
        //
        //    以前は無条件に消して無条件に減らしていた。この処理は直列で
        //    最大2000件回るので途中で実行時間を使い切ることがあり、
        //    しかも呼び出し側は失敗を見て「もう一度お試しください」と出す。
        //    もう一度走ると、既に消えたマーカーの分まで**もう一度**
        //    減らすので、**他人のフォロワー数が実際より小さくなる**
        //    （相手には直す手段が無い。こちらはもうアカウントが無いので
        //    フォローし直すこともできない）。
        // 片付け切れなかったときは following# を残す。消してしまうと
        // やり直す手がかりが無くなり、相手のフォロワー数が1多いまま
        // 誰にも直せなくなる（こちらはもうアカウントが無い）。
        //
        // 直列で最大2000件回していたが、写真の削除と同じく並列にする
        // （すぐ上の mapWithConcurrency）。1件ずつ待っていると、
        // フォローの多い人の退会が実行時間を使い切って途中で切れる。
        //
        // 失敗した分はその場でやり直す。ここで一番多い失敗は
        // TransactionConflict——相手が人気ユーザーだと、他の人のフォロー操作と
        // ぶつかる。一度きりで諦めると、その1件は誰にも直せないまま残る
        // （この関数を呼べる人はもう存在しない）。
        //
        // 残り時間を見て打ち切る。掃除の依頼（下）に必ず到達させる。
        const timeLeft = () => context?.getRemainingTimeInMillis?.() ?? Infinity;
        const following = await readList(`following#${uid}`);
        let targets = following.list
            .map((t) => (typeof t === "string" ? t : ""))
            .filter(Boolean);
        for (let attempt = 0; attempt < FOLLOW_CLEANUP_ATTEMPTS && targets.length > 0; attempt++) {
            if (timeLeft() < CLEANUP_RESERVE_MS) {
                console.warn(`deleteAccount: out of time; ${targets.length} follow target(s) left`);
                break;
            }
            if (attempt > 0) {
                // 待たずに撃ち直すと、スロットリング由来の失敗は悪化する
                await new Promise((r) => setTimeout(r, FOLLOW_RETRY_BASE_MS * 2 ** (attempt - 1)));
            }
            const failed: string[] = [];
            await mapWithConcurrency(targets, 8, async (t) => {
                if (timeLeft() < CLEANUP_RESERVE_MS) { failed.push(t); return; }
                if (!await unfollowAtomically(t, uid)) { failed.push(t); return; }
                // フォロー通知の間引きマーカー（follow.ts の follownotify#）も消す。
                // 消し忘れていた頃は退会のたびに1件ずつ残り、スコープ外リストにも
                // 載っていない「誰も消さないゴミ」だった。ただの間引き印なので
                // ベストエフォート（ddbDelete は失敗を握って続行する）。
                await ddbDelete(PHOTOS_TABLE, { id: `follownotify#${t}#${uid}` });
            });
            targets = failed;
            // 最後の回では「やり直す」と書かない（実際にはもう回らない）
            if (targets.length && attempt < FOLLOW_CLEANUP_ATTEMPTS - 1) {
                console.warn(`deleteAccount: retrying follow cleanup for ${targets.length} target(s)`);
            }
        }
        const followCleanupComplete = following.ok && targets.length === 0;

        // 5. 自分の各ドキュメント（既知キー）
        await ddbDelete(PHOTOS_TABLE, { id: `notifs#${uid}` });
        await ddbDelete(PHOTOS_TABLE, { id: `followstats#${uid}` });
        if (followCleanupComplete) {
            await ddbDelete(PHOTOS_TABLE, { id: `following#${uid}` });
        } else {
            // ここで 500 を返してはいけない。呼び出し側（app/auth/context.tsx）は
            // !res.ok だと Cognito の削除に進まないので、権限や設定の誤りで
            // 恒常的に失敗する種類だと、**写真もプロフィールも消えたのに
            // ログインできるアカウントだけが残り、退会が永久に完了しない**。
            // 一度そうしてしまい、静的ページの掃除依頼（下）も飛ばしていた。
            //
            // ただし 200 を返すと、この uid で退会APIを呼べる人はもういない
            // （Cognito のアカウントごと消える）。つまり following# を残しても
            // **自動でやり直す主体はいない**。残っているズレは
            // 「相手のフォロワー数が1多い」だけなので、掃除役ができるまでは
            // 手がかりとして残す、という割り切り。定期の掃除は入れていない
            // （Actions の枠の判断が要るので勝手に足さない）。
            console.error(
                `deleteAccount: follow cleanup incomplete for ${uid}; ` +
                "keeping following# (needs a manual reconcile; no sweeper exists)");
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("deleteAccount error:", e);
        return jsonError(500, "退会処理に失敗しました");
    }
};
