import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withDenyStatement, STATEMENT_SID, PREFIX } = require("../restrict-originals.js");

type Statement = {
    Sid?: string;
    Effect?: string;
    Principal?: unknown;
    Action?: string;
    Resource?: string;
};
type Policy = { Version?: string; Statement: Statement[] };

const BUCKET = "prod-journey-photo-upload";
const find = (p: Policy) => p.Statement.find((s) => s.Sid === STATEMENT_SID)!;
const DEFAULT = { Service: "cloudfront.amazonaws.com" };

// uploads/originals/ には EXIF を落とす前の原本（GPS 入り）が置かれていて、
// 写真と同じ CloudFront から誰でも取れる状態だった。URL を公開ページから
// 消しただけでは「隠した」に過ぎないので、配信そのものを止める。

describe("withDenyStatement", () => {
    it("ポリシーが無いところにも Deny を作れる", () => {
        const p = withDenyStatement(null, BUCKET) as Policy;
        expect(p.Version).toBe("2012-10-17");
        expect(find(p).Effect).toBe("Deny");
    });

    it("対象は uploads/originals 配下だけ（通常の写真は巻き込まない）", () => {
        const s = find(withDenyStatement(null, BUCKET));
        expect(s.Resource).toBe(`arn:aws:s3:::${BUCKET}/${PREFIX}*`);
        expect(s.Resource).not.toBe(`arn:aws:s3:::${BUCKET}/uploads/*`);
        expect(s.Action).toBe("s3:GetObject");
    });

    it("止めるのは配信経由の読み取りだけ", () => {
        // IAM ユーザーでの運用（撮影日のバックフィル・退会時の削除）は
        // 今後も動く必要がある。ここを "*" にすると原本から撮影日を
        // 復元する手段まで失う。
        const s = find(withDenyStatement(null, BUCKET));
        expect(s.Principal).toEqual({ Service: "cloudfront.amazonaws.com" });
    });

    it("OAC（今の方式）の許可先をそのまま拒否対象にする", () => {
        const existing: Policy = {
            Statement: [{
                Sid: "AllowCloudFrontServicePrincipal",
                Effect: "Allow",
                Principal: { Service: "cloudfront.amazonaws.com" },
                Action: "s3:GetObject",
            }],
        };
        expect(find(withDenyStatement(existing, BUCKET)).Principal)
            .toEqual({ Service: ["cloudfront.amazonaws.com"] });
    });

    it("OAI（古い方式）で配信していても塞ぐ", () => {
        // サービスプリンシパル決め打ちだと、OAI のバケットでは Deny が
        // 誰にも当たらず「入れたのに塞がっていない」状態になる。
        const oai = "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E123";
        const existing: Policy = {
            Statement: [{ Effect: "Allow", Principal: { AWS: oai }, Action: "s3:GetObject" }],
        };
        expect(find(withDenyStatement(existing, BUCKET)).Principal).toEqual({ AWS: [oai] });
    });

    it("許可が複数あれば全部を拒否対象にする", () => {
        const existing: Policy = {
            Statement: [
                { Effect: "Allow", Principal: { Service: "cloudfront.amazonaws.com" }, Action: "s3:GetObject" },
                { Effect: "Allow", Principal: { AWS: "arn:aws:iam::1:role/legacy" }, Action: "s3:*" },
            ],
        };
        const s = find(withDenyStatement(existing, BUCKET));
        expect(s.Principal).toEqual({
            AWS: ["arn:aws:iam::1:role/legacy"],
            Service: ["cloudfront.amazonaws.com"],
        });
    });

    it("読み取りを許していない文（書き込み専用など）は拾わない", () => {
        const existing: Policy = {
            Statement: [{ Effect: "Allow", Principal: { AWS: "arn:aws:iam::1:user/uploader" }, Action: "s3:PutObject" }],
        };
        expect(find(withDenyStatement(existing, BUCKET)).Principal).toEqual(DEFAULT);
    });

    it("Deny の文は拾わない（自分自身を拒否対象にしない）", () => {
        const once = withDenyStatement(null, BUCKET);
        expect(find(withDenyStatement(once, BUCKET)).Principal).toEqual(DEFAULT);
    });

    it("既存の文は消さない（OAC の許可を壊さない）", () => {
        const existing: Policy = {
            Version: "2012-10-17",
            Statement: [{ Sid: "AllowCloudFrontServicePrincipal", Effect: "Allow" }],
        };
        const p = withDenyStatement(existing, BUCKET) as Policy;
        expect(p.Statement).toHaveLength(2);
        expect(p.Statement[0].Sid).toBe("AllowCloudFrontServicePrincipal");
    });

    it("二度流しても増えない（冪等）", () => {
        const once = withDenyStatement(null, BUCKET);
        const twice = withDenyStatement(once, BUCKET) as Policy;
        expect(twice.Statement.filter((s) => s.Sid === STATEMENT_SID)).toHaveLength(1);
    });

    it("元のポリシーを書き換えない", () => {
        const existing: Policy = { Version: "2012-10-17", Statement: [{ Sid: "Keep" }] };
        withDenyStatement(existing, BUCKET);
        expect(existing.Statement).toHaveLength(1);
    });
});
