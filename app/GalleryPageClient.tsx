"use client";

import React from "react";
import { tagKey } from "@/lib/utils/collections";
import { categoryChipMap } from "@/lib/utils/categoryMap";
import FilterBar from "./components/FilterBar";
import DiscoverSections from "./search/DiscoverSections";
import SpotSearchResults from "./search/SpotSearchResults";
import DiscoverRail from "./components/DiscoverRail";
import FeaturedSections from "./components/FeaturedSections";
import { useLocale } from "./i18n/context";
import useGallery from "../lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import { GRID_SIZES_SEARCH, GRID_COLUMNS_SEARCH } from "./components/gridSizes";
import GalleryModal from "./components/GalleryModal";
import SearchParamWatcher from "./components/SearchParamWatcher";
import { resolveShortPhotoId } from "@/lib/utils/shortPhotoLink";
import { usePhotos } from "../lib/hooks/usePhotos";
import { useToast } from "../lib/hooks/useToast";
import { useAuth } from "./auth/context";
import TimelineFeed from "./components/TimelineFeed";
import HomeMosaic from "./components/HomeMosaic";
import { EmptyState } from "./components/StateViews";
import HomeTopCards from "./components/HomeTopCards";
import SpotsEntry from "./components/SpotsEntry";
import type { HomeSeasonal } from "../lib/data/spotTopics";
import { useMySaves } from "../lib/hooks/useMySaves";
import { nextTabIndex } from "../lib/utils/tabKeys";
import { TAB_ON, TAB_OFF, TAB_BASE, TAB_ROW } from "./components/tabStyles";
import Link from "next/link";
import { ROUTES } from "../lib/routes";
import { CHIP_ON, CHIP_OFF, CHIP_SIZE, CHIP_HIT } from "./components/chipStyles";

// フィルタバーに出すタグ数の上限（枚数の多い順）。残りは検索で辿る
const POPULAR_TAG_LIMIT = 10;

/** ホームで優先して読む枚数。**大きい1枚＋最初の2枚の段＝3枚**（`HomeMosaic`）。
 *  2枚だと同じ段の右だけ遅れて出る */
const HOME_PRIORITY_COUNT = 3;

/**
 * ホームのタブ（おすすめ／フォロー中／新着）。**順番が矢印キーの順番**。
 * 3つとも同じ1つの面を入れ替えるので、`aria-controls` の行き先も1つ
 * （`role="tabpanel"` はその面に付ける）。
 */
const HOME_TABS = [
    { key: "featured", ja: "おすすめ", en: "For you" },
    { key: "following", ja: "フォロー中", en: "Following" },
    { key: "all", ja: "新着", en: "New" },
] as const;
const HOME_PANEL_ID = "home-tabpanel";

/**
 * **ホームの PC は「左に写真の並び（`HomeMosaic`）＋右の柱」**（owner の指示書 4・11・17:
 * 「PCではスマートフォン画面をそのまま横に引き伸ばすのではなく、
 * Webサイトとして最適なレイアウトを設計してください」）。
 *
 *   < 1024px … 写真の並びだけ（iOS の `HomeMosaic`・大きく1枚 → 2枚 → 2枚）
 *   ≥ 1024px … 左にフィード（**40rem＝640px**）／右に**発見の柱**（余りぜんぶ）
 *
 * **空いた横を埋めるのは別の中身。** スマホでは下部タブの「さがす」で
 * 辿る面を、PC では同じ画面に出す（柱の行き先も「さがす」の検索結果）。
 *
 * ## 余白の詰め方（2026-09-22・owner の指示）
 *
 * owner:「ホームの本文が 576px に制限され、1280px 幅で左右に大きな余白が
 * 残る問題を解消すること。ただし**無理に画面幅いっぱいへ引き伸ばさない**。
 * 中央フィードと右サイドバーのバランスを整える」。
 *
 *     画面   容器            フィード ＋ 隙間 ＋ 柱      画面に対して
 *     1024   1024−64=960     640 + 32 + 288 = 960        94%（余白 0）
 *     1152   1152−64=1088    640 + 32 + 416 = 1088       94%
 *     1280   1152 で頭打ち   同上                        85%（前は 72.5%）
 *     1920   同上            同上                        57%
 *
 * ⚠️ **フィードを 640px より広げない。** `Thumb` の派生は 512w までなので、
 * 箱を広げるほど引き伸ばしになる（`MOSAIC_HERO_SIZES` と `SPOT_HERO_SIZES` の
 * doc に同じ線が引いてある）。**「引き伸ばさない」は owner の言葉でもある。**
 *
 * **柱は `1fr`（余りぜんぶ）にする。** 固定幅にして `justify-center` で
 * 寄せると、見出し・タブと本文の左端が 16px ずれる
 * （実測: 見出し x=160 / カード x=176）。余りを柱に渡せば両端が揃う。
 */
/**
 * タブが入れ替える面。**`aria-controls` の行き先**（`role="tab"` が
 * 指す先が無いと、読み上げがタブから中身へ飛べない）。
 *
 * **3つの枝それぞれを包む**（同時に描かれるのは1つだけなので id は重複しない）。
 * 外側をまとめて包まないのは、`surface === "search"` の枝まで
 * 「ホームのタブの面」にしてしまうため。
 */
type SearchScopeKey = "all" | "photos" | "tags" | "places";
/** 「さがす」の対象のチップ（iOS の `SearchScope.allCases` の順） */
const SEARCH_SCOPES: ReadonlyArray<{ key: SearchScopeKey | "people"; ja: string; en: string }> = [
  { key: "all", ja: "すべて", en: "All" },
  { key: "photos", ja: "写真", en: "Photos" },
  { key: "people", ja: "人", en: "People" },
  { key: "tags", ja: "タグ", en: "Tags" },
  { key: "places", ja: "撮影地", en: "Places" },
];

function HomePanel({ scope, children }: { scope: string; children: React.ReactNode }) {
  return <div id={HOME_PANEL_ID} role="tabpanel" aria-labelledby={`home-tab-${scope}`}>{children}</div>;
}

function HomeColumns({ rail, children }: { rail: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-8 lg:items-start">
      <div className="max-w-xl mx-auto lg:mx-0 lg:max-w-none">{children}</div>
      {/* **狭い画面には出さない。** スマホの「さがす」は下部タブの別の面で、
          ここに足すとモックに無いものが1画面に増える。

          **高さを画面に収める。** 貼り付いたまま画面より高くなると、
          下の節（機材）が**どうやっても読めない**——本文を送っても柱は
          動かないので、届く手段が1つも無い（レビューが 1280×600 で計測）。
          引くのはヘッダー ＋ 上の余白 16 ＋ 下部タブ（`--bottom-bar-h`・浮いた
          カプセル62＋下の隙間22、safe-area 込みの実寸）＋ 下の余白 16。
          下部タブを決め打ちの数で引くと、形が変わったとき柱がタブの裏に潜る
          （57px の頃の「96px」のままカプセルにしたら 4px 潜った）。
          **`overflow-y-auto` を付けられるのはこちらだけ**——「さがす」の
          柱は並び替えの一覧が `absolute` で吊り下がるので、切り取る箱を
          作ると隠れる */}
      <aside className="hidden lg:block lg:sticky lg:top-[calc(var(--header-h)_+_16px)] lg:max-h-[calc(100vh_-_var(--header-h)_-_var(--bottom-bar-h,84px)_-_32px)] lg:overflow-y-auto">{rail}</aside>
    </div>
  );
}

type Props = {
  /**
   * どの面として描くか。
   *
   * **1つの部品のまま出し分ける。** 2つに割ると `?photo=` の扱い（消された
   * 写真・届く前・絞り込みの解除・トースト。この画面でいちばん手を入れた
   * 100行）を複製することになる。違うのは見せ方だけで、写真の一覧・
   * 絞り込みの状態・集約の数え上げは同じものを見ている。
   *   `home`   … タブ（おすすめ／フォロー中／新着）＋写真の並び（新着は `HomeMosaic`）
   *   `search` … 絞り込み＋件数＋サムネのグリッド
   */
  surface?: "home" | "search";
  /**
   * ホームの「いまの季節の撮影スポット」（ビルド時にサーバーが選んだ数件・`homeSeasonalSpots`）。
   * 台帳はクライアントに持ち込まない（`SpotsEntry` の注記）
   */
  seasonalSpots?: HomeSeasonal | null;
};

export default function GalleryPageClient({ surface = "home", seasonalSpots = null }: Props) {
  const { locale, labels } = useLocale();
  const { showToast } = useToast();
  const { photos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
  const { isAuthenticated, userId, loading: authLoading } = useAuth();
  const ownUserId = isAuthenticated ? userId : null;
  // 保存した写真の id を**1回で**引いてカードに配る（写真ごとに聞きに行かせない）
  const saves = useMySaves(isAuthenticated, authLoading);
  const savedIds = React.useMemo(() => (saves.pending || saves.failed ? null : new Set(saves.photoIds)), [saves.pending, saves.failed, saves.photoIds]);

  const {
    PHOTOS,
    filters,
    setFilters,
    filteredPhotos,
    currentIndex,
    openPhotoId,
    openById,
    setPendingPhoto,
    close,
    next,
    prev,
  } = useGallery(photos, ownUserId, {
    recommendOnFeatured: surface === "home",
    // ホームの新着は投稿日の新しい順（iOS の新着・api-user の /feed と同じ・2026-10-30）
    postedOrderOnNew: surface === "home",
  });

  /**
   * 「さがす」の対象（iOS の `SearchScope`・2026-10-31 束 1 S1）。「人」は人を探す頁へのリンクなので状態に持たない。
   * 写真の並びは `filteredPhotos`（語・カテゴリ・タグで絞ったもの）から、対象で更に絞る:
   *   タグ … タグを持つ写真だけ　撮影地 … 撮影地を持つ写真だけ
   */
  const [searchScope, setSearchScope] = React.useState<SearchScopeKey>("all");
  const searchDiscovering = filters.query.trim() === "" && (filters.category ?? "all") === "all"
    && (filters.selectedTags?.length ?? 0) === 0 && searchScope === "all";
  const scopedPhotos = React.useMemo(() => {
    if (searchScope === "tags") return filteredPhotos.filter((p) => (p.tags ?? []).length > 0);
    if (searchScope === "places") return filteredPhotos.filter((p) => typeof p.location === "string" && p.location.trim() !== "");
    return filteredPhotos;
  }, [filteredPhotos, searchScope]);

  /**
   * **ログイン中の既定は「自分」**（owner:「デフォルトは自分のみがいい」）。
   *
   * 静的HTMLと未ログインは「すべて」（検索の着地点はみんなの写真）。セッションが
   * 確定してログイン中と分かった時点で、**URL がタブを指定していなければ**一度だけ
   * 「自分」へ倒す。指定があればそれを尊重（開いて戻った）。**`?photo=` で来た
   * 人も倒さない**——写真を名指しした共有リンク・通知で、その1枚が「自分」に
   * 無ければ絞りを外す往復（トースト付き）になる。最初から「すべて」で開く。
   * ログアウトしたら「すべて」に戻す（`mine` は本人の id が無いと意味を持たない）。
   */
  /**
   * **おすすめに出せる写真が1枚でもあるか。**
   *
   * 「おすすめ」は運営が選んだ写真（`featured`）を先に、残りをいいねの多い順に並べる
   * （iOS の `HomeFeed`・空にならない）。**既定にするのは選ばれた写真があるときだけ**
   * ——無ければ運営の選んだものが1枚も無いタブになるので、新着を既定のままにする
   * （静的HTML も新着のまま）。
   */
  const hasFeatured = React.useMemo(() => PHOTOS.some((p) => p.featured === true), [PHOTOS]);

  /**
   * いま絞り込んでいるか（タブ以外の条件）。
   *
   * **絞り込み中は「おすすめ」を出さない。** 絞った結果と関係ない写真が
   * 並ぶと何を見ているか分からなくなる。ホームに絞り込みの欄は無いが、
   * `?q=` `?tags=` `?category=` は URL から来うる（古いリンク）。
   */
  const narrowedNow = filters.category !== "all" || filters.selectedTags.length > 0
    || filters.query.trim() !== "";

  const scopeDecidedRef = React.useRef(false);
  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      // **「フォロー中」だけ戻す。** 本人の id が無いと意味を持たないタブは
      // これだけで、**「おすすめ」は未ログインでも見られる**（運営が選んだ
      // 写真で、誰が見ても同じ）。ここを `!== "all"` にしていたので、
      // 未ログインの人は「おすすめ」を押しても弾かれていた
      if (filters.scope === "following") setFilters({ scope: "all" });
      return;
    }
    // 決めるのは確定した1回だけ（利用者が別のタブを押したあとに戻さない）
    if (scopeDecidedRef.current) return;
    scopeDecidedRef.current = true;
    // **URL はその時点で読む**（マウント時の控えではなく）。ハイドレーション直後に
    // 一覧の写真を押して開いたあとで認証が確定すると、`?photo=` はマウント後に
    // 付いている。ここで「自分」へ倒すと**開いている写真の下で一覧が入れ替わる**
    // （`setFilters` は `currentIndex` を触らない＝別の写真になるか、外れて閉じる。
    // レビューが指摘）。開いている写真は `?photo=` として URL に**必ず**載っている
    // （`useGallery` の URL 同期はこの effect より先に定義されているので先に走る）
    // ——`currentIndex` を重ねて見ない（二重の守りは変異で観測できない）
    const q = new URLSearchParams(window.location.search);
    if (q.has("scope") || q.has("photo")) return;
    // **「さがす」では倒さない。** タブ（おすすめ／フォロー中／新着）はホームに
    // しか無いので、ここで「おすすめ」へ倒すと**戻す手段の無い絞り込み**になる
    // ——結果の件数・グリッド・色の内訳が全部おすすめだけになり、FilterBar には
    // 何も絞っていないように見える（レビューで指摘）
    if (surface !== "home") return;
    // **選ばれた写真があるときだけ「おすすめ」を既定にする**（実データは featured 0枚）。
    // 無ければ既定は「新着」のまま（静的HTML も新着）。おすすめは空にはならないが、
    // 選ばれた写真が無い間は「いいね順＝ほぼ投稿の新しい順」でしかない
    if (hasFeatured) setFilters({ scope: "featured" });
  }, [authLoading, isAuthenticated, filters.scope, setFilters, hasFeatured, surface]);

  /**
   * ホームのタブの矢印キー（WAI-ARIA の tabs の作法）。
   * 計算は `nextTabIndex` に寄せてある（マイページ・通知・スポット詳細と同じ1本）。
   */
  const onHomeTabKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const order = HOME_TABS.map((t) => t.key as string);
    const to = nextTabIndex(e.key, order.indexOf(filters.scope ?? ""), order.length);
    if (to === null) return;
    e.preventDefault();          // 矢印での横スクロールを起こさない
    const next = HOME_TABS[to].key;
    setFilters({ scope: next });
    // roving tabindex なので、選んだタブへフォーカスも移す
    // （移さないと次の Tab が一覧を飛ばす）
    document.getElementById(`home-tab-${next}`)?.focus();
  }, [filters.scope, setFilters]);


  // URLパラメータ(?photo=)で写真モーダルを開く。
  // 一覧タップは個別ページへ直接遷移するが、ビルド前の新着写真は
  // 静的ページが無いため、この経路（モーダル）だけが閲覧手段になる。
  //
  // 以前は初回レンダー時に一度だけ読んでいた。ホームに居るときの
  // /?photo=<id> への遷移は「同じルート」なのでこの画面は再マウントされず、
  // 読み終わった ref のままで何も起きなかった——つまり新着写真は
  // タップしても開けず、通知からも開けなかった（唯一の閲覧手段なのに）。
  // useSearchParams は遷移のたびに更新されるので、そちらを見る。
  const [photoParam, setPhotoParam] = React.useState<string | null>(null);
  // 短縮リンク `/?p=<先頭8文字>`（`lib/utils/shortPhotoLink.ts`）。一覧と照らして
  // `/?photo=<id>` に置き換え、あとは上の `?photo=` の経路に任せる
  const [shortParam, setShortParam] = React.useState<string | null>(null);
  // 一度開いて閉じた写真を、同じ ?photo= のまま開き直さないための記録
  const dismissedRef = React.useRef<string | null>(null);
  // 「見つかりません」を同じ写真について2回言わないための記録。
  // 上の dismissedRef とは**別物**（あちらは開くのを止めるゲート）
  const notFoundRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // ?photo= が外れたら「閉じた覚え」も捨てる。
    // 捨てないと、同じ写真へもう一度遷移しても永久に開かなくなる
    // （通知からその写真を2回開こうとすると2回目が無反応になっていた）。
    if (!photoParam) {
      dismissedRef.current = null;
      notFoundRef.current = null;
      // **URL から ?photo= が消えたら閉じる。**
      //
      // 通知から `/?photo=<id>` を開いた場合だけは本物の履歴が積まれる
      // （同じルートなので `<Link>` が push する）。そこで戻るを押すと
      // URL は `/` に戻るのに、ここが**何もしていなかった**のでモーダルは
      // 開いたまま——画面とアドレスバーが食い違い、利用者には
      // 「戻るを押したのに何も起きなかった」と見える。もう一度押すと
      // モーダルを開いたままページを離れる。
      //
      // **自分で消した場合と区別しなくてよいのは、下で待ち id を立てて
      // いるから。** 開けなかった `?photo=` は必ず `setPendingPhoto` に
      // 預けるので、同期がそれを落とすことは無い。ここに null が来るのは
      // 「開いていない」か「外から消された」ときだけ。
      close();
      return;
    }
    if (photoParam === dismissedRef.current) return;

    // **預けるのは「開けなかった」と決まってから。**
    // 試す前に預けると、開いたあとで同じ効果がもう一度走ったときに
    // （`photoParam` はまだ古い値のまま）**閉じた直後に預け直して**しまい、
    // 同期が `?photo=` を書き戻す＝閉じてもURLに残る。
    /**
     * **取りに行って駄目で、しかも開けないときだけ伝える。**
     *
     * 一覧が取れなくても、手元のスナップショット（`app/data/photos.json`）に
     * ある写真は開ける——本番の30枚、つまり共有リンクの大多数がそれ。
     * 判定を `openById` より前に置いたら、**開いている写真の上に
     * 「読み込めませんでした」を出し、`?photo=` を URL から消して**いた
     * （レビューが実測。しかも `notFoundRef` に書くので、そのセッションの
     * 以後の `?photo=` 遷移が全部拒否される）。開けるかどうかを先に見る。
     */
    const tellCouldNotLoad = () => {
      if (notFoundRef.current === photoParam) return;
      notFoundRef.current = photoParam;
      // **待ち id は捨てない。** `setPendingPhoto(null)` は `?photo=` を URL から
      // 削る（`useGallery`）。通信の失敗は一時的で、`usePhotos` は戻ってきた
      // ときに取り直すので、id を捨てると**取り直しが成功しても開き直せない**
      // うえ、アドレスバーからも復元できない（「見つからない」と同じ扱いに
      // しすぎていた）。伝えるのは1回だけ、id は預けたままにする
      setPendingPhoto(photoParam);
      showToast(locale === "en"
        ? "Could not load photos. Check your connection and try again."
        : "写真を読み込めませんでした。通信を確かめて、もう一度お試しください。", "error");
    };

    // **手元に無い写真で、一覧が空のとき**は下の救済まで届かないので、ここで
    // 取れていないなら理由を出す。**手元にある写真は下へ通す**——絞り込みや
    // 「自分」タブ（写真0枚の人には既定でそうなる）で空になっていても、
    // 絞りを外して開ける（レビューが実測した「開ける写真まで断る」を避ける）
    if (filteredPhotos.length === 0 && !PHOTOS.some((p) => p.id === photoParam) && !photosLoaded) {
      if (photosFailed) { tellCouldNotLoad(); return; }
      setPendingPhoto(photoParam);
      return;
    }
    if (openById(photoParam)) { dismissedRef.current = null; return; }

    // **開けなかったことを伝える。**
    //
    // 消された写真の共有リンクを踏むと、404 → `/?photo=<id>` に振り替わり、
    // ここで `openById` が false を返す。今までは**何もしなかった**ので、
    // `?photo=` だけが静かに外れて普通のギャラリーが出る——踏んだ人には
    // 「リンクが壊れている」ではなく「トップに飛ばされた」と見える。
    //
    // **一覧に無い＝存在しない、ではない**ので、そこは分けて見る。
    // `openById` が探すのは**絞り込んだあと**の一覧なので、フィルターで
    // 外れているだけの写真まで「見つかりません」と言ってはいけない。
    //
    // **ただし黙って何もしないのもやめる。** 以前はここで「絞り込みを
    // 勝手に外す方が驚く」として黙っていたが、実際に起きていたのは
    // **通知をタップしても本当に何も起きない**（モーダルも出ず、理由も
    // 出ず、押し直しても同じ）だった。`?photo=<id>` は写真を名指しして
    // いる——通知・共有リンク・戻るでしか来ない——ので、その1枚を開く
    // 方に倒す。ビルド後の新着写真はこのモーダルが唯一の閲覧手段。
    //
    // 外すのは**絞り込みだけ**（並び順は触らない）。外したことはトースト
    // で伝える——画面の見え方が変わる理由が見えないと、次に困る。
    if (PHOTOS.some((p) => p.id === photoParam)) {
      setPendingPhoto(photoParam);
      // **今まさに絞り込んでいるときだけ外す。** ここを ref の「一度きり」で
      // 守ると、外しても開けなかった場合に**同じ値を setFilters し続ける**
      // 形（毎回新しいオブジェクト＝毎回再描画）を作りかねない。今の状態を
      // 見て決めれば、外し終わったあとは自然に何もしない。
      const narrowed = filters.category !== "all" || filters.selectedTags.length > 0
        || filters.query.trim() !== "" || filters.scope !== "all";
      if (narrowed) {
        setFilters({ category: "all", selectedTags: [], query: "", scope: "all" });
        showToast(locale === "en"
          ? "Cleared the filters to open this photo."
          : "絞り込みを解除して、この写真を開きました。", "info");
      }
      return;
    }

    // **API の一覧が届くまでは言わない。** `PHOTOS` の初期値はビルド時の
    // スナップショットなので、そこに無いことは「存在しない」を意味しない
    // ——ビルド後にアップロードされた写真は必ずここに来る。届く前に
    // 言ってしまうと、嘘をつくうえに下の記録が残って**あとから届いても
    // 開かなくなる**（このモーダルは新着写真の唯一の閲覧手段）。
    if (!photosLoaded) {
      // ここまで来た＝手元の一覧では開けなかった。取りに行って駄目だったなら、
      // 「まだ届いていない」ではないので待たせない
      if (photosFailed) { tellCouldNotLoad(); return; }
      setPendingPhoto(photoParam);
      return;
    }

    // **記録は専用の ref に置く。** `dismissedRef` は「一度閉じた写真を
    // 開き直さない」ゲートで、そこへ書くと「トーストを止める」つもりの
    // 1行が「開くのを止める」に化ける（実際そうなっていた）。
    if (notFoundRef.current === photoParam) return;
    notFoundRef.current = photoParam;
    setPendingPhoto(null);   // 無いと分かったので、死んだ ?photo= を URL に残さない
    showToast(locale === "en" ? "That photo is no longer available." : "その写真は見つかりませんでした。", "error");
  }, [photoParam, filteredPhotos, openById, PHOTOS, photosLoaded, photosFailed, showToast, locale, close, setPendingPhoto, setFilters, filters]);

  // **短縮リンクを `?photo=` に置き換える。** 一覧（ビルド時の控え → API の一覧）に
  // 1枚だけ当たればその写真へ。まだ一覧が届いていなければ待つ（ビルド後の新着写真は
  // API の一覧にしか無い）。届いても当たらない・2枚当たるときは、8文字のまま `?photo=` に
  // 渡して上の経路に「見つかりません」を言わせる（黙ってトップを出さない）。形の違う値は触らない
  //
  // - **値は ref に覚える。** 待っている間に `useGallery` が絞り込みから URL を書き戻すと
  //   `p` が落ちる（あちらは Next に知らせない書き方なので今は届かないが、それに頼らない）
  // - **取れなかったときは書かない。** 8文字を `?photo=` に固めると、回線が戻って一覧が
  //   届いても完全な id に一致せず、二度と開けなかった。一度だけ知らせて待ち、取り直しを待つ
  // - **`history.replaceState` の state は null で渡す。** Next はこの差し替えを、state に
  //   `__NA` も `_N` も無いときだけ拾って `useSearchParams` を更新する
  //   （`next/dist/client/components/app-router.js`）。このリポジトリの他の書き戻しの作法
  //   （`withNextHistoryState`）に揃えると Next に届かず、`?photo=` の監視が動かない
  const shortRef = React.useRef<string | null>(null);
  const shortFailToldRef = React.useRef(false);
  React.useEffect(() => {
    if (shortParam && resolveShortPhotoId(shortParam, []).kind !== "invalid") shortRef.current = shortParam;
    const short = shortRef.current;
    if (!short) return;
    const result = resolveShortPhotoId(short, PHOTOS.map((p) => p.id));
    if (result.kind === "none" && !photosLoaded) {
      if (photosFailed && !shortFailToldRef.current) {
        shortFailToldRef.current = true;
        showToast(locale === "en"
          ? "Couldn't load the photo. Check your connection and try again."
          : "写真を読み込めませんでした。通信を確かめて、もう一度お試しください。", "error");
      }
      return;
    }
    shortRef.current = null;
    const id = result.kind === "found" ? result.id : short.trim().toLowerCase();
    // いまの画面（トップ／さがす）とその時点のクエリは残し、`p` だけを `photo` に替える
    const params = new URLSearchParams(window.location.search);
    params.delete("p");
    params.set("photo", id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [shortParam, PHOTOS, photosLoaded, photosFailed, showToast, locale]);

  const handleClose = React.useCallback(() => {
    dismissedRef.current = openPhotoId ?? null;
    close();
  }, [openPhotoId, close]);

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      if (p.category) set.add(p.category);
    }
    return [...Array.from(set)];
  }, [PHOTOS]);

  // タグの**字面と並び**は全写真で決める（絞り込みでは動かさない）。
  //
  // 代表表記は「いちばん多く使われている表記、同数なら文字列の小さい方」。
  // これを絞り込み後の集合で決めると、**検索1文字ごとにチップの字面が
  // 入れ替わる**（`Fuji` ⇄ `fuji`）。`e731478` で「写真が1枚増えるだけで
  // 入れ替わる」を潰したのと同じ性質なので、母集団は全体に固定する。
  const tagLabels = React.useMemo(() => {
    const groups = new Map<string, { label: string; total: number; byLabel: Map<string, number> }>();
    for (const p of PHOTOS) {
      // 1枚の写真は1回しか数えない（`["旅","#旅"]` を2枚と数えない）
      const seen = new Set<string>();
      for (const t of p.tags ?? []) {
        const key = tagKey(t);
        // 空になるのは空白だけのタグのときで、それは `useGallery` が
        // ここへ渡す前に落としている（保険）
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const g = groups.get(key) ?? { label: t, total: 0, byLabel: new Map<string, number>() };
        g.total += 1;
        const n = (g.byLabel.get(t) ?? 0) + 1;
        g.byLabel.set(t, n);
        const cur = g.byLabel.get(g.label) ?? 0;
        if (n > cur || (n === cur && t < g.label)) g.label = t;
        groups.set(key, g);
      }
    }
    return groups;
  }, [PHOTOS]);

  // 件数バッジは**いま出ている結果の中**で数える。
  //
  // 全写真で数えていた頃は、カテゴリや検索語、「フォロー中」で絞っている
  // 最中でも全体の枚数を出していた——チップが「fuji 3」なのに押すと
  // 「結果: 1 件」。バッジは「そのタグを足したらこうなる」を出すのが素直。
  // 結果に無いタグはそもそも載らない（押しても0件のチップを並べない）。
  const tagCounts = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of filteredPhotos) {
      const seen = new Set<string>();
      for (const t of p.tags ?? []) {
        const key = tagKey(t);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // 字面は全体で決めた代表を使う（絞り込みで変えない）
        const label = tagLabels.get(key)?.label ?? t;
        map[label] = (map[label] ?? 0) + 1;
      }
    }
    return map;
  }, [filteredPhotos, tagLabels]);

  // 表示するのは「よく使うタグ」だけ。1枚しかないタグまで全部並べても選べないので、
  // 枚数の多い順に上位だけ出し、残りは検索で辿ってもらう。
  const tags = React.useMemo(() => {
    // 結果に無いタグは `tagCounts` に載らない（結果の中だけを数えるので、
    // 載っているものは必ず1枚以上）。押しても0件のチップは並ばない。
    //
    // **並び順は全体の枚数で決める。** 絞り込み後の数で並べ替えると、
    // 検索1文字ごとにチップが入れ替わって**押そうとした位置がずれる**。
    // 顔ぶれは結果に応じて減るが、残ったものの前後関係は変わらない。
    const totalOf = (label: string) => {
      const g = tagLabels.get(tagKey(label));
      return g ? g.total : (tagCounts[label] ?? 0);
    };
    const popular = Object.keys(tagCounts)
      .sort((a, b) => (totalOf(b) - totalOf(a)) || a.localeCompare(b))
      .slice(0, POPULAR_TAG_LIMIT);
    // 選択中のタグは上位に無くても必ず出す（消えると解除できなくなるため）。
    //
    // **突き合わせはスラッグで。** 完全一致で見ていた頃は、`?tags=<スラッグ>`
    // で来たとき（集約ページの404救済）に**同じタグのチップが2つ**並んで
    // いた——生のタグ（未選択・件数つき）と、スラッグ（選択済み・件数0）。
    // 大文字違い（`Fuji` と `fuji`）でも同じことが起きる。
    const popularKeys = new Set(popular.map(tagKey));
    const extra = filters.selectedTags.filter((t) => !popularKeys.has(tagKey(t)));
    return [...popular, ...extra];
  }, [tagCounts, tagLabels, filters.selectedTags]);

  // **写真から作り直さない。** `categories` は `PHOTOS` の全カテゴリを
  // 重複除去したものなので、そこを埋めれば足りる（写真からもう一周する
  // ループを置いていたが、**1件も足せない死にコード**だった——中身を
  // `throw` に変えても GalleryPageClient 系9ファイル62件が全部緑）。
  // 名前の決め方は `categoryLabel` 1つ（`/favorites` と同じ）。
  const categoryDisplayMap = React.useMemo(
    () => categoryChipMap(categories, { all: labels.category.all, names: labels.category.names }),
    [labels, categories],
  );

  /**
   * ホームの PC の右の柱（`HomeColumns`）に置く中身。
   *
   * **同じものを二度作らない**——「さがす」の発見の節（`DiscoverSections`）を
   * 柱の形で出すだけ。数え方も行き先も1か所（`collectEntries`）のままなので、
   * 柱の数字と飛んだ先の枚数が食い違わない。
   *
   * **架空の数字は出さない**（owner の指示書）。ここに出るのは
   * カテゴリ・撮影地・機材と、その**実際の枚数**だけ。
   */
  const discoverRail = (
    <nav aria-label={locale === "en" ? "Browse photos" : "写真をさがす"}>
      <DiscoverRail
        photos={PHOTOS}
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
      />
    </nav>
  );

  const renderSubtitle = (sub?: string | string[]) => {
    if (!sub) return null;
    const parts = Array.isArray(sub) ? sub : [sub];
    const first = parts[0] ?? "";
    const rest = parts.slice(1).join(" ");
    return (
      <p
        id="site-subtitle"
        className="text-sm text-white/60 mt-0.5 sm:mt-1 leading-tight sm:leading-normal"
      >
        <span className="inline-block align-baseline sm:inline">{first}</span>
        {rest ? <br className="block sm:hidden" /> : null}
        {rest ? (
          <span className="inline-block align-baseline sm:inline -mt-1 sm:mt-0" style={{ lineHeight: "1.05" }}>
            {rest}
          </span>
        ) : null}
      </p>
    );
  };

  /**
   * 見出しは面ごとに別の文。
   *
   * **以前はどちらも `site.title`（「みんなの旅の写真」）だった。**
   * `/search` は `noindex` なので検索への影響は無いが、別の画面が
   * 同じ見出しを名乗ると、見出しで行き来する人には区別が付かない。
   * 一言（`subtitle`）はサイトの看板なのでトップにだけ置く。
   */
  const isSearch = surface !== "home";
  const heading = isSearch
    ? (labels.search?.heading ?? (locale === "en" ? "Find photos" : "写真をさがす"))
    : (labels.site?.title ?? "Gallery");

  /**
   * **PC は両方 6xl に広げる**（指示書 4・11・17「スマホ画面をそのまま横に
   * 引き伸ばさない」／owner 2026-09-22「1280px 幅で左右に大きな余白が
   * 残る問題を解消する。ただし無理に画面幅いっぱいへ引き伸ばさない」）。
   *
   * **上限は 6xl**——写真ページ（`lg:max-w-6xl`）・集約ページと同じ箱。
   * 7xl にするとヘッダー（`max-w-5xl`）とロゴの左端が片側128px ずれる。
   * 狭い画面（< 1024px）は今までどおり `max-w-5xl`。
   */
  return (
    <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg mx-auto w-full max-w-5xl lg:max-w-6xl">
      {/* **見出しは1つだけ。** 狭い画面では画面に出さず（`sr-only`）、広い画面で
          ふつうに見せる（`sm:not-sr-only`）。
          以前は狭い画面用の `sr-only sm:hidden` の h1 と、`hidden sm:flex` の中の h1 の
          **2つが HTML に在った**（どちらの幅でも描かれるのは1つだが、HTML を読む
          検索には h1 が2つ見える）。**見た目は変えない**——狭い画面では包みが高さ0
          （中身は読み上げ専用の見出しと、隠した一言だけ）、広い画面は今までどおり。
          スマホで見出しが1つも無かった件（390px 幅で h1 が0件）もこの形で満たす */}
      {/* タイトル: モバイルでは見せない（ヘッダーナビにサイト名がある） */}
      <div className="sm:flex sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:mb-4">
        <div className="sm:flex-1">
          {/* 探すは**狭い画面でも見せる**明朝 30（アプリ v2 の探すの題・板 Search の h1）。
              トップはこれまでどおり（ヘッダーにサイト名がある） */}
          <h1 id="site-title" className={isSearch
              ? "font-serif font-bold m-0 mb-3 sm:mb-0 text-[32px] leading-[1.25]" /* 束 1: iOS の探すの題（`JPFont.photoTitle` 32） */
              : "sr-only sm:not-sr-only text-2xl sm:text-3xl font-bold mb-0"}>
            {heading}
          </h1>
          {!isSearch && <div className="hidden sm:block">{renderSubtitle(labels.site?.subtitle)}</div>}
        </div>
      </div>

      {/* 誰の写真を見るか（ログイン中だけ）。owner:「この画面は、タブで切り替えて、
          自分の写真かフォロー中の人の写真みれるようにしたい」。
          「すべて」は未ログインの人が見るのと同じ一覧。既定は「自分」（上の effect） */}
      {/* 🔴 **`aria-pressed` ではなく、本物のタブ。**
          `aria-pressed` は「押して入り切りする」という意味だが、この3つは
          **押し直しても外れない**（必ずどれか1つが選ばれている）ので、
          読み上げの「押されています／押されていません」が嘘になる。
          マイページのタブを同じ理由で直したのと同じ形に揃える
          （`app/users/UserProfileClient.tsx`・2026-09-22）。
          矢印キーの計算は `lib/utils/tabKeys.ts` を使い回す——**同じ計算を
          もう1つ書かない**（あちらのコメントが名指ししている形） */}
      {/* 板（`Main.dc.html`）のタブ。**丸薬から下線へ。**
         採った数値: 間隔 24px ／ 1つの高さ 44px ／ 字 15px ／
         選択中だけ太字＋下線（v2 で白 → 真鍮・`tabStyles.ts`）／
         列の下に 1px の細い線。
         🔴 **高さ 28px はタップ領域の基準（44px）に届いていなかった。**
         見た目の話の前に、指で押す的が小さすぎた。
         **px で書く**——以前は 640px 未満の root が 14px で `gap-6` も
         `text-sm` も縮んでいた（`gap-6` は 21px・2026-10-30 束 0a で外した）。 */}
      {surface === "home" && (
        <div role="tablist" aria-label={locale === "en" ? "Which photos" : "どの写真を見るか"}
             className={`${TAB_ROW} mb-3`}>
          {HOME_TABS.map((t) => {
            const active = filters.scope === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`home-tab-${t.key}`}
                aria-selected={active}
                aria-controls={HOME_PANEL_ID}
                // roving tabindex（選んでいるタブだけが Tab の止まり先）
                tabIndex={active ? 0 : -1}
                onClick={() => setFilters({ scope: t.key })}
                onKeyDown={onHomeTabKeyDown}
                // 選んでいるタブは真鍮＋太字＋2px の下線（`tabStyles.ts`。以前は白の下線）
                className={`${TAB_BASE} ${active ? TAB_ON : TAB_OFF}`}
                style={{ touchAction: "manipulation" }}
              >
                {locale === "en" ? t.en : t.ja}
              </button>
            );
          })}
        </div>
      )}

      {/* **上段のめくる札**（今日のテーマ・今日の一問・撮影スポット・2026-10-31 束 1 H2・iOS の `HomeTopCardView`）。
          タブの直下＝どのタブでも同じ位置。以前は文字だけの帯 3 本（`QuizEntry`・`SpotsEntry`・`ThemeEntry`） */}
      {surface === "home" && <HomeTopCards locale={locale === "en" ? "en" : "ja"} photos={PHOTOS} seasonal={seasonalSpots} />}
      {/* いまの季節の撮影スポットの段（iOS の #417 ④⑤⑥ が出るまで今の形・束 5）。帯の行は上の札へ移した */}
      {surface === "home" && <SpotsEntry locale={locale === "en" ? "en" : "ja"} seasonal={seasonalSpots} showRow={false} />}

      {/* ストーリーはマイページへ移した（owner:「ストーリー見れる場所もマイページに
          移設したいな」）。投稿する入口も同じ場所に集めた流れに揃える */}

      {/* フォロー中: 絞り込み・件数・グリッドは出さず、新着と同じ並び（`HomeMosaic`）で
          投稿順に流れる。撮った人の名前は撮影地と一緒に写真に重ねる（撮影地が無い写真は
          重ねない・iOS と同じ・2026-09-29）。
          `useGallery` はこのタブで一覧を空にするので、`?photo=` が来たら上の effect が
          「すべて」へ外して開く（フィードの上にモーダルを重ねない） */}
      {surface === "home" && filters.scope === "following" ? (
        <HomePanel scope="following">
          <HomeColumns rail={discoverRail}>
            <TimelineFeed locale={locale} />
          </HomeColumns>
        </HomePanel>
      ) : surface === "home" && filters.scope === "featured" ? (
        /* **おすすめ＝iOS の `HomeFeed.recommended`**（2026-09-29 に揃えた）。
           1. 運営が選んだ写真があれば、カテゴリごとの段（`FeaturedSections`）
           2. その下に**全部の写真**を「選ばれた写真を先に、残りはいいねの多い順」で
              （並べるのは `useGallery`＝モーダルの前後も同じ順）＝**空にならない**
           🔴 **このタブは PC の右の柱を付けない**（owner の指示 2026-09-22:「おすすめは
           右側サイドバーを表示していません。これは現在の意図的な実装です。3タブすべてに
           機械的に同じサイドバーを追加しないでください」・`docs/owner-instructions-2026-09-22.md`）。
           段（`FeaturedSections`）は中で `GRID_SIZES_HOME_6XL` を使う＝容器いっぱいの前提。
           並びの方は**新着と同じ位置・同じ幅**（PC は左寄せの 40rem・`MOSAIC_*_SIZES` の申告と合わせる）。
           中央に置くと、タブを切り替えたときに並びが横へ 160〜224px 跳ねる
           （owner の指示の確認事項「タブを切り替えても見出し位置が不自然に移動しないか」）。
           ⚠️ 柱を付けない理由（広い段）は、選ばれた写真が0枚の本番では成り立っていない
           ——付けるかどうかは owner の判断（`docs/ios-alignment-2026-09-27.md` §3 のホームのカードの行）
           並び: いいねが全部 0 なら「投稿の新しい順」。新着も投稿の新しい順（2026-10-30 から） */
        <HomePanel scope="featured">
          {hasFeatured && !narrowedNow && (
            <FeaturedSections
              photos={PHOTOS}
              categoryNames={labels.category?.names ?? {}}
              locale={locale}
              categoryDisplayMap={categoryDisplayMap}
              onOpenPhoto={openById}
            />
          )}
          {/* 選ばれた写真のカテゴリの段の下に、**全部の写真を「おすすめ」の並びで**
              （選ばれた写真を先に、残りはいいねの多い順・`useGallery` が並べる）。
              iOS の `GalleryView` と同じ——段は選ばれた写真があるときだけ、並びは必ず出る */}
          <div className="max-w-xl mx-auto lg:mx-0 lg:max-w-[40rem]">
            {filteredPhotos.length === 0 ? (
              <EmptyState className="py-16" message={locale === "en" ? "No photos yet." : "まだ写真がありません。"} testId="gallery-empty" />
            ) : (
              <HomeMosaic
                photos={filteredPhotos}
                locale={locale === "en" ? "en" : "ja"}
                priorityCount={hasFeatured && !narrowedNow ? 0 : HOME_PRIORITY_COUNT}
              />
            )}
          </div>
        </HomePanel>
      ) : surface === "home" ? (
        /* **新着は iOS と同じ写真の並び**（`HomeMosaic`・大きく1枚 → 2枚 → 2枚・2026-09-29）。
           以前は縦1列の札（題・説明・タグ・4つの操作）だった。題・説明・タグ・保存・共有は
           写真ページにある。サムネを並べる格子は「さがす」の持ち場のまま。
           並びは**投稿日の新しい順**（`useGallery` の `postedOrderOnNew`・2026-10-30） */
        <HomePanel scope="all"><HomeColumns rail={discoverRail}>
          {filteredPhotos.length === 0 ? (
            <EmptyState className="py-16" message={locale === "en" ? "No photos yet." : "まだ写真がありません。"} testId="gallery-empty" />
          ) : (
            <HomeMosaic
              photos={filteredPhotos}
              locale={locale === "en" ? "en" : "ja"}
              priorityCount={HOME_PRIORITY_COUNT}
            />
          )}
        </HomeColumns></HomePanel>
      ) : (
      /**
       * **「さがす」は電話と同じ 1 列の順**（2026-10-31 束 1 S1・S2・S9・W7・iOS の `SearchView`）:
       *
       *     検索欄 → 対象のチップ（すべて・写真・人・タグ・撮影地）
       *     ［何も探していない間］発見の面（撮影地・おすすめ・色・機材）
       *     ［探している間］カテゴリ・タグのチップ → 撮影スポットの結果
       *     結果の見出し（件数・右に並べ替え）→ 写真の札（縦 3:4・2 列〜）
       *
       * 以前は ≥1024px で左に絞り込みの柱を置いた 2 カラムで、カテゴリのチップが検索欄より上、
       * タグのチップがいつも出ていた。PC も同じ順を中央に（容器 72rem）——節の中の札が横に増えるだけ
       */
      <div data-testid="search-surface">
      <FilterBar
        categories={categories}
        tags={tags}
        values={filters}
        onChange={setFilters}
        className="mb-6"
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
        tagCounts={tagCounts}
        layout="search"
        // カテゴリは「人」以外で出す（iOS の `SearchView`: `showsPhotos`）。「人」は頁へのリンクなので選ばれた状態にならない。
        // 2026-10-31 束 1 の確かめの直し: 以前は「タグ」「撮影地」でカテゴリのチップを消し、選んだカテゴリが
        // 見えないまま効いていた（外す手立てが無かった）
        showCategories={!searchDiscovering}
        // タグは「撮影地」では出さない（iOS の `showsTagChips`）。撮影地へ切り替えるときに選んだタグを外す（下の onClick）
        showTags={!searchDiscovering && searchScope !== "places"}
        scopeRow={
          // 対象のチップ（iOS の `SearchScope`・C5 の形）。「人」は人を探す頁へ（Web は別の頁で同じことができる）
          <div role="group" aria-label={locale === "en" ? "Search in" : "探す対象"}
               className="flex gap-1.5 -mx-1 px-1 py-[5px] -my-[5px] overflow-x-auto no-scrollbar" data-testid="search-scope">
            {SEARCH_SCOPES.map((sc) => {
              const label = locale === "en" ? sc.en : sc.ja;
              const cls = `${CHIP_HIT} inline-flex items-center justify-center rounded-full text-[13px] transition-colors flex-shrink-0`;
              if (sc.key === "people") {
                // 打った語を人を探す頁へ運ぶ（あちらが `q` を読んで初めから探す）
                const q = filters.query.trim();
                return (
                  <Link key={sc.key} href={q ? `${ROUTES.USER_SEARCH}?q=${encodeURIComponent(q)}` : ROUTES.USER_SEARCH} prefetch={false}
                        className={`${cls} ${CHIP_OFF}`} style={{ ...CHIP_SIZE, touchAction: "manipulation" }} data-scope="people">
                    {label}
                  </Link>
                );
              }
              const on = searchScope === sc.key;
              return (
                <button key={sc.key} type="button" aria-pressed={on} onClick={() => {
                          const next = sc.key as SearchScopeKey;
                          // タグの段が消える対象へ移るとき、選んだタグを残さない（見えないまま絞り込みが効かないように）
                          if (next === "places" && (filters.selectedTags?.length ?? 0) > 0) setFilters({ selectedTags: [] });
                          setSearchScope(next);
                        }} data-scope={sc.key}
                        className={`${cls} ${on ? CHIP_ON : CHIP_OFF}`} style={{ ...CHIP_SIZE, touchAction: "manipulation" }}>
                  {label}
                </button>
              );
            })}
          </div>
        }
      />

      {/* **撮影スポットの結果**（語を打ったときだけ・当たりが無ければ何も出さない・対象が「すべて」「撮影地」のとき）。
          写真の結果とは別の節で、件数も混ぜない。写真が0枚でも撮影地ガイドへ案内する（2026-09-30 のレビュー） */}
      {(searchScope === "all" || searchScope === "places") && <SpotSearchResults query={filters.query} locale={locale} />}

      {/* 発見の面（何も探していない間だけ・iOS の `isDiscovering`）。**絞り込みに連動させない**——「いま何があるか」を出す面 */}
      {searchDiscovering && (
        <DiscoverSections photos={PHOTOS} locale={locale} categoryDisplayMap={categoryDisplayMap} onOpenPhoto={openById} />
      )}

      <>
        {/* 結果の見出し: 件数（13・text-2・等幅の数字）と、右に並べ替え（`FilterBar` が `#search-sort-slot` へ描く） */}
        <div className="flex items-center justify-between gap-3 mb-2" data-testid="search-results-head">
          <p className="m-0 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }}>
            {/* 語で探しているときは「写真」と名乗る——上に撮影スポットの節が出るので、「結果: 0件」だとスポットまで0件に読める */}
            {filters.query.trim()
              ? (locale === "en" ? `Photos: ${scopedPhotos.length}` : `写真: ${scopedPhotos.length} 件`)
              : locale === "en"
                ? `${labels.gallery?.resultsCount ?? "Results"}: ${scopedPhotos.length}`
                : `${labels.gallery?.resultsCount ?? "結果"}: ${scopedPhotos.length} 件`}
          </p>
          <div id="search-sort-slot" className="relative min-h-[44px] flex items-center" />
        </div>

        {scopedPhotos.length === 0 && PHOTOS.length === 0 ? (
          // **絞り込んでいないのに「該当」と言わない。**（写真が1枚も無い環境）
          <EmptyState className="py-16" message={locale === "en" ? "No photos yet." : "まだ写真がありません。"} testId="gallery-empty" />
        ) : scopedPhotos.length === 0 && PHOTOS.length > 0 ? (
          <EmptyState
            className="py-16"
            message={locale === "en" ? "No photos match the current filters." : "条件に一致する写真がありません。"}
            // `scope` も戻す。「さがす」にはタブが無いので、URL から来た `?scope=following`（一覧が空になる）をここでしか外せない
            action={{
              label: locale === "en" ? "Reset filters" : "フィルターをリセット",
              onClick: () => { setSearchScope("all"); setFilters({ category: "all", selectedTags: [], query: "", sort: "new", scope: "all" }); },
            }}
            testId="gallery-no-match"
          />
        ) : (
          <GalleryGrid
            sizes={GRID_SIZES_SEARCH}
            columnsClassName={GRID_COLUMNS_SEARCH}
            photos={scopedPhotos}
            locale={locale}
            categoryDisplayMap={categoryDisplayMap}
            onOpenPhoto={openById}
            searchTiles
          />
        )}
      </>
      </div>
      )}

      <SearchParamWatcher name="photo" onChange={setPhotoParam} />
      <SearchParamWatcher name="p" onChange={setShortParam} />

      {currentIndex !== null && filteredPhotos[currentIndex] && (
        <GalleryModal
          photos={filteredPhotos}
          currentIndex={currentIndex}
          onClose={handleClose}
          onNext={next}
          onPrev={prev}
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
          // **一覧で持っているぶんを渡す**（送るたびに聞きに行かせない）
          savedIds={savedIds}
          savesPending={saves.pending}
        />
      )}
    </main>
  );
}
