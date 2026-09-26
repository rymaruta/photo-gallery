"use client";

import React from "react";
import Link from "next/link";
import type { Spot } from "@/lib/data/spots";
import type { Photo } from "@/lib/data/photos";
import { showsField, sourcesFor, needsVisibleCredit, usesMapHero, isVerified } from "@/lib/utils/spotGuide";
import { useLocale } from "@/app/i18n/context";
import { ROUTES } from "@/lib/routes";
import GalleryGrid from "./GalleryGrid";
import SaveSpotButton from "./SaveSpotButton";
import { ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";
import { shareUrl } from "@/lib/utils/share";
import { useToast } from "@/lib/hooks/useToast";

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

export default function SpotGuideClient({ spot, photos, nearby, locationPath }: Props) {
    const { locale } = useLocale();
    const isJa = locale !== "en";
    const mapHero = usesMapHero(spot);
    const cover = spot.coverImage;
    // **人が確かめたか。** false のあいだは「下書き（運営未確認）」の帯を出し、
    // 「情報の最終確認」を描かず、公式サイトのリンクを「未確認」と名乗らせる
    const verified = isVerified(spot);
    const region = [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ");
    const mapHref = spot.coords ? `${ROUTES.MAP}#14/${spot.coords.lat}/${spot.coords.lng}` : ROUTES.MAP;
    const { showToast } = useToast();
    // シェア（デザイン「13 スポット」の3つ目のボタン）。写真ページと同じ `shareUrl`
    // ——共有シートが無い／拒まれる環境ではコピーに落ち、結果で文言を出し分ける
    const handleShare = async () => {
        const url = `${window.location.origin}${ROUTES.SPOTS}/${spot.slug}`;
        const result = await shareUrl(url, spot.name);
        if (result === "copied") {
            showToast(isJa ? "リンクをクリップボードにコピーしました" : "Link copied to clipboard!", "success");
        } else if (result === "failed") {
            showToast(isJa ? "共有できませんでした" : "Could not share", "error");
        }
    };

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
                                {cover!.requiredCreditText || `Photo: ${cover!.credit}`}
                            </p>
                        )}
                    </>
                )}
            </section>

            <div className="mx-auto w-full max-w-5xl lg:max-w-6xl px-4 sm:px-6 md:px-8 pb-10">
                {/* ── 2. 基本情報 ─────────────────────────────── */}
                <header className="pt-5 pb-4">
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
                        {region && <span>{region}</span>}
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

                {/* ── 3. 主な操作 ──────────────────────────────
                    「行きたい」は**本物**（`spots#<uid>` に入る・上の注記）。
                    部品は撮影地ページと同じ `SaveSpotButton`——同じ見た目・
                    同じ3状態の扱いを2つ作らない */}
                <div className="flex flex-wrap items-start gap-2 pb-6 border-b border-white/10">
                    <SaveSpotButton slug={spot.slug} name={spot.name} locale={isJa ? "ja" : "en"} kind="spot" />
                    <Link href={mapHref} prefetch={false}
                          className="inline-flex items-center rounded-full bg-accent-fill text-white font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px", touchAction: "manipulation" }}>
                        {isJa ? "地図で見る" : "View on map"}
                    </Link>
                    <button type="button" onClick={() => void handleShare()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-surface ring-1 ring-line text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px", touchAction: "manipulation" }}>
                        <ArrowUpOnSquareIcon aria-hidden="true" style={{ width: "18px", height: "18px" }} />
                        {isJa ? "シェア" : "Share"}
                    </button>
                    {spot.officialWebsiteUrl && (
                        /* 下書きの URL は誰も開いていない。**未確認と名乗り、検索エンジンにも
                           推さない（nofollow）**——1,103 ドメインへ「公式」と名指しして渡さない */
                        <a href={spot.officialWebsiteUrl} target="_blank"
                           rel={verified ? "noopener noreferrer" : "noopener noreferrer nofollow"}
                           className="inline-flex items-center rounded-full bg-surface ring-1 ring-line text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                           style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px" }}>
                            {verified
                                ? (isJa ? "公式サイト" : "Official site")
                                : (isJa ? "公式サイト（未確認のリンク）" : "Official site (unchecked link)")}
                            {" "}<span aria-hidden="true" className="ml-1">↗</span>
                        </a>
                    )}
                </div>

                {/* PC は2段組。スマホは1列（スマホを横に引き伸ばさない） */}
                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10 lg:items-start">
                    <div className="min-w-0">
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

                        {/* ── 7. みんなが撮影した写真 ───────────
                            **ここだけがユーザー投稿に触れる節。** 0枚でも上は完成している */}
                        <section className="pt-8" aria-labelledby="spot-photos">
                            <Head id="spot-photos">{isJa ? "みんなが撮影した写真" : "Photos from the community"}</Head>
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
                                          className="mt-3 inline-flex items-center rounded-full bg-accent-fill text-white font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          style={{ fontSize: "14px", padding: "10px 18px", minHeight: "44px" }}>
                                        {isJa ? "ここで撮った写真を投稿する" : "Share a photo"}
                                    </Link>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* ── 右カラム（PC）＝所在地・地図・アクセス・周辺 ──────
                        **ホームの柱と同じ形**（`max-h` + `overflow-y-auto`）。
                        上だけで留めると、画面が低いときに下の節へ**永久に届かない**
                        （1280×600 で実測済み・`app/GalleryPageClient.tsx` の注記） */}
                    <aside className="pt-8 lg:pt-6 lg:sticky lg:top-[calc(var(--header-h)_+_16px)] lg:max-h-[calc(100vh_-_var(--header-h)_-_96px_-_env(safe-area-inset-bottom,0px))] lg:overflow-y-auto">
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
                        {verified && spot.verifiedAt && (
                            <p className="m-0 mt-5 text-white/60" style={{ fontSize: "11px" }}>
                                {isJa ? `情報の最終確認: ${spot.verifiedAt}（運営）` : `Last checked: ${spot.verifiedAt} (by our team)`}
                            </p>
                        )}
                    </aside>
                </div>
            </div>
        </main>
    );
}
