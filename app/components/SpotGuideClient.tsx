"use client";

import React from "react";
import Link from "next/link";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";
import type { SpotSample } from "@/lib/data/spotSamples";
import { commonsThumbAt, commonsSrcSet } from "@/lib/utils/commonsThumb";
import { showsField, sourcesFor, needsVisibleCredit, usesMapHero, isVerified, isPublished, hasAiCheck } from "@/lib/utils/spotGuide";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";
import { MapIcon, ArrowUpOnSquareIcon, MapPinIcon, ChevronRightIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";
import { distanceLabel } from "@/lib/utils/journey";
import { useToast } from "@/lib/hooks/useToast";
import { shareUrl } from "@/lib/utils/share";
import GalleryGrid from "./GalleryGrid";
import SaveSpotButton, { TILE, TILE_OFF, TILE_TEXT, TILE_ICON } from "./SaveSpotButton";
import { spotUploadHref } from "@/lib/utils/spotUpload";
import { lightCellText, lightLegend, type LightCalendar } from "../../lib/utils/lightCalendar";
import { LIGHT_MAX_OFFSET, guideTimes, lightDateLabel, lightNote, lightSheet, lightZone, splitGuides, type LightBlock } from "../../lib/utils/spotLight";

/**
 * **公式撮影地ガイドの画面**（`/spots/<slug>`）。
 *
 * ## この画面の完成条件
 *
 * owner:「**ユーザーの投稿が0枚でも、その撮影地について十分な情報を得られ、
 * 実際に行って撮影したくなるページ**」。
 *
 * だから**ユーザー投稿に触れるのは1つの節だけ**（「この場所の写真（N）」）。
 * 代表写真・魅力・撮影ガイド・アクセス・地図は、投稿が0枚でも出る。
 * 空になるのはその1節だけで、**ページ全体が寂しくならない**。
 *
 * ## 出さない判断は `lib/utils/spotGuide.ts` が持つ
 *
 * 「出典が無ければ出さない」「代表写真の権利が確認できていなければ出さない」は
 * **この画面には書かない**——同じ判断が2か所にあると、片方だけ直したときに
 * 静かにずれる（このリポジトリが何度も踏んでいる形）。
 *
 * ## 「行きたい場所に保存」は本物（ダミーではない）
 *
 * owner:「**保存機能が正しく実装されていない段階ではダミーボタンを表示しない**」。
 * だから置くまで出さなかった。いまは**実際に `spots#<uid>` へ入る**。
 *
 * **API は1行も変えていない。** サーバーが受けるのは「`#` を含まない
 * 200バイト以内の文字列」だけで、公式スポットは `SPOT-<slug>` という鍵で
 * 同じ一覧に入る（`lib/utils/savedSpotKey.ts` がその形を1か所で持つ）。
 * 既存の保存（撮影地のスラッグそのまま）は**1件も消えない・触らない**。
 */
type Props = {
    spot: Spot;
    /** そのスポットに**確認済みで紐付いた**公開写真だけ */
    photos: Photo[];
    /** 周辺スポット（台帳に登録済みで、手で選んだものだけ） */
    nearby: SpotRow[];
    /** 同じ場所を指す集約ページ（あれば）。無ければ `null` */
    locationPath: string | null;
    /** 属する県（海外は一括）。パンくずと「すべて見る」の行き先。引けなければ `null` */
    area?: { slug: string; name: string; nameEn: string } | null;
    /**
     * 同じ県（海外は同じ国）のほかのスポット（人が確かめたものだけ・近い順）。
     * **手で選んだ「近くの撮影スポット」とは別の節**で、関係があるとは名乗らない
     */
    sameArea?: { label: string; spots: SpotRow[] } | null;
    /** このページの URL（canonical と同じ形・サーバーが組む）。「シェア」で配る */
    pageUrl?: string;
    /**
     * 撮影の光の月別の表（サーバーが計算した文字だけ・`lib/utils/lightCalendar.ts`）。
     * 座標が無い・時刻帯が引けない場所は `null`（節ごと出さない）
     */
    light?: LightCalendar | null;
    /**
     * 作例（Wikimedia Commons の自由に使える写真・最大6枚・`lib/data/spotSamples.ts`）。
     * どれも作者・ライセンス・出典を持つ（持たない1枚はサーバー側で落としてある）
     */
    samples?: SpotSample[];
};

/** 一覧の1行（`km` はこのスポットからの距離・両方に座標があるときだけ） */
type SpotRow = { slug: string; name: string; region?: string; km?: number };

/**
 * ほかのスポットの一覧（iOS の `nearbyRow`: 面の箱に、印 → 名前 → 距離 → 矢印）。
 * **距離は計算したもの**（言い方は `distanceLabel`＝iOS の `NearbyPhotos.label` と同じ刻み）。
 * 地域の行は Web だけ残す（同じ県の一覧で市の違いが分かる）
 */
function SpotRows({ rows, isJa }: { rows: SpotRow[]; isJa: boolean }) {
    return (
        <ul className="m-0 p-0 rounded-2xl bg-surface overflow-hidden" style={{ listStyle: "none" }}>
            {rows.map((n, i) => {
                const dist = n.km === undefined ? "" : distanceLabel(n.km, isJa);
                return (
                    <li key={n.slug} className={i > 0 ? "border-t border-white/5" : undefined}>
                        <Link href={`/spots/${n.slug}`} prefetch={false}
                              className="flex items-center gap-3 px-3.5 hover:bg-surface-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                              style={{ minHeight: 54 }}>
                            <MapPinIcon className="w-5 h-5 flex-shrink-0 text-white/55" aria-hidden />
                            <span className="min-w-0 flex-1 py-2">
                                <span className="block text-white truncate" style={{ fontSize: "15px", lineHeight: "20px" }}>{n.name}</span>
                                {n.region && <span className="block text-white/55 truncate" style={{ fontSize: "11px", lineHeight: "15px" }}>{n.region}</span>}
                            </span>
                            {dist && <span className="flex-shrink-0 text-white/55" style={{ fontSize: "13px" }}>{dist}</span>}
                            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 text-white/55" aria-hidden />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}

const SEASON_LABEL: Record<string, string> = {
    spring: "春", summer: "夏", autumn: "秋", winter: "冬",
};
const TIME_LABEL: Record<string, string> = {
    dawn: "夜明け", morning: "朝", day: "日中", goldenHour: "夕方の斜光", dusk: "日没後", night: "夜",
};

/** 節の見出し。ホームと同じ声（`font-serif`）＝新しい字体を持ち込まない */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <h2 id={id} className="m-0 mb-3 font-serif font-bold text-white tracking-wide"
            style={{ fontSize: "18px", lineHeight: "24px" }}>
            {children}
        </h2>
    );
}

/** 時刻帯の短い言い方（表の注記）。日本は「日本時間」、ほかは都市名 */
function zoneLabel(timeZone: string, isJa: boolean): string {
    if (timeZone === "Asia/Tokyo") return isJa ? "日本時間" : "Japan time";
    const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
    return isJa ? `現地時刻・${city}` : `local time, ${city}`;
}

/**
 * 撮影の光の月別の表（各月15日の計算値）。**天気・山の影は含まない**と書く。
 * 時刻が出ない欄は理由の言葉（白夜・極夜・終日・沈まない・明け方まで）、日付をまたぐ時刻は「翌」。出てくる言葉だけ凡例に出す。
 * 狭い画面では表だけ横に流す（ページは横に溢れさせない）。数字は等幅でそろえる
 */
function LightTable({ light, isJa }: { light: LightCalendar; isJa: boolean }) {
    // 320px の画面でも右端の列が隠れない幅（余白 12・見出しは折り返す・9d7ba04e のレビュー）
    const cell = "py-2 pr-3 whitespace-nowrap";
    const legend = lightLegend(light.rows, isJa);
    return (
        <section className="pt-8" aria-labelledby="spot-light" data-testid="spot-light">
            <Head id="spot-light">{isJa ? "撮影の光" : "Light through the year"}</Head>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left" style={{ fontSize: "13px", lineHeight: "18px" }}>
                    <caption className="sr-only">
                        {isJa ? "各月15日の日の出・日の入り・夕方のゴールデンアワー" : "Sunrise, sunset and evening golden hour on the 15th of each month"}
                    </caption>
                    <thead>
                        <tr className="text-white/60 border-b border-line align-bottom" style={{ fontSize: "12px" }}>
                            <th scope="col" className={`${cell} font-normal`}>{isJa ? "月" : "Month"}</th>
                            <th scope="col" className={`${cell} font-normal`}>{isJa ? "日の出" : "Sunrise"}</th>
                            <th scope="col" className={`${cell} font-normal`}>{isJa ? "日の入り" : "Sunset"}</th>
                            <th scope="col" className="py-2 font-normal">{isJa ? "夕方のゴールデンアワー" : "Evening golden hour"}</th>
                        </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums text-white/85">
                        {light.rows.map((r) => (
                            <tr key={r.month} className="border-b border-line/60">
                                <th scope="row" className={`${cell} font-normal font-sans text-white/60`}>
                                    {isJa ? `${r.month}月` : new Date(Date.UTC(2000, r.month - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" })}
                                </th>
                                <td className={cell}>{lightCellText(r.sunrise, isJa)}</td>
                                <td className={cell}>{lightCellText(r.sunset, isJa)}</td>
                                <td className="py-2 whitespace-nowrap">{lightCellText(r.eveningGolden, isJa)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="m-0 mt-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                {isJa
                    ? `各月15日の計算値（${zoneLabel(light.timeZone, true)}）。ゴールデンアワーは太陽の高さが6°から−4°の間。天気や山・建物の影は含みません。`
                    : `Calculated for the 15th of each month (${zoneLabel(light.timeZone, false)}). Golden hour is when the sun is between 6° and −4°. Weather and shadows from terrain or buildings are not included.`}
            </p>
            {legend.length > 0 && (
                <ul className="m-0 mt-1 p-0 text-white/60" style={{ fontSize: "12px", lineHeight: "18px", listStyle: "none" }} data-testid="spot-light-legend">
                    {legend.map((l) => <li key={l}>{l}</li>)}
                </ul>
            )}
        </section>
    );
}

/**
 * **光の時刻**（その日の日の出・日の入りと方角、ゴールデンアワー・ブルーアワー・`lib/utils/spotLight.ts`）。
 * アプリの撮影スポットの画面（`OfficialSpotView` の光の時刻）と同じ段・同じ文。日付は前後に送れる。
 *
 * **今日はブラウザで決まる**（静的なページなので、ビルドの日の時刻を書き込まない）。最初の描画は
 * サーバーと同じにするため、時刻の行と日付の帯は水和のあとに出す。節を出すかどうか・台帳の時間帯の文・
 * 注記は日付に依らないので、サーバーの HTML にも入る（検索にも読まれる）
 */
function LightToday({ spot, zone, isJa }: { spot: Spot; zone: string; isJa: boolean }) {
    const [now, setNow] = React.useState<Date | null>(null);
    const [offset, setOffset] = React.useState(0);
    React.useEffect(() => { setNow(new Date()); }, []);
    const sheet = now && spot.coords ? lightSheet(spot.region?.country, spot.coords, offset, now, isJa) : null;
    const guides = splitGuides(spot.timeOfDayGuide ?? []);
    // 水和の前は段の札と台帳の文だけ（文の無い段は出さない）
    const blocks: LightBlock[] = sheet?.blocks ?? [
        { title: isJa ? "朝" : "Morning", isMorning: true, rows: [] },
        { title: isJa ? "夕" : "Evening", isMorning: false, rows: [] },
    ].filter((b) => (b.isMorning ? guides.morning : guides.evening).length > 0);
    const step = (d: number) => setOffset((o) => Math.min(Math.max(o + d, -LIGHT_MAX_OFFSET), LIGHT_MAX_OFFSET));
    const stepButton = (d: -1 | 1) => {
        const atEdge = d < 0 ? offset <= -LIGHT_MAX_OFFSET : offset >= LIGHT_MAX_OFFSET;
        const Icon = d < 0 ? ChevronLeftIcon : ChevronRightIcon;
        return (
            <button type="button" onClick={() => step(d)} disabled={atEdge}
                    aria-label={d < 0 ? (isJa ? "前の日" : "Previous day") : (isJa ? "次の日" : "Next day")}
                    data-testid={d < 0 ? "spot-today-light-prev" : "spot-today-light-next"}
                    className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full text-white hover:bg-surface-2 disabled:opacity-30 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent">
                <Icon className="w-4 h-4" aria-hidden />
            </button>
        );
    };
    return (
        <section className="pt-8" aria-labelledby="spot-today-light" data-testid="spot-today-light">
            <Head id="spot-today-light">{isJa ? "光の時刻" : "Light"}</Head>
            {sheet && (
                <div className="flex items-center gap-1 mb-2">
                    {stepButton(-1)}
                    <span className="min-w-0 text-white tabular-nums" style={{ fontSize: "15px", lineHeight: "20px", fontWeight: 500 }}
                          aria-live="polite" data-testid="spot-today-light-date">
                        {lightDateLabel(sheet.ymd, offset, sheet.todayYMD, isJa)}
                    </span>
                    {stepButton(1)}
                    <span className="flex-1" />
                    {offset !== 0 && (
                        <button type="button" onClick={() => setOffset(0)} aria-label={isJa ? "今日に戻す" : "Back to today"}
                                className="flex-shrink-0 min-w-11 h-11 px-2 font-semibold text-accent hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded"
                                style={{ fontSize: "14px" }}>
                            {isJa ? "今日" : "Today"}
                        </button>
                    )}
                </div>
            )}
            {blocks.length > 0 && (
                <div className="rounded-2xl bg-surface ring-1 ring-line overflow-hidden">
                    {blocks.map((b, i) => {
                        const texts = b.isMorning ? guides.morning : guides.evening;
                        return (
                            <div key={b.title} className={`p-3.5 ${i > 0 ? "border-t border-line" : ""}`} data-testid="spot-today-light-block">
                                <p className="m-0 mb-2 uppercase tracking-[0.16em] text-accent" style={{ fontSize: "11px", lineHeight: "14px" }}>{b.title}</p>
                                {b.rows.length > 0 && (
                                    <dl className="m-0 flex flex-col gap-1.5">
                                        {b.rows.map((r) => (
                                            <div key={r.label} className="flex items-baseline gap-2.5" data-testid="spot-today-light-row">
                                                <dt className="text-white/70" style={{ fontSize: "14px", lineHeight: "20px" }}>{r.label}</dt>
                                                <dd className="m-0 ml-auto flex items-baseline gap-2.5 text-right">
                                                    {r.detail && <span className="tabular-nums text-white/55" style={{ fontSize: "13px" }}>{r.detail}</span>}
                                                    <span className="tabular-nums text-white" style={{ fontSize: "15px", fontWeight: 500 }}>{r.value}</span>
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                                {texts.length > 0 && (
                                    <ul className={`m-0 p-0 flex flex-col gap-2 ${b.rows.length > 0 ? "mt-3" : ""}`} style={{ listStyle: "none" }}>
                                        {texts.map((t) => (
                                            <li key={t.time} className="flex gap-2.5">
                                                <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-chip text-chip-text"
                                                      style={{ fontSize: "11px", padding: "2px 10px", height: "22px" }}>
                                                    {TIME_LABEL[t.time] ?? t.time}
                                                </span>
                                                <span className="text-white/85" style={{ fontSize: "14px", lineHeight: "22px" }}>{t.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            <p className="m-0 mt-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>{lightNote(zone, isJa)}</p>
        </section>
    );
}

/**
 * **作例（Wikimedia Commons より）。** 利用者の投稿とは別の節で、投稿だとは名乗らない。
 *
 * 🔴 **1枚ごとに、写真のすぐ下へ「題 / 写真: 作者 / ライセンス（文面へ）/ Wikimedia Commons（出典へ）」。**
 * CC BY・CC BY-SA の表示条件（作者・ライセンスの URI・出典）。代表写真の出典と同じ書き方。
 * 写真は**切り抜かない**（元の縦横比のまま・改変と受け取られる余地を作らない）
 */
function Samples({ samples, isJa }: { samples: SpotSample[]; isJa: boolean }) {
    // 読み込めなかった1枚（Commons 側で消えた・差し替わった）は、出典ごと隠す。
    // 全部読めなければ節ごと隠す（割れた画像の枠と出典だけが並ばないように）
    const [broken, setBroken] = React.useState<ReadonlySet<string>>(() => new Set());
    const shown = samples.filter((s) => !broken.has(s.sourceUrl));
    if (shown.length === 0) return null;
    return (
        <section className="pt-8" aria-labelledby="spot-samples" data-testid="spot-samples">
            <Head id="spot-samples">{isJa ? "作例（Wikimedia Commons より）" : "Example photos (from Wikimedia Commons)"}</Head>
            <p className="m-0 mb-3 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                {isJa
                    ? "この場所の近くで撮られ、Wikimedia Commons で自由なライセンスのもと公開されている写真です。撮影者はこのサイトの利用者ではありません。"
                    : "Photos taken near this spot and published under free licenses on Wikimedia Commons. The photographers are not members of this site."}
            </p>
            <ul className="m-0 p-0 grid grid-cols-2 sm:grid-cols-3 gap-3 items-start" style={{ listStyle: "none" }}>
                {shown.map((s) => {
                    const small = commonsThumbAt(s.src, 500);
                    const srcSet = commonsSrcSet(s.src, s.width);
                    return (
                        <li key={s.sourceUrl} className="min-w-0">
                            <figure className="m-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={small ?? s.src} srcSet={srcSet}
                                     sizes="(min-width:1024px) 240px, (min-width:640px) 30vw, 46vw"
                                     width={s.width} height={s.height} loading="lazy" decoding="async"
                                     alt={isJa ? `作例の写真（撮影: ${s.author}）` : `Example photo by ${s.author}`}
                                     onError={() => setBroken((prev) => new Set(prev).add(s.sourceUrl))}
                                     className="block w-full h-auto rounded-lg bg-surface" />
                                <figcaption className="mt-1.5 text-white/60 wrap-anywhere" style={{ fontSize: "11px", lineHeight: "15px" }}
                                            data-testid="spot-sample-credit">
                                    {/* TASL（題・作者・出典・ライセンス）。題は Commons のファイル名から */}
                                    <cite className="not-italic">{s.title}</cite>{" / "}
                                    {isJa ? "写真: " : "Photo: "}{s.author}{" / "}
                                    {s.licenseUrl ? (
                                        <a href={s.licenseUrl} target="_blank" rel="noopener noreferrer license"
                                           className="text-white/60 underline underline-offset-2 hover:text-white">{s.license}</a>
                                    ) : s.license}
                                    {" / "}
                                    <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer"
                                       className="text-white/60 underline underline-offset-2 hover:text-white">Wikimedia Commons</a>
                                </figcaption>
                            </figure>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/** 出典の1行。**変わりやすい情報には必ず付く** */
function Sources({ spot, field }: { spot: Spot; field: string }) {
    const list = sourcesFor(spot, field);
    if (!list.length) return null;
    return (
        <p className="m-0 mt-2 text-white/50" style={{ fontSize: "11px", lineHeight: "16px" }}>
            出典:{" "}
            {list.map((s, i) => (
                <React.Fragment key={s.url}>
                    {i > 0 && " / "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                       className="underline decoration-white/30 underline-offset-2 hover:text-white/80">
                        {s.title || new URL(s.url).host}
                    </a>
                    <span>（{s.checkedAt} 確認）</span>
                </React.Fragment>
            ))}
        </p>
    );
}

export default function SpotGuideClient({ spot, photos, nearby, locationPath, area = null, sameArea = null, pageUrl, light = null, samples = [] }: Props) {
    const { locale } = useLocale();
    const { showToast } = useToast();
    const isJa = locale !== "en";
    /**
     * 投稿画面から戻ってきたか（`?posted=1`・`app/user/upload/page.tsx` が付ける）。
     * 静的なページなので**水和のあとに URL を読む**（最初の描画をサーバーと揃える）。
     * 読んだら URL から外す——再読込や共有で「投稿しました」が出続けないように
     */
    const [justPosted, setJustPosted] = React.useState(false);
    React.useEffect(() => {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get("posted") !== "1") return;
            setJustPosted(true);
            url.searchParams.delete("posted");
            window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        } catch { /* ignore */ }
    }, []);
    const mapHero = usesMapHero(spot);
    /**
     * 投稿の行き先。**スポットを運ぶのは公開済みの場所だけ**——投稿画面が読む本文 JSON
     * （`/app/data/spots/<slug>.json`）は公開済みの分しか書き出さない（`toSpotBody`）。
     * 下書きの画面（`BUILD_DRAFT_SPOTS` を戻したとき）から運ぶと、毎回「読み込めません
     * でした」になる
     */
    const uploadHref = isPublished(spot) ? spotUploadHref(spot.slug) : ROUTES.UPLOAD;
    const cover = spot.coverImage;
    // **公開済みか**（人の確認か AI 照合）。false のあいだは「下書き（運営未確認）」の
    // 帯を出し、公式サイトのリンクを「未確認」と名乗らせる
    const verified = isPublished(spot);
    // **「運営が確かめた」と書けるのは人が確かめた行だけ**（AI 照合は出典を書く）
    const humanChecked = isVerified(spot);
    const aiChecked = !humanChecked && hasAiCheck(spot) ? spot.aiCheck : undefined;
    const region = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
    // 光の時刻の節を出す場所か（座標と国だけで決まる）。出すときは朝・夕の時間帯の文をそちらへ移す
    const lightTz = lightZone(spot.coords, spot.region?.country);
    const guideTimeList = guideTimes(spot.timeOfDayGuide ?? [], lightTz !== null);
    const mapHref = spot.coords ? `${ROUTES.MAP}#14/${spot.coords.lat}/${spot.coords.lng}` : ROUTES.MAP;
    // 「[都道府県] [市区町村] · N枚の写真」（iOS の `SpotScreen.subtitle`）。N は数えた値
    const photoCountLabel = isJa ? `${photos.length}枚の写真` : (photos.length === 1 ? "1 photo" : `${photos.length} photos`);

    // 「シェア」: 共有シートが使えなければリンクをコピー（`SpotPageClient` と同じ扱い）。
    // 配るのは**サーバーが組んだ canonical**（`window.location` だとクエリが付いたまま配られる）
    const handleShare = async () => {
        const url = pageUrl ?? (typeof window === "undefined" ? "" : window.location.href.split(/[?#]/)[0]);
        const result = await shareUrl(url, spot.name, region || undefined);
        if (result === "copied") {
            showToast(isJa ? "リンクをクリップボードにコピーしました" : "Link copied to clipboard!", "success");
        } else if (result === "failed") {
            showToast(isJa ? "共有できませんでした" : "Could not share", "error");
        }
    };

    /* 公式サイト（iOS と同じく本文の後ろ・行動の3つには入れない） */
    const officialSite = spot.officialWebsiteUrl ? (
        <div className="pt-6">
            {/* 下書きの URL は誰も開いていない。**未確認と名乗り、検索エンジンにも
                推さない（nofollow）**——1,103 ドメインへ「公式」と名指しして渡さない */}
            <a href={spot.officialWebsiteUrl} target="_blank"
               rel={verified ? "noopener noreferrer" : "noopener noreferrer nofollow"}
               className="inline-flex items-center rounded-full bg-surface ring-1 ring-line text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
               style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px" }}>
                {verified
                    ? (isJa ? "公式サイト" : "Official site")
                    : (isJa ? "公式サイト（未確認のリンク）" : "Official site (unchecked link)")}
                {" "}<span aria-hidden="true" className="ml-1">↗</span>
            </a>
        </div>
    ) : null;

    /* ── この場所の写真 ─────────────────────────
       **ここだけがユーザー投稿に触れる節。** 0枚でも上は完成している。
       iOS と同じく**写真がある場所は本文より先**（写真が主役）、0枚の場所は本文の後ろ */
    const photosSection = (
        <section className={photos.length > 0 ? "pt-6" : "pt-8"} aria-labelledby="spot-photos">
            <Head id="spot-photos">{isJa ? `この場所の写真（${photos.length}）` : `Photos here (${photos.length})`}</Head>
            {/* 投稿から戻ってきた（`?posted=1`）。**この一覧はビルド時の写真**なので、
                いま上げた写真はサイトの更新が終わるまで並ばない——並んだとは言わない */}
            {justPosted && (
                <p role="status" className="m-0 mb-3 rounded-xl bg-surface ring-1 ring-line px-4 py-3 text-white/80"
                   style={{ fontSize: "13px", lineHeight: "20px" }} data-testid="spot-posted-note">
                    {isJa
                        ? "投稿しました。この一覧に並ぶのは、サイトの更新が終わってからです。"
                        : "Posted. It will appear here after the site is updated."}
                </p>
            )}
            {photos.length > 0 ? (
                <>
                    <GalleryGrid photos={photos} locale={locale} sizes="(min-width:1024px) 300px, 50vw"
                                  columnsClassName="grid-cols-2 sm:grid-cols-3" />
                    {/* 写真がある場所にも投稿の入口を置く（0枚のときだけだと、2枚目以降が紐付かない） */}
                    <div className="mt-3 text-center">
                        <Link href={uploadHref} prefetch={false}
                              className="inline-flex items-center rounded-full ring-1 ring-line text-white hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px" }}>
                            {isJa ? "ここで撮った写真を投稿する" : "Share a photo"}
                        </Link>
                    </div>
                </>
            ) : (
                <div className="rounded-xl bg-surface ring-1 ring-line p-5 text-center">
                    <p className="m-0 text-white/70" style={{ fontSize: "14px", lineHeight: "22px" }}>
                        {isJa
                            ? "この撮影地の写真は、まだ投稿されていません。"
                            : "No photos have been shared for this spot yet."}
                    </p>
                    <Link href={uploadHref} prefetch={false}
                          className="mt-3 inline-flex items-center rounded-full bg-accent-fill text-ink font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px" }}>
                        {isJa ? "ここで撮った写真を投稿する" : "Share a photo"}
                    </Link>
                </div>
            )}
        </section>
    );

    return (
        <main className="min-h-screen text-white bg-bg">
            {/* ── 1. 代表写真（無ければ地図を主役に）───────────────────
                owner:「適切な代表写真が存在しない場合は、無関係な写真で埋めず、
                撮影地名と地図を中心とした代替レイアウトを表示してください」 */}
            {/* 🔴 **PC で縦横比を変える。** スマホの 3:2 のまま横に伸ばすと、
                1280px では高さが 853px になって**画面を丸ごと占め、下の情報が
                全部押し出される**（実測してから直した）。owner:「スマートフォンを
                単純に横へ引き伸ばさないでください」。
                さらに `max-height` で上限を切る——縦に長い画面でも、
                スクロールせずに見出しと概要が見えるようにする */}
            {/* 写真があるときは **スマホは 4:3**（iOS の `heroPhoto`）・PC は 12:5 のまま。
                **出典は写真の下に右寄せ**（iOS と同じ）——以前は写真の上に重ね、読ませるために
                下を黒く暗くしていた。CC BY・CC BY-SA の表示条件は写真と一緒に出ることで満たす */}
            <section>
            <div className={`relative w-full overflow-hidden ${
                mapHero ? "aspect-[2/1] sm:aspect-[16/5]" : "aspect-[4/3] sm:aspect-[12/5]"
            }`} style={{ maxHeight: "min(62vh, 520px)" }}>
                {mapHero ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface">
                        <p className="m-0 font-serif font-bold text-white text-center px-6"
                           style={{ fontSize: "clamp(22px, 5vw, 36px)", lineHeight: "1.2" }}>{spot.name}</p>
                        {region && <p className="m-0 text-white/60" style={{ fontSize: "13px" }}>{region}</p>}
                        <p className="m-0 mt-1 text-white/60" style={{ fontSize: "11px" }}>
                            {isJa ? "代表写真はまだありません" : "No guide photo yet"}
                        </p>
                    </div>
                ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={cover!.src} alt={cover!.alt}
                         className="absolute inset-0 w-full h-full object-cover" />
                )}
            </div>
            {!mapHero && needsVisibleCredit(spot) && (
                /* 左右は本文の列にそろえる（最大幅まで同じ箱。余白だけ合わせると
                   1152px を超える画面で右端が本文から外れた・実測 1440px で 144px） */
                <p className="m-0 mt-1.5 mx-auto w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 md:px-8 text-white/60 text-right"
                   style={{ fontSize: "11px", lineHeight: "15px" }}>
                    {/* Commons の写真は「写真: 作者 / ライセンス（文面へ）/ Wikimedia Commons（出典へ）」
                        ——CC BY・CC BY-SA の表示条件（作者・ライセンスの URI・出典） */}
                    {cover!.licenseLabel ? (
                        <>
                            {isJa ? "写真: " : "Photo: "}{cover!.credit}{" / "}
                            {cover!.licenseUrl ? (
                                <a href={cover!.licenseUrl} target="_blank" rel="noopener noreferrer license"
                                   className="text-white/60 underline underline-offset-2 hover:text-white">{cover!.licenseLabel}</a>
                            ) : cover!.licenseLabel}
                            {cover!.sourceUrl && (
                                <>
                                    {" / "}
                                    <a href={cover!.sourceUrl} target="_blank" rel="noopener noreferrer"
                                       className="text-white/60 underline underline-offset-2 hover:text-white">Wikimedia Commons</a>
                                </>
                            )}
                        </>
                    ) : (cover!.requiredCreditText || `Photo: ${cover!.credit}`)}
                </p>
            )}
            </section>

            <div className="mx-auto w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 md:px-8 pb-10">
                {/* ── 2. 基本情報 ─────────────────────────────── */}
                <header className="pt-5 pb-4">
                    {/* パンくず（構造化データの `BreadcrumbList` と同じ段）。
                        県の段は区画のページが在るときだけ */}
                    <nav aria-label={isJa ? "パンくずリスト" : "Breadcrumb"} className="mb-2 text-white/60"
                         style={{ fontSize: "12px", lineHeight: "18px" }}>
                        <Link href="/" prefetch={false} className="hover:text-white/90">{isJa ? "ホーム" : "Home"}</Link>
                        <span className="mx-1.5" aria-hidden>/</span>
                        <Link href={ROUTES.SPOTS} prefetch={false} className="hover:text-white/90">{isJa ? "撮影スポット" : "Photo spots"}</Link>
                        {area && (
                            <>
                                <span className="mx-1.5" aria-hidden>/</span>
                                <Link href={ROUTES.SPOT_AREA(area.slug)} prefetch={false} className="hover:text-white/90">
                                    {isJa ? area.name : area.nameEn}
                                </Link>
                            </>
                        )}
                    </nav>
                    {/* 小見出し（iOS の `SpotScreen.eyebrow`・等幅11・字間1.5・大文字）。
                        🔴 **下書きを「撮影スポット」と名乗らない**——真鍮ではなく薄い色で「下書き・未確認」 */}
                    {/* 公開の回は読み上げから外す（すぐ上のパンくずが同じ「撮影スポット」を読む）。
                        「下書き・未確認」は意味を持つので読ませる */}
                    <p aria-hidden={verified ? true : undefined}
                       className={`m-0 mb-1.5 font-mono font-medium uppercase ${verified ? "text-accent" : "text-white/60"}`}
                       style={{ fontSize: "11px", lineHeight: "16px", letterSpacing: "1.5px" }}>
                        {verified ? (isJa ? "撮影スポット" : "Photo spot") : (isJa ? "下書き・未確認" : "Draft · Unreviewed")}
                    </p>
                    <h1 className="m-0 font-serif font-bold text-white wrap-anywhere"
                        style={{ fontSize: "clamp(24px, 4.5vw, 38px)", lineHeight: "1.18" }}>
                        {spot.name}
                    </h1>
                    {(spot.reading || spot.nameEn) && (
                        <p className="m-0 mt-1 text-white/55" style={{ fontSize: "13px", lineHeight: "18px" }}>
                            {[spot.reading, spot.nameEn].filter(Boolean).join(" ・ ")}
                        </p>
                    )}
                    <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-white/70"
                       style={{ fontSize: "13px", lineHeight: "18px" }}>
                        <span>{region ? `${region} · ${photoCountLabel}` : photoCountLabel}</span>
                        {spot.category && (
                            <span className="inline-flex items-center rounded-full bg-chip text-chip-text"
                                  style={{ fontSize: "11px", padding: "2px 8px" }}>{spot.category}</span>
                        )}
                    </p>
                    {/* 🔴 **下書き（運営未確認）の帯。** 2026-09-24 の台帳は AI が1日で書き、
                        誰も確かめていないのに「確認済み」を名乗っていた。人が確かめて
                        `published` に上げるまで、読む人にそう伝える（文字と rel だけ。
                        色・部品・余白は変えない） */}
                    {!verified && (
                        <p role="note" className="m-0 mt-3 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                            {isJa
                                ? "下書き（運営未確認）：この内容は運営がまだ公式サイト・現地で確かめていません。行く前に公式サイトで確認してください。"
                                : "Draft — not checked by us yet. We have not verified this against the official site or on location. Please check the official site before you go."}
                            {spot.draftedAt && (isJa ? ` 下書き作成: ${spot.draftedAt}` : ` Drafted: ${spot.draftedAt}`)}
                        </p>
                    )}
                    {spot.summary && (
                        <p className="m-0 mt-3 text-white/85" style={{ fontSize: "15px", lineHeight: "24px" }}>
                            {spot.summary}
                        </p>
                    )}
                </header>

                {/* ── 3. 主な操作（iOS の行動3つ: 行きたい・地図で見る・シェア）──────
                    **横に等分・高さ48・角12**（`SpotDetailParts.actionLabel`）。
                    「行きたい」は**本物**（`spots#<uid>` に入る・上の注記）。
                    部品は撮影地ページと同じ `SaveSpotButton`（形だけ `tile`）——
                    同じ3状態の扱いを2つ作らない。
                    「地図で見る」は iOS では端末の地図アプリ（英語 Open in Maps）、Web はサイトの
                    撮影地マップなので英語は Map（端末の地図アプリとは名乗らない）。
                    **格子で3等分**（`flex-1` だと包んだ側だけ狭くなる）。PC は本文の列の幅
                    （36rem）で止める——スマホの形を横に引き伸ばさない（owner の指示） */}
                <div className="pb-6 border-b border-white/10">
                <div className="grid grid-cols-3 gap-2.5 max-w-xl">
                    <SaveSpotButton slug={spot.slug} name={spot.name} locale={isJa ? "ja" : "en"} kind="spot" variant="tile" />
                    <Link href={mapHref} prefetch={false}
                          className={`${TILE} ${TILE_OFF} min-w-0`}
                          style={{ minHeight: 48, touchAction: "manipulation" }}>
                        <MapIcon className={TILE_ICON} aria-hidden />
                        <span className={TILE_TEXT}>{isJa ? "地図で見る" : "Map"}</span>
                    </Link>
                    <button type="button" onClick={handleShare}
                            className={`${TILE} ${TILE_OFF} min-w-0`}
                            style={{ minHeight: 48, touchAction: "manipulation" }}>
                        <ArrowUpOnSquareIcon className={TILE_ICON} aria-hidden />
                        <span className={TILE_TEXT}>{isJa ? "シェア" : "Share"}</span>
                    </button>
                </div>
                </div>

                {/* PC は2段組。スマホは1列（スマホを横に引き伸ばさない） */}
                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10 lg:items-start">
                    <div className="min-w-0">
                        {photos.length > 0 && photosSection}

                        {/* ── 4. この場所の魅力 ───────────────── */}
                        {(spot.description || (spot.highlights ?? []).length > 0) && (
                            <section className="pt-6" aria-labelledby="spot-charm">
                                <Head id="spot-charm">{isJa ? "この場所の魅力" : "What makes it special"}</Head>
                                {spot.description && (
                                    <p className="m-0 mb-3 text-white/85" style={{ fontSize: "15px", lineHeight: "26px" }}>
                                        {spot.description}
                                    </p>
                                )}
                                {(spot.highlights ?? []).length > 0 && (
                                    <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: "none" }}>
                                        {spot.highlights!.map((h) => (
                                            <li key={h} className="flex gap-2 text-white/85"
                                                style={{ fontSize: "15px", lineHeight: "24px" }}>
                                                <span aria-hidden="true" className="text-accent flex-shrink-0">—</span>
                                                <span>{h}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )}

                        {/* ── 作例（Wikimedia Commons）──────────
                            投稿が0枚の場所でも、どんな写真が撮れるかが分かるように。撮影ガイドの前 */}
                        {samples.length > 0 && <Samples samples={samples} isJa={isJa} />}

                        {/* ── 5. 撮影ガイド ──────────────────
                            **事実ではなく運営のアドバイス**なので、出典は求めない
                            （代わりに「撮影ガイド」という見出しで事実と分ける） */}
                        {((spot.seasonalGuide ?? []).length > 0
                            || guideTimeList.length > 0
                            || (spot.compositionTips ?? []).length > 0
                            || showsField(spot, "safetyNotes")) && (
                            <section className="pt-8" aria-labelledby="spot-guide">
                                <Head id="spot-guide">{isJa ? "撮影ガイド" : "Shooting guide"}</Head>

                                {(spot.seasonalGuide ?? []).length > 0 && (
                                    <div className="mb-5">
                                        <p className="m-0 mb-2 text-white/60" style={{ fontSize: "12px" }}>
                                            {isJa ? "季節ごとの景色" : "By season"}
                                        </p>
                                        <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: "none" }}>
                                            {spot.seasonalGuide!.map((s) => (
                                                <li key={s.season} className="flex gap-2.5">
                                                    <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-chip text-chip-text"
                                                          style={{ fontSize: "11px", padding: "2px 10px", height: "22px" }}>
                                                        {SEASON_LABEL[s.season] ?? s.season}
                                                    </span>
                                                    <span className="text-white/85" style={{ fontSize: "14px", lineHeight: "22px" }}>{s.text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {guideTimeList.length > 0 && (
                                    <div className="mb-5">
                                        <p className="m-0 mb-2 text-white/60" style={{ fontSize: "12px" }}>
                                            {isJa ? "時間帯" : "By time of day"}
                                        </p>
                                        <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: "none" }}>
                                            {guideTimeList.map((t) => (
                                                <li key={t.time} className="flex gap-2.5">
                                                    <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-chip text-chip-text"
                                                          style={{ fontSize: "11px", padding: "2px 10px", height: "22px" }}>
                                                        {TIME_LABEL[t.time] ?? t.time}
                                                    </span>
                                                    <span className="text-white/85" style={{ fontSize: "14px", lineHeight: "22px" }}>{t.text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {(spot.compositionTips ?? []).length > 0 && (
                                    <div className="mb-5">
                                        <p className="m-0 mb-2 text-white/60" style={{ fontSize: "12px" }}>
                                            {isJa ? "構図のヒント" : "Composition"}
                                        </p>
                                        <ul className="m-0 p-0 flex flex-col gap-1.5" style={{ listStyle: "none" }}>
                                            {spot.compositionTips!.map((c) => (
                                                <li key={c} className="text-white/85" style={{ fontSize: "14px", lineHeight: "22px" }}>・{c}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* ⚠️ 注意事項は**出典が無ければ出さない**（`showsField`）。
                                    立入禁止・撮影制限を推測で書くと、人が入ってはいけない所へ入る */}
                                {showsField(spot, "safetyNotes") && (spot.safetyNotes ?? []).length > 0 && (
                                    <div className="rounded-xl bg-surface ring-1 ring-line p-3.5">
                                        <p className="m-0 mb-1.5 text-white font-semibold" style={{ fontSize: "13px" }}>
                                            {isJa ? "撮影時の注意" : "Before you shoot"}
                                        </p>
                                        <ul className="m-0 p-0 flex flex-col gap-1" style={{ listStyle: "none" }}>
                                            {spot.safetyNotes!.map((n) => (
                                                <li key={n} className="text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>・{n}</li>
                                            ))}
                                        </ul>
                                        <Sources spot={spot} field="safetyNotes" />
                                    </div>
                                )}
                            </section>
                        )}

                        {/* ── 光の時刻（その日）→ 撮影の光（月別の表）── */}
                        {lightTz && <LightToday spot={spot} zone={lightTz} isJa={isJa} />}

                        {light && <LightTable light={light} isJa={isJa} />}

                        {officialSite}

                        {photos.length === 0 && photosSection}
                    </div>

                    {/* ── 右カラム（PC）＝所在地・地図・アクセス・周辺 ──────
                        **ホームの柱と同じ形**（`max-h` + `overflow-y-auto`）。
                        上だけで留めると、画面が低いときに下の節へ**永久に届かない**
                        （1280×600 で実測済み・`app/GalleryPageClient.tsx` の注記） */}
                    <aside className="pt-8 lg:pt-6 lg:sticky lg:top-[calc(var(--header-h)_+_16px)] lg:max-h-[calc(100vh_-_var(--header-h)_-_var(--bottom-bar-h,84px)_-_32px)] lg:overflow-y-auto">
                        {/* ── 6. アクセス ── */}
                        {(showsField(spot, "access") || showsField(spot, "parking") || spot.address) && (
                            <section className="mb-7" aria-labelledby="spot-access">
                                <Head id="spot-access">{isJa ? "アクセス" : "Getting there"}</Head>
                                {spot.address && (
                                    <p className="m-0 mb-2 text-white/75" style={{ fontSize: "13px", lineHeight: "20px" }}>
                                        {spot.address}
                                    </p>
                                )}
                                {showsField(spot, "access") && spot.access && (
                                    <dl className="m-0">
                                        {spot.access.transit && (
                                            <>
                                                <dt className="text-white/55" style={{ fontSize: "11px" }}>{isJa ? "公共交通機関" : "Transit"}</dt>
                                                <dd className="m-0 mb-2 text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>{spot.access.transit}</dd>
                                            </>
                                        )}
                                        {spot.access.car && (
                                            <>
                                                <dt className="text-white/55" style={{ fontSize: "11px" }}>{isJa ? "車" : "By car"}</dt>
                                                <dd className="m-0 mb-2 text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>{spot.access.car}</dd>
                                            </>
                                        )}
                                        {spot.access.walk && (
                                            <>
                                                <dt className="text-white/55" style={{ fontSize: "11px" }}>{isJa ? "徒歩" : "On foot"}</dt>
                                                <dd className="m-0 mb-2 text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>{spot.access.walk}</dd>
                                            </>
                                        )}
                                    </dl>
                                )}
                                {showsField(spot, "access") && <Sources spot={spot} field="access" />}
                                {showsField(spot, "parking") && spot.parking?.note && (
                                    <div className="mt-3">
                                        <p className="m-0 text-white/55" style={{ fontSize: "11px" }}>{isJa ? "駐車場" : "Parking"}</p>
                                        <p className="m-0 text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>{spot.parking.note}</p>
                                        <Sources spot={spot} field="parking" />
                                    </div>
                                )}
                            </section>
                        )}

                        {/* ── 8. 地図（座標があるときだけ）── */}
                        {spot.coords && (
                            <section className="mb-7" aria-labelledby="spot-map">
                                <Head id="spot-map">{isJa ? "地図" : "Map"}</Head>
                                <Link href={mapHref} prefetch={false}
                                      className="block rounded-xl bg-surface ring-1 ring-line p-4 hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                    <p className="m-0 text-white/85" style={{ fontSize: "13px", lineHeight: "20px" }}>
                                        {isJa ? "撮影地マップでこの場所を開く" : "Open on the map"} <span aria-hidden="true">›</span>
                                    </p>
                                    {/* **正確な GPS は出さない。** 台帳の座標は約1km に丸めてある */}
                                    <p className="m-0 mt-1 text-white/60" style={{ fontSize: "11px" }}>
                                        {isJa ? "位置はおおよそです（約1km）" : "Approximate location (~1km)"}
                                    </p>
                                </Link>
                            </section>
                        )}

                        {/* ── 9. 近くの撮影スポット（登録済みのみ）── */}
                        {nearby.length > 0 && (
                            <section className="mb-7" aria-labelledby="spot-nearby">
                                <Head id="spot-nearby">{isJa ? "近くの撮影スポット" : "Nearby spots"}</Head>
                                <SpotRows rows={nearby} isJa={isJa} />
                            </section>
                        )}

                        {/* ── 10. 同じ県のほかのスポット（人が確かめたものだけ）──
                            手で選んだ「近くの撮影スポット」とは別。見出しは関係を名乗らない */}
                        {sameArea && sameArea.spots.length > 0 && (
                            <section className="mb-7" aria-labelledby="spot-same-area">
                                <Head id="spot-same-area">{isJa ? `${sameArea.label}の撮影スポット`
                                    // 英語の国名は台帳に無い（海外の区画名 Outside Japan では中身と合わない）
                                    : spot.region?.country === "日本" && area ? `More spots in ${area.nameEn}` : "More photo spots"}</Head>
                                <SpotRows rows={sameArea.spots} isJa={isJa} />
                                {area && (
                                    <Link href={ROUTES.SPOT_AREA(area.slug)} prefetch={false}
                                          className="mt-2 inline-flex items-center text-white/60 hover:text-white transition-colors"
                                          style={{ fontSize: "12px" }}>
                                        {isJa ? `${area.name}の撮影スポットをすべて見る` : `See all spots in ${area.nameEn}`} <span aria-hidden="true" className="ml-1">›</span>
                                    </Link>
                                )}
                            </section>
                        )}

                        {/* 集約ページへの導線（**`/location/*` は維持**。役割が違う） */}
                        {locationPath && (
                            <Link href={locationPath} prefetch={false}
                                  className="inline-flex items-center text-white/60 hover:text-white transition-colors"
                                  style={{ fontSize: "12px" }}>
                                {isJa ? "この地域の写真をまとめて見る" : "See photos from this area"} <span aria-hidden="true" className="ml-1">›</span>
                            </Link>
                        )}

                        {/* **人が確かめたときだけ。** 以前は台帳の日付をそのまま描き、
                            AI が書いた日が「情報の最終確認」として全ページに出ていた */}
                        {humanChecked && spot.verifiedAt && (
                            <p className="m-0 mt-5 text-white/60" style={{ fontSize: "11px" }}>
                                {isJa ? `情報の最終確認: ${spot.verifiedAt}（運営）` : `Last checked: ${spot.verifiedAt} (by our team)`}
                            </p>
                        )}
                        {/* **AI 照合の行は出典を書く**（owner の委任・2026-09-26）。
                            「運営が確かめた」とは名乗らない */}
                        {aiChecked && (
                            <p className="m-0 mt-5 text-white/60" style={{ fontSize: "11px", lineHeight: "17px" }}>
                                {isJa ? "出典: " : "Source: "}
                                {aiChecked.sources.map((s, i) => (
                                    <React.Fragment key={s.url}>
                                        {i > 0 && "、"}
                                        <a href={s.url} target="_blank" rel="noopener noreferrer"
                                           className="underline underline-offset-2 hover:text-white">{s.title}</a>
                                    </React.Fragment>
                                ))}
                                {isJa ? `（AI 照合 ${aiChecked.checkedAt}）` : ` (checked by AI against the source, ${aiChecked.checkedAt})`}
                            </p>
                        )}
                    </aside>
                </div>
            </div>
        </main>
    );
}
