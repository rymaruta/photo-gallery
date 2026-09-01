import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withDenyStatement, readerPrincipals, hasAnonymousRead, planPolicyChange, grantsGetObject, coversOriginals, STATEMENT_SID, PREFIX } = require("../restrict-originals.js");

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
        // **バージョン付きの読み取りも塞ぐ。** バケットのバージョニングが
        // 有効なら `s3:GetObjectVersion` でも原本の中身が取れるので、
        // `s3:GetObject` だけの Deny では素通りする
        expect(s.Action).toEqual(["s3:GetObject", "s3:GetObjectVersion"]);
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

// **`Principal` は文字列でも書ける。** `"Principal": "*"`（匿名公開）は
// `s.Principal.AWS` が undefined なので、オブジェクト形式しか見ていなかった
// 頃は**その文を無いものとして飛ばして**いた。結果、Deny が CloudFront 宛て
// だけになり、**GPS 入りの原本が S3 直 URL の匿名 GET で取れたまま**、
// しかもスクリプトは成功で終わる——このファイルが「一番まずい形」と
// 呼んでいるそれ。
//
// **ただし「拾って Deny に載せる」は誤りだった**（一度そう直して、レビューで
// 気づいた）。リソースベースポリシーの明示的 Deny はあらゆる Allow を
// 上書きするので、`{AWS: ["*"]}` を載せると**このアカウントの IAM ユーザーも
// root も**その prefix を読めなくなる——上の「止めるのは配信経由の読み取り
// だけ」が守っている契約に正面から反する。戻すには手でポリシーを編集するしかない。
//
// なので「見つけたら止める」にした。塞ぐには匿名公開そのものを消す必要がある。
describe("匿名公開が残っているときは、適用せずに止める", () => {
    const anonString = {
        Version: "2012-10-17",
        Statement: [{ Sid: "PublicRead", Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" }],
    };
    const anonObject = {
        Version: "2012-10-17",
        Statement: [{ Sid: "PublicRead", Effect: "Allow", Principal: { AWS: "*" }, Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" }],
    };

    it("文字列形式の匿名を見つける", () => {
        expect(hasAnonymousRead(anonString)).toBe(true);
    });

    it("オブジェクト形式の匿名も見つける", () => {
        expect(hasAnonymousRead(anonObject)).toBe(true);
    });

    it("CloudFront だけの許可は匿名ではない", () => {
        const cf = {
            Version: "2012-10-17",
            // **Resource は originals に掛かる形にする。** `"x"` だと
            // `coversOriginals` が先に false を返して Principal の判定まで
            // 届かず、`if (s.Principal === "*") return true` を
            // `if (true) return true` に変えても緑になる（死んだテストだった）
            Statement: [{ Sid: "Cf", Effect: "Allow", Principal: { Service: "cloudfront.amazonaws.com" }, Action: "s3:GetObject", Resource: "arn:aws:s3:::b/uploads/originals/*" }],
        };
        expect(hasAnonymousRead(cf, "b")).toBe(false);
    });

    // **ここが要点。** どちらの形でも、Deny に `*` を載せてはいけない
    it.each([["文字列", anonString], ["オブジェクト", anonObject]])(
        "%s形式の匿名でも、Deny に * を載せない（自分のアカウントを締め出さない）",
        (_name, policy) => {
            const deny = withDenyStatement(policy, "b").Statement
                .find((s: { Sid?: string }) => s.Sid === STATEMENT_SID);
            expect(JSON.stringify(deny.Principal)).not.toContain('"*"');
        });

    it("正当な ARN と * が混ざっていたら、ARN だけ写す", () => {
        const mixed = {
            Version: "2012-10-17",
            Statement: [{
                Sid: "Mixed", Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/uploads/originals/*",
                Principal: { AWS: ["*", "arn:aws:iam::1:role/r"] },
            }],
        };
        expect(readerPrincipals(mixed, "b")).toEqual({ AWS: ["arn:aws:iam::1:role/r"] });
    });
});

// **`s3:Get*` を見落としていた。** 完全一致だけを見ていたので、IAM でごく
// 普通のワイルドカード表記が素通りし、匿名公開があっても「完了」と出ていた
// ——このファイルが「一番まずい形」と呼んでいるもの（元のバグが Action の
// ワイルドカード経由でそのまま残っていた）。
describe("読み取りを許す Action の判定", () => {
    it.each(["s3:GetObject", "s3:Get*", "s3:GetObject*", "s3:*", "*"])(
        "%s は読み取りを許すと見る", (a) => {
            expect(grantsGetObject({ Action: a })).toBe(true);
        });

    it.each(["s3:PutObject", "s3:Put*", "s3:DeleteObject", "s3:List*"])(
        "%s は読み取りではない", (a) => {
            expect(grantsGetObject({ Action: a })).toBe(false);
        });

    it("配列でもどれか1つ当たれば読み取り", () => {
        expect(grantsGetObject({ Action: ["s3:PutObject", "s3:Get*"] })).toBe(true);
        expect(grantsGetObject({ Action: ["s3:PutObject", "s3:DeleteObject"] })).toBe(false);
    });
});

// **Resource を見ないと、関係ない公開でスクリプトが止まる。** サムネイルだけ
// 匿名公開しているバケットで中断すると、原本は配信から外れないまま放置される
// （直す気で走らせたのに、何も変わらず終わる）。
describe("originals に掛かる文だけを見る", () => {
    it("originals を含む Resource は対象", () => {
        expect(coversOriginals({ Resource: "arn:aws:s3:::b/uploads/originals/*" }, "b")).toBe(true);
        expect(coversOriginals({ Resource: "arn:aws:s3:::b/*" }, "b")).toBe(true);
        expect(coversOriginals({ Resource: "arn:aws:s3:::b/uploads/*" }, "b")).toBe(true);
    });

    it("別の prefix だけなら対象外", () => {
        expect(coversOriginals({ Resource: "arn:aws:s3:::b/uploads/thumbs/*" }, "b")).toBe(false);
        expect(coversOriginals({ Resource: "arn:aws:s3:::b/profiles/*" }, "b")).toBe(false);
    });

    it("別のバケットは対象外", () => {
        expect(coversOriginals({ Resource: "arn:aws:s3:::other/*" }, "b")).toBe(false);
    });
});

// **中断の配線が1本も守られていなかった。** `main()` の中に書いていた頃は、
// `if (hasAnonymousRead(...))` を `if (false)` に変えても17件すべて緑
// ——このスクリプトの目的そのものが無テストだった。判断を切り出して固定する。
describe("planPolicyChange: 何をするかの判断", () => {
    const stmt = (over: Record<string, unknown>) => ({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*", ...over }],
    });

    it("匿名公開があれば止める（適用しない）", () => {
        const plan = planPolicyChange(stmt({ Principal: "*" }), "b");
        expect(plan.abort).toBe(true);
        expect(plan.next).toBeUndefined();
        // 何をすればよいかを書く（Block Public Access を有効にする）
        expect(plan.reason).toContain("Block Public Access");
    });

    it("s3:Get* の匿名公開でも止める", () => {
        expect(planPolicyChange(stmt({ Principal: "*", Action: "s3:Get*" }), "b").abort).toBe(true);
    });

    it("別の prefix だけの匿名公開では止めない（原本を放置しない）", () => {
        const plan = planPolicyChange(
            stmt({ Principal: "*", Resource: "arn:aws:s3:::b/uploads/thumbs/*" }), "b");
        expect(plan.abort).toBe(false);
        expect(plan.next.Statement.find((x: { Sid?: string }) => x.Sid === STATEMENT_SID)).toBeTruthy();
    });

    it("CloudFront だけの許可なら、いつもどおり Deny を作る", () => {
        const plan = planPolicyChange(stmt({ Principal: { Service: "cloudfront.amazonaws.com" } }), "b");
        expect(plan.abort).toBe(false);
        const deny = plan.next.Statement.find((x: { Sid?: string }) => x.Sid === STATEMENT_SID);
        expect(deny.Principal).toEqual({ Service: ["cloudfront.amazonaws.com"] });
    });
});

// **見落とすと素通り（原本が匿名で取れるのに「完了」と出る）、
// 見過ぎると過剰中断（原本が公開されたまま何もせず終わる）。**
// どちらも「塞げていない」で終わるので、迷ったら素通りしない側に倒す
// ——という判断そのものを、ここで固定する。
describe("判断が付かない形は「掛かる」に倒す（素通りさせない）", () => {
    const anon = (over: Record<string, unknown>) => ({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${BUCKET}/*`, ...over }],
    });

    it("NotAction は読み取りを許すと見る（補集合は読み切れない）", () => {
        // {Allow, NotAction:[DeleteObject]} は「DeleteObject 以外の全部」＝ GetObject を含む。
        // Action が無い形を `[].some(...)` で false にしていた頃は、丸ごと見落としていた
        const p = anon({ Action: undefined, NotAction: ["s3:DeleteObject"] });
        expect(hasAnonymousRead(p, BUCKET)).toBe(true);
        expect(planPolicyChange(p, BUCKET).abort).toBe(true);
    });

    it("NotResource も同じ（掛からないと言い切れない）", () => {
        expect(hasAnonymousRead(anon({ Resource: undefined, NotResource: [`arn:aws:s3:::${BUCKET}/uploads/thumbs/*`] }), BUCKET)).toBe(true);
    });

    it("NotPrincipal + Allow は「挙げた相手以外の全員」＝匿名を含む", () => {
        expect(hasAnonymousRead(anon({ Principal: undefined, NotPrincipal: { AWS: "arn:aws:iam::1:role/r" } }), BUCKET)).toBe(true);
    });

    it("Action は大文字小文字を区別しない（IAM の仕様）", () => {
        expect(grantsGetObject({ Action: "s3:get*" })).toBe(true);
        expect(grantsGetObject({ Action: "S3:GETOBJECT" })).toBe(true);
    });

    it("? は1文字のワイルドカード", () => {
        // `*` だけ実装して `?` を落としても、prefix の照合は
        // 確定部分だけで決まるので気づけない。ここで直接踏む
        expect(grantsGetObject({ Action: "s3:GetObjec?" })).toBe(true);
        expect(grantsGetObject({ Action: "s3:GetObjec??" })).toBe(false);
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET.slice(0, -1)}?/${PREFIX}*` }, BUCKET)).toBe(true);
    });

    it("バージョン付きの読み取りも読み取り", () => {
        // バージョニングが有効なら、これで原本の中身が取れる
        expect(grantsGetObject({ Action: "s3:GetObjectVersion" })).toBe(true);
        expect(grantsGetObject({ Action: "s3:GetObjectAcl" })).toBe(false);
    });

    it("読めない形の Resource も「掛かる」に倒す", () => {
        expect(coversOriginals({ Resource: "x" }, BUCKET)).toBe(true);
    });

    it("パーティションが違っても見る（aws-cn / aws-us-gov）", () => {
        expect(coversOriginals({ Resource: `arn:aws-cn:s3:::${BUCKET}/${PREFIX}*` }, BUCKET)).toBe(true);
    });

    it("バケット名のワイルドカードも照合する", () => {
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET.slice(0, 4)}*/${PREFIX}*` }, BUCKET)).toBe(true);
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}*/${PREFIX}*` }, "staging-x")).toBe(false);
        // `*` 単体のバケットも当たる
        expect(coversOriginals({ Resource: `arn:aws:s3:::*/${PREFIX}*` }, BUCKET)).toBe(true);
    });

    it("キーの途中のワイルドカードも見る", () => {
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}/*/originals/*` }, BUCKET)).toBe(true);
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}/uploads/*/2024/*` }, BUCKET)).toBe(true);
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}/uploads/?riginals/*` }, BUCKET)).toBe(true);
    });

    it("PREFIX より深い prefix の公開も見る", () => {
        // `path.slice(0,-1).startsWith(PREFIX)` の側。前半の
        // `PREFIX.startsWith(head)` だけでは通らない入力
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}/${PREFIX}2024/*` }, BUCKET)).toBe(true);
    });

    it("Condition が付いていても止める（条件は評価しない）", () => {
        // VPCe / SourceIp で絞ってあれば「誰でも取れる」ではないが、
        // その判断には条件キーの評価が要る。素通りさせるより止める方に倒す
        const p = anon({ Condition: { StringEquals: { "aws:SourceVpce": "vpce-1" } } });
        expect(hasAnonymousRead(p, BUCKET)).toBe(true);
    });
});

// **確実に掛からないと言える形では止めない。** 止めると「直しに行ったのに
// 原本は公開されたまま、何も変わらずに終わる」。
describe("確実に掛からない形では止めない", () => {
    it("バケット自身の ARN（/ が無い）はオブジェクトに当たらない", () => {
        expect(coversOriginals({ Resource: `arn:aws:s3:::${BUCKET}` }, BUCKET)).toBe(false);
        const p = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:*", Resource: `arn:aws:s3:::${BUCKET}` }] };
        expect(planPolicyChange(p, BUCKET).abort).toBe(false);
    });

    it("Resource を持たない文（＝ Resource も NotResource も無い）は掛かる扱い", () => {
        expect(coversOriginals({}, BUCKET)).toBe(true);
    });
});

// **originals に掛からない相手を Deny に載せない。** リソースベースの明示的
// Deny は IAM 側の Allow も上書きするので、サムネイルしか許されていない
// ロールを載せると、そのロールの原本アクセス（撮影日のバックフィル・
// 退会時の削除）まで黙って止まる——冒頭の「IAM ユーザー経由の運用は
// 塞がない」に正面から反する。
describe("Deny に載せる相手も originals で絞る", () => {
    it("サムネイルだけのロールは載せない", () => {
        const p = {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow", Principal: { AWS: "arn:aws:iam::1:role/ThumbsOnly" },
                Action: "s3:GetObject", Resource: `arn:aws:s3:::${BUCKET}/uploads/thumbs/*`,
            }],
        };
        expect(JSON.stringify(readerPrincipals(p, BUCKET))).not.toContain("ThumbsOnly");
    });

    it("originals を読んでいる相手は載せる", () => {
        const p = {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow", Principal: { AWS: "arn:aws:iam::1:role/Reader" },
                Action: "s3:GetObject", Resource: `arn:aws:s3:::${BUCKET}/${PREFIX}*`,
            }],
        };
        expect(readerPrincipals(p, BUCKET)).toEqual({ AWS: ["arn:aws:iam::1:role/Reader"] });
    });
});
