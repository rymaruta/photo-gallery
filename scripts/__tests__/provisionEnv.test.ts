import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 別環境を作るときに、本番の設定をどこまで持ち込まないか。
//
// このスクリプトは本番の CloudFront 設定をコピーして staging を作る。
// 「別環境を指したまま」になる項目を落とし忘れると、**staging の
// リクエストが本番の資源を動かす**。オリジン（execute-api）は既に
// 落としていたが、Lambda@Edge の紐付けが残っていた。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildStagingConfig: (src: any) => any;

beforeAll(async () => {
    // モジュール読込時に環境名を要求する（未設定なら止める作り）
    process.env.ENV_NAME = "staging";
    process.env.SOURCE_DISTRIBUTION_ID = "EYRLTGCPOS9E4";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ buildStagingConfig } = require("../provision-env.js"));
});

/** 本番のディストリビューション設定を模したもの */
const prodConfig = () => ({
    CallerReference: "prod-original",
    Comment: "prod",
    Aliases: { Quantity: 1, Items: ["journey-photo.com"] },
    WebACLId: "arn:aws:wafv2:...:webacl/prod",
    Logging: { Enabled: true, Bucket: "prod-logs", Prefix: "cf/" },
    Origins: {
        Quantity: 3,
        Items: [
            { Id: "s3-site", DomainName: "prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com" },
            { Id: "s3-upload", DomainName: "prod-journey-photo-upload.s3.ap-northeast-1.amazonaws.com" },
            { Id: "api", DomainName: "ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com" },
        ],
    },
    DefaultCacheBehavior: {
        TargetOriginId: "s3-site",
        // OGP 書き換え用（scripts/fix-cdn-static-behavior.js 参照）
        LambdaFunctionAssociations: {
            Quantity: 2,
            Items: [
                { EventType: "viewer-request", LambdaFunctionARN: "arn:aws:lambda:us-east-1:1:function:ogp:3" },
                { EventType: "origin-response", LambdaFunctionARN: "arn:aws:lambda:us-east-1:1:function:ogp:3" },
            ],
        },
    },
    CacheBehaviors: {
        Quantity: 2,
        Items: [
            { PathPattern: "/api/*", TargetOriginId: "api" },
            {
                PathPattern: "/_next/static/*", TargetOriginId: "s3-site",
                LambdaFunctionAssociations: { Quantity: 0, Items: [] },
                FunctionAssociations: { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: "arn:aws:cloudfront::1:function/prod-fn" }] },
            },
        ],
    },
});

describe("buildStagingConfig: 本番の資源を持ち込まない", () => {
    // ここが 4-2。落とし忘れると staging の全リクエストが**本番の関数**を
    // 実行し、本番のログと課金に乗る。さらに Lambda@Edge は参照している
    // 配信が1つでもあるとバージョンを消せないので、本番側の掃除が
    // 数時間〜数日ブロックされる。
    it("既定のキャッシュ動作から Lambda@Edge を外す", () => {
        const cfg = buildStagingConfig(prodConfig());
        expect(cfg.DefaultCacheBehavior.LambdaFunctionAssociations).toEqual({ Quantity: 0, Items: [] });
    });

    it("残ったキャッシュ動作からも外す（CloudFront Functions も）", () => {
        const cfg = buildStagingConfig(prodConfig());
        for (const b of cfg.CacheBehaviors.Items) {
            expect(b.LambdaFunctionAssociations).toEqual({ Quantity: 0, Items: [] });
            expect(b.FunctionAssociations).toEqual({ Quantity: 0, Items: [] });
        }
    });

    it("本番の API オリジンを引き継がない（staging の /api/* が本番APIに届く）", () => {
        const cfg = buildStagingConfig(prodConfig());
        const domains = cfg.Origins.Items.map((o: { DomainName: string }) => o.DomainName);
        expect(domains.some((d: string) => d.includes("execute-api"))).toBe(false);
        // 落としたオリジンを指すキャッシュ動作も消える（残すと作成が失敗する）
        expect(cfg.CacheBehaviors.Items.some((b: { PathPattern: string }) => b.PathPattern === "/api/*")).toBe(false);
    });

    it("S3 オリジンは staging のバケットへ向け直す", () => {
        const cfg = buildStagingConfig(prodConfig());
        const domains: string[] = cfg.Origins.Items.map((o: { DomainName: string }) => o.DomainName);
        expect(domains).toContain("staging-journey-photo.com.s3.ap-northeast-1.amazonaws.com");
        expect(domains).toContain("staging-journey-photo-upload.s3.ap-northeast-1.amazonaws.com");
        expect(domains.some((d) => d.startsWith("prod-"))).toBe(false);
    });

    it("別名・証明書・WAF・ログは引き継がない", () => {
        const cfg = buildStagingConfig(prodConfig());
        expect(cfg.Aliases).toEqual({ Quantity: 0, Items: [] });
        expect(cfg.WebACLId).toBe("");
        expect(cfg.Logging.Enabled).toBe(false);
        expect(cfg.ViewerCertificate.CloudFrontDefaultCertificate).toBe(true);
    });

    it("元の設定を書き換えない（コピー元を壊さない）", () => {
        const src = prodConfig();
        buildStagingConfig(src);
        expect(src.DefaultCacheBehavior.LambdaFunctionAssociations.Quantity).toBe(2);
        expect(src.Aliases.Items).toEqual(["journey-photo.com"]);
    });
});

// `ENV_NAME=Prod` がガードを素通りし、`Prod-photo-gallery-photos` の
// テーブルだけ作って S3 で失敗していた（バケット名は小文字しか使えない）。
// 中途半端に作られた資源が残る。スクリプトは env を読んだ時点で
// process.exit するので、子プロセスとして起動して終了コードを見る。
describe("ENV_NAME の受け付け方", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("child_process");
    const run = (envName: string) => spawnSync(
        process.execPath, ["scripts/provision-env.js"],
        { env: { ...process.env, ENV_NAME: envName, SOURCE_DISTRIBUTION_ID: "X", AWS_REGION: "ap-northeast-1" },
            encoding: "utf8", timeout: 20000 },
    );

    it("prod は大文字混じりでも弾く", () => {
        for (const v of ["prod", "Prod", "PROD"]) {
            const r = run(v);
            expect(r.status).toBe(1);
            expect(String(r.stderr)).toContain("prod は指定できません");
        }
    });

    it("AWS の名前規則に合わない環境名は、作り始める前に弾く", () => {
        for (const v of ["Staging", "1staging", "staging_2", "staging.a"]) {
            const r = run(v);
            expect(r.status).toBe(1);
            expect(String(r.stderr)).toContain("英小文字で始まり");
        }
    });
});

// ユーザープールの設定は、アプリ側の前提と**対**でしか意味を持たない。
// 片方だけ変えると「作れるけれど使えない環境」ができる。
describe("ユーザープールの設定（lib/auth/cognito.ts と対）", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let config: any;
    beforeAll(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ({ USER_POOL_CONFIG: config } = require("../provision-env.js"));
    });

    // signUp はユーザー名に **UUID** を渡し、メールは属性として別に渡す。
    // `UsernameAttributes: ["email"]` は「ユーザー名そのものがメールアドレス」
    // という設定なので、UUID を渡した時点で Cognito が弾く
    // ——**そのプールでは新規登録ができない**。
    it("メールはエイリアス（ユーザー名そのものにしない）", () => {
        expect(config.AliasAttributes).toEqual(["email"]);
        expect(config.UsernameAttributes).toBeUndefined();
    });

    // 画面は3か所で「記号を1文字以上」と案内している
    // （signup の入力補助・login のプレースホルダ・InvalidPasswordException の文言）
    it("パスワード方針が、画面の案内と食い違わない", () => {
        expect(config.Policies.PasswordPolicy).toMatchObject({
            MinimumLength: 8,
            RequireUppercase: true,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
        });
    });

    it("メールは自動検証（確認コードで登録を確定する流れ）", () => {
        expect(config.AutoVerifiedAttributes).toEqual(["email"]);
    });

    // 上の3本は**定数の形しか見ていない**。定数を正しいまま置いて
    // CreateUserPoolCommand の呼び出し側だけを元のバグ（UsernameAttributes /
    // RequireSymbols: false）に戻すと、全部緑のまま通る——実際に変異させて
    // 確かめた。切り出した意味が無くなるので、渡っていることも固定する。
    it("その設定が実際に CreateUserPoolCommand へ渡っている", () => {
        const src = readFileSync(join(__dirname, "..", "provision-env.js"), "utf8");
        const call = /new CreateUserPoolCommand\(\{([\s\S]*?)\}\)\)/.exec(src);
        expect(call).not.toBeNull();
        expect(call![1]).toContain("...USER_POOL_CONFIG");
        // 呼び出し側で上書きしていない（後勝ちで設定を潰さない）
        expect(call![1]).not.toContain("UsernameAttributes");
        expect(call![1]).not.toContain("AliasAttributes");
        expect(call![1]).not.toContain("PasswordPolicy");
    });
});
