import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { requireEnv } from "./env";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
export const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
export const USER_INDEX = "userId-createdAt-index";
