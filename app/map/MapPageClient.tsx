"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import PhotoMap, { photosWithCoords, type MapSelection } from "../components/PhotoMap";
import MapPhotoSheet from "./MapPhotoSheet";
import MapControls, { type MapView } from "./MapControls";
import MapPhotoList from "./MapPhotoList";
import { collectionPath, slugify } from "../../lib/utils/collections";
import {
    filterMapPhotos, mapCategories, photosInBounds, type MapBounds,
} from "../../lib/utils/mapFilter";
import type { SpotPin } from "../../lib/data/spotLink";
import MapSpotSheet from "./MapSpotSheet";
import MapSpotList from "./MapSpotList";

/**
 * 撮影地マップ（/map）。位置情報を持つ公開写真を地図に載せる。
 *
 * 座標は約1km精度（アップロード側の `sanitizeCoords`）か、地名から引いた
 * おおよその位置（`geoApprox`）。どちらも「街」までしか分からない粒度で、
 * 地名（テキスト）として既に公開している以上の情報は出ない。
 *
 * ## 画面の組み方（最終版モック `06-map.jpg` ＋ owner の指示書 §14）
 *
 * - **1024px 未満**（スマホ）は**モックのとおり**——検索欄 → 絞り込みのチップ
 *   → 地図／リストの切り替え → 地図（またはリスト）→ 押したピンのシート。
 *   見出しは**読み上げにだけ出す**（モックの画面に題は無い。検索欄が先頭）
 * - **1024px 以上**（PC）は**左に検索と一覧・右に地図**。モックを横に
 *   引き伸ばさない。切り替えの必要が無いので「地図／リスト」は出さない
 */
export default function MapPageClient({ spots }: { spots: readonly SpotPin[] }) {
    const { locale } = useLocale();
    const { photos, loaded, failed } = usePhotos();
    const en = locale === "en";

    const geo = useMemo(() => photosWithCoords(photos.filter((p) => p.published !== false)), [photos]);
    const approxCount = useMemo(() => geo.filter((p) => p.geoApprox).length, [geo]);

    // 絞り込み。**どれも画面の中だけ**（URL には持たない——`/map` は
    // `#zoom/lat/lng` を読む側で、履歴には触らない約束がある）
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [view, setView] = useState<MapView>("map");
    /** 「このエリアを検索」で決めた範囲。`null` は指定なし */
    const [area, setArea] = useState<MapBounds | null>(null);

    // チップは**いま地図に在るカテゴリだけ**（決め打ちで並べない）。
    // 数えるのは語と範囲で絞る前——絞るたびにチップが消えると、
    // 元に戻す手段が無くなる
    const categories = useMemo(() => mapCategories(geo), [geo]);

    const filtered = useMemo(
        () => photosInBounds(filterMapPhotos(geo, { query, category, locale }), area),
        [geo, query, category, locale, area],
    );

    // ピンを押すと画面下のシートに出す（以前は地図の中のポップアップ）。
    //
    // **持つのは ID と何枚目かだけ。** 写真の中身は毎回 `geo` から引く。
    // 押した瞬間の写真オブジェクトを抱えると、開いている間に一覧が
    // 更新されたとき（手元の断面を API の一覧が置き換える・編集・非公開）
    // 古い題や、もう地図に無い写真を出し続ける。ID から引き直せば、
    // 消えた写真はシートから落ち、全部消えればシートごと畳まれる
    // （描画のときに決めるので `setState` は要らない）
    const [selection, setSelection] = useState<{ ids: string[]; index: number } | null>(null);
    /**
     * 押した公式スポットのスラッグ。
     *
     * **写真の選択とは別に持ち、同時には出さない**——シートは画面の同じ場所に
     * 出るので、2枚重なると下が読めない。押した方を採り、もう片方を閉じる。
     */
    const [spotSlug, setSpotSlug] = useState<string | null>(null);
    const onSelect = useCallback((s: MapSelection | null) => {
        setSelection(s ? { ids: s.photos.map((p) => p.id), index: s.index } : null);
        if (s) setSpotSlug(null);
    }, []);
    const onSelectSpot = useCallback((slug: string) => {
        setSpotSlug(slug);
        setSelection(null);
    }, []);
    const closeSpot = useCallback(() => setSpotSlug(null), []);
    const closeSheet = useCallback(() => setSelection(null), []);
    const setIndex = useCallback((index: number) => {
        setSelection((s) => (s ? { ...s, index } : s));
    }, []);
    const sheetPhotos = useMemo(() => {
        if (!selection) return [];
        const byId = new Map(geo.map((p) => [p.id, p]));
        return selection.ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    }, [selection, geo]);
    const sheet = selection && sheetPhotos.length > 0 ? { photos: sheetPhotos, index: selection.index } : null;
    /**
     * 開いている公式スポット。**写真と同じく、スラッグから引き直す。**
     * 台帳から下りた（下書きに戻った・条件を満たさなくなった）スポットは
     * 次のビルドで `spots` から消えるので、シートも自然に畳まれる。
     */
    const spotSheet = useMemo(
        () => (spotSlug ? spots.find((sp) => sp.slug === spotSlug) ?? null : null),
        [spotSlug, spots],
    );

    // シートに出す「同じ撮影地の別の写真」と「この場所の写真を見る」の行き先。
    // **撮影地の文字列が完全に同じものだけ**を同じ場所とみなす（集約ページの
    // 「緩い一致」はここでは使わない——「パリ」と「パリ, フランス」を寄せると、
    // 地図の上では別のピンの写真が「この場所」として並ぶ）
    const current = sheet ? sheet.photos[Math.min(Math.max(sheet.index, 0), sheet.photos.length - 1)] : null;
    const currentLocation = (current?.location ?? "").trim();
    const sameLocation = useMemo(() => {
        if (!currentLocation) return [];
        return geo.filter((p) => (p.location ?? "").trim() === currentLocation);
    }, [geo, currentLocation]);
    const related = useMemo(
        () => sameLocation.filter((p) => p.id !== current?.id),
        [sameLocation, current?.id],
    );
    // `/location/<スラッグ>` は**2枚から**索引に載る（`MIN_INDEXABLE_LOCATION`）が、
    // 1枚でもページ自体は在るので導線は出す
    const locationSlug = currentLocation ? slugify(currentLocation, "location") : "";
    const relatedHref = locationSlug ? collectionPath("location", locationSlug) : "";

    // **押しても一覧へ切り替えない。** 最初は切り替えていたが、実ブラウザで
    // 触ると地図ごと消えるのが驚きだったうえ、「範囲の指定を解除」は地図の上に
    // 在るので**押した直後に届かなくなっていた**（Playwright で実測: 押した
    // あと地図の列が `display: none` になり、解除のボタンが見えない）。
    // いまは絞るだけ——上の断り（「このエリアの写真 N件」）が出て、
    // 一覧で見たければ「リスト」を押す
    const onSearchArea = useCallback((b: MapBounds | null) => setArea(b), []);

    const emptyHint = query || category !== "all" || area
        ? (en ? "No photos match. Try clearing the search or filters." : "該当する写真がありません。検索や絞り込みを外してみてください。")
        : undefined;

    // 位置情報のある写真が1枚も無い／まだ届いていないときは、地図も操作も出さない
    const nothingToShow = geo.length === 0;

    return (
        <main className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-28 lg:px-6">
            {/* **見出しは読み上げにだけ。** モックの画面に題は無く、先頭は検索欄。
                消してしまうと読み上げの人がこのページが何かを掴めないので残す */}
            <h1 className="sr-only">{en ? "Map" : "撮影地マップ"}</h1>

            {nothingToShow && !loaded ? (
                // **まだ届いていないなら「まだ」と言わない。** 手元の断面に座標が
                // 無いだけで、API の一覧には有ることがある（実測: 4秒の回線で
                // 「0枚・まだありません」が出たあと 18枚に変わった）
                // `aria-busy` は「更新中だから待て」の合図。失敗の告知には付けない
                // （付いたままだと支援技術が読み上げを抑える）
                <div className="rounded-2xl ring-1 ring-white/10 bg-white/5 px-6 py-16 text-center text-white/60 text-sm" aria-busy={!failed}>
                    {failed
                        ? (en ? "Couldn't load photos. Check your connection and try again." : "写真を読み込めませんでした。通信を確かめて、もう一度お試しください。")
                        : (en ? "Loading…" : "読み込み中…")}
                </div>
            ) : nothingToShow ? (
                // **0枚は「まだ」と言う。** 位置情報は GPS 付きの写真を上げたとき、
                // または撮影地名から補ったとき・編集画面で選んだときに付く。
                // 無い状態を「地図が壊れた」と読ませない
                <div className="rounded-2xl ring-1 ring-white/10 bg-white/5 px-6 py-16 text-center text-white/60 text-sm">
                    <p>{en ? "No photos with location yet." : "位置情報のある写真はまだありません。"}</p>
                    <p className="mt-2 text-white/60">
                        {en
                            ? "Photos uploaded with GPS data, or given a place from the edit screen, appear here (rounded to about 1 km)."
                            : "GPS 付きの写真をアップロードするか、編集画面の「地図に出す位置」で場所を選ぶと、約1km の粒度でここに載ります。"}
                    </p>
                    <Link href={ROUTES.HOME} prefetch={false} className="inline-block mt-6 text-link hover:text-white underline underline-offset-4">
                        {en ? "Back to gallery" : "ギャラリーに戻る"}
                    </Link>
                </div>
            ) : (
                <div className="lg:flex lg:items-start lg:gap-6">
                    {/* 左（PC）／上（スマホ）: 検索・チップ・切り替え・一覧 */}
                    <div className="lg:w-[360px] lg:flex-shrink-0">
                        <MapControls
                            query={query}
                            onQueryChange={setQuery}
                            categories={categories}
                            category={category}
                            onCategoryChange={setCategory}
                            view={view}
                            onViewChange={setView}
                            locale={locale}
                        />

                        {/* 範囲を絞っているときの断り＋解除。モックの
                            「このエリアの写真／12件の写真／×」に当たる */}
                        {area && (
                            <div
                                className="flex items-center justify-between rounded-2xl bg-surface-2/70 ring-1 ring-white/10 text-white"
                                style={{ marginTop: "12px", padding: "8px 8px 8px 14px", gap: "8px", fontSize: "13px" }}
                                data-testid="map-area-note"
                            >
                                <span>
                                    {en
                                        ? `This area · ${filtered.length} photo${filtered.length === 1 ? "" : "s"}`
                                        : `このエリアの写真 ${filtered.length}件`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setArea(null)}
                                    className="flex-shrink-0 rounded-full text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                    style={{ minWidth: "32px", minHeight: "32px", touchAction: "manipulation" }}
                                    aria-label={en ? "Clear this area" : "範囲の指定を解除"}
                                >
                                    ×
                                </button>
                            </div>
                        )}

                        {/* 押したピンの中身。**地図の中には描かない**ので、地図の高さに
                            縛られない。**左の列の DOM に置く**のは PC のため
                            ——1024px 以上では普通の流れに戻り、一覧の上の板になる
                            （地図に重ねると右の操作ボタンと「このエリアを検索」を
                            覆う。実ブラウザで測って分かった）。スマホでは
                            `position: fixed` なので、DOM のこの位置は効かない */}
                        {/* 公式スポットのシート。**写真のシートと同じ場所**に出るので、
                            両方は出さない（押した方を採る＝`onSelect` / `onSelectSpot`）。
                            部品は分けてある——公式スポットには写真のサムネも撮影日も
                            説明も無く、1つに詰めると片方では必ず半分が `null` になる */}
                        {spotSheet && (
                            <MapSpotSheet spot={spotSheet} onClose={closeSpot} locale={locale} />
                        )}

                        {sheet && (
                            <MapPhotoSheet
                                photos={sheet.photos}
                                index={sheet.index}
                                onIndexChange={setIndex}
                                onClose={closeSheet}
                                locale={locale}
                                related={related}
                                relatedTotal={sameLocation.length}
                                relatedHref={relatedHref}
                            />
                        )}

                        {/* 何枚が残っているか。**「まだ届いていない」ときは
                            この枝に入らない**ので、ここの 0 は「絞り込みで
                            消えた 0」だけ（実測: 4秒の回線で「0枚」→「18枚」と
                            出ていたのを分けた経緯がある）。

                            **絞っているときは分数で出す。** 「位置情報のある写真 5枚」
                            のまま数だけ絞られた値にすると、**サイト全体で5枚しか
                            位置情報を持っていない**と読める嘘になる */}
                        <p className="text-white/60 tabular-nums" style={{ marginTop: "12px", fontSize: "12px" }} data-testid="map-count">
                            {filtered.length === geo.length
                                ? (en
                                    ? `${geo.length} photo${geo.length === 1 ? "" : "s"} with location`
                                    : `位置情報のある写真 ${geo.length}枚`)
                                : (en
                                    ? `${filtered.length} of ${geo.length} shown`
                                    : `${geo.length}枚中 ${filtered.length}枚を表示`)}
                        </p>

                        {/* 公式撮影スポットの一覧。**タブで写真と分けない**
                            ——地図は1つで、公式スポットのピンと写真のピンが
                            同時に立つ。ここは「地図を操作できない人のための
                            ガイドへの経路」で、`MapPhotoList` と同じ役目。
                            **絞り込み（語・カテゴリ・範囲）には連動しない**
                            ——あれは写真の値を見る仕組みで、台帳は別の持ち物 */}
                        <MapSpotList spots={spots} locale={locale} />

                        {/* 一覧。**PC では常に出す**（切り替えはスマホだけ）。

                            **以前あった `sr-only` の一覧は、これに置き換えた。**
                            両方置くと同じリンクが2組 DOM に並び、片方だけ直す事故が
                            起きる。地図を操作できない人（読み上げ・キーボード）の
                            経路が細るのではないか——を実ブラウザで確かめた
                            （Chromium・390x844）:

                                ピンの tabindex / role           0 / button
                                読み上げに出る名前               撮影地（例「フィンランド」）
                                Tab で最初のピンに届くまで       14回
                                Enter でシートが開く             開く

                            単独のピンは `circleMarker`（**フォーカスできない**）から
                            `Marker`（`keyboard: true`）に変えたので、**経路はむしろ
                            増えている**——地図の上を Tab で回れるようになったうえ、
                            「リスト」を押せばこの一覧に来られる */}
                        <div
                            className={`${view === "list" ? "" : "hidden lg:block"} lg:overflow-y-auto lg:max-h-[calc(100vh-300px)] lg:pr-1`}
                            style={{ marginTop: "8px" }}
                        >
                            <MapPhotoList photos={filtered} locale={locale} emptyHint={emptyHint} />
                        </div>
                    </div>

                    {/* 右（PC）／下（スマホ）: 地図 */}
                    <div className={`${view === "map" ? "" : "hidden lg:block"} lg:flex-1 lg:min-w-0`} style={{ marginTop: "12px" }}>
                        {/* **スマホの下限は「画面に見えている高さ」を超えない。** 固定の 320px
                            だと、横向きの iPhone（高さ 390px）ではヘッダーとタブバーを引いた
                            見える高さ（約240px）より高くなり、地図の上の1本指はページでなく
                            地図を動かすので、地図の下へ抜けにくかった */}
                        <PhotoMap
                            photos={filtered}
                            locale={locale}
                            onSelect={onSelect}
                            selectedId={current?.id ?? null}
                            onSearchArea={onSearchArea}
                            areaActive={!!area}
                            sheetOpen={!!sheet || !!spotSheet}
                            spots={spots}
                            onSelectSpot={onSelectSpot}
                            selectedSpotSlug={spotSheet?.slug ?? null}
                            className="h-[62vh] min-h-[min(320px,calc(100dvh_-_var(--header-h)_-_var(--bottom-bar-h,57px)_-_24px))] lg:h-[calc(100vh-200px)] lg:min-h-[480px]"
                        />

                        {/* 位置の出どころの断り。**小さい字なので色は薄くしない**
                            （white/40 は黒地で約3.66:1 ＝ 小さい文字の基準 4.5:1 に届かない） */}
                        <p className="mt-3 text-xs text-white/60">
                            {en
                                ? "Pins are rounded to about 1 km. "
                                : "ピンの位置は約1km の粒度に丸めています。"}
                            {approxCount > 0 && (en
                                ? `${approxCount} pin${approxCount === 1 ? "" : "s"} are approximate (from place names).`
                                : `${approxCount}枚は地名から引いたおおよその位置です。`)}
                        </p>

                    </div>
                </div>
            )}
        </main>
    );
}
