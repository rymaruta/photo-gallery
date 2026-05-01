import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
export const ddb = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
});

export const USERS_TABLE = process.env.USERS_TABLE ?? "prod-photo-gallery-users";
export const USERNAME_INDEX = "username-index";
