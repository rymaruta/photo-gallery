import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SongArtwork from "../SongArtwork";

// **呼び出し側5か所のうち、テストが守っているのは1か所だけだった。**
// 残り4か所（曲検索の結果3・ストーリーの下書き1）を素の `<img>` に戻しても
// フルスイート 3,809件が全緑になる、とレビューが実測した。5画面ぶんの
// 描画テストは重いので、**部品そのもの**を固定する。

const GOOD = "https://is1-ssl.mzstatic.com/image/art.jpg";
const CLS = "w-9 h-9 rounded-md object-cover bg-white/10 flex-shrink-0";

describe("SongArtwork", () => {
    it("許可ホストは <img> で出す", () => {
        const { container } = render(<SongArtwork src={GOOD} className={CLS} />);
        const img = container.querySelector("img");
        expect(img?.getAttribute("src")).toBe(GOOD);
        expect(img?.className).toBe(CLS);
    });

    // **`<img>` を残して src だけ落とす、にしない。** 属性ごと消えた `<img>` は
    // 壊れた画像の絵にはならないが、呼び出し側が用意したフォールバック
    // （音符アイコンなど）にも落ちない＝無地の箱で固まる
    it.each([
        ["別ホスト", "https://evil.example/art.jpg"],
        ["末尾一致の偽物", "https://evil-mzstatic.com/art.jpg"],
        ["http", "http://is1-ssl.mzstatic.com/art.jpg"],
        ["空", ""],
        ["未設定", undefined],
    ])("%s は <img> を出さない", (_name, src) => {
        const { container } = render(<SongArtwork src={src as string | undefined} className={CLS} />);
        expect(container.querySelector("img"), "許可していない値を読み込んでいる").toBeNull();
    });

    // **大きさは変えない。** 呼び出し側の className に `w-*` `h-*` `bg-*` が
    // 入っているので、同じ class を持つ箱を出せばレイアウトは動かない
    it("出さないときも、同じ class の箱を残す", () => {
        const { container } = render(<SongArtwork src="https://evil.example/a.jpg" className={CLS} />);
        const box = container.firstElementChild as HTMLElement | null;
        expect(box?.tagName).toBe("DIV");
        expect(box?.className, "大きさの指定ごと消している").toBe(CLS);
    });
});
