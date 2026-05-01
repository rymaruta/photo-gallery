import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
export const PHOTOS_TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
export const USER_INDEX = "userId-createdAt-index";
