import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// **変換確定の Enter は、ページには普通の Enter として届く**（Chromium で実測）。
// `e.key === "Enter"` だけを見る入力欄は、日本語で打つ人が必ず踏む:
//   曲検索は未確定の読み（「きょう」）で外部APIを叩き、
//   YouTube 欄は打っている途中で `PUT /photos/{id}` を投げてエラーを出し、
//   コメント欄は未確定の読みのまま公開コメントを投稿していた。
//
// **これは足し忘れが起きる形**（入力欄を1つ増やすたびに要る）なので、
// 綴りではなく「Enter を見ている入力欄のあるファイルは、変換中を見る
// 仕掛けを持っていること」を機械的に確かめる。
//
// 逆に、ボタンやチップの Enter（入力欄ではない）には要らない——
// そこまで縛ると「変換していないのに押せない」を作る。
const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });
}

/** 入力欄（input/textarea）に付いた onKeyDown で Enter を見ているか */
function hasEnterOnTextInput(src: string): boolean {
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/<(input|textarea)\b/.test(code)) return false;
    return /onKeyDown=\{[^}]*key\s*===\s*"Enter"/.test(code);
}

/** 変換中を見る仕掛けを持っているか（共有の関数か、自前の composition 制御） */
function guardsComposition(src: string): boolean {
    return /isImeKey/.test(src) || /onCompositionStart|compositionstart/.test(src);
}

describe("Enter を見る入力欄は、変換中を必ず見る", () => {
    const files = walk(join(ROOT, "app")).map((f) => f.slice(ROOT.length + 1));

    it("走査の対象が空になっていない（見張りが空振りしていない）", () => {
        expect(files.length).toBeGreaterThan(20);
        expect(files.filter((f) => hasEnterOnTextInput(readFileSync(join(ROOT, f), "utf8"))).length)
            .toBeGreaterThan(0);
    });

    it("変換中を見ていない入力欄が無い", () => {
        const bad = files.filter((f) => {
            const src = readFileSync(join(ROOT, f), "utf8");
            return hasEnterOnTextInput(src) && !guardsComposition(src);
        });
        expect(bad, "変換確定の Enter で動いてしまう入力欄がある").toEqual([]);
    });
});
