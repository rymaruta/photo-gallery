import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-09-27、撮影スポットを155件足した本番の反映が、S3 への書き込みの途中で
// ジョブの上限（30分）に当たって打ち切られた。HTML を**1件ずつ順に**書いていて、
// ページが増えた分だけ伸びたため。本番は途中まで入れ替わった状態で止まった。
// ここで固定するのは2つ:
//   1. HTML も素材と同じく並べて書く（素材を先に上げ終えるので順番は要らない）
//   2. フロントのジョブの上限と、S3 の段の上限の両方に余裕がある
//      （書き込みはすべて S3 の段の中。ジョブだけ広げても段の上限で止まる）
const root = join(__dirname, "..", "..");
/** コメントを落とす。**コメントに書いてあるだけ**を緑にしないため */
const strip = (s: string) => s.replace(/^\s*(\/\/|#).*$/gm, "");
const script = strip(readFileSync(join(root, "scripts", "deploy-static-site.js"), "utf8"));
const workflow = strip(readFileSync(join(root, ".github", "workflows", "deploy.yml"), "utf8"));

describe("本番の反映が S3 への書き込みで時間切れにならない", () => {
    it("HTML を1件ずつ順に書いていない", () => {
        expect(script).not.toMatch(/for\s*\(const\s+\w+\s+of\s+htmlFiles\)\s*await\s+uploadFile/);
    });

    it("HTML も素材と同じ並び（runPool）で書く", () => {
        expect(script).toMatch(/await\s+runPool\(htmlFiles,\s*uploadFile/);
    });

    it("素材を上げ終えてから HTML を書く（順番は崩さない）", () => {
        const images = script.indexOf("await runPool(imageAssets, uploadFile");
        const assets = script.indexOf("await runPool(otherAssets, uploadFile");
        const html = script.indexOf("await runPool(htmlFiles, uploadFile");
        expect(images).toBeGreaterThan(-1);
        expect(assets).toBeGreaterThan(images);
        expect(html).toBeGreaterThan(assets);
    });

    /** 2026-10-08: アプリ向けの JSON の `thumbUrl` が、まだ上がっていない JPEG を指す隙間を作らない */
    it("素材のうち画像（images/）を先に上げ終えてから、残り（JSON など）を上げる", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { splitImagesFirst } = require("../deploy-static-site.js");
        expect(script).toMatch(/splitImagesFirst\(assets\)/);
        expect(splitImagesFirst([
            "app/data/spots.json", "images/spots/thumb/a.jpg", "images/spots/a.jpg", "_next/static/x.js", "imagesx/y.png",
        ])).toEqual({
            images: ["images/spots/thumb/a.jpg", "images/spots/a.jpg"],
            rest: ["app/data/spots.json", "_next/static/x.js", "imagesx/y.png"],
        });
    });

    it("フロントのジョブの上限は45分以上", () => {
        const job = workflow.slice(workflow.indexOf("needs: [config, api-gate]"));
        const m = /timeout-minutes:\s*(\d+)/.exec(job);
        expect(m, "deploy-frontend に timeout-minutes が無い").not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(45);
    });

    it("S3 の段の上限は30分以上（ジョブの上限は超えない）", () => {
        const step = workflow.slice(workflow.indexOf("- name: Deploy to S3"));
        const m = /timeout-minutes:\s*(\d+)/.exec(step);
        expect(m, "Deploy to S3 に timeout-minutes が無い").not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(30);
        const job = /timeout-minutes:\s*(\d+)/.exec(workflow.slice(workflow.indexOf("needs: [config, api-gate]")));
        expect(Number(m![1])).toBeLessThan(Number(job![1]));
    });
});
