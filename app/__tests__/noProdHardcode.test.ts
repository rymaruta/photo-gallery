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

    // **配信元への事前接続は出さない。**
    //
    // 以前はここに「preconnect は環境変数から組む（本番へフォールバックしない）」
    // という判定があった。直書きをやめた当時は正しかったが、
    // **画面に描く画像URLを全部サイトのドメインに揃えた**ので
    // （`lib/utils/seo.ts` の `publicImageUrl`）、その preconnect は
    // **一度も使われない相手**への接続になった。本番と同じ環境変数で
    // ビルドして数えた（2026-09-13）: 描画された絶対URL 981件はすべて
    // `journey-photo.com`、CloudFront の既定ドメインを指していたのは
    // preconnect と dns-prefetch だけ（140ページ）。
    //
    // 見張る向きを**逆にする**——「環境変数から組めているか」ではなく
    // 「もう出していないか」。戻すなら画像URLの揃え方も一緒に戻す話になる。
    describe("配信元への事前接続", () => {
        const layoutSrc = () => nodeFs.readFileSync(nodePath.join(process.cwd(), "app", "layout.tsx"), "utf8");
        /** コメントを落としてから探す（理由を書くほど綴りの検出は自分の説明に当たる） */
        const stripComments = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        const preconnectsCdn = (src: string) =>
            /<link[^>]*rel=\{?"(?:preconnect|dns-prefetch)"[^>]*NEXT_PUBLIC_CLOUDFRONT_URL/.test(stripComments(src));

        it("CloudFront への preconnect / dns-prefetch を出さない", () => {
            expect(preconnectsCdn(layoutSrc()), "使われない相手への事前接続が戻っている").toBe(false);
        });

        // 判定そのものが効くか（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
        it("判定は、戻されたら見つける", () => {
            const readded = layoutSrc() + '\n<link rel="preconnect" href={process.env.NEXT_PUBLIC_CLOUDFRONT_URL} crossOrigin="" />\n';
            expect(preconnectsCdn(readded), "戻されても見つけられていない").toBe(true);
            // コメントの中の言及では発火しない
            const mentioned = layoutSrc() + '\n{/* <link rel="preconnect" href={process.env.NEXT_PUBLIC_CLOUDFRONT_URL} /> は出さない */}\n';
            expect(preconnectsCdn(mentioned), "コメントに一致している").toBe(false);
        });
    });
});
