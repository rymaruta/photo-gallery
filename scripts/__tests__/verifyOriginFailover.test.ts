import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const m = require("../verify-origin-failover.js") as {
    refuseReason: (x: { distributionId?: string; originDomain?: string; buckets?: string[] }) => string | null;
    withOriginGroup: (cfg: Record<string, unknown>, o: { fnDomain: string; groupId?: string; originId?: string }) => Record<string, unknown>;
    withoutOriginGroup: (cfg: Record<string, unknown>, o: { originalTargetOriginId: string; originId?: string }) => Record<string, unknown>;
    readOutcome: (r: { status: number; contentType?: string; body?: string }) => string;
    isSecondOrigin: (r: { status: number; contentType?: string }) => boolean;
    pollForFailover: (domain: string, o: {
        limitSec?: number; everySec?: number;
        probeFn: (d: string, extra: string) => Promise<Probe>;
        log?: (s: string) => void;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
    }) => Promise<{ last: Probe; ok: boolean; tries: number }>;
    PROD_DISTRIBUTION: string;
    STAGING_DISTRIBUTION: string;
    PROBE_ORIGIN_DOMAIN: string;
};
const { refuseReason, withOriginGroup, withoutOriginGroup, readOutcome, isSecondOrigin, pollForFailover, PROD_DISTRIBUTION, STAGING_DISTRIBUTION, PROBE_ORIGIN_DOMAIN } = m;

type Probe = { status: number; contentType?: string; body?: string };
const JSON_OK: Probe = { status: 200, contentType: "application/json; charset=utf-8", body: "[]" };
const PAGE_404: Probe = { status: 404, contentType: "text/html", body: "<html>" };

/** 時計も待ちも偽物にする（実時間では待たない。台帳 `d54e7ca4` の形） */
function fakeClock() {
    let t = 0;
    return {
        now: () => t,
        sleep: async (ms: number) => { t += ms; },
        advance: (ms: number) => { t += ms; },
    };
}

/**
 * **本番の CloudFront を触る道具。取り消せない。**
 *
 * 本番と staging は**同じアカウント・同じ資格情報**で、区別は名前だけ。
 * 台帳には「ガードがバケットとテーブルしか見ておらず、**関数名は本番でも
 * 素通り**した」という傷がある（`verify-invalidate` で実際に本番の関数を
 * 叩けた）。ここでは配信ID・関数名・バケット名の**全部**を見る。
 */
describe("staging 以外では動かない", () => {
    const ok = { distributionId: STAGING_DISTRIBUTION, originDomain: PROBE_ORIGIN_DOMAIN, buckets: ["staging-journey-photo.com"] };

    it("staging の組み合わせは通す", () => {
        expect(refuseReason(ok)).toBeNull();
    });

    // 🔴 いちばん止めなければいけないもの
    it("本番の配信IDを名指しで拒む", () => {
        expect(refuseReason({ ...ok, distributionId: PROD_DISTRIBUTION }), "本番の配信を触ろうとしている").toContain("本番");
    });

    it("知らない配信も拒む（打ち間違い・別環境）", () => {
        expect(refuseReason({ ...ok, distributionId: "E123456789ABC" })).toContain("知らない配信");
    });

    /**
     * 🔴 **本番のAPIを staging に繋がない。** 繋ぐと staging の画面に
     * 本番の写真・利用者が出る（「本番の写真はコピーしない」という
     * staging の方針が崩れる）
     */
    it("本番の API Gateway を第2オリジンにしない", () => {
        expect(refuseReason({ ...ok, originDomain: "gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com" })).toContain("本番");
        expect(refuseReason({ ...ok, originDomain: "ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com" })).toContain("本番");
    });

    it("知らない第2オリジンも拒む", () => {
        expect(refuseReason({ ...ok, originDomain: "example.com" })).toContain("知らない");
    });

    it("本番のバケットが混ざっていたら拒む", () => {
        expect(refuseReason({ ...ok, buckets: ["prod-journey-photo.com"] })).toContain("本番");
        expect(refuseReason({ ...ok, buckets: ["journey-photo.com"] }), "接頭辞を付ける前の本番バケット").toContain("本番");
    });

    it("空は通さない", () => {
        expect(refuseReason({ distributionId: "", originDomain: PROBE_ORIGIN_DOMAIN })).toBeTruthy();
        expect(refuseReason({ distributionId: STAGING_DISTRIBUTION, originDomain: "" })).toBeTruthy();
    });
});

type Behavior = { PathPattern?: string; TargetOriginId: string; ViewerProtocolPolicy?: string };
type Cfg = {
    Origins: { Quantity: number; Items: { Id: string; DomainName: string }[] };
    OriginGroups: {
        Quantity: number;
        Items: {
            Id: string;
            FailoverCriteria: { StatusCodes: { Quantity: number; Items: number[] } };
            Members: { Quantity: number; Items: { OriginId: string }[] };
        }[];
    };
    DefaultCacheBehavior: Behavior;
    CacheBehaviors: { Quantity: number; Items: Behavior[] };
    CustomErrorResponses: { Quantity: number; Items: { ErrorCode: number; ResponsePagePath: string }[] };
};

const baseCfg = (): Cfg => ({
    Origins: { Quantity: 1, Items: [{ Id: "s3-site", DomainName: "staging-journey-photo.com.s3.ap-northeast-1.amazonaws.com" }] },
    OriginGroups: { Quantity: 0, Items: [] },
    DefaultCacheBehavior: { TargetOriginId: "s3-site", ViewerProtocolPolicy: "redirect-to-https" },
    CacheBehaviors: { Quantity: 1, Items: [{ PathPattern: "/_next/static/*", TargetOriginId: "s3-site" }] },
    CustomErrorResponses: { Quantity: 2, Items: [{ ErrorCode: 403, ResponsePagePath: "/404.html" }, { ErrorCode: 404, ResponsePagePath: "/404.html" }] },
});

describe("オリジングループの組み立て", () => {
    it("第2オリジンを足し、既定の向き先をグループにする", () => {
        const next = withOriginGroup(baseCfg(), { fnDomain: "abc.lambda-url.ap-northeast-1.on.aws" }) as unknown as Cfg;
        expect(next.Origins.Items).toHaveLength(2);
        expect(next.Origins.Quantity).toBe(2);
        expect(next.DefaultCacheBehavior.TargetOriginId).toBe("failover-group");
        expect(next.OriginGroups.Items[0].Members.Items.map((x: { OriginId: string }) => x.OriginId)).toEqual(["s3-site", "probe-lambda"]);
    });

    /**
     * 🔴 **403 を入れ忘れると、何も起きない。**
     * S3 + OAC は**存在しないオブジェクトに 403** を返す（`ListBucket` を
     * 与えていないため。`fix-cdn-error-pages.js` が同じ理由で403と404の
     * 両方を404ページに振っている）。404 だけだと発火しない
     */
    it("切り替えの条件に 403 と 404 の両方が入る", () => {
        const next = withOriginGroup(baseCfg(), { fnDomain: "x.on.aws" }) as unknown as Cfg;
        expect(next.OriginGroups.Items[0].FailoverCriteria.StatusCodes.Items.sort()).toEqual([403, 404]);
        expect(next.OriginGroups.Items[0].FailoverCriteria.StatusCodes.Quantity).toBe(2);
    });

    // **他のビヘイビアは触らない**（`/_next/static/*` まで切り替えると、資産の
    // 一時的な不在で Lambda に流れ込む）
    it("既定以外のビヘイビアは元のまま", () => {
        const next = withOriginGroup(baseCfg(), { fnDomain: "x.on.aws" }) as unknown as Cfg;
        expect(next.CacheBehaviors.Items[0].TargetOriginId).toBe("s3-site");
    });

    // **カスタムエラー応答は消さない**（消せば「確かめたいこと」自体が消える）
    it("カスタムエラー応答はそのまま", () => {
        const next = withOriginGroup(baseCfg(), { fnDomain: "x.on.aws" }) as unknown as Cfg;
        expect(next.CustomErrorResponses.Items).toHaveLength(2);
    });

    it("元の設定を書き換えない（渡したものが汚れない）", () => {
        const cfg = baseCfg();
        withOriginGroup(cfg, { fnDomain: "x.on.aws" });
        expect(cfg.Origins.Items).toHaveLength(1);
        expect(cfg.DefaultCacheBehavior.TargetOriginId).toBe("s3-site");
    });

    it("既定のオリジンが無い設定では止まる", () => {
        expect(() => withOriginGroup({ Origins: { Items: [] }, DefaultCacheBehavior: {} }, { fnDomain: "x" })).toThrow();
    });
});

describe("元へ戻す", () => {
    // **戻し損ねると staging が壊れたまま残る。** 往復で元に戻ることを見る
    it("足す前とまったく同じ姿に戻る", () => {
        const cfg = baseCfg();
        const added = withOriginGroup(cfg, { fnDomain: "x.on.aws" });
        const back = withoutOriginGroup(added, { originalTargetOriginId: "s3-site" });
        expect(back).toEqual(cfg);
    });
});

describe("結果の読み取り", () => {
    it("200 + JSON なら第2オリジン（＝フェイルオーバーが効いた）", () => {
        expect(readOutcome({ status: 200, contentType: "application/json", body: "[]" })).toContain("フェイルオーバー");
    });

    /**
     * 🔴 **status だけで「効いた」と読まない。** 確認するパスが S3 に
     * 在ってしまった回（静的サイトが `/photos` を作るようになった等）は
     * **200 + text/html** が返る。これを「効いた」と読むと、
     * **フェイルオーバーを一度も試さずに成立したことにしてしまう**
     */
    it("200 でも HTML なら「効いた」と読まない", () => {
        expect(readOutcome({ status: 200, contentType: "text/html", body: "<html>" }), "S3 が返したものを第2オリジンと読んでいる").toContain("不明");
    });

    it("JSON でも 200 でなければ「効いた」と読まない", () => {
        expect(readOutcome({ status: 404, contentType: "application/json", body: "{}" })).not.toContain("フェイルオーバー");
    });

    it("HTML の 404 は 404ページが勝った", () => {
        expect(readOutcome({ status: 404, contentType: "text/html", body: "<html>ページが見つかりません</html>" })).toContain("404ページ");
    });

    it("5xx はオリジンのエラーとして分ける", () => {
        expect(readOutcome({ status: 502, body: "" })).toContain("502");
    });

    it("分からないものを「効いた」と読まない", () => {
        expect(readOutcome({ status: 204, contentType: "", body: "" })).toContain("不明");
    });
});

/**
 * 🔴 **入口（`main()`）を実際に走らせる。**
 *
 * 純関数のテストが24件緑でも、`main()` は1行も通っていなかった。
 * 実際、`main()` を呼ぶ行を `const line` の宣言より前に置いていて
 * **`ReferenceError`（TDZ）で即死**した——`node --check` も eslint も
 * tsc も通り、**Actions で走らせて初めて落ちた**。
 * 台帳が記録している「`main()` がまるごと無検証」そのもの。
 *
 * 子プロセスで本当に起動し、**本番のIDでは止まる**ことまで見る。
 */
describe("入口を実際に走らせる", () => {
    const run = (env: Record<string, string>) => {
        try {
            const out = execFileSync("node", ["scripts/verify-origin-failover.js"], {
                env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
            });
            return { code: 0, out };
        } catch (e) {
            const err = e as { status?: number; stdout?: string; stderr?: string };
            return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
        }
    };

    it("本番の配信IDを渡すと、起動して止まる（TDZ で落ちない）", () => {
        const r = run({ CLOUDFRONT_DISTRIBUTION_ID: PROD_DISTRIBUTION });
        expect(r.out, "実行時エラーで落ちている（入口の並びが壊れた）").not.toMatch(/ReferenceError|TypeError|is not a function/);
        expect(r.out, "ガードの理由を出していない").toContain("本番");
        expect(r.code, "本番を触ろうとして止まっていない").not.toBe(0);
    });

    /**
     * 🔴 **ガードで止まる経路だけでは、この不具合は捕まらない。**
     *
     * `main()` はガードを**先に**通すので、本番IDを渡すと `line()` に
     * 到達せず TDZ が起きない。実際、上の1本だけでは
     * 「入口を宣言より前に戻す」変異が**素通りした**。
     * **staging の ID を渡して、最初の1行を印字するところまで進める。**
     *
     * 資格情報は偽物を渡す——本物の AWS には触らせない（読むだけの
     * 処理だが、テストが外へ出る形にはしない）。
     */
    it("staging の ID では、最初の行を印字するところまで進む（TDZ を捕まえる）", () => {
        const r = run({
            CLOUDFRONT_DISTRIBUTION_ID: STAGING_DISTRIBUTION,
            AWS_ACCESS_KEY_ID: "test-not-real", AWS_SECRET_ACCESS_KEY: "test-not-real",
            AWS_SESSION_TOKEN: "", AWS_REGION: "ap-northeast-1", AWS_EC2_METADATA_DISABLED: "true",
        });
        expect(r.out, "入口の並びが壊れている（宣言より前で main が走っている）").not.toMatch(/ReferenceError/);
        expect(r.out, "最初の行にも届いていない").toContain("[verify] region=");
        expect(r.out, "何を確かめるのかを言っていない").toContain("カスタムエラー応答");
    });

    it("配信IDが無いときも、起動して止まる", () => {
        const r = run({ CLOUDFRONT_DISTRIBUTION_ID: "" });
        expect(r.out).not.toMatch(/ReferenceError|TypeError/);
        expect(r.code).not.toBe(0);
    });
});

/**
 * **この差分の肝は「何度も測る」ところ。**
 *
 * 前の版は `Status === "Deployed"` を見て**一度だけ**測り、33秒で通過した。
 * それが「速かった」のか「古い構成を見た」のかは状態からは区別できず、
 * **区別できないまま『効かない』と報告するところだった**。
 *
 * だから見るのは2つ: **出たら即やめるか** と **出なければ使い切るか**。
 */
describe("第2オリジンが出るまで叩く", () => {
    it("出たら、その場で止める（無駄に叩かない）", async () => {
        const clock = fakeClock();
        const seen: string[] = [];
        const r = await pollForFailover("d.example", {
            limitSec: 240, everySec: 10,
            probeFn: async (d, extra) => { seen.push(`${d}${extra}`); return JSON_OK; },
            log: () => {}, sleep: clock.sleep, now: clock.now,
        });
        expect(r.ok, "第2オリジンが返ったのに ok でない").toBe(true);
        expect(r.tries, "1回で分かるのに叩き続けている").toBe(1);
        expect(seen).toHaveLength(1);
    });

    it("最初は404でも、あとから出たら ok（＝反映待ちを取りこぼさない）", async () => {
        const clock = fakeClock();
        const answers: Probe[] = [PAGE_404, PAGE_404, JSON_OK];
        let i = 0;
        const r = await pollForFailover("d.example", {
            limitSec: 240, everySec: 10,
            probeFn: async () => answers[i++] ?? PAGE_404,
            log: () => {}, sleep: clock.sleep, now: clock.now,
        });
        expect(r.ok, "3回目に出たのに取りこぼした").toBe(true);
        expect(r.tries).toBe(3);
    });

    it("出なければ予算を使い切ってから「効かない」と言う", async () => {
        const clock = fakeClock();
        let tries = 0;
        const r = await pollForFailover("d.example", {
            limitSec: 60, everySec: 10,
            probeFn: async () => { tries += 1; return PAGE_404; },
            log: () => {}, sleep: clock.sleep, now: clock.now,
        });
        expect(r.ok).toBe(false);
        // 0/10/20/30/40/50/60 秒 → 7回（予算ちょうどまで叩いてから諦める）。
        // 1回で諦めていないこと**と**予算を超えて回り続けていないことの両方を見る
        expect(tries, "1回しか測らずに『効かない』と言っている").toBeGreaterThan(1);
        expect(tries, "予算の使い方が変わった").toBe(7);
        expect(r.last.status, "最後に見た応答を返していない").toBe(404);
    });

    it("一度も 200+JSON が返らなければ、最後の応答をそのまま渡す", async () => {
        const clock = fakeClock();
        const r = await pollForFailover("d.example", {
            limitSec: 20, everySec: 10,
            probeFn: async () => ({ status: 503, contentType: "text/plain", body: "oops" }),
            log: () => {}, sleep: clock.sleep, now: clock.now,
        });
        expect(r.ok).toBe(false);
        expect(readOutcome(r.last)).toContain("オリジンのエラー");
    });

    /** 判定を1か所に寄せたので、そこだけ見ておけば3か所ぶんが縛れる */
    it("第2オリジンの見分け: 200+JSON だけを通す", () => {
        expect(isSecondOrigin(JSON_OK)).toBe(true);
        expect(isSecondOrigin(PAGE_404)).toBe(false);
        expect(isSecondOrigin({ status: 200, contentType: "text/html" }), "HTML を JSON と読んでいる").toBe(false);
        expect(isSecondOrigin({ status: 403, contentType: "application/json" }), "200 でないのに通している").toBe(false);
        expect(isSecondOrigin({ status: 200 }), "content-type が無いのに通している").toBe(false);
    });
});
