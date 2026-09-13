import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 運用タスク（`.github/workflows/maintenance.yml`）の配線。
 *
 * **これが守っているもの**: ここは owner が本番へ触れる唯一の口で、
 * 台帳の保留（`diagnose` を流す・`geocode-locations` を apply する・
 * `public-feed-index` を apply する）はすべてこの画面から実行する。
 *
 * **壊れ方が静か。** 選択肢（`options`）とステップの条件
 * （`if: inputs.task == '...'`）は**別々に書く**ので、片方だけ直すと
 * 「選べるのに、走らせても全ステップが skip されて**緑**」になる
 * ——owner は実行したつもりで何も起きていない。台帳が何度も記録している
 * 「関数は書いたが配線していない」の、いちばん人手に近いところ。
 *
 * スクリプトのファイル名の付け替えも同じ（`run:` は文字列なので
 * `tsc` も `eslint` も見ない）。
 */
const FILE = join(process.cwd(), ".github/workflows/maintenance.yml");
const src = readFileSync(FILE, "utf8");

/** 画面の選択肢 */
function options(): string[] {
    const m = /task:\s*\n(?:.*\n)*?\s*options:\s*\n((?:\s*-\s*\S+.*\n)+)/.exec(src);
    if (!m) return [];
    return m[1]
        .split("\n")
        .map((l) => /^\s*-\s*(\S+)/.exec(l)?.[1])
        .filter((v): v is string => !!v);
}

/** 実際に条件へ書かれているタスク名 */
function conditions(): string[] {
    return [...src.matchAll(/inputs\.task\s*==\s*'([^']+)'/g)].map((m) => m[1]);
}

/** タスク名 → `run:` が叩くスクリプトのパス */
function scriptFor(task: string): string | undefined {
    const re = new RegExp(`if:\\s*inputs\\.task\\s*==\\s*'${task}'[\\s\\S]{0,900}?run:[\\s\\S]{0,200}?(scripts/[\\w./-]+)`);
    return re.exec(src)?.[1];
}

/** ワークフロー全体の `env:`（トップレベル。キーは2スペース） */
function workflowEnv(): Set<string> {
    const m = /^env:\s*\n((?:  [A-Z_][A-Z0-9_]*:.*\n)+)/m.exec(src);
    return new Set([...(m?.[1] ?? "").matchAll(/^  ([A-Z_][A-Z0-9_]*):/gm)].map((x) => x[1]));
}

/**
 * そのタスクのステップ自身の `env:`（キーは10スペース）。
 *
 * **コメント行と空行を飛ばす。** 最初は「キーの行が続く限り」で読んでいたが、
 * 実ファイルは `env:` の直後に説明のコメントを置いているので**1件も読めず**、
 * 「`PUBLIC_BASE_URL` を渡していない」という嘘の失敗を出した（自分で踏んだ）。
 */
function stepEnv(task: string): Set<string> {
    const head = new RegExp(`if:\\s*inputs\\.task\\s*==\\s*'${task}'`);
    const at = head.exec(src)?.index;
    if (at === undefined) return new Set();
    // そのステップの終わり（次の `- name:`）まで
    const rest = src.slice(at);
    const end = /\n\s{6}- (?:name|uses):/.exec(rest)?.index ?? rest.length;
    const block = rest.slice(0, end);
    const envAt = /\n\s{8}env:\s*\n/.exec(block);
    if (!envAt) return new Set();
    const body = block.slice(envAt.index + envAt[0].length);
    const keys = new Set<string>();
    for (const line of body.split("\n")) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const m = /^\s{10}([A-Z_][A-Z0-9_]*):/.exec(line);
        if (!m) break;           // 字下げが浅くなったら env: の外
        keys.add(m[1]);
    }
    return keys;
}

/** そのタスクのステップ自身の `env:` を「名前→値」で返す */
function stepEnvValues(task: string): Map<string, string> {
    const head = new RegExp(`if:\\s*inputs\\.task\\s*==\\s*'${task}'`);
    const at = head.exec(src)?.index;
    const out = new Map<string, string>();
    if (at === undefined) return out;
    const rest = src.slice(at);
    const end = /\n\s{6}- (?:name|uses):/.exec(rest)?.index ?? rest.length;
    const block = rest.slice(0, end);
    const envAt = /\n\s{8}env:\s*\n/.exec(block);
    if (!envAt) return out;
    for (const line of block.slice(envAt.index + envAt[0].length).split("\n")) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const m = /^\s{10}([A-Z_][A-Z0-9_]*):\s*(.*)$/.exec(line);
        if (!m) break;
        out.set(m[1], m[2].trim());
    }
    return out;
}

/** そのタスクが実際に受け取れる環境変数 */
function envForTask(task: string): Set<string> {
    return new Set([...workflowEnv(), ...stepEnv(task)]);
}

describe("運用タスクの配線", () => {
    it("選択肢が1つ以上ある（読み取りが空振りしていない）", () => {
        expect(options().length).toBeGreaterThan(5);
    });

    // **選べるのに走るステップが無い＝実行しても緑のまま何も起きない**
    it("選べるタスクには、必ず走るステップがある", () => {
        const cond = new Set(conditions());
        const orphan = options().filter((o) => !cond.has(o));
        expect(orphan, `選べるのに走らないタスク: ${orphan.join(", ")}`).toEqual([]);
    });

    // 逆向き。条件にあるのに選べないと、そのステップは永久に走らない
    it("ステップの条件は、必ず選択肢にある", () => {
        const opt = new Set(options());
        const unreachable = [...new Set(conditions())].filter((c) => !opt.has(c));
        expect(unreachable, `選べないのに条件がある: ${unreachable.join(", ")}`).toEqual([]);
    });

    // ファイル名を変えても `tsc` も `eslint` も止めない（`run:` はただの文字列）
    it("各タスクが叩くスクリプトが実在する", () => {
        const missing: string[] = [];
        for (const t of options()) {
            const p = scriptFor(t);
            if (!p) { missing.push(`${t}（run: にスクリプトが見つからない）`); continue; }
            if (!existsSync(join(process.cwd(), p))) missing.push(`${t} → ${p}`);
        }
        expect(missing, `実在しない: ${missing.join(" / ")}`).toEqual([]);
    });

    // `requireEnv` は1行目で止める。渡し忘れると、そのタスクだけ必ず失敗する。
    //
    // **スコープを見る。** 最初は「この名前がファイルのどこかに書いてあるか」
    // だけ見ていたが、`PHOTOS_TABLE` は**3か所**（ワークフロー全体と、
    // staging 用の2ステップ）にあるので、**ワークフロー全体の定義を消しても
    // 緑のまま**だった（変異で確認）。ステップの `env:` はそのステップにしか
    // 効かないので、タスクごとに「全体 ＋ 自分の env」で数える
    it("各スクリプトが必須にしている環境変数を、そのタスクが受け取れる", () => {
        const missing: string[] = [];
        for (const t of options()) {
            const p = scriptFor(t);
            if (!p || !existsSync(join(process.cwd(), p))) continue;
            const code = readFileSync(join(process.cwd(), p), "utf8");
            const available = envForTask(t);
            for (const m of code.matchAll(/requireEnv\(\s*"([A-Z_][A-Z0-9_]*)"/g)) {
                if (!available.has(m[1])) missing.push(`${t} が要る ${m[1]}`);
            }
        }
        expect(missing, `渡していない: ${missing.join(" / ")}`).toEqual([]);
    });

    /**
     * **staging 専用のタスクが、本番の値に落ちないこと。**
     *
     * ワークフロー全体の `env:` は**本番**を指す。staging 用の確認タスクは
     * ステップの `env:` で上書きしているだけなので、その行を消すと
     * **本番のバケット・テーブルを受け取る**（上の「受け取れるか」の判定は
     * 名前の有無しか見ないので通ってしまう。変異で確認）。
     *
     * **最後の砦はスクリプト側にある**——`verify-upload.ts` は
     * `UPLOAD_BUCKET` が `staging-` で始まらなければ中止する（＝「動かない」に
     * 倒れる）。ここはその手前で気づくための1本。
     */
    it("staging 専用のタスクは staging の値を受け取る", () => {
        const bad: string[] = [];
        for (const t of ["verify-upload", "verify-invalidate"]) {
            const env = stepEnvValues(t);
            for (const key of ["UPLOAD_BUCKET", "PHOTOS_TABLE"]) {
                const v = env.get(key);
                if (v === undefined) { bad.push(`${t} に ${key} の上書きが無い`); continue; }
                if (!v.startsWith("staging-")) bad.push(`${t} の ${key} が staging- でない: ${v}`);
            }
        }
        expect(bad, bad.join(" / ")).toEqual([]);
    });

    // 台帳の保留がこの口から実行される。名前が変わったら気づけるようにする
    it("owner の保留に使うタスクが揃っている", () => {
        const opt = new Set(options());
        for (const t of ["diagnose", "geocode-locations", "public-feed-index", "normalize-image-urls"]) {
            expect(opt.has(t), `${t} が選択肢から消えている`).toBe(true);
        }
    });
});
