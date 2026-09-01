import { PutCommand, QueryCommand, GetCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
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
/**
 * 保存の再送で、**この回の意図**を書き直す。
 *
 * 再送を見つけたら保存済みの行をそのまま返す作りにしたら、`published` を
 * 取り違えた——「下書き保存」で応答が落ちたあと「公開」を押すと、200 が
 * 返って画面は成功と出るのに**行は下書きのまま**。逆順のほうが重い:
 * 「公開」で落ちたあと「下書き保存」を押すと、非公開にしたつもりで
 * **写真は公開されたまま**。タイトルや場所を直してから押し直した場合も、
 * その編集は黙って捨てられていた。重複は目に見えて消せたが、これは見えない。
 *
 * 条件で守るのは3つ:
 *   - 自分の行であること（`userId` は古い行に無いことがあるので両方見る）
 *   - 同じ画像を指していること（`src`）
 *   - **まだ誰も触っていないこと**（`updatedAt`）。/user/edit で後から
 *     直した内容を、開きっぱなしのアップロードタブが巻き戻さないため
 */
export async function overwriteOwnPhoto(photo: Photo, expectUpdatedAt: string): Promise<boolean> {
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: photo,
            ConditionExpression:
                "attribute_exists(id) AND src = :src AND updatedAt = :ua AND (userId = :u OR uploadedBy = :u)",
            ExpressionAttributeValues: {
                ":src": photo.src, ":ua": expectUpdatedAt, ":u": photo.userId,
            },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
        throw e;
    }
}

/**
 * 1件だけ引く（保存の再送かどうかを見分けるため）。
 *
 * このテーブルには写真以外（`notifs#…` / `comments#…` / `following#…`）も
 * 同居しているので、読み側は `#` を弾く——api/src/photos.ts と
 * photoUpdate.ts が同じことをしている。今の呼び出し元は UUID しか渡さないが、
 * export した汎用関数がその規約から外れていると、次の利用者が穴を開ける。
 */
export async function getPhotoById(id: string): Promise<Photo | undefined> {
    if (!id || id.includes("#")) return undefined;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
    return res.Item as Photo | undefined;
}

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
/**
 * 自分の生きているメディア項目を、**本体から読み直して**返す。
 *
 * **GSI の射影をそのまま信じてはいけない。** ここは
 * 「このアップロード済みファイルは、まだ写真やストーリーに使われているか」の
 * 判定に使う（`discardUpload`）。索引が `ALL` でなければ `key` や
 * `srcOriginal` などの属性が落ちるので、**使われているのに「使われていない」**
 * と判定して S3 の実体を消す——生きている写真のサムネや原本が消え、
 * 全員の画面に壊れた画像が出る。しかも `attribute_exists(src)` の絞り込み
 * 自体が索引側で評価されるので、射影が足りないと**結果が丸ごと空**になり、
 * どのファイルも「未使用」に見える。
 *
 * 本番テーブルの射影がどうなっているかは**この環境から確認できない**
 * （AWS の資格情報が無い）。**確認しなくても正しく動く形**にするために、
 * 索引からは id だけを採り、中身は `BatchGetItem` で本体から読み直す。
 * 他の経路（`getPhotoById` など）が最初からそうしているのと同じ扱い。
 * 呼ばれるのは「アップロードを取り消す」ときだけなので、回数は多くない。
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

    // **本体から読み直す。** 索引が返した中身は射影次第で欠けている。
    const ids = items.map((p) => (p as { id?: unknown }).id).filter((v): v is string => typeof v === "string");
    if (ids.length === 0) return [];
    const full: Photo[] = [];
    for (let i = 0; i < ids.length; i += 100) {   // BatchGetItem は1回100件まで
        const chunk = ids.slice(i, i + 100);
        let keys = chunk.map((id) => ({ id }));
        // 未処理分は返ってくるので、無くなるまで拾い直す
        while (keys.length > 0) {
            const res = await ddb.send(new BatchGetCommand({
                RequestItems: { [PHOTOS_TABLE]: { Keys: keys } },
            }));
            full.push(...((res.Responses?.[PHOTOS_TABLE] ?? []) as Photo[]));
            const un = res.UnprocessedKeys?.[PHOTOS_TABLE]?.Keys;
            keys = (un ?? []) as { id: string }[];
        }
    }
    return full;
}
