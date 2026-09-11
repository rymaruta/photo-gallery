import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
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

    // **控えも捨てる。** SW は写真をキャッシュ優先で持っていて寿命が無い
    // ので、キャプティブポータルの HTML を控えた端末は再読込しても直らない
    it("読み込めなかった写真の控えを捨てる", async () => {
        const deleted: string[] = [];
        const opened: string[] = [];
        // **開いた名前は外で見る。** `open` の中で expect すると、その throw は
        // `dropCachedPhoto` の catch に飲まれて「deleted が空」としか出ない
        vi.stubGlobal("caches", {
            open: async (name: string) => {
                opened.push(name);
                return { delete: async (u: string) => { deleted.push(u); return true; } };
            },
        });

        render(<ModalImage src="https://cdn/gone.jpg" alt="湖" />);
        fireEvent.error(img()!);
        await Promise.resolve();
        await Promise.resolve();

        expect(opened, "違う入れ物を開いている").toEqual(["journey-photo-img-v1"]);
        expect(deleted).toEqual(["https://cdn/gone.jpg"]);
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

afterEach(() => { vi.unstubAllGlobals(); });
