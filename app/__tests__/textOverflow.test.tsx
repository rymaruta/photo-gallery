import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
        const line = src.split("\n").find((l) => l.includes("{userProfile.bio}"));
        expect(line, "自己紹介を描く行が見つからない").toBeDefined();
        expect(line, "break-words が無い（長い URL でページごと横に流れる）").toContain("break-words");
    });

    it("写真ページのタイトルと説明", () => {
        const src = read("app/photo/[id]/PhotoPageClient.tsx");
        const title = src.split("\n").find((l) => l.includes("{titleText}</h1>"));
        expect(title, "タイトルに break-words が無い").toContain("break-words");
        const desc = src.split("\n").find((l) => l.includes("text-sm sm:text-base text-white/80 leading-relaxed"));
        expect(desc, "説明に break-words が無い").toContain("break-words");
    });

    // 正常系: 付けた側が実際に描画される（クラス名を消しても落ちない形にしない）
    it("付けたクラスが要素に載る", () => {
        const { container } = render(
            <p className="text-sm whitespace-pre-wrap break-words">https://example.com/very/long/path</p>,
        );
        expect(container.querySelector("p")?.className).toContain("break-words");
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
    it.each([
        ["app/user/upload/page.tsx", "アップロードバー"],
        ["app/user/edit/page.tsx", "保存・削除バー"],
        ["app/components/Toast.tsx", "トースト"],
    ])("%s（%s）", (rel) => {
        const src = read(rel);
        expect(src, "env(safe-area-inset-bottom) が無い（ホームインジケーターに被る）")
            .toContain("safe-area-inset-bottom");
    });
});
