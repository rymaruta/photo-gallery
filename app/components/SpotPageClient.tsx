"use client";

import React from "react";
import Link from "next/link";
import { MapPinIcon } from "@heroicons/react/24/outline";
import GalleryGrid from "./GalleryGrid";
import { GRID_SIZES_6XL } from "./gridSizes";
import SaveSpotButton from "./SaveSpotButton";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { formatStoredDateTime } from "../../lib/utils/photoDate";
import { collectionPath, slugify } from "../../lib/utils/collections";
import type { Photo } from "@/lib/data/photos";
import type { SpotCoords, SpotFacts } from "@/lib/utils/spot";

type SpotLink = { label: string; count: number; path: string };
type NearbyLink = SpotLink & { km: number; approx: boolean };

type Props = {
    slug: string;
    name: string;
    heading: string;
    description: string;
    breadcrumb: string;
    photos: Photo[];
    nearbyPhotos: Photo[];
    facts: SpotFacts;
    coords: SpotCoords | null;
    broader: SpotLink[];
    narrower: SpotLink[];
    nearby: NearbyLink[];
    related: SpotLink[];
};

type TabKey = "overview" | "photos" | "map";

/**
 * 撮影スポット詳細。
 *
 * ## クチコミは作らない
 *
 * モックには無いが、この手の画面には付き物なので明記しておく——
 * **投稿する口も、荒れたものを裁く仕組みも持っていない**。枠だけ置くと
 * 「いつまでも0件の欄」か「誰も見ていない投稿欄」のどちらかになる。
 *
 * ## 概要に文章を作らない
 *
 * 出すのは `spotFacts` が**数えた結果**と、写真が持っていた値そのものだけ
 * （owner の指示）。紹介文は生成しない。人気の根拠を持っていないので
 * 「最近人気」のような肩書きも名乗らない。
 *
 * ## タブは全部 DOM に残す
 *
 * `/location/*` は**検索に載っているページ**。切り替えで中身を差し替えると、
 * 本文がその時の状態でしか HTML に出ない。3つとも描いて `hidden` で隠す
 * （画面に出るのは1つ、HTML には3つとも在る）。
 *
 * **初期タブは「写真」。** このページは今まで写真グリッドが本体で、
 * 既に索引に載っている。既定を「概要」にすると、**20ページぶんの
 * 最初に見えるものが変わる**——`CLAUDE.md` の「デザインは勝手に変えない」に
 * 倒して、既定は今まで見えていたものを保つ。タブの並びはモックの通り。
 * JS が動かない環境でも写真が見える、という副産物もある。
 */
export default function SpotPageClient({
    slug, name, heading, description, breadcrumb,
    photos, nearbyPhotos, facts, coords, broader, narrower, nearby, related,
}: Props) {
    const { locale } = useLocale();
    const en = locale === "en";
    const [tab, setTab] = React.useState<TabKey>("photos");

    const TABS: Array<[TabKey, string]> = [
        ["overview", en ? "Overview" : "概要"],
        ["photos", en ? "Photos" : "写真"],
        ["map", en ? "Map" : "地図"],
    ];

    /**
     * 矢印キーでタブを移る（`Home` / `End` も）。移った先にフォーカスを送る
     * ——送らないと、見た目だけ動いて読み上げの位置が置いていかれる。
     * 端では折り返す（WAI-ARIA の tabs の作法）。
     */
    const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const keys = TABS.map(([k]) => k);
        const at = keys.indexOf(tab);
        let next: number;
        switch (e.key) {
            case "ArrowRight": next = (at + 1) % keys.length; break;
            case "ArrowLeft": next = (at - 1 + keys.length) % keys.length; break;
            case "Home": next = 0; break;
            case "End": next = keys.length - 1; break;
            default: return;
        }
        // 矢印での横スクロールを起こさない
        e.preventDefault();
        setTab(keys[next]);
        document.getElementById(`spot-tab-${keys[next]}`)?.focus();
    };

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 pb-28">
            <nav aria-label="パンくずリスト" className="mb-3 text-sm text-white/60">
                <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                <span className="mx-2" aria-hidden>/</span>
                <span className="text-white/80">{breadcrumb}</span>
            </nav>

            {/* 見出し（スポット名）。**`heading` はそのまま使う**
                （「◯◯の写真」という既存の文言。title・JSON-LD と同じ字） */}
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">{heading}</h1>

            {/* 所在地。**推測しない**——同じ一覧にある「この場所を含む撮影地」
                だけを出す（書かれている字から読み取れるぶん）。
                無ければ何も出さない（国名を当てに行かない）。

                **`/` 区切りの住所のようには描かない。** 一度そう描いていたが、
                この並びは**広い順であることを保証できない**——
                `photoIsInLocation` は字の包含なので「パリ」と「フランス」は
                互いに含まず、どちらが広いかをこのデータは知らない。
                住所の形に描くと、知らない順序を主張することになる。 */}
            {broader.length > 0 && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
                    <MapPinIcon className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="sr-only">{en ? "Part of" : "この場所を含む撮影地"}</span>
                    {broader.map((b) => (
                        <Link
                            key={b.path}
                            href={b.path}
                            prefetch={false}
                            className="hover:text-white/90 underline underline-offset-4 decoration-white/20"
                        >
                            {b.label}
                        </Link>
                    ))}
                </p>
            )}

            <div className="mb-5">
                <SaveSpotButton slug={slug} name={name} locale={locale} />
            </div>

            {/* タブ。**クチコミは無い**（理由は上の docstring）。

                **`role="tablist"` を名乗るなら、矢印キーで動けること。**
                名乗るだけだと、読み上げは「タブ 1/3」と案内するのに矢印が
                効かない——案内された通りに操作できない方が、ただのボタンの
                並びより悪い。`aria-selected` を持つものだけ Tab で止まる
                （roving tabindex）のも同じ作法の片割れ。 */}
            <div
                role="tablist"
                aria-label={en ? "Spot sections" : "スポットの内容"}
                className="flex gap-1 border-b border-white/10 mb-5"
                onKeyDown={onTabKeyDown}
            >
                {TABS.map(([key, text]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`spot-tab-${key}`}
                        aria-selected={tab === key}
                        aria-controls={`spot-panel-${key}`}
                        // **選ばれていないタブは Tab で止まらない**（矢印で移る）
                        tabIndex={tab === key ? 0 : -1}
                        onClick={() => setTab(key)}
                        // 44px の押せる高さを px で書く（`96eb86db`）
                        style={{ touchAction: "manipulation", minHeight: 44 }}
                        className={`px-4 text-sm font-semibold transition border-b-2 -mb-px ${
                            tab === key
                                ? "border-white text-white"
                                : "border-transparent text-white/50 hover:text-white/80"
                        }`}
                    >
                        {text}
                    </button>
                ))}
            </div>

            {/* ── 概要 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-overview" aria-labelledby="spot-tab-overview" hidden={tab !== "overview"}>
                {/* **その場所の説明**は、既にあるページ固有の文（`collectionCopy`）。
                    ここで新しい紹介文を作らない */}
                <p className="text-sm text-white/70 mb-5">{description}</p>

                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                    <Fact label={en ? "Photos" : "写真"} value={`${facts.photoCount}${en ? "" : "枚"}`} />
                    <Fact
                        label={en ? "Photographers" : "撮った人"}
                        value={facts.photographerCount > 0 ? `${facts.photographerCount}${en ? "" : "人"}` : null}
                    />
                    {/* **撮影期間は `date` を持つ写真だけから。** 投稿日は使わない
                        （実データは30枚中8枚しか撮影日を持たず、残りは
                        アップロードした年に固まっている——「撮影期間」として
                        出すと嘘になる） */}
                    <Fact
                        label={en ? "Shot between" : "撮影時期"}
                        value={facts.period
                            ? facts.period.from === facts.period.to
                                ? formatStoredDateTime(facts.period.from, locale)
                                : `${formatStoredDateTime(facts.period.from, locale)} 〜 ${formatStoredDateTime(facts.period.to, locale)}`
                            : null}
                    />
                </dl>

                {facts.cameras.length > 0 && (
                    <Chips
                        heading={en ? "Cameras used here" : "ここで使われたカメラ"}
                        // **`collectionPath` は正規化しない**（デコードして1回
                        // エンコードするだけ）。生の機種名を渡していたので
                        // `/camera/SONY%20ILCE-7M3` を出していたが、実体は
                        // `out/camera/sony-ilce-7m3.html`——`dynamicParams = false`
                        // の静的書き出しなので、**カメラのチップが出る全ページで
                        // ハード404**だった（実ビルドの `out/location/パリ.html` で確認）。
                        // 隣のタグが `t.slug` を渡しているのと同じ形に揃える
                        items={facts.cameras.map((c) => ({
                            key: c.name, label: c.name, count: c.count,
                            path: collectionPath("camera", slugify(c.name, "camera")),
                        }))}
                    />
                )}
                {facts.tags.length > 0 && (
                    <Chips
                        heading={en ? "Tags on these photos" : "この場所の写真に付いたタグ"}
                        items={facts.tags.map((t) => ({
                            key: t.slug, label: `#${t.label}`, count: t.count, path: collectionPath("tag", t.slug),
                        }))}
                    />
                )}

                {narrower.length > 0 && (
                    <Chips
                        heading={en ? "Spots within" : "この場所の中の撮影地"}
                        items={narrower.map((n) => ({ key: n.path, label: n.label, count: n.count, path: n.path }))}
                    />
                )}
            </section>

            {/* ── 写真 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-photos" aria-labelledby="spot-tab-photos" hidden={tab !== "photos"}>
                <p className="mb-4 text-sm text-white/70">
                    {description}
                    <span className="ml-1 whitespace-nowrap text-white/50">（{photos.length}枚）</span>
                </p>
                <GalleryGrid photos={photos} locale={locale} sizes={GRID_SIZES_6XL} />

                {/* **写真が少ないページにだけ。** 既存の `CollectionPage` と同じ扱い */}
                {nearbyPhotos.length > 0 && (
                    <section className="mt-10 pt-5 border-t border-white/10">
                        <h2 className="text-sm font-semibold text-white/70 mb-3">
                            {en ? "You might also like" : "ほかにこんな写真も"}
                        </h2>
                        <GalleryGrid photos={nearbyPhotos} locale={locale} sizes={GRID_SIZES_6XL} />
                    </section>
                )}
            </section>

            {/* ── 地図 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-map" aria-labelledby="spot-tab-map" hidden={tab !== "map"}>
                {coords ? (
                    <>
                        <p className="text-sm text-white/70 mb-4">
                            {en
                                ? "Open the photo map to see this area."
                                : "撮影地マップでこのあたりを見られます。"}
                        </p>
                        <Link
                            href={ROUTES.MAP}
                            prefetch={false}
                            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-white/10 ring-1 ring-white/20 hover:bg-white/20 active:scale-95 transition"
                            style={{ touchAction: "manipulation", minHeight: 44 }}
                        >
                            <MapPinIcon className="w-5 h-5" aria-hidden />
                            {en ? "Open the map" : "撮影地マップを開く"}
                        </Link>
                        {/* **位置の出どころを断る。** `geoApprox` を正確な GPS と
                            区別する。座標は `sanitizeCoords` が約1kmに丸めた値で、
                            ここはそれを読むだけ（精度を上げ直さない）。
                            **小さい字なので色は薄くしない**（white/40 は黒地で
                            約3.7:1 ＝ 小さい文字の基準 4.5:1 に届かない） */}
                        <p className="mt-3 text-xs text-white/60">
                            {en ? "Positions are rounded to about 1 km. " : "位置は約1km の粒度に丸めています。"}
                            {coords.approx && (en
                                ? "This one is approximate (derived from the place name, not GPS)."
                                : "この場所の位置は、GPS ではなく地名から引いたおおよその位置です。")}
                        </p>
                    </>
                ) : (
                    // **「地図に出せる位置を持っていない」と言い切る。**
                    // 空の地図を出したり、地名から勝手に座標を当てたりしない
                    <p className="text-sm text-white/60">
                        {en
                            ? "No map position for this spot yet. Photos taken with GPS, or given a place from the edit screen, put it on the map."
                            : "この場所には、地図に出せる位置がまだありません。GPS 付きの写真を上げるか、編集画面で場所を選ぶと地図に載ります。"}
                        <Link href={ROUTES.MAP} prefetch={false} className="ml-1 text-sky-300 hover:text-sky-200 underline underline-offset-4">
                            {en ? "Open the map" : "撮影地マップを開く"}
                        </Link>
                    </p>
                )}
            </section>

            {/* ── 周辺のスポット（距離順）───────────────────────
                **タブの外に出す。** どのタブから来ても次へ行ける導線にする。
                座標を持つスポットどうしでしか出せないので、出ない断面がある */}
            {nearby.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {en ? "Nearby spots" : "周辺のスポット"}
                    </h2>
                    <ul className="flex flex-wrap gap-1.5">
                        {nearby.map((n) => (
                            <li key={n.path}>
                                <Link
                                    href={n.path}
                                    prefetch={false}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {n.label}
                                    {/* **距離の粒度を偽らない。** 元の座標が約1kmに
                                        丸めてあるので、小数第1位までしか出さない。
                                        推定に基づくぶんは「約」を付ける */}
                                    <span className="text-white/50 tabular-nums">
                                        {n.approx && (en ? "~" : "約")}{n.km < 10 ? n.km.toFixed(1) : Math.round(n.km)}km
                                    </span>
                                    <span className="text-white/60 tabular-nums">{n.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 同タイプの他ページへの相互リンク（**既存のまま**・孤立防止・SEO） */}
            {related.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {en ? "More locations" : "他の撮影地"}
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {related.map((r) => (
                            // **先読みしない**（一覧で何本も出るリンク。理由は
                            // `GalleryGrid` のカードのコメント）
                            <Link
                                key={r.path}
                                href={r.path}
                                prefetch={false}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {r.label}
                                <span className="text-white/50">{r.count}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}

/** 概要の1項目。**値が無ければ「—」と書く**（0 や推測で埋めない） */
function Fact({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2">
            <dt className="text-[11px] text-white/50">{label}</dt>
            <dd className="text-sm text-white/90 mt-0.5">{value ?? <span className="text-white/60">—</span>}</dd>
        </div>
    );
}

function Chips({ heading, items }: { heading: string; items: Array<{ key: string; label: string; count: number; path: string }> }) {
    return (
        <section className="mt-5">
            <h2 className="text-sm font-semibold text-white/70 mb-2">{heading}</h2>
            <div className="flex flex-wrap gap-1.5">
                {items.map((i) => (
                    <Link
                        key={i.key}
                        href={i.path}
                        prefetch={false}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                        style={{ touchAction: "manipulation" }}
                    >
                        {i.label}
                        <span className="text-white/50 tabular-nums">{i.count}</span>
                    </Link>
                ))}
            </div>
        </section>
    );
}
