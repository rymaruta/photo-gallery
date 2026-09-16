import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { refuseReason, screen, referencedByCloudFront, ALLOW } = require("../purge-leftover-resources.js") as {
    refuseReason: (name: unknown) => string | null;
    screen: (entries: { name?: string; id?: string }[], key?: string) => { pass: unknown[]; refused: { refused: string }[] };
    referencedByCloudFront: (bucket: string, domains: Set<string>) => string | null;
    ALLOW: { buckets: { name: string; why: string }[]; functions: { name: string; why: string }[]; pools: { id: string; name: string; why: string }[] };
};

/**
 * **本番アカウントのリソースを消す道具。取り消せない。**
 *
 * この道具は「一覧に書いたものだけ消す」形にしてある。**一覧を書くのは私**で、
 * 私は一度間違えた——`unused-resources` が現役の serverless デプロイ用
 * バケット4本を「残骸かも」と出し、そのまま「消してよさそう」と報告しかけた
 * （`deploymentBucket` を指定していないので自動命名される、を知らなかった）。
 *
 * なので**一覧を信じない層**を1つ挟んである。ここではその層を見る。
 */
describe("一覧に書いてあっても消さない条件", () => {
    it("本番・ステージングの名前は消さない", () => {
        for (const n of ["prod-journey-photo.com", "prod-photo-gallery-photos", "staging-journey-photo-upload"]) {
            expect(refuseReason(n), n).toContain("本番");
        }
    });

    // ⚠️ **私が実際に間違えたところ。** 消すと次のデプロイが壊れる
    it("serverless のデプロイ用バケットは消さない（切り詰められた名前も）", () => {
        for (const n of [
            "photo-gallery-api-prod-serverlessdeploymentbucket-ta5ij6kngero",
            "photo-gallery-user-api-pr-serverlessdeploymentbuck-p9mpjlfw4qdo",
        ]) {
            expect(refuseReason(n), n).toContain("デプロイ");
        }
    });

    // **外れるとトップ以外の全ページが 404 になる**（台帳に記録のある関数）
    it("Lambda@Edge の OGP 関数は消さない", () => {
        for (const n of ["photo-gallery-ogp-viewer-request", "us-east-1.photo-gallery-ogp-origin-response", "OGP-Thing"]) {
            expect(refuseReason(n), n).toContain("404");
        }
    });

    it("空の名前も消さない", () => {
        expect(refuseReason("")).toBeTruthy();
        expect(refuseReason(undefined)).toBeTruthy();
        expect(refuseReason(null)).toBeTruthy();
    });

    it("残骸の名前は通す", () => {
        for (const n of ["journey-photo-api-deploy-prod-463470976368", "dev-journey-photo-upload", "photo-gallery-api-dev-api"]) {
            expect(refuseReason(n), n).toBeNull();
        }
    });
});

describe("ふるい", () => {
    it("通すものと止めるものを分け、止めた理由を付ける", () => {
        const r = screen([
            { name: "dev-journey-photo.com" },
            { name: "prod-journey-photo.com" },
            { name: "photo-gallery-api-prod-serverlessdeploymentbucket-x" },
        ]);
        expect(r.pass).toHaveLength(1);
        expect(r.refused).toHaveLength(2);
        expect(r.refused[0].refused).toBeTruthy();
    });

    it("空でも落ちない", () => {
        expect(screen([])).toEqual({ pass: [], refused: [] });
        expect(screen(undefined as unknown as []).pass).toEqual([]);
    });
});

describe("CloudFront が使っているか", () => {
    // オリジンは `<bucket>.s3.<region>.amazonaws.com` の形で出てくる
    it("オリジンになっているバケットを見つける", () => {
        const d = new Set(["prod-journey-photo.com.s3.ap-northeast-1.amazonaws.com"]);
        expect(referencedByCloudFront("prod-journey-photo.com", d)).toBeTruthy();
        expect(referencedByCloudFront("journey-photo.com", d), "別のバケットを誤って「使用中」にしている").toBeNull();
    });

    it("ウェブサイト形式のオリジンも見つける", () => {
        const d = new Set(["journey-photo.com.s3-website-ap-northeast-1.amazonaws.com"]);
        expect(referencedByCloudFront("journey-photo.com", d)).toBeTruthy();
    });

    // ログの出力先はバケット名そのもの（ドメインではない）で入る
    it("ログの出力先も見つける", () => {
        expect(referencedByCloudFront("cf-logs-journey-photo", new Set(["cf-logs-journey-photo"]))).toBeTruthy();
    });

    it("参照が無ければ null", () => {
        expect(referencedByCloudFront("dev-journey-photo.com", new Set())).toBeNull();
        expect(referencedByCloudFront("dev-journey-photo.com", new Set(["other.s3.amazonaws.com"]))).toBeNull();
    });
});

describe("一覧そのもの", () => {
    // **理由を書けないものは一覧に入れない**（次に読む人が判断できない）
    it("全部に理由が書いてある", () => {
        for (const e of [...ALLOW.buckets, ...ALLOW.functions, ...ALLOW.pools]) {
            expect(e.why, JSON.stringify(e)).toBeTruthy();
            expect(e.why.length, JSON.stringify(e)).toBeGreaterThan(10);
        }
    });

    // 一覧の中身が、上のふるいを1つも踏まないこと（踏むなら書き間違えている）
    it("一覧に「消してはいけないもの」が混ざっていない", () => {
        const bad: string[] = [];
        for (const e of [...ALLOW.buckets, ...ALLOW.functions]) {
            const why = refuseReason(e.name);
            if (why) bad.push(`${e.name}: ${why}`);
        }
        expect(bad, `一覧に混ざっている: ${bad.join(" / ")}`).toEqual([]);
    });

    // プールは ID で消すので、名前も控えて突き合わせる（ID の書き間違いで
    // 別のプールを消さないため）
    it("プールは ID と名前を両方持つ", () => {
        for (const p of ALLOW.pools) {
            expect(p.id).toMatch(/^ap-northeast-1_/);
            expect(p.name).toBeTruthy();
        }
    });

    // 現役のものが一覧に入っていないこと（名指しで確かめる）
    it("現役の名前は一覧に1つも無い", () => {
        const names = [...ALLOW.buckets, ...ALLOW.functions].map((e) => e.name);
        for (const live of [
            "prod-journey-photo.com", "prod-journey-photo-upload", "prod-journey-photo-cdn-logs",
            "staging-journey-photo.com", "staging-journey-photo-upload",
            "photo-gallery-api-prod-serverlessdeploymentbucket-ta5ij6kngero",
        ]) {
            expect(names, live).not.toContain(live);
        }
        expect(ALLOW.pools.map((p) => p.id)).not.toContain("ap-northeast-1_ZbuhDQsWz");
        expect(ALLOW.pools.map((p) => p.id)).not.toContain("ap-northeast-1_DSQ16c6vO");
    });
});
