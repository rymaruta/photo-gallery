import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "./env";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
export const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
export const USER_INDEX = "userId-createdAt-index";

/**
 * ストーリー一覧用の GSI。
 *
 * ストーリーは「今生きているものを全ユーザー分」引く必要があるが、
 * このテーブルは単一PKで、写真・コメント文書・いいね/フォローのマーカーが
 * 全部同居している。以前は毎回テーブル全体を Scan していたので、
 * マーカーが増えるほど遅くなり（マーカーは退会しても消えない）、
 * いずれ Lambda の実行時間内に終わらなくなる＝ログイン中の全員の
 * ストーリー欄が同時に壊れる、という壊れ方をする。
 *
 * story 項目にだけ定数の storyFeed を持たせ、expiresAt をソートキーにして
 * 「期限が今より先のもの」を Query 一発で引く。
 */
export const STORY_INDEX = "storyFeed-expiresAt-index";
/** storyFeed の値。story 項目にだけ入れる（他の項目は GSI に載らない） */
export const STORY_FEED_KEY = "1";
