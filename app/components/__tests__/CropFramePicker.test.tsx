import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CropFramePicker from "../CropFramePicker";

/**
 * 一覧に出る範囲を掴んで動かす部品。
 *
 * **jsdom は大きさを持たない**ので、`clientWidth` /
 * `getBoundingClientRect` を差し込んで「横長／縦長」を作る。
 * ここで見たいのは見た目ではなく**どの軸が動くか**と**返す割合**。
 */

/** 画像に大きさを持たせる（jsdom は 0 のまま） */
function sizeImage(img: HTMLImageElement, w: number, h: number) {
    Object.defineProperty(img, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(img, "clientHeight", { value: h, configurable: true });
    img.getBoundingClientRect = () => ({
        width: w, height: h, left: 0, top: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    // pointer capture は jsdom に無い
    img.setPointerCapture = vi.fn();
    img.hasPointerCapture = () => true;
}

function setup(w: number, h: number, focalPoint?: { x: number; y: number }) {
    const onChange = vi.fn();
    render(
        <CropFramePicker
            src="blob:x"
            hint="白い枠が一覧に表示されます（ドラッグで移動）"
            focalPoint={focalPoint}
            onChange={onChange}
            fallback={<p>開けませんでした</p>}
        />,
    );
    const img = document.querySelector("img") as HTMLImageElement;
    sizeImage(img, w, h);
    fireEvent.load(img);
    return { img, onChange };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("一覧の切り抜き枠", () => {
    it("案内を出す", () => {
        setup(400, 200);
        expect(screen.getByText(/ドラッグで移動/)).toBeTruthy();
    });

    // **横長なら左右だけ。** 短い辺（高さ）は枠と同じ長さなので動く余地が無い。
    // 動かない軸まで返すと、上下に指を振っただけで値が変わったことになる
    it("横長は左右だけ動く（上下は中央のまま）", () => {
        const { img, onChange } = setup(400, 200);
        fireEvent.pointerDown(img, { clientX: 300, clientY: 10, pointerId: 1 });
        expect(onChange).toHaveBeenCalledTimes(1);
        const fp = onChange.mock.calls[0][0];
        expect(fp.y, "動かない軸が中央でない").toBe(0.5);
        expect(fp.x).toBeGreaterThan(0.5);
    });

    it("縦長は上下だけ動く（左右は中央のまま）", () => {
        const { img, onChange } = setup(200, 400);
        fireEvent.pointerDown(img, { clientX: 10, clientY: 300, pointerId: 1 });
        const fp = onChange.mock.calls[0][0];
        expect(fp.x, "動かない軸が中央でない").toBe(0.5);
        expect(fp.y).toBeGreaterThan(0.5);
    });

    // **枠が画像からはみ出さない。** 端まで掴んでも、枠の半分ぶんは内側で止まる
    // （はみ出すと、一覧には無いはずの余白が出る）
    it("端を掴んでも、枠が画像から出ない割合を返す", () => {
        const { img, onChange } = setup(400, 200);
        fireEvent.pointerDown(img, { clientX: 0, clientY: 100, pointerId: 1 });
        // 枠は 200x200。中心は最小でも 100px ＝ 400 の 0.25
        expect(onChange.mock.calls[0][0].x).toBeCloseTo(0.25, 5);
        onChange.mockClear();
        fireEvent.pointerDown(img, { clientX: 400, clientY: 100, pointerId: 1 });
        expect(onChange.mock.calls[0][0].x).toBeCloseTo(0.75, 5);
    });

    // **正方形は動かせない。** 掴めるように見せると「効かない」と読まれる
    it("正方形はドラッグを受け付けない", () => {
        const { img, onChange } = setup(300, 300);
        fireEvent.pointerDown(img, { clientX: 10, clientY: 10, pointerId: 1 });
        expect(onChange).not.toHaveBeenCalled();
    });

    // **縦スクロールを奪わない。** 動かせるのが横だけの写真で `touch-none` に
    // すると、写真の上で指を上下に振ってもページが動かなくなる
    it("動かせない軸のスクロールは残す", () => {
        const { img } = setup(400, 200);
        expect(img.style.touchAction).toBe("pan-y");
    });

    it("読み込めなければ、渡された出し方に落とす", () => {
        const { img } = setup(400, 200);
        fireEvent.error(img);
        expect(screen.getByText("開けませんでした")).toBeTruthy();
    });

    // 渡した位置が枠に効いていること（描画まで見る）
    it("渡した位置に枠を置く", () => {
        setup(400, 200, { x: 0.75, y: 0.5 });
        const box = document.querySelector("div.absolute.border-2") as HTMLElement;
        // 枠 200px・中心 300px → 左端 200px
        expect(box.style.left).toBe("200px");
        expect(box.style.width).toBe("200px");
    });
});
