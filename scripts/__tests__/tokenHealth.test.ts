import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 再ビルドのトークンの健康診断（`.github/workflows/token-health.yml`）。
 *
 * **これが守っているもの**: `REBUILD_DISPATCH_TOKEN` が切れる／取り消される／
 * 権限を失うと、再ビルドが黙って止まる（`rebuild.ts` は警告1行で先へ進む）。
 * 症状は「出した写真が最大7日 検索に出ない」「消した写真のページが最大7日残る」で、
 * **誰も気づけない**。週1で実際に使ってみて、駄目なら赤くする。
 */
const DIR = ".github/workflows";
const read = (f: string) => readFileSync(join(process.cwd(), DIR, f), "utf8");
const HEALTH = "token-health.yml";

/** どのワークフローが repository_dispatch のどの名前を待ち受けているか */
function listenedEventTypes(): string[] {
    const out: string[] = [];
    for (const f of readdirSync(join(process.cwd(), DIR)).filter((x) => x.endsWith(".yml"))) {
        const src = read(f);
        // `repository_dispatch:` の直後の `types: [a, b]` だけを拾う
        const m = /repository_dispatch:\s*\n\s*types:\s*\[([^\]]*)\]/.exec(src);
        if (!m) continue;
        for (const t of m[1].split(",")) {
            const name = t.trim().replace(/^["']|["']$/g, "");
            if (name) out.push(name);
        }
    }
    return out;
}

describe("トークンの健康診断", () => {
    it("週1で動く（スケジュールがある）", () => {
        // コメント行が挟まるので、隣接は要求しない
        const src = read(HEALTH);
        expect(src, "定期実行が無い＝誰も気づけない状態に戻る").toMatch(/^\s*schedule:\s*$/m);
        expect(src, "cron が無い").toMatch(/^\s*- cron: ".+"\s*$/m);
    });

    // **本番と同じ口を叩いていること。** `GET /repos` などで代用すると
    // 「読めるが書けない」を見逃す（`dispatches` は Contents の書き込みが要る）
    it("本番と同じ口（/dispatches）を叩く", () => {
        expect(read(HEALTH)).toContain("/dispatches");
    });

    // **いちばん大事。** 待ち受けている名前で dispatch すると、
    // 健康診断のたびに**本物のサイトビルド（約8分）が毎週走る**。
    // Actions の枠はこのリポジトリが何度も逼迫させている資源
    it("ビルドを起こさない名前を使っている", () => {
        const src = read(HEALTH);
        const m = /"event_type"\s*:\s*"([^"]+)"/.exec(src);
        expect(m, "event_type が読み取れない").not.toBeNull();
        const used = m![1];
        const listened = listenedEventTypes();
        expect(listened, "待ち受けている名前が1つも読めていない（正規表現が的を外している）")
            .toContain("site-rebuild");
        expect(listened, `event_type=${used} は待ち受けられている＝毎週ビルドが走る`)
            .not.toContain(used);
    });

    // **秘密を `run:` のテキストに埋めない。** 値の中身が shell の構文として
    // 解釈される（このリポジトリは同じ形で一度事故を起こしかけている）
    it("トークンは env 経由で渡す（run: に埋めない）", () => {
        const src = read(HEALTH);
        expect(src, "secrets を env で渡していない")
            .toMatch(/^\s*TOKEN: \$\{\{ secrets\.REBUILD_DISPATCH_TOKEN \}\}\s*$/m);
        const runBlocks = src.split(/^\s*run:\s*\|/m).slice(1).join("\n");
        expect(runBlocks, "run: の中に secrets を直接書いている").not.toMatch(/\$\{\{\s*secrets\./);
    });

    // 未設定のときも赤くする（いまの本番がその状態）
    it("トークンが未設定なら失敗する", () => {
        const src = read(HEALTH);
        expect(src).toMatch(/if \[ -z "\$\{TOKEN\}" \]/);
        expect(src, "未設定を素通りさせている").toMatch(/exit 1/);
    });

    // 成功したときだけ 0 で抜ける（204 以外を緑にしない）
    it("204 以外は失敗にする", () => {
        const src = read(HEALTH);
        expect(src).toMatch(/if \[ "\$\{code\}" = "204" \]/);
    });

    // **切れてから気づくのでは遅い。** 期限付きのトークンは、切れた瞬間から
    // 「削除が最大7日残る」に静かに戻る。GitHub が応答に返す残り期限を読んで
    // 2週間前に言う（期限なしのトークンならヘッダが無いので黙る）
    it("期限が近づいたら、切れる前に赤くする", () => {
        const src = read(HEALTH);
        expect(src, "残り期限のヘッダを読んでいない")
            .toContain("github-authentication-token-expiration");
        expect(src, "ヘッダを読むには -D が要る").toMatch(/curl[^\n]*-D /);
        expect(src, "しきい値の判定が無い").toMatch(/-le 14/);
    });
});
