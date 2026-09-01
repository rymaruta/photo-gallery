import { describe, it, expect } from "vitest";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// **ここだけ本物の SDK を使う。**
//
// 他の presign のテストは `getSignedUrl` をモックしているので、
// 「`signableHeaders` を渡したか」までしか見られない。ところが今回の穴は
// **渡さないと何も署名されない**という SDK の既定の挙動そのものだった
// ——モックでは絶対に見つからない種類の問題なので、実物に聞く。
//
// ネットワークは要らない。署名は手元の計算で、結果は URL の
// `X-Amz-SignedHeaders` に出る。ダミーの資格情報で十分。
//
// 実測（この版の SDK）:
//   既定                     → host
//   signableHeaders 指定     → content-type;host
//   + ContentLength          → content-length;content-type;host
// `signableHeaders` の上書きは `ALWAYS_UNSIGNABLE_HEADERS`（cache-control など）
// にも効く。「効かない」と書きかけて、ここで測って外れた。

const s3 = new S3Client({
    region: "ap-northeast-1",
    credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
});

const signedHeaders = (url: string): string[] =>
    (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").filter(Boolean);

const put = (extra: Record<string, unknown> = {}) => new PutObjectCommand({
    Bucket: "b", Key: "uploads/u/x.jpg", ContentType: "image/jpeg", ...extra,
});

describe("presigned URL が何を縛るか（本物の SDK で確かめる）", () => {
    // **これが穴の正体。** `ContentType` を渡しても署名対象に入らないので、
    // 同じ URL に `text/html` で PUT できる。CloudFront はサイトと同一
    // オリジンでそれを返すので、任意のスクリプトが動く
    // （`uploadPolicy.ts` が SVG を弾く理由として書いている攻撃そのもの）。
    it("既定では content-type を署名しない（＝許可リストが素通りする）", async () => {
        const url = await getSignedUrl(s3, put(), { expiresIn: 900 });
        expect(signedHeaders(url)).toEqual(["host"]);
    });

    it("signableHeaders を渡すと署名対象に入る", async () => {
        const url = await getSignedUrl(s3, put(), {
            expiresIn: 900,
            signableHeaders: new Set(["content-type"]),
        });
        expect(signedHeaders(url), "content-type が署名されていない").toContain("content-type");
    });

    // サイズも縛れる（`content-length` は ALWAYS_UNSIGNABLE_HEADERS に無い）。
    // 今は使っていないが、使えることは測ってある——台帳 PRESIGN-SIZE
    it("ContentLength を渡せばサイズも署名対象に入る", async () => {
        const url = await getSignedUrl(s3, put({ ContentLength: 1234 }), {
            expiresIn: 900,
            signableHeaders: new Set(["content-type"]),
        });
        expect(signedHeaders(url)).toContain("content-length");
    });

    // `cache-control` は既定では署名されない（`ALWAYS_UNSIGNABLE_HEADERS`）が、
    // **`signableHeaders` を渡せば戻る**——`getCanonicalHeaders` の上書きは
    // `ALWAYS_UNSIGNABLE_HEADERS` にも効く。
    // 「戻せない」と書きかけたが、ここで測って外れた。
    // ただし**戻すと縛りになる**（クライアントが同じ値を送らないと 403）。
    // アイコンは `Cache-Control: no-store` を送らせたいだけなので、
    // 縛る必要は無い＝今は渡さない。
    it("cache-control も signableHeaders を渡せば署名対象に入る", async () => {
        const before = await getSignedUrl(s3, put({ CacheControl: "no-store" }), { expiresIn: 900 });
        expect(signedHeaders(before), "既定で署名されている").not.toContain("cache-control");

        const url = await getSignedUrl(s3, put({ CacheControl: "no-store" }), {
            expiresIn: 900,
            signableHeaders: new Set(["content-type", "cache-control"]),
        });
        expect(signedHeaders(url)).toContain("cache-control");
    });
});
