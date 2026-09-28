"use client";

import { useEffect } from "react";
import { isImeKey } from "../utils/ime";
import { isBehindPriorityOverlay } from "./useFocusTrap";

/**
 * 開いている間だけ Escape を拾う。
 *
 * モーダルが5つあって、Escape で閉じられるのは
 * `GalleryModal` / `StoryViewer` / `HeaderNav` / `FilterBar` だけだった。
 * 残り（写真の削除確認・管理画面の削除確認・退会確認・QRコード）は
 * **閉じる手段がマウス前提**で、キーボードだけの人は閉じるボタンまで
 * Tab で辿るしかない。しかもフォーカスは押した要素に残ったままなので、
 * オーバーレイの裏にあるボタンを先に通過する（`/user/edit` では
 * その先が「保存する」で、Enter でそのまま実行できてしまう）。
 *
 * `capture` は使わない。入れ子（ビューアの中の確認シート）は
 * **内側だけが有効になるように呼び出し側で `active` を切る**——
 * StoryViewer が既にその形で、外側は `confirmDelete` の間は自分の
 * Escape 処理を止めている。ここで capture を使うと、その順序を
 * 呼び出し側から見えない所でひっくり返すことになる。
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
    useEffect(() => {
        if (!active) return;
        const onKey = (e: KeyboardEvent) => {
            // **変換中の Escape は「変換の取り消し」**。閉じてはいけない。
            // 退会の確認モーダルは `退会` と打たせる＝**IME 必須**なので、
            // 「たいかい」の変換をやめようとしただけでモーダルごと閉じ、
            // 打ち直しになっていた（Chromium で再現：`onClose` が呼ばれた）。
            // **同意画面（優先度のある閉じ込め）が上にある間は閉じない。** 見えない裏の
            // シート・確認画面が Escape で閉じていた（同意画面は自分では Escape を聞かない）
            if (e.key === "Escape" && !isImeKey(e) && !isBehindPriorityOverlay()) onEscape();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [active, onEscape]);
}
