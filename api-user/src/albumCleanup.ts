import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * アルバムから写真の ID を取り除く（**削除の経路すべてから呼ぶ**）。
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
 * DynamoDB は値でリストから消せないので、読んで書き直す。**書き直す前の
 * 一覧を条件に入れる**ので、その間に誰かが足していたら何もしない
 * （足された写真を取りこぼさない。次の削除で拾える）。
 *
 * **このファイルは `api` と `api-user` の2本ある。** 管理APIは別サービス
 * （別の Lambda・別の esbuild）なので import できない。複製した規則は
 * 静かにずれるので、コードの一致を
 * `scripts/__tests__/albumCleanupParity.test.ts` で縛る
 * （`cdnInvalidate` と同じ手）。
 */
export async function removePhotoFromAlbum(albumId: string, photoId: string): Promise<void> {
    // キーの綴りは `api-user/src/invite.ts` の `albumKey` と同じ。
    // あちらを import しないのは、api 側に `invite.ts` が無いため
    // （綴りが揃っていることは突き合わせのテストが見る）
    const key = `album#${albumId}`;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: key } }));
    const album = res.Item as { photoIds?: unknown } | undefined;
    const ids = Array.isArray(album?.photoIds)
        ? (album.photoIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
    if (!ids.includes(photoId)) return;
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: key },
        UpdateExpression: "SET photoIds = :next",
        ConditionExpression: "attribute_exists(id) AND photoIds = :prev",
        ExpressionAttributeValues: { ":next": ids.filter((v) => v !== photoId), ":prev": ids },
    }));
}
