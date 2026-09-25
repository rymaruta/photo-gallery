import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 🔴 **iPhone のキーボードと入力欄**（`docs/ios-bug-audit-2026-09-25.md` #2・#22・#27・#28・#33・#34）。
 *
 * どれも iOS のキーボード・パスワード管理・拡大の挙動に依存していて、
 * jsdom では起きない。`bottomBarOverlap.test.ts` と同じく、そう書いてあるかをソースで見る。
 */

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (rel: string): string =>
    read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** `id="…"` の付いた <input> の開きタグを切り出す */
function inputById(src: string, id: string): string {
    const i = src.indexOf(`id="${id}"`);
    expect(i, `id="${id}" が見つからない`).toBeGreaterThan(0);
    const start = src.lastIndexOf("<input", i);
    return src.slice(start, src.indexOf("/>", i) + 2);
}

describe("#2 入力欄の文字でフォーカス時に拡大させない", () => {
    it("タッチ端末では入力欄を 16px 未満にしない（インラインの指定にも勝つ）", () => {
        const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
        const m = css.match(/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/);
        expect(m, "タッチ端末向けの規則が無い").toBeTruthy();
        const block = m![1];
        expect(block).toMatch(/(^|\s)input[:\s]/);
        expect(block).toMatch(/textarea/);
        expect(block).toMatch(/select/);
        expect(block).toMatch(/font-size:\s*16px\s*!important/);
    });
});

describe("#33 検索欄", () => {
    const files = ["app/components/FilterBar.tsx", "app/users/search/page.tsx", "app/map/MapControls.tsx"];

    it("確定キーは「検索」と出し、押したらキーボードを閉じる（変換の確定は除く）", () => {
        for (const f of files) {
            const src = code(f);
            const i = src.indexOf('type="search"');
            const tag = src.slice(src.lastIndexOf("<input", i), src.indexOf("/>", i));
            expect(tag, f).toContain('enterKeyHint="search"');
            expect(tag, f).toMatch(/e\.key === "Enter" && !isImeKey\(e\.nativeEvent\)\) e\.currentTarget\.blur\(\)/);
        }
    });

    it("ブラウザの消去ボタンを消す（自前の ✕ と2つ並ぶ）", () => {
        expect(read("app/globals.css")).toMatch(/input\[type="search"\]::-webkit-search-cancel-button\s*\{[^}]*appearance:\s*none/);
    });
});

describe("#22 テーマソングの開始・終了（m:ss）", () => {
    it("数字キーパッドを出さない（「:」が打てない）", () => {
        const src = code("app/user/profile/page.tsx");
        for (const id of ["profile-song-start", "profile-song-end"]) {
            expect(inputById(src, id), id).not.toContain("inputMode");
        }
    });

    it("全角の「１：１２」も読む（かなキーボードの数字は全角）", () => {
        const src = code("app/user/profile/page.tsx");
        const fn = src.slice(src.indexOf("function mmssToSec"), src.indexOf("function secToMMSS"));
        expect(fn).toContain('normalize("NFKC")');
    });
});

describe("#28 Instagram の欄", () => {
    it("先頭の大文字化・自動修正を切り、全角の「＠」も落とす", () => {
        const tag = inputById(code("app/user/profile/page.tsx"), "profile-instagram");
        expect(tag).toContain('autoCapitalize="none"');
        expect(tag).toContain('autoCorrect="off"');
        expect(tag).toContain("spellCheck={false}");
        expect(tag).toContain("/^[@＠]/");
    });

    it("タグの欄も先頭を大文字にしない", () => {
        expect(inputById(code("app/user/edit/page.tsx"), "edit-tags")).toContain('autoCapitalize="none"');
        const up = code("app/user/upload/page.tsx");
        const i = up.indexOf("onChange={(e) => setTags(e.target.value)}");
        const tag = up.slice(up.lastIndexOf("<input", i), up.indexOf("/>", i));
        expect(tag).toContain('autoCapitalize="none"');
    });
});

describe("#34 パスワード再設定の確認コード", () => {
    it("数字キーパッドを出す（登録・設定と揃える）", () => {
        expect(inputById(code("app/login/page.tsx"), "reset-code")).toContain('inputMode="numeric"');
    });
});

describe("#27 パスワードの変更", () => {
    it("<form> で送り、ユーザー名の欄を置く（iOS のキーチェーンが新しいパスワードを覚える）", () => {
        const src = code("app/user/settings/page.tsx");
        const i = src.indexOf('id="settings-new-password"');
        const formStart = src.lastIndexOf("<form", i);
        expect(formStart, "新しいパスワードの欄が <form> の中に無い").toBeGreaterThan(0);
        const form = src.slice(formStart, src.indexOf("</form>", i));
        expect(form).toMatch(/onSubmit=/);
        expect(form).toMatch(/autoComplete="username"/);
        expect(form).toMatch(/type="submit"/);
    });
});
