"use client";

/**
 * 撮影情報のカード（ラベル上・値下の2列グリッド）。
 *
 * **写真ページにしか無かった。** モーダルは同じ値を
 * 「Hasselblad X2D II 100C ・ XCD 35-100E@70 ・ f/11 ・ 1/125s ・ ISO50 ・ 70mm」
 * と中黒でつないだ1行で出していて、どの数字が何なのか読めなかった
 * （owner の指示「昔みたいに各項目ごとに書かれてる丁寧で綺麗な方が好き」）。
 *
 * **同じものを二度作らない。** 写真ページの中に直書きしてあった組み立てと
 * 見た目をここへ出し、両方が同じ部品を使う。片方だけ直すと静かにずれる
 * ——このリポジトリが何度も踏んでいる形。
 *
 * **写真ページの表示は変えない。** 項目の並び・ラベル・リンクの付け方
 * （カメラだけ機材の集約ページへ）はそのまま移した。
 */

import React from "react";
import Link from "next/link";
import { CameraIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { dedupeCameraName } from "../../lib/utils/cameraName";
import { formatStoredDateTime } from "../../lib/utils/photoDate";
import { displayWhiteBalance } from "../../lib/utils/exifDisplay";

export type ExifSpec = { label: string; value: string; wide?: boolean; href?: string };

type ExifLike = {
    camera?: string;
    lens?: string;
    aperture?: string;
    exposure?: string;
    iso?: number | string;
    focalLength?: string;
    whiteBalance?: string;
    imageSize?: string;
    dateTimeOriginal?: string;
} | undefined;

/**
 * 表示する項目を組む。**空の値は入れない**（`0` は値として残す）。
 *
 * @param cameraHref 機種名に付ける行き先。**保存済みの値から作ること**
 *   ——端末で抽出した値から作ると、集約ページに自分が居ない／
 *   そもそもページが無い（`dynamicParams = false`）。理由は
 *   `PhotoPageClient` の呼び出し側に書いてある
 */
export function buildExifSpecs(exif: ExifLike, locale: string, cameraHref?: string): ExifSpec[] {
    if (!exif) return [];
    const specs: ExifSpec[] = [];
    const add = (label: string, value: string | number | undefined | null, wide = false, href?: string) => {
        if (value !== undefined && value !== null && `${value}`.trim() !== "") specs.push({ label, value: `${value}`, wide, href });
    };
    const en = locale === "en";
    // 保存済みの値には二重のメーカー名が混じる（実データに
    // "Hasselblad Hasselblad X2D II 100C" が実在）。表示だけ直す
    add(en ? "Camera" : "カメラ", dedupeCameraName(exif.camera), false, cameraHref);
    add(en ? "Lens" : "レンズ", exif.lens);
    add(en ? "Aperture" : "絞り", exif.aperture);
    add(en ? "Shutter" : "シャッター速度", exif.exposure);
    add("ISO", exif.iso);
    add(en ? "Focal Length" : "焦点距離", exif.focalLength);
    // **保存済みの値は英語のまま。表示のときだけ日本語にする**
    // （`/admin/edit` の入力欄に当てると、保存の差分の比較先が変わって
    //  「利用者が書き換えた」と読まれる——`dedupeCameraName` と同じ判断）
    add(en ? "White Balance" : "ホワイトバランス", displayWhiteBalance(exif.whiteBalance, en ? "en" : "ja"));
    add(en ? "Image Size" : "画像サイズ", exif.imageSize);
    // 撮影日時は**保存されている通り**に出す。`toLocaleString` を描画中に
    // 呼んでいた頃は、ビルド(UTC)と閲覧者のゾーンで文字列が食い違って
    // ハイドレーション不一致になり、しかも日付だけの値（"2024-10-12"）が
    // UTC 0時として読まれるためニューヨークからは前日と表示されていた
    const shotAt = formatStoredDateTime(exif.dateTimeOriginal, en ? "en" : "ja");
    if (shotAt) add(en ? "Date Taken" : "撮影日時", shotAt, true);
    return specs;
}

/**
 * カード本体。**項目が1つも無ければ何も描かない**（空の枠を置かない）。
 *
 * @param className 外側の枠に足すクラス。写真ページは `max-w-md`、
 *   モーダルは幅いっぱい——**見た目の違いはここだけ**にする
 */
/**
 * @param collapsible 最終版モックの写真ページ用（初期は畳む・「詳しく見る」で開く）。
 *   **畳んでも中身は DOM に残す**（`hidden` 属性）——機材名の `/camera/` への
 *   リンクは静的HTMLに焼かれている必要がある（内部リンク＝SEO・回遊）。
 *   `open && …` の条件付き描画にしない。既定は今までどおり常時展開（モーダル）
 */
export default function ExifSpecs({ specs, locale, className = "", collapsible = false }: { specs: ExifSpec[]; locale: string; className?: string; collapsible?: boolean }) {
    const [open, setOpen] = useState(false);
    if (specs.length === 0) return null;
    const expanded = !collapsible || open;
    return (
        <div className={`rounded-2xl bg-surface ring-1 ring-line p-4 ${className}`}>
            <div className={`flex items-center gap-1.5 ${expanded ? "mb-3" : ""}`}>
                <CameraIcon className="w-4 h-4 text-accent" />
                <span className="text-[13px] font-semibold text-white">
                    {locale === "en" ? "Camera Settings" : "撮影情報"}
                </span>
                {collapsible && (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="ml-auto inline-flex items-center gap-0.5 text-[12px] text-link hover:text-white active:scale-95 transition"
                        style={{ touchAction: "manipulation", minHeight: "32px" }}
                    >
                        {open ? (locale === "en" ? "Hide" : "閉じる") : (locale === "en" ? "Details" : "詳しく見る")}
                        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3" hidden={!expanded}>
                {specs.map((s) => (
                    <div key={s.label} className={s.wide ? "col-span-2" : ""}>
                        <dt className="text-[10px] uppercase tracking-wider text-white/50">{s.label}</dt>
                        <dd className="text-[13px] text-white/85 mt-0.5 break-words">
                            {/* リンクにするのは行き先がある項目だけ。
                                見た目（大きさ・色）は変えず、下線だけで示す */}
                            {s.href
                                ? <Link href={s.href} prefetch={false} className="underline decoration-white/30 underline-offset-2 hover:decoration-white/70">{s.value}</Link>
                                : s.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
