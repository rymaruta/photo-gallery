"use client";

import React from "react";
import Link from "next/link";
import { GlobeAltIcon, UserGroupIcon, StarIcon } from "@heroicons/react/24/outline";
import { AUDIENCES, type Audience } from "../../lib/utils/audience";
import { ROUTES } from "../../lib/routes";

const ICON: Record<Audience, typeof GlobeAltIcon> = {
    everyone: GlobeAltIcon,
    followers: UserGroupIcon,
    closeFriends: StarIcon,
};

type Props = {
    value: Audience;
    onChange: (a: Audience) => void;
    locale: string;
    disabled?: boolean;
    /** `name` 属性（同じ画面に2つ置かないが、ラジオの組を分けるため） */
    name?: string;
};

/**
 * **公開範囲の三択**（iOS の投稿・写真の編集と同じ）。ラジオの組で、矢印キーで選べる。
 * 選択中は白の塗り（デザインシステム: 白＝選択）。
 */
export default function AudiencePicker({ value, onChange, locale, disabled, name = "audience" }: Props) {
    const isJa = locale !== "en";
    return (
        <fieldset disabled={disabled}>
            <legend className="text-xs text-white/70 mb-2">{isJa ? "公開範囲" : "Who can see this"}</legend>
            <div className="space-y-2">
                {AUDIENCES.map((a) => {
                    const on = value === a.value;
                    const Icon = ICON[a.value];
                    return (
                        <label
                            key={a.value}
                            className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 cursor-pointer transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${on ? "bg-primary text-ink ring-primary" : "bg-surface-2 ring-white/10 text-white hover:bg-white/10"}`}
                        >
                            <input
                                type="radio"
                                name={name}
                                value={a.value}
                                checked={on}
                                onChange={() => onChange(a.value)}
                                className="sr-only"
                            />
                            <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold">{isJa ? a.ja : a.en}</span>
                                <span className={`block text-xs mt-0.5 ${on ? "text-ink/70" : "text-white/60"}`}>{isJa ? a.noteJa : a.noteEn}</span>
                            </span>
                        </label>
                    );
                })}
            </div>
            {value === "closeFriends" && (
                <p className="mt-2 text-xs text-white/60">
                    {isJa ? "見られる人は " : "Choose who in "}
                    <Link href={ROUTES.SETTINGS} prefetch={false} className="text-accent underline underline-offset-2 hover:text-accent-strong">
                        {isJa ? "設定の「親しい友達」" : "Settings › Close friends"}
                    </Link>
                    {isJa ? " で選べます。" : "."}
                </p>
            )}
        </fieldset>
    );
}
