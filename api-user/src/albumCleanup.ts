import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * やり直しの回数と待ちの起点。`follow.ts` の `FOLLOWING_WRITE_RETRIES` /
 * `LIST_RETRY_BASE_MS` と同じ作法（同じ行を複数人が書く場所なので）。
 */
const ALBUM_WRITE_RETRIES = 3;
const ALBUM_RETRY_BASE_MS = 25;

/**
 * アルバムから写真の ID を**まとめて**取り除く（**削除の経路すべてから呼ぶ**）。
 *
 * **一覧に死んだ ID が溜まると2つ困る**:
 *   - 500枚の枠（`PHOTOS_PER_ALBUM`）を食う。枠に当たると
 *     `addPhotoToAlbum` は条件不成立で投げ、呼び出し側は握って**投稿を
 *     成功で返す**ので、本人は入ったつもりになる
 *   - 招待ページ（**未認証で叩ける**ので読み取りに上限がある）が、
 *     新しい順に見る窓を死んだ ID で埋めて「生きている写真があるのに空」
 *     に見える
 *
 * **写真の行が `albumId` の唯一の手がかり。** 行を消したあとは
 * 誰も辿り直せない——このテーブルはソートキーが無く `album#…` の
 * 前方一致列挙もできないので、取りこぼすと**永久にずれる**。
 *
 * **まとめて受け取るのは、呼び出し元が並列だから。** DynamoDB は値で
 * リストから消せないので読んで書き直すしかなく、条件に「書き直す前の
 * 一覧」を入れる。1枚ずつ呼ぶと**同じ行を取り合って先着1本以外が全部
 * 条件不成立**になる——`deleteAccount` は8並列なので、実測（Get も
 * Update も往復させたモデル）で **8枚中1枚・20枚中1枚**しか外れなかった。
 * 1枚ずつ呼ぶ形を、そのまま並列の文脈へ持ち込んだのが原因。
 *
 * それでも**やり直しは要る**——他人が同時に足す・消すことがある
 * （このアルバムは全員が同じ1行を書く）。条件不成立は「誰かが先に
 * 書いた」なので、読み直して撃ち直せば収束する。
 *
 * **このファイルは `api` と `api-user` の2本ある。** 管理APIは別サービス
 * （別の Lambda・別の esbuild）なので import できない。複製した規則は
 * 静かにずれるので、コードの一致を
 * `scripts/__tests__/albumCleanupParity.test.ts` で縛る
 * （`cdnInvalidate` と同じ手）。
 */
export async function removePhotosFromAlbum(albumId: string, photoIds: string[]): Promise<void> {
    if (!albumId || photoIds.length === 0) return;
    // キーの綴りは `api-user/src/invite.ts` の `albumKey` と同じ。
    // あちらを import しないのは、api 側に `invite.ts` が無いため
    // （綴りが揃っていることは突き合わせのテストが見る）
    const key = `album#${albumId}`;
    const drop = new Set(photoIds);
    for (let attempt = 0; attempt <= ALBUM_WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: key } }));
        const album = res.Item as { photoIds?: unknown } | undefined;
        const ids = Array.isArray(album?.photoIds)
            ? (album.photoIds as unknown[]).filter((v): v is string => typeof v === "string")
            : [];
        const next = ids.filter((v) => !drop.has(v));
        // 外すものが無い（もう消えている・そもそも入っていない）
        if (next.length === ids.length) return;
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: key },
                UpdateExpression: "SET photoIds = :next",
                ConditionExpression: "attribute_exists(id) AND photoIds = :prev",
                ExpressionAttributeValues: { ":next": next, ":prev": ids },
            }));
            return;
        } catch (e) {
            const name = (e as { name?: string })?.name;
            // **条件不成立以外は投げ直す。** 権限や接続の失敗を
            // 「誰かが先に書いた」と読んで撃ち直すと、理由が消える
            if (name !== "ConditionalCheckFailedException") throw e;
            // 最後の1回のあとに待たない（`follow.ts` と同じ理由——
            // ループが尽きて投げるだけなので、待ちは丸損）
            if (attempt < ALBUM_WRITE_RETRIES) {
                await new Promise((r) => setTimeout(r, ALBUM_RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random())));
            }
        }
    }
    throw new Error(`removePhotosFromAlbum: ${albumId} の書き換えが競合し続けました`);
}

/** 1枚だけ取り除く（`deleteMyPhoto` と管理者削除はこちら） */
export async function removePhotoFromAlbum(albumId: string, photoId: string): Promise<void> {
    await removePhotosFromAlbum(albumId, [photoId]);
}
