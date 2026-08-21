import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

// 本番の CloudFront ドメインをフロントのソースに直書きしない。
//
// app/layout.tsx の preconnect が直書きだった頃は、staging の全ページが
// 開くたびに**本番CDN**へ無駄な DNS+TLS 接続を張り、実際の配信元
// （staging のCDN）には preconnect が効かなかった——狙った LCP 改善が
// staging で一度も再現しない。環境の値は NEXT_PUBLIC_CLOUDFRONT_URL から
// 注入する（未設定なら出さない。フォールバックしない）。
//
// api/src/__tests__/upload.test.ts の「ソースに個人名を持たない」と同じ形の
// 再発防止ガード。ワークフロー（.github/**）は環境ごとの値を持つ場所なので対象外。
describe("フロントのソースに本番CDNのドメインを直書きしない", () => {
    const PROD_CDN = "d1s3dwwzgxf5ni";

    const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const name of nodeFs.readdirSync(dir)) {
            const p = nodePath.join(dir, name);
            if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
            const st = nodeFs.statSync(p);
            if (st.isDirectory()) out.push(...walk(p));
            else if (/\.(ts|tsx)$/.test(name)) out.push(p);
        }
        return out;
    };

    it("app/ と lib/ のどのファイルにも入っていない", () => {
        const hits: string[] = [];
        for (const dir of ["app", "lib"]) {
            for (const f of walk(nodePath.join(process.cwd(), dir))) {
                if (nodeFs.readFileSync(f, "utf8").includes(PROD_CDN)) hits.push(f);
            }
        }
        expect(hits).toEqual([]);
    });

    it("preconnect は環境変数から組む（本番へフォールバックしない）", () => {
        const src = nodeFs.readFileSync(nodePath.join(process.cwd(), "app", "layout.tsx"), "utf8");
        expect(src).toContain("NEXT_PUBLIC_CLOUDFRONT_URL");
        // 未設定なら出さない分岐があること（`? (` の三項で囲われている）
        expect(src).toMatch(/NEXT_PUBLIC_CLOUDFRONT_URL \? \(/);
    });
});
