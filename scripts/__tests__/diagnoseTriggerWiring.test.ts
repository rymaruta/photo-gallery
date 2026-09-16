import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inspectTrigger } = require("../diagnose-aws.js") as {
    inspectTrigger: (a: { idp: Fake; lambda: Fake; poolId: string; stage: string; warn?: (s: string) => void }) => Promise<{
        attachedArn: string; expectedName: string; fnExists?: boolean; policyAllowsCognito: boolean; policyReadable: boolean;
    }>;
};

type Cmd = { constructor: { name: string }; input?: unknown };
type Fake = { send: (c: Cmd) => Promise<unknown> };

/**
 * `triggerLines` の**材料を作る側**の配線。判定（`policyAllowsPool`）は
 * SourceArn まで見るが、ここでプール ARN を渡し忘れると「別プール宛ての許可」を
 * ✅ と読む——`triggerLines` のテストだけでは、その差し替えが素通りした（変異で確認）。
 * 偽の `send` でコマンドの種類ごとに応答を返して、材料の中身を見る。
 */
const POOL_ARN = "arn:aws:cognito-idp:ap-northeast-1:123:userpool/ap-northeast-1_AAAA";
const OTHER_POOL_ARN = "arn:aws:cognito-idp:ap-northeast-1:123:userpool/ap-northeast-1_BBBB";
const FN = "arn:aws:lambda:ap-northeast-1:123:function:photo-gallery-api-prod-postConfirmation";

const policy = (sourceArn: string) => JSON.stringify({
    Statement: [{
        Effect: "Allow", Principal: { Service: "cognito-idp.amazonaws.com" }, Action: "lambda:InvokeFunction",
        Condition: { ArnLike: { "AWS:SourceArn": sourceArn } },
    }],
});

function fakes(opts: { attached?: string; policy?: string | Error; fn?: Error }) {
    const idp: Fake = {
        send: async (c) => {
            if (c.constructor.name === "DescribeUserPoolCommand") return { UserPool: { Arn: POOL_ARN, LambdaConfig: opts.attached ? { PostConfirmation: opts.attached } : {} } };
            throw new Error(`unexpected ${c.constructor.name}`);
        },
    };
    const lambda: Fake = {
        send: async (c) => {
            if (c.constructor.name === "GetFunctionConfigurationCommand") { if (opts.fn) throw opts.fn; return { FunctionArn: opts.attached }; }
            if (c.constructor.name === "GetPolicyCommand") { if (opts.policy instanceof Error) throw opts.policy; return { Policy: opts.policy }; }
            throw new Error(`unexpected ${c.constructor.name}`);
        },
    };
    return { idp, lambda };
}
const notFound = () => Object.assign(new Error("nf"), { name: "ResourceNotFoundException" });

describe("PostConfirmation トリガーの診断（材料の配線）", () => {
    it("このプール宛ての許可があれば「呼べる」", async () => {
        const r = await inspectTrigger({ ...fakes({ attached: FN, policy: policy(POOL_ARN) }), poolId: "p", stage: "prod" });
        expect(r).toMatchObject({ attachedArn: FN, expectedName: "photo-gallery-api-prod-postConfirmation", fnExists: true, policyReadable: true, policyAllowsCognito: true });
    });

    // **別プール宛ての許可を ✅ と読まない。** 同名プールが2つあってカスタムリソースが
    // 別のプールに許可を付けた形＝この診断がいちばん見逃してはいけない状態
    it("別のプール宛ての許可しか無ければ「呼べない」", async () => {
        const r = await inspectTrigger({ ...fakes({ attached: FN, policy: policy(OTHER_POOL_ARN) }), poolId: "p", stage: "prod" });
        expect(r.policyReadable).toBe(true);
        expect(r.policyAllowsCognito).toBe(false);
    });

    it("ポリシーが無い（ResourceNotFound）は「読めたが呼べない」", async () => {
        const r = await inspectTrigger({ ...fakes({ attached: FN, policy: notFound() }), poolId: "p", stage: "prod" });
        expect(r).toMatchObject({ policyReadable: true, policyAllowsCognito: false });
    });

    it("ポリシーを読む権限が無ければ「確認できていない」（呼べるに丸めない）", async () => {
        const r = await inspectTrigger({ ...fakes({ attached: FN, policy: Object.assign(new Error("x"), { name: "AccessDeniedException" }) }), poolId: "p", stage: "prod" });
        expect(r).toMatchObject({ policyReadable: false, policyAllowsCognito: false });
    });

    it("トリガーが付いていなければ関数もポリシーも引きに行かない", async () => {
        let calls = 0;
        const { idp } = fakes({});
        const lambda: Fake = { send: async () => { calls++; return {}; } };
        const r = await inspectTrigger({ idp, lambda, poolId: "p", stage: "prod" });
        expect(r.attachedArn).toBe("");
        expect(calls).toBe(0);
    });

    it("関数が消えていれば fnExists=false", async () => {
        const r = await inspectTrigger({ ...fakes({ attached: FN, fn: notFound() }), poolId: "p", stage: "prod" });
        expect(r.fnExists).toBe(false);
    });
});
