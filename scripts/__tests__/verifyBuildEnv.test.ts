import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 **手元の関門が建てる site が、本番と同じ形をしていること。**
 *
 * `scripts/verify-local.sh` の `build_site()` は「本番と同じ環境変数で建てる」と
 * 名乗りながら、`deploy.yml` が渡す `NEXT_PUBLIC_*` のうち**3本しか渡していなかった**。
 * 欠けていたのは API の宛先2本と Cognito の2本。
 *
 * 症状が出ないのが怖いところで、ビルドは緑・スモークも緑のまま、
 * **建った site では誰もログインできない**（`lib/auth/config.ts` が
 * 空の Client ID で投げ、`lookupSession` は必ず未ログインを返す）。
 * 実測（2026-09-22・`out/user/highlights` を実ブラウザで開いた）:
 *
 *     本文 = "ログイン / 写真をアップロードするにはログインが必要です …"
 *
 * つまり `/user/**` の11画面は**1つも中身が描かれない**。今日いちばん大きかった
 * 2件（ハイライトの「保存」が押せない・`/user/edit` の下バーが全部押せない）が
 * 全関門を素通りしたのは、突き詰めるとこれ。
 *
 * `publicEnvWiring.test.ts` は「**読んでいるのに `deploy.yml` が渡していない**」を
 * 見る。こちらは「**`deploy.yml` が渡しているのに手元の関門が渡していない**」を見る
 * ——向きが逆なので、あちらでは一度も落ちなかった。
 */
const ROOT = join(__dirname, "..", "..");

const deployYml = () => readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
const verifySh = () => readFileSync(join(ROOT, "scripts", "verify-local.sh"), "utf8");

/** `deploy.yml` の Build ステップが渡す `NEXT_PUBLIC_*` */
function deployVars(): Set<string> {
    const out = new Set<string>();
    for (const m of deployYml().matchAll(/^\s+(NEXT_PUBLIC_[A-Z0-9_]+):/gm)) out.add(m[1]);
    return out;
}

/** `verify-local.sh` の `PROD_BUILD_ENV` が渡す `NEXT_PUBLIC_*`（値つき） */
function verifyVars(): Map<string, string> {
    const sh = verifySh();
    const block = /PROD_BUILD_ENV=\(([\s\S]*?)\n\)/.exec(sh);
    if (!block) return new Map();
    const out = new Map<string, string>();
    for (const m of block[1].matchAll(/^\s*"(NEXT_PUBLIC_[A-Z0-9_]+)=([^"]*)"/gm)) out.set(m[1], m[2]);
    return out;
}

/**
 * 手元では**わざと渡さない**もの。**理由が書けるものだけ**。
 * 書けないものは、たいてい配線漏れ。
 */
const LOCAL_ONLY_EMPTY: Record<string, string> = {
    // 入れると手元のスモークの全ページが Google へ計測を送る（本番の数字が汚れる）
    NEXT_PUBLIC_GA_ID: "空＝手元のスモークで計測を送らない",
};

describe("手元の関門のビルド環境（verify-local.sh）", () => {
    it("走査が空回りしていない", () => {
        expect(deployVars().size, "deploy.yml の走査が壊れている").toBeGreaterThan(5);
        expect(verifyVars().size, "verify-local.sh の PROD_BUILD_ENV が読めない").toBeGreaterThan(5);
    });

    it("deploy.yml が渡す NEXT_PUBLIC_* を、手元でも全部渡している", () => {
        const local = verifyVars();
        const missing = [...deployVars()]
            .filter((v) => !local.has(v) && !(v in LOCAL_ONLY_EMPTY))
            .sort();
        expect(missing, "本番だけに渡している（手元の site は別物になる）").toEqual([]);
    });

    it("免除の一覧に、deploy.yml がもう渡していないものが残っていない", () => {
        const deployed = deployVars();
        const stale = Object.keys(LOCAL_ONLY_EMPTY).filter((v) => !deployed.has(v)).sort();
        expect(stale, "本番側が消えたのに免除だけ残っている").toEqual([]);
    });

    /**
     * **配線があっても空なら同じこと。** `NEXT_PUBLIC_COGNITO_CLIENT_ID=""` と
     * 書いても上のテストは通るので、値まで見る。
     */
    it("ログインに要る2本に、実際の値が入っている", () => {
        const local = verifyVars();
        expect(local.get("NEXT_PUBLIC_COGNITO_USER_POOL_ID") ?? "",
            "空＝建てた site で誰もログインできない").toMatch(/^[a-z0-9-]+_[A-Za-z0-9]+$/);
        expect(local.get("NEXT_PUBLIC_COGNITO_CLIENT_ID") ?? "",
            "空＝建てた site で誰もログインできない").toMatch(/^[a-z0-9]{20,}$/);
    });

    it("API の宛先2本が URL の形をしている", () => {
        const local = verifyVars();
        for (const k of ["NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_USER_API_BASE_URL"]) {
            expect(local.get(k) ?? "", `${k} が URL ではない`).toMatch(/^https:\/\/[^\s/]+$/);
        }
    });

    /**
     * 🔴 **スモーク用の値を `export` しない。**
     *
     * 最初 `export NEXT_PUBLIC_COGNITO_CLIENT_ID=…` で通したら、
     * **単体テストにも漏れて 55件が落ちた**（実測）——`lib/auth/config.ts` は
     * Pool ID と Client ID の**両方**が揃っているかで分岐するので、片方だけ
     * 立つと、テストが前提にしている失敗の形が変わる
     * （`UserProfileClient.*` の10ファイルと `lib/utils/apiTimeout` ほか）。
     *
     * しかも **`npx vitest run` を手で叩くと緑**で、関門でしか出ない。
     * 「手元と CI で環境が違う」の、もう1つの向き。**要るプロセスにだけ渡す。**
     */
    it("スモーク用の値を export で撒いていない（単体テストに漏れる）", () => {
        const sh = verifySh();
        // ⚠️ **綴りを `NEXT_PUBLIC_*` に絞らない／行頭に固定しない。**
        // 実際に踏んだ書き方は
        //     case "$_kv" in NEXT_PUBLIC_COGNITO_CLIENT_ID=*) export "$_kv" ;; esac
        // で、**名前でも行頭でも見つからない**——最初その2つで書いて、
        // この見張りは壊れた状態でも緑だった（2回とも実測）。
        // コメント行を落としてから、`export` という語そのものを禁じる
        const code = sh.replace(/^\s*#.*$/gm, "");
        const exported = [...code.matchAll(/^.*\bexport\b.*$/gm)].map((m) => m[0].trim());
        expect(exported, "export すると vitest にも渡ってしまう（要るプロセスにだけ渡す）").toEqual([]);
    });

    it("スモークの関門だけに Client ID を渡している", () => {
        const sh = verifySh();
        // 一覧から取り出して `SMOKE_ENV` に積む（同じ値を2か所に書かない）
        expect(sh, "SMOKE_ENV を組み立てていない").toMatch(/SMOKE_ENV\+=\("\$_kv"\)/);
        // **スモークを呼ぶ行すべてに渡す**（派生ありの2回目を忘れない）
        const calls = [...sh.matchAll(/^gate .*e2e-smoke\.mjs|^\s+gate .*e2e-smoke\.mjs/gm)].map((m) => m[0]);
        expect(calls.length, "スモークの呼び出しが見つからない").toBeGreaterThanOrEqual(2);
        for (const c of calls) {
            expect(c, `Client ID を渡していない: ${c.trim()}`).toContain('env "${SMOKE_ENV[@]}"');
        }
    });

    /** `build_site()` がその一覧を実際に使っていること（宣言しただけで使わない形を止める） */
    it("build_site() が PROD_BUILD_ENV を使って建てている", () => {
        const sh = verifySh();
        const fn = /build_site\(\)[\s\S]*?\n\}/.exec(sh);
        expect(fn, "build_site() が見つからない").not.toBeNull();
        expect(fn?.[0] ?? "", "宣言しただけで使っていない")
            .toMatch(/env\s+"\$\{PROD_BUILD_ENV\[@\]\}"\s+npx next build/);
    });
});
