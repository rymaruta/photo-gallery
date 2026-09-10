import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// **配線していない環境変数は、静かに空になる。**
//
// `NEXT_PUBLIC_CONTACT_EMAIL` を読むのは `lib/utils/seo.ts` だけで、
// `deploy.yml` の Build ステップの env に**入っていなかった**。
// つまり owner がリポジトリ変数を設定しても**何も起きない**——
// `MemberOnlyNotice`（投稿権限が付かなかった人が必ず着く画面）の
// 「問い合わせる」は、**どのビルドでも出ないまま**だった。
// 台帳には「未設定（owner の作業）」としか書いていなかった。
//
// **同じ型は前にも踏んでいる**——`USERS_TABLE` を `Deploy Site` が
// 渡しておらず、改名の突き合わせが**本番のビルドで1行も効いていなかった**
// （スクリプトは警告1行で素通りし、ビルドは緑）。
//
// だから「読んでいるのに渡していない」を機械で見る。**免除には理由を書く**
// ——理由を書けないものは、たいてい配線漏れ。
const ROOT = join(__dirname, "..", "..");

/**
 * 渡さなくてよいもの。**理由が書けるものだけ**ここに入れる。
 * 「使っていない」なら読む側を消すこと（死んだ設定は静かにずれる）。
 */
const NOT_WIRED: Record<string, string> = {
    // 既定値を持つ（`lib/auth/config.ts` が ap-northeast-1 に落とす）
    NEXT_PUBLIC_AWS_REGION: "既定値がある",
    // 開発用のフォールバック。本番の書き込みは presign を通るので要らない
    NEXT_PUBLIC_UPLOAD_API_KEY: "ローカル開発専用（本番は presign）",
    // 空＝その機能を出さない。使うと決めたときに配線する
    NEXT_PUBLIC_ADSENSE_CLIENT_ID: "空＝広告を出さない（未導入）",
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "空＝Plausible を使わない（GA を使用中）",
    NEXT_PUBLIC_GSC_VERIFICATION: "空＝メタタグを出さない（DNS 等で確認済みなら不要）",
    NEXT_PUBLIC_BING_VERIFICATION: "空＝メタタグを出さない",
    // 本番で立ってはいけない（ローカルの API を向く）
    NEXT_PUBLIC_USE_LOCAL_API: "本番では立てない（ローカル向け）",
};

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === "out" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full, out); continue; }
        if (/\.(ts|tsx|js|mjs)$/.test(name) && !full.includes("__tests__")) out.push(full);
    }
    return out;
}

/** 出荷されるコードが読んでいる `NEXT_PUBLIC_*` */
function readVars(): Set<string> {
    const found = new Set<string>();
    for (const dir of ["app", "lib", "scripts"]) {
        for (const file of walk(join(ROOT, dir))) {
            const src = readFileSync(file, "utf8");
            for (const m of src.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) found.add(m[1]);
        }
    }
    return found;
}

/** `deploy.yml` の Build ステップが渡している `NEXT_PUBLIC_*` */
function wiredVars(): Set<string> {
    const yml = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
    const out = new Set<string>();
    for (const m of yml.matchAll(/^\s+(NEXT_PUBLIC_[A-Z0-9_]+):/gm)) out.add(m[1]);
    return out;
}

describe("ビルドに渡す NEXT_PUBLIC_*", () => {
    // 走査そのものが壊れていないこと（0件を「問題なし」と読ませない）
    it("読む側も渡す側も、十分な数を見つけている", () => {
        expect(readVars().size, "コードの走査が壊れている").toBeGreaterThan(10);
        expect(wiredVars().size, "workflow の走査が壊れている").toBeGreaterThan(5);
    });

    it("読んでいるのに渡していないものは、免除の一覧に理由つきで入っている", () => {
        const wired = wiredVars();
        const missing = [...readVars()].filter((v) => !wired.has(v) && !(v in NOT_WIRED)).sort();
        expect(missing, "配線漏れ（設定しても何も起きない）").toEqual([]);
    });

    // **免除が古くなるのを止める。** 読まなくなった変数を免除に残すと、
    // 次にその名前を使い始めたとき素通りする
    it("免除の一覧に、もう読んでいないものが残っていない", () => {
        const read = readVars();
        const stale = Object.keys(NOT_WIRED).filter((v) => !read.has(v)).sort();
        expect(stale, "読む側が消えたのに免除だけ残っている").toEqual([]);
    });

    // 免除と配線の両方に居るのは矛盾（どちらかが古い）
    it("免除の一覧と、渡しているものが重なっていない", () => {
        const wired = wiredVars();
        expect(Object.keys(NOT_WIRED).filter((v) => wired.has(v)), "渡しているのに免除にも入っている").toEqual([]);
    });

    // **投稿権限が付かなかった人の唯一の出口**なので、名指しで縛る
    it("問い合わせ先を渡している（MemberOnlyNotice の唯一の出口）", () => {
        expect(wiredVars().has("NEXT_PUBLIC_CONTACT_EMAIL"),
            "設定しても何も起きない状態に戻っている").toBe(true);
    });
});
