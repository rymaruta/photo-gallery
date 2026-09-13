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

/**
 * **集約ページを、本番のスモークが一度も開いていなかった。**
 *
 * 生成の **86/140** が集約ページ（タグ／カテゴリ／撮影地／機材）で、
 * 検索から人が着地する側でもある。そこをスモークが見ていないと、
 * **静的HTMLは出るのに水和後にサムネが消える**形（サーバーが渡す props を
 * 絞りすぎた、など）が本番まで通ってしまう。
 *
 * 2026-09-12 に実際にその props を絞った（`slimForGrid`）。単体テストは
 * 「何を渡すか」を縛るが、**配線が壊れた場合は捕まえられない**。
 *
 * ここで固定するのは「スモークが集約ページを開き、水和後に数えること」。
 */
describe("E2E スモークが見る範囲", () => {
    const script = read("scripts/e2e-smoke.mjs");

    it("集約ページ（/tag/…）を開く", () => {
        expect(script, "集約ページを一度も開いていない").toContain("/tag/");
    });

    it("水和のあとに写真の数を数える（静的HTMLだけ見ない）", () => {
        expect(script).toContain("集約ページ: ハイドレーション完了");
        expect(script, "写真が並ぶことを見ていない").toContain("集約ページ: 写真が並ぶ");
        expect(script, "壊れた画像を見ていない").toContain("集約ページ: 壊れた画像が無い");
        expect(script, "写真へのリンクを見ていない").toContain("集約ページ: 写真へのリンクがある");
    });

    // **空枠は開かない**（写真0件のビルドを通すための `_none.html`）。
    // プロフィール側が同じ理由で除いている
    it("空枠（_none.html）は開かない", () => {
        const tagBlock = script.slice(script.indexOf("const tagDir"), script.indexOf("const realErrors"));
        expect(tagBlock, "空枠を実在ページとして開いている").toContain('f !== "_none.html"');
    });

    // **生成が無い環境（写真0件の staging）で落とさない**
    it("集約ページが1つも無ければ飛ばす", () => {
        const tagBlock = script.slice(script.indexOf("const tagDir"), script.indexOf("const realErrors"));
        expect(tagBlock).toContain("tags.length > 0");
        expect(tagBlock, "ディレクトリが無い環境で落ちる").toContain("fs.existsSync(tagDir)");
    });
});
