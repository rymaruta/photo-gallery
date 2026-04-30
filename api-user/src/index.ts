import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { presignedUrl, savePhoto } from "./upload";

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
    const { rawPath, requestContext } = event;
    const method = requestContext.http.method;

    if (method === "POST" && rawPath === "/upload/presigned-url") {
        return (await presignedUrl(event, {} as never, () => undefined)) ?? { statusCode: 500, body: "" };
    }
    if (method === "POST" && rawPath === "/upload/save") {
        return (await savePhoto(event, {} as never, () => undefined)) ?? { statusCode: 500, body: "" };
    }

    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
}
