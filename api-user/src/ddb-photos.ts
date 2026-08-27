import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import type { Photo } from "./types";

/**
 * 新規写真を保存する。既存の id には絶対に書き込まない。
 * このテーブルには写真以外（通知・コメント・フォロー関係）も同じキー空間に入っており、
 * 無条件の Put だと他人のレコードを丸ごと置き換えられてしまうため。
 * 既存写真の更新は photoUpdate.ts の UpdateCommand を使うこと。
 */
export async function putPhoto(photo: Photo): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: photo,
        ConditionExpression: "attribute_not_exists(id)",
    }));
}

/**
 * その userId の項目（写真・下書き・ストーリー）が1件でもあるか。
 *
 * フォローの実在判定で使う。USERS_TABLE の行だけを見ていた頃は、
 * PostConfirmation トリガーが失敗した人・トリガー導入前に登録した人が
 * **誰からもフォローできなかった**（プロフィールページは 200 で普通に
 * 開き、ボタンも出るので、押して初めて 404 になる）。何か上げている人は
 * 明らかに実在するので、その手がかりも見る。
 *
 * **絞り込みは意図的に付けていない。** 下のcountUserPhotos は
 * ストーリーを外すが、こちらは「実在の証拠」を探しているだけなので
 * ストーリーでも下書きでも構わない（ストーリーは24時間で消えるため、
 * それだけの人は救済が揺れるが、救えるときに救う方を採る）。
 *
 * **FilterExpression を足すなら Limit を外してページングすること。**
 * DynamoDB は Limit をフィルタ**適用前**に評価するので、絞り込みを
 * 足したまま Limit 1 にすると「最新の1件がストーリーだった人は
 * 写真があっても 0 件」になり、この修正が壊れる。
 */
export async function hasAnyUserItem(userId: string): Promise<boolean> {
    const res = await ddb.send(new QueryCommand({
        TableName: PHOTOS_TABLE,
        IndexName: USER_INDEX,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
        Limit: 1,
        Select: "COUNT",
    }));
    return (res.Count ?? 0) > 0;
}

/**
 * 100枚制限の判定に使う「その人の写真の枚数」。
 *
 * 以前は Query 1回の Count をそのまま返していた。DynamoDB の Query は
 * 1MB 読んだ時点で打ち切られるので、写真が増えるほど**少なめに数える**。
 * さらにこの GSI には userId を持つ項目が全部載るので、ストーリーまで
 * 数えていた。ページングして最後まで数え、ストーリーを外す。
 *
 * **下書き（published:false）は数える。** これは容量と費用の上限なので、
 * 公開しているかどうかは関係ない。外すと「下書きなら無制限に上げられる」
 * 穴になる。以前このコメントは「下書きも絞る」と書いていたが、
 * 実装はそうなっておらず、実装の方が正しかった。
 * 次に読む人が「コメントどおりに直す」と穴が開くので、ここを直した。
 */
export async function countUserPhotos(userId: string): Promise<number> {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            // 写真だけ（ストーリーは除く）。listMyPhotos と同じ条件にする。
            FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
            ExpressionAttributeValues: { ":uid": userId },
            Select: "COUNT",
            ExclusiveStartKey: lastKey,
        }));
        count += res.Count ?? 0;
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return count;
}

// 自分の写真を新しい順で全件取得（下書き=非公開も含む）。
// 公開一覧と違い published フィルタを付けないのが肝（本人だけが自分の下書きを見られる）。
export async function listMyPhotos(userId: string): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            // ストーリーを除く。ストーリーも src と userId と published:false を
            // 持つので、これが無いと「下書き」として一覧に出る。そこから
            // 「公開する」を押すと永久の写真ページになり、24時間後の期限切れ
            // 掃除が実体だけ消して壊れたページが残った。
            FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
            ExpressionAttributeValues: { ":uid": userId },
            ScanIndexForward: false, // createdAt ソートキーの降順（新しい順）
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

/**
 * 自分の「メディアの実体を持つ item」を全件返す（**ストーリーも含む**）。
 *
 * discardUpload の使用中判定用。listMyPhotos（ストーリー除外）で判定して
 * いた頃は、**自分の生きているストーリーの実体を discard で消せた**——
 * ストーリーの item は残るので、ログイン中の全員のトレイに壊れた画像／
 * 再生できない動画が最大24時間出続ける。消してよいかを決める場面では、
 * 実体を参照しうるものを全部見る。
 */
export async function listMyMediaItems(userId: string): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            FilterExpression: "attribute_exists(src)",
            ExpressionAttributeValues: { ":uid": userId },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
}
