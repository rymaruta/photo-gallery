import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **本番デプロイだけが落ちる形を作らないための番人。**
//
// `scripts/e2e-smoke.mjs`（Playwright）はハンバーガーを
// `[aria-label="Open menu"]` で引いていた。表示ラベルを日本語に直した回に
// スクリプトが追随できず、**staging は緑のまま本番のスモークで落ちる**
// 状態になっていた（`deploy.yml` のスモークは `envName == 'prod'` の
// ステップにしか無い）。しかも落ちる場所は S3 反映の直前。
//
// 目印（`data-e2e`）と表示文言を分けたので、ここでは
// 「スクリプトが目印で引いていること」「実装がその目印を持っていること」
// の2つを固定する。表示文言はいくら変えても壊れない。

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("E2E スモークが引く目印", () => {
    const script = read("scripts/e2e-smoke.mjs");
    const headerNav = read("app/components/HeaderNav.tsx");

    it("スクリプトはハンバーガーを data-e2e で引く", () => {
        expect(script).toContain('[data-e2e="menu-toggle"]');
    });

    it("スクリプトは表示ラベルで引かない（文言を変えると壊れるため）", () => {
        expect(script, "aria-label で引いている（文言を直すと本番だけ落ちる）")
            .not.toMatch(/aria-label="(Open|Close) menu"/);
        expect(script).not.toContain('aria-label="メニューを開く"');
    });

    it("実装側にその目印がある", () => {
        expect(headerNav, "ボタンから data-e2e が消えている（スモークが引けない）")
            .toContain('data-e2e="menu-toggle"');
    });
});
