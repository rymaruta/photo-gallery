import { describe, it, expect, vi } from "vitest";

// robots.txt は「本番だけ許可」の出し分け。ここが最後まで残っていた
// 「本番へのフォールバック」で、環境名を注入し忘れたビルドが
// **許可する側**を出していた（staging の内容が重複コンテンツとして拾われる）。
// 未設定なら拒否側に倒す。
//
// 逆側（本番なのに拒否を出す）は scripts/deploy-static-site.js の
// assertRobotsMatchesTarget が上げる直前に止めるので、
// **その判定が本番の実物を誤爆しないこと**もここで一緒に確かめる。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertRobotsMatchesTarget } = require("../../scripts/deploy-static-site.js");

/** Next.js が MetadataRoute.Robots から出す robots.txt を再現する */
function renderRobots(r: { rules: { userAgent: string; allow?: string; disallow?: string | string[] }; sitemap?: string[] }): string {
    const lines = [`User-Agent: ${r.rules.userAgent}`];
    if (r.rules.allow) lines.push(`Allow: ${r.rules.allow}`);
    for (const d of [r.rules.disallow ?? []].flat()) lines.push(`Disallow: ${d}`);
    if (r.sitemap) for (const s of r.sitemap) lines.push(`Sitemap: ${s}`);
    return lines.join("\n") + "\n";
}

async function robotsFor(envName: string | undefined) {
    vi.resetModules();
    if (envName === undefined) vi.stubEnv("NEXT_PUBLIC_ENV_NAME", "");
    else vi.stubEnv("NEXT_PUBLIC_ENV_NAME", envName);
    const mod = await import("../robots");
    return mod.default();
}

describe("robots.txt の出し分け", () => {
    it("本番はクロールを許可する", async () => {
        const r = await robotsFor("prod");
        expect(r.rules).toMatchObject({ allow: "/" });
        expect(r.sitemap).toBeTruthy();
    });

    it("staging は全面拒否", async () => {
        const r = await robotsFor("staging");
        expect(r.rules).toEqual({ userAgent: "*", disallow: "/" });
    });

    // ここが 4-5 の再現。以前は未設定でも "prod" 扱いだった。
    it("環境名が未設定なら全面拒否（本番へフォールバックしない）", async () => {
        const r = await robotsFor(undefined);
        expect(r.rules).toEqual({ userAgent: "*", disallow: "/" });
    });
});

describe("本番の robots.txt が、上げる直前の判定に引っかからない", () => {
    it("実際に出力される本番の robots.txt は通る", async () => {
        const text = renderRobots(await robotsFor("prod") as never);
        // /admin や /user/ の Disallow を「全面拒否」と読み違えると、
        // 正しい本番デプロイが毎回止まる（直すために判定を弱める、が起きる）
        expect(text).toContain("Disallow: /admin");
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com", text)).not.toThrow();
    });

    it("実際に出力される staging の robots.txt も通る", async () => {
        const text = renderRobots(await robotsFor("staging") as never);
        expect(() => assertRobotsMatchesTarget("staging-journey-photo.com", text)).not.toThrow();
    });

    it("取り違えは両方向とも止まる", async () => {
        const prodText = renderRobots(await robotsFor("prod") as never);
        const stagingText = renderRobots(await robotsFor("staging") as never);
        expect(() => assertRobotsMatchesTarget("staging-journey-photo.com", prodText)).toThrow();
        expect(() => assertRobotsMatchesTarget("prod-journey-photo.com", stagingText)).toThrow();
    });
});
