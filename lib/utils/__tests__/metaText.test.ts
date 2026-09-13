import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { metaText } from "../metaText";

/**
 * **利用者が書いた説明には改行が入る**（段落の中で改行する人がいる）。
 * 素で `<meta name="description">` に入れると属性値に生の改行が残る。
 * 実ビルドで数えた: メタ15/420・JSON-LD 8・画像サイトマップ4・フィード4。
 */
describe("メタ情報に出す1行のテキスト", () => {
    it("改行を1つの空白に畳む", () => {
        expect(metaText("一行目。\n二行目。")).toBe("一行目。 二行目。");
        expect(metaText("a\r\nb")).toBe("a b");
    });

    it("連続する空白・タブも1つにする", () => {
        expect(metaText("a   b\t\tc")).toBe("a b c");
    });

    // 全角スペースは `\s` に入る。行末に全角スペースを置いて改行する人が
    // 実データに居る（「深い緑␣\n苔むした石段」）
    it("全角スペースも畳む", () => {
        expect(metaText("深い緑　\n苔むした石段")).toBe("深い緑 苔むした石段");
    });

    it("前後の空白を落とす", () => {
        expect(metaText("  こんにちは \n")).toBe("こんにちは");
    });

    // **ZWSP は残す。** `\s` に入らないので畳まれない。台帳が
    // 「ZWSP・NBSP・BOM は落とさない」と決めたのは**入口（保存する値）**の
    // 話で、ここは出口。NBSP と BOM は `\s` なので畳まれる
    it("幅ゼロの空白（ZWSP）は落とさない", () => {
        expect(metaText("あ​い")).toBe("あ​い");
    });

    it("普通の1行はそのまま", () => {
        expect(metaText("白鳥と湖の写真。")).toBe("白鳥と湖の写真。");
    });

    it("空でも落ちない", () => {
        expect(metaText("")).toBe("");
        expect(metaText(undefined as unknown as string)).toBe("");
    });

    // **何も import しない。** 4経路（写真ページ・seo.ts・画像サイトマップ・
    // フィード）が読むので、依存を持つと輪になりうる
    // （`nameVariants.ts`・`exifDisplay.ts` と同じ理由）
    it("このモジュールは何も import しない", () => {
        const src = readFileSync(resolve(process.cwd(), "lib/utils/metaText.ts"), "utf8");
        expect(src.match(/^\s*import\s/m), "import が増えている").toBeNull();
    });
});
