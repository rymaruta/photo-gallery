import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "./env";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
export const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
// USER_INDEX はここから export していたが、使う側（ddb-photos.ts）が
// 自前の const を持っていて import ゼロの死に export だった。
// 索引名の定義は ddb-photos.ts の1か所にする。
