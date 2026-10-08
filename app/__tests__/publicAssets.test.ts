import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **`public/` に置いたものは、そのまま世界に配られる。**
 *
 * `scripts/deploy-static-site.js` は `out/` を丸ごと S3 へ上げ、`next build` は
 * `public/` を `out/` へそのまま写す。つまり**ここに置いたファイルは、どこからも
 * リンクされていなくても公開URLで取れる**。`assertNoForbiddenContent` は
 * `.html` と `.txt` の中身しか見ないので、画像やSVGは素通りする。
 *
 * 実際、`create-next-app` の雛形が置いた `next.svg` / `file.svg` /
 * `window.svg` と、使われていない `Instagram.svg` が**参照0のまま配信**
 * されていた（実ビルドの HTML・JS・txt から0件）。
 *
 * **参照されていないものは、意図を1行書いて一覧に入れる。**
 * 書かずに置いたものは落とす——次に何かを置いた人が、
 * 「配られている」ことに気づける。
 */
const PUBLIC_DIR = join(process.cwd(), "public");

/** 参照が無くても置いてよいもの（理由つき） */
const ALLOWED: [file: string, why: string][] = [
    ["images/me-portrait.jpg", "owner の写真。今どこからも参照していないが、本人が置いたものなので消さない（人物画像として構造化データに出すかは owner の判断）"],
    ["offline.html", "Service Worker が `PRECACHE_URLS` で名前を持つ（`public/sw.js`）。ソースの文字列としては `OFFLINE_URL` 定数"],
    ["sw.js", "`ServiceWorkerRegister.tsx` が `/sw.js` として登録する"],
    ["manifest.webmanifest", "`app/layout.tsx` の `manifest` が指す"],
];

function listPublic(dir = PUBLIC_DIR): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...listPublic(full));
        else out.push(relative(PUBLIC_DIR, full).split("\\\\").join("/"));
    }
    return out;
}

/**
 * ソースのどこかに名前が出るか（パスではなくファイル名で見る）。
 *
 * **テストは数えない。** 最初は全ファイルを走査していたので、
 * **このファイルのコメントに書いた `next.svg` が「参照」として数えられ**、
 * 参照0のファイルを置き直す変異が素通りした（自分で踏んだ）。
 * テストからしか名前が出ない資産は「サイトが使っていない」側なので、
 * 外すのが正しい向きでもある。
 */
function referenced(file: string): boolean {
    const base = file.split("/").pop()!;
    for (const { full, text } of sourceTexts()) {
        if (full.endsWith(join("public", base))) continue;   // 自分自身は数えない
        if (text.includes(base)) return true;
    }
    return false;
}

/**
 * 走査する中身は**1回だけ読む**（2026-10-08）。ファイルごとに木を辿り直していた頃は、
 * スポットの写真のサムネ（`public/images/spots/thumb/*.jpg`・787枚）を足した回に
 * 3.6秒 → 6.2秒になり、5秒の上限で落ちた。見るものと順番は前と同じ
 */
let cachedTexts: { full: string; text: string }[] | null = null;
function sourceTexts(): { full: string; text: string }[] {
    if (cachedTexts) return cachedTexts;
    const out: { full: string; text: string }[] = [];
    // `content/` も数える: スポットの写真（`public/images/spots/*.jpg`）は
    // `content/spot-images.json` の `local.src` が名前を持つ（2026-09-26）
    const roots = ["app", "lib", "scripts", "public", ".github", "content"];
    const stack = roots.map((r) => join(process.cwd(), r));
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: string[];
        try { entries = readdirSync(dir); } catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== "__tests__") stack.push(full); continue; }
            if (!/\.(ts|tsx|js|mjs|json|webmanifest|yml|css)$/.test(name)) continue;
            if (/[\\/]__tests__[\\/]/.test(full) || /\.test\.[tj]sx?$/.test(name)) continue;
            out.push({ full, text: readFileSync(full, "utf8") });
        }
    }
    return (cachedTexts = out);
}

describe("public/ に置いたものは全部配信される", () => {
    const files = listPublic();
    const allowed = new Map(ALLOWED);

    it("読み取りが空振りしていない", () => {
        expect(files.length).toBeGreaterThan(3);
    });

    /**
     * **検出器そのものを確かめる。**
     *
     * `referenced()` を「常に true」にする変異は、上の判定では捕まえられない
     * ——参照0のファイルが1つも無い状態では、壊れた検出器と正しい検出器が
     * 同じ答えを返すため（自分で変異を当てて確認した）。台帳のコントラスト
     * 監査が「白40%は3.66:1」を差し込んで確かめたのと同じ立場。
     */
    it("検出器が、参照のある/無いを実際に見分ける", () => {
        expect(referenced("icon-512.png"), "参照のあるものを見落としている").toBe(true);
        expect(referenced("__this-file-does-not-exist-anywhere__.png"), "何でも参照ありと言っている").toBe(false);
    });

    it("参照が無いファイルは、理由つきで一覧にある", () => {
        const orphans = files.filter((f) => !allowed.has(f) && !referenced(f));
        expect(orphans, `参照0のまま配信されている: ${orphans.join(", ")}`).toEqual([]);
    });

    // 一覧が腐るのを防ぐ（消したファイルの理由だけ残る形にしない）
    it("一覧に書いたファイルは実在する", () => {
        const gone = [...allowed.keys()].filter((f) => !files.includes(f));
        expect(gone, `一覧にあるが public/ に無い: ${gone.join(", ")}`).toEqual([]);
    });

    it("理由が書いてある", () => {
        for (const [f, why] of ALLOWED) expect(why.length, `${f} の理由が短すぎる`).toBeGreaterThan(10);
    });
});
