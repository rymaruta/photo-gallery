"use client";

import React from "react";
import Link from "next/link";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";
import { showsField, sourcesFor, needsVisibleCredit, usesMapHero, isVerified, isPublished, hasAiCheck } from "@/lib/utils/spotGuide";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";
import { MapIcon, ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";
import { useToast } from "@/lib/hooks/useToast";
import { shareUrl } from "@/lib/utils/share";
import GalleryGrid from "./GalleryGrid";
import SaveSpotButton, { TILE, TILE_OFF } from "./SaveSpotButton";

/**
 * **公式撮影地ガイドの画面**（`/spots/<slug>`）。
 *
 * ## この画面の完成条件
 *
 * owner:「**ユーザーの投稿が0枚でも、その撮影地について十分な情報を得られ、
 * 実際に行って撮影したくなるページ**」。
 *
 * だから**ユーザー投稿に触れるのは1つの節だけ**（「みんなが撮影した写真」）。
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
    nearby: { slug: string; name: string; region?: string }[];
    /** 同じ場所を指す集約ページ（あれば）。無ければ `null` */
    locationPath: string | null;
    /** 属する県（海外は一括）。パンくずと「すべて見る」の行き先。引けなければ `null` */
    area?: { slug: string; name: string; nameEn: string } | null;
    /**
     * 同じ県（海外は同じ国）のほかのスポット（人が確かめたものだけ・近い順）。
     * **手で選んだ「近くの撮影スポット」とは別の節**で、関係があるとは名乗らない
     */
    sameArea?: { label: string; spots: { slug: string; name: string; region?: string }[] } | null;
    /** このページの URL（canonical と同じ形・サーバーが組む）。「シェア」で配る */
    pageUrl?: string;
};

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

export default function SpotGuideClient({ spot, photos, nearby, locationPath, area = null, sameArea = null, pageUrl }: Props) {
    const { locale } = useLocale();
    const { showToast } = useToast();
    const isJa = locale !== "en";
    const mapHero = usesMapHero(spot);
    const cover = spot.coverImage;
    // **公開済みか**（人の確認か AI 照合）。false のあいだは「下書き（運営未確認）」の
    // 帯を出し、公式サイトのリンクを「未確認」と名乗らせる
    const verified = isPublished(spot);
    // **「運営が確かめた」と書けるのは人が確かめた行だけ**（AI 照合は出典を書く）
    const humanChecked = isVerified(spot);
    const aiChecked = !humanChecked && hasAiCheck(spot) ? spot.aiCheck : undefined;
    const region = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
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
            {photos.length > 0 ? (
                <GalleryGrid photos={photos} locale={locale} sizes="(min-width:1024px) 300px, 50vw"
                              columnsClassName="grid-cols-2 sm:grid-cols-3" />
            ) : (
                <div className="rounded-xl bg-surface ring-1 ring-line p-5 text-center">
                    <p className="m-0 text-white/70" style={{ fontSize: "14px", lineHeight: "22px" }}>
                        {isJa
                            ? "この撮影地の写真は、まだ投稿されていません。"
                            : "No photos have been shared for this spot yet."}
                    </p>
                    <Link href={ROUTES.UPLOAD} prefetch={false}
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
            <section className={`relative w-full overflow-hidden ${
                mapHero ? "aspect-[2/1] sm:aspect-[16/5]" : "aspect-[3/2] sm:aspect-[12/5]"
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
                    <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cover!.src} alt={cover!.alt}
                             className="absolute inset-0 w-full h-full object-cover" />
                        <div aria-hidden="true"
                             className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                        {needsVisibleCredit(spot) && (
                            <p className="absolute bottom-2 right-3 m-0 text-white/70 text-right"
                               style={{ fontSize: "10px", lineHeight: "14px" }}>
                                {/* Commons の写真は「写真: 作者 / ライセンス（文面へ）/ Wikimedia Commons（出典へ）」
                                    ——CC BY・CC BY-SA の表示条件（作者・ライセンスの URI・出典） */}
                                {cover!.licenseLabel ? (
                                    <>
                                        {isJa ? "写真: " : "Photo: "}{cover!.credit}{" / "}
                                        {cover!.licenseUrl ? (
                                            <a href={cover!.licenseUrl} target="_blank" rel="noopener noreferrer license"
                                               className="text-white/70 underline underline-offset-2">{cover!.licenseLabel}</a>
                                        ) : cover!.licenseLabel}
                                        {cover!.sourceUrl && (
                                            <>
                                                {" / "}
                                                <a href={cover!.sourceUrl} target="_blank" rel="noopener noreferrer"
                                                   className="text-white/70 underline underline-offset-2">Wikimedia Commons</a>
                                            </>
                                        )}
                                    </>
                                ) : (cover!.requiredCreditText || `Photo: ${cover!.credit}`)}
                            </p>
                        )}
                    </>
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
                    <p className={`m-0 mb-1.5 font-mono font-medium uppercase ${verified ? "text-accent" : "text-white/60"}`}
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
                    「地図で見る」は iOS では端末の地図アプリ、Web はサイトの撮影地マップ */}
                <div className="flex items-start gap-2.5 pb-6 border-b border-white/10">
                    <SaveSpotButton slug={spot.slug} name={spot.name} locale={isJa ? "ja" : "en"} kind="spot" variant="tile" />
                    <Link href={mapHref} prefetch={false}
                          className={`${TILE} ${TILE_OFF} flex-1 min-w-0`}
                          style={{ minHeight: 48, touchAction: "manipulation" }}>
                        <MapIcon className="w-5 h-5 flex-shrink-0" aria-hidden />
                        {isJa ? "地図で見る" : "View on map"}
                    </Link>
                    <button type="button" onClick={handleShare}
                            className={`${TILE} ${TILE_OFF} flex-1 min-w-0`}
                            style={{ minHeight: 48, touchAction: "manipulation" }}>
                        <ArrowUpOnSquareIcon className="w-5 h-5 flex-shrink-0" aria-hidden />
                        {isJa ? "シェア" : "Share"}
                    </button>
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

                        {/* ── 5. 撮影ガイド ──────────────────
                            **事実ではなく運営のアドバイス**なので、出典は求めない
                            （代わりに「撮影ガイド」という見出しで事実と分ける） */}
                        {((spot.seasonalGuide ?? []).length > 0
                            || (spot.timeOfDayGuide ?? []).length > 0
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

                                {(spot.timeOfDayGuide ?? []).length > 0 && (
                                    <div className="mb-5">
                                        <p className="m-0 mb-2 text-white/60" style={{ fontSize: "12px" }}>
                                            {isJa ? "時間帯" : "By time of day"}
                                        </p>
                                        <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: "none" }}>
                                            {spot.timeOfDayGuide!.map((t) => (
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
                                <ul className="m-0 p-0 flex flex-col gap-1.5" style={{ listStyle: "none" }}>
                                    {nearby.map((n) => (
                                        <li key={n.slug}>
                                            <Link href={`/spots/${n.slug}`} prefetch={false}
                                                  className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                                <span className="block text-white" style={{ fontSize: "13px" }}>{n.name}</span>
                                                {n.region && <span className="block text-white/55" style={{ fontSize: "11px" }}>{n.region}</span>}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* ── 10. 同じ県のほかのスポット（人が確かめたものだけ）──
                            手で選んだ「近くの撮影スポット」とは別。見出しは関係を名乗らない */}
                        {sameArea && sameArea.spots.length > 0 && (
                            <section className="mb-7" aria-labelledby="spot-same-area">
                                <Head id="spot-same-area">{isJa ? `${sameArea.label}の撮影スポット`
                                    // 英語の国名は台帳に無い（海外の区画名 Outside Japan では中身と合わない）
                                    : spot.region?.country === "日本" && area ? `More spots in ${area.nameEn}` : "More photo spots"}</Head>
                                <ul className="m-0 p-0 flex flex-col gap-1.5" style={{ listStyle: "none" }}>
                                    {sameArea.spots.map((n) => (
                                        <li key={n.slug}>
                                            <Link href={`/spots/${n.slug}`} prefetch={false}
                                                  className="block rounded-lg px-2 py-1.5 -mx-2 hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                                <span className="block text-white" style={{ fontSize: "13px" }}>{n.name}</span>
                                                {n.region && <span className="block text-white/55" style={{ fontSize: "11px" }}>{n.region}</span>}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
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
