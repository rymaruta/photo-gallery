import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **「画像を読み込めません」の分岐にテストが1本も無かった**（レビュー指摘）。
// 実装は前からあるが、消しても誰も気づかない状態だった。モーダルは
// 写真が絶対配置（`absolute inset-0`）なので、失敗すると**真っ黒な枠**に
// なり、閉じるボタン以外に手がかりが無くなる。

import ModalImage from "../ModalImage";

const img = () => document.body.querySelector("img[alt='湖']") as HTMLImageElement | null;

describe("モーダルの画像が取れないとき", () => {
    it("理由を出し、スピナーは止める", () => {
        render(<ModalImage src="https://cdn/gone.jpg" alt="湖" />);
        expect(img()).not.toBeNull();

        fireEvent.error(img()!);

        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        // 取れなかった img を残さない（真っ黒な枠のまま回り続けない）
        expect(img(), "失敗した img を残している").toBeNull();
        expect(document.body.querySelector(".animate-spin"), "スピナーが回りっぱなし").toBeNull();
    });

    // 正常系: 読み込めたらスピナーだけ消える
    it("読み込めたら何も出さない", () => {
        render(<ModalImage src="https://cdn/ok.jpg" alt="湖" />);
        fireEvent.load(img()!);

        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(img()).not.toBeNull();
        expect(document.body.querySelector(".animate-spin")).toBeNull();
    });
});
