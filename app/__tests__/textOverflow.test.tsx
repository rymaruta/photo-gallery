import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// **長い URL でページごと横スクロールしていた。**
//
// `break-words`（`overflow-wrap: break-word`）が無いと、ブラウザは URL を
// `/` で折り返さず1語として扱う。Playwright での実測:
//
//   幅320px … 50文字の URL から `documentElement.scrollWidth` が超える
//   幅375px … 55文字から     幅430px … 70文字から
//   270文字の連続文字列だと scrollWidth が 1829px（幅320px）まで伸びる
//
// 自己紹介は300文字、写真の説明はサーバ側で段落あたり2000文字まで入る。
// UTM 付きの共有URLや地図の URL は70文字を軽く超えるので日常的に踏む。
// ストーリーのキャプションとコメント本文には最初から付いていた。
//
// jsdom はレイアウトを計算しないので、ここは**クラス名で固定する**
// （`UserProfileClient.pin.test.tsx` の hover 判定と同じ立場）。
describe("長い文字列で横に流れない", () => {
    it("プロフィールの自己紹介", () => {
        const src = read("app/users/UserProfileClient.tsx");
        // 目印は `757c90b3` で `{userProfile.bio}` から変わった（届く前は
        // ビルド時の控えを出すので、式を `shownBio` 1つにまとめた）。
        // **見ているものは同じ**——自己紹介を描く行に `break-words` があること
        const line = src.split("\n").find((l) => l.includes("{shownBio}</p>"));
        expect(line, "自己紹介を描く行が見つからない").toBeDefined();
        expect(line, "break-words が無い（長い URL でページごと横に流れる）").toContain("break-words");
    });

    // レビューで見つかった取りこぼし。**同じデータを描く場所が3つ残っていた**
    //   - モーダルのキャプション（写真ページと同じタイトル・説明）
    //   - `ProfileLink` の表示名（サーバーは100文字まで通す。実測で
    //     幅375pxのとき要素幅871px・`scrollWidth` 879 ＝ページごと流れる）
    //   - 通知の本文（パネルは `overflow-hidden` なので流れない代わりに
    //     名前が丸ごと読めなくなる。実測で名前の右端896px・パネル右端320px）
    it.each([
        ["app/components/GalleryModal/ModalCaption.tsx", "{titleText}</div>"],
        ["app/components/GalleryModal/ModalCaption.tsx", 'role="note"'],
        ["app/components/ProfileLink.tsx", "{displayName}"],
    ])("%s の %s", (rel, needle) => {
        const src = read(rel);
        const idx = src.indexOf(needle);
        expect(idx, `${needle} が見つからない`).toBeGreaterThan(-1);
        // その要素（直前の開始タグ）に break-words があること
        const openTag = src.lastIndexOf("<", idx);
        const chunk = src.slice(openTag, idx + needle.length);
        expect(chunk, "break-words が無い（長い URL・長い表示名で横に流れる）").toContain("break-words");
    });

    it("通知の本文", () => {
        const src = read("app/components/NotificationsBell.tsx");
        // 字の大きさは**寸法表（`M.body`）から渡す**ようになったので、
        // 目印から `text-[13px]` が消えた（スマホ 14px / PC 13px の2つを
        // 持つため）。色と行送りの指定で行を特定する
        const line = src.split("\n").find((l) => l.includes('className="text-white/85 leading-snug'));
        expect(line, "通知の本文を描く行が見つからない").toBeDefined();
        expect(line, "break-words が無い（長い表示名がパネルの外へ出て読めない）").toContain("break-words");
    });

    it("写真ページのタイトルと説明", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        const title = src.split("\n").find((l) => l.includes("{titleText}</h1>"));
        expect(title, "タイトルに break-words が無い").toContain("break-words");
        const desc = src.split("\n").find((l) => l.includes('className="text-white/85 break-words" style={{ fontSize: "14px"'));
        expect(desc, "説明に break-words が無い").toContain("break-words");
    });

});

// **画面下に固定したバーが safe-area を見ていなかった。**
//
// `viewportFit: "cover"`（`app/layout.tsx`）なので、ホームインジケーターの
// ある端末では下 34px がインジケーター帯になる。`globals.css` の
// `body { padding-bottom: env(safe-area-inset-bottom) }` は
// **`position: fixed` の要素には効かない**（fixed は body の padding box の
// 外に出る）。実測で、高さ44pxのボタンの下に14pxしか空いていなかった。
// `StoryViewer` / `StoriesBar` / `MiniPlayer` は既にこの形を持っている。
describe("画面下に固定したものは safe-area を空ける", () => {
    // **コメントを数えない。** 最初の版はファイル全文に `toContain` を
    // 掛けていたので、**この修正の説明コメントが同じ文字列を含んでいる**
    // せいで、`style` の行を消しても緑だった（レビューが実証）。
    // 実装の行だけを見る。
    const codeOf = (rel: string) =>
        read(rel).replace(/\/\*[\s\S]*?\*\//g, " ")
            .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

    it.each([
        ["app/user/upload/page.tsx", "アップロードバー"],
        ["app/user/edit/page.tsx", "保存・削除バー"],
    ])("%s（%s）", (rel) => {
        const code = codeOf(rel);
        // `style={{ ... safe-area-inset-bottom ... }}` の形で入っていること
        expect(code, "env(safe-area-inset-bottom) を実装で使っていない（ホームインジケーターに被る）")
            .toMatch(/style=\{\{[^}]*safe-area-inset-bottom/);
    });

    // **safe-area はクラスで足す。** インライン style はどの utility より
    // 強いので、`sm:pb-0` のようなレスポンシブ指定を殺す（実測: 幅640px
    // 以上で中央寄せのカードが 6px ずれていた）
    it("削除確認シートは sm:pb-0 を殺さない", () => {
        const code = codeOf("app/user/edit/page.tsx");
        const line = code.split("\n").find((l) => l.includes("items-end sm:items-center"));
        expect(line, "確認シートの行が見つからない").toBeDefined();
        expect(line, "safe-area をクラスで足していない").toContain("safe-area-inset-bottom");
        expect(line, "sm:pb-0 が消えている").toContain("sm:pb-0");
        const next = code.split("\n")[code.split("\n").indexOf(line!) + 1] ?? "";
        expect(next, "インライン style で上書きしている（sm:pb-0 が効かない）")
            .not.toContain("paddingBottom");
    });

    // 画面下に固定するものを新しく足したときに気づけるように、
    // 数そのものを固定する（増えたら「safe-area を見たか」を確かめる）。
    //
    // **目印は `fixed bottom-0` ではなく「下辺いっぱいに張る」形**（2026-09-22）。
    // 投稿作成のバーは常駐のタブバー（`BottomNav`）を覆わないよう
    // `bottom` を `--bottom-bar-h` ぶん持ち上げたので、`bottom-0` を持たない。
    // `fixed inset-0` の覆い（編集画面の確認シート2つ）は数えない
    it("固定バーは2本（増えたら safe-area を確かめる）", () => {
        const bars = ["app/user/upload/page.tsx", "app/user/edit/page.tsx"]
            .map(codeOf)
            .map((c) => (c.match(/fixed (?:bottom-0 )?left-0 right-0/g) ?? []).length)
            .reduce((a, b) => a + b, 0);
        expect(bars).toBe(2);
    });
});
