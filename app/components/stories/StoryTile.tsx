"use client";

import React from "react";
import { PlayIcon } from "@heroicons/react/24/outline";
import type { Story } from "@/lib/stories";
import StoryThumb from "./StoryThumb";

/**
 * アーカイブのストーリー1枚のタイル（縦長 9:16・3列のグリッドに並べる）。
 *
 * アーカイブの一覧（`/user/archive`）とハイライトの作成画面
 * （`/user/highlights`）が同じ絵を並べる——**中身は同じ行**なので、
 * 描き方も1つにする。押したときに何が起きるかは呼び出し側が決める
 * （開く／選ぶ）。`children` は上に重ねる印（チェック・表紙・理由）。
 *
 * **`<li>` の中に `<button>`。** `role="listitem"` を button に乗せると
 * 押せるものとして読まれない（アーカイブの画面で一度踏んだ）。
 */
export default function StoryTile({ story, label, ariaLabel, onClick, disabled, pressed, children }: {
    story: Story;
    /** 左下に出す短い文字（投稿した日） */
    label: string;
    ariaLabel: string;
    onClick: () => void;
    disabled?: boolean;
    /** 選ぶ用途で「選んでいる」を伝える（`aria-pressed`）。開く用途では渡さない */
    pressed?: boolean;
    children?: React.ReactNode;
}) {
    return (
        <li className="relative aspect-[9/16] overflow-hidden bg-white/5">
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                aria-label={ariaLabel}
                {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
                className="absolute inset-0 w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed"
                style={{ touchAction: "manipulation" }}
            >
                <StoryThumb src={story.src} mediaType={story.mediaType} className={disabled ? "opacity-40" : ""} />
                {story.mediaType === "video" && (
                    <PlayIcon className="absolute right-1 top-1 w-4 h-4 text-white drop-shadow" aria-hidden="true" />
                )}
                <span
                    className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-black/60 text-white/90"
                    style={{ fontSize: "10px" }}
                >
                    {label}
                </span>
                {children}
            </button>
        </li>
    );
}
