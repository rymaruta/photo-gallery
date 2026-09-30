"use client";

import React from "react";
import { tagKey } from "@/lib/utils/collections";
import { categoryChipMap } from "@/lib/utils/categoryMap";
import FilterBar from "./components/FilterBar";
import ColorJourney from "./components/ColorJourney";
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
import { usePhotos } from "../lib/hooks/usePhotos";
import { useToast } from "../lib/hooks/useToast";
import { useAuth } from "./auth/context";
import TimelineFeed from "./components/TimelineFeed";
import HomeMosaic from "./components/HomeMosaic";
import { useMySaves } from "../lib/hooks/useMySaves";
import { nextTabIndex } from "../lib/utils/tabKeys";

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
};

export default function GalleryPageClient({ surface = "home" }: Props) {
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
  } = useGallery(photos, ownUserId, { recommendOnFeatured: surface === "home" });

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
      {/* **スマホでは見出しが1つも無かった。** 下のタイトルは `hidden sm:flex`
          の中なので、狭い画面では `display:none` ＝読み上げの木からも消える。
          ホームはこのサイトの入口なのに、h1 が無く「何のページか」を見出しから
          辿れない（実測: 390px 幅で h1 が0件）。**見た目は変えない**——
          画面に出さない見出しを1つ置く。広い画面では下の h1 が出るので、
          `sm:hidden` で重複させない */}
      <h1 className="sr-only sm:hidden">{heading}</h1>

      {/* タイトル: モバイルでは非表示（ヘッダーナビにサイト名がある） */}
      <div className="hidden sm:flex sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
        <div className="flex-1">
          <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
            {heading}
          </h1>
          {!isSearch && renderSubtitle(labels.site?.subtitle)}
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
         選択中だけ太字＋下線（`inset 0 -2px 0 #fff`）／
         列の下に 1px の細い線。
         🔴 **高さ 28px はタップ領域の基準（44px）に届いていなかった。**
         見た目の話の前に、指で押す的が小さすぎた。
         **px で書く**——640px 未満は root が 14px なので `gap-6` も
         `text-sm` も縮む（`gap-6` は 21px にしかならない）。 */}
      {surface === "home" && (
        <div role="tablist" aria-label={locale === "en" ? "Which photos" : "どの写真を見るか"}
             className="flex items-stretch gap-[24px] mb-3 border-b border-white/[0.12]">
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
                className={`min-h-[44px] px-0 text-[15px] transition-colors ${
                  active ? "text-white font-semibold shadow-[inset_0_-2px_0_#fff]" : "text-white/60 hover:text-white"
                }`}
                style={{ touchAction: "manipulation" }}
              >
                {locale === "en" ? t.en : t.ja}
              </button>
            );
          })}
        </div>
      )}

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
           並び: いいねが全部 0 なら「投稿の新しい順」。**新着（撮影日が先）とは違う並び**になる */
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
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
                <p className="text-sm m-0">
                  {locale === "en" ? "No photos yet." : "まだ写真がありません。"}
                </p>
              </div>
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
           写真ページにある。サムネを並べる格子は「さがす」の持ち場のまま */
        <HomePanel scope="all"><HomeColumns rail={discoverRail}>
          {filteredPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
              <p className="text-sm m-0">
                {locale === "en" ? "No photos yet." : "まだ写真がありません。"}
              </p>
            </div>
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
       * **「さがす」の PC は2カラム**（owner の指示書 4・11・17:
       * 「PCではスマートフォン画面をそのまま横に引き伸ばすのではなく、
       * Webサイトとして最適なレイアウトを設計してください」）。
       *
       *   < 1024px … 最終版モックのまま（絞り込み → 発見の節 → 結果）
       *   ≥ 1024px … **左に絞り込みの柱**（画面に貼り付く）／右に写真の面
       *
       * 柱にするのは、この画面がいちばん長くなる面だから——結果が
       * 数十枚あるとスクロールの先で絞り込みが画面から消え、条件を
       * 変えるたびに上まで戻ることになる。マップ（左に一覧／右に地図）と
       * 同じ考え方。
       *
       * 柱はヘッダー（`--header-h`・安全領域込み）の下 16px に貼り付く。
       * **`overflow-y-auto` は付けない**——並び替えの一覧が
       * `absolute` で吊り下がるので、切り取られる箱を作ると隠れる。
       */
      <div className="lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
      <div className="lg:sticky lg:top-[calc(var(--header-h)_+_16px)]">
      <FilterBar
        categories={categories}
        tags={tags}
        values={filters}
        onChange={setFilters}
        className="mb-4 lg:mb-0"
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
        tagCounts={tagCounts}
      />
      </div>

      <div className="min-w-0">
      {/* **撮影スポットの結果**（語を打ったときだけ・当たりが無ければ何も出さない）。
          写真の結果とは別の節で、件数も混ぜない。写真が0枚でも撮影地ガイドへ案内する
          （2026-09-30 のレビュー: 「銀山温泉」で写真0件・ガイドが案内されない）。
          **発見の面より上**——探しに来た人の答えを、絞り込みに連動しない節の下に埋めない */}
      <SpotSearchResults query={filters.query} locale={locale} />

      {/* 色でさがす（Color Journey）。**この部品は写真を取りに行かない**——
          絞り込み後の一覧・モーダルを開く関数・カテゴリ名の地図を、下の
          グリッドと同じものとして渡す。以前は `/search` の上に独立して置いて
          `usePhotos()` を2つ動かしていた（PR #72 の積み残し3件をここで解く）。
          色を持つ写真が1枚も無ければ丸ごと描かない */}
      {/* 発見の面（最終版モックの中段・指示書 7）。**絞り込みに連動させない**
          ——「いま何があるか」を出す面なので、絞り込んだ結果で節が消えると
          探しに来た人の手がかりが無くなる。実データが無い節は丸ごと出さない */}
      <DiscoverSections photos={PHOTOS} locale={locale} categoryDisplayMap={categoryDisplayMap} />

      <ColorJourney
        photos={filteredPhotos}
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
        onOpenPhoto={openById}
      />

      <>
        <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
            {/* 語で探しているときは「写真」と名乗る——上に撮影スポットの節が出るので、
                「結果: 0件」だとスポットまで0件に読める */}
            {filters.query.trim()
              ? (locale === "en" ? `Photos: ${filteredPhotos.length}` : `写真: ${filteredPhotos.length} 件`)
              : locale === "en"
                ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
                : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
        </div>

        {filteredPhotos.length === 0 && PHOTOS.length === 0 ? (
          // **絞り込んでいないのに「該当」と言わない。**
          // この分岐が無かったので、写真が1枚も無い環境（新しい環境・
          // 公開が全部消えた）は下の `GalleryGrid` の既定文言
          // 「該当する写真がありません。」に落ちていた。絞り込んでいない
          // 人に「該当」と言うと、条件を外そうとして探し回ることになる。
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
            <p className="text-sm">
              {locale === "en" ? "No photos yet." : "まだ写真がありません。"}
            </p>
          </div>
        ) : filteredPhotos.length === 0 && PHOTOS.length > 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
            <p className="text-sm">
              {locale === "en" ? "No photos match the current filters." : "条件に一致する写真がありません。"}
            </p>
            <button
              // `scope` も戻す。「さがす」にはタブが無いので、URL から来た
              // `?scope=following`（一覧が空になる）をここでしか外せない
              onClick={() => setFilters({ category: "all", selectedTags: [], query: "", sort: "new", scope: "all" })}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
              style={{ touchAction: "manipulation" }}
            >
              {locale === "en" ? "Reset filters" : "フィルターをリセット"}
            </button>
          </div>
        ) : (
          <GalleryGrid
            sizes={GRID_SIZES_SEARCH}
            columnsClassName={GRID_COLUMNS_SEARCH}
            photos={filteredPhotos}
            locale={locale}
            categoryDisplayMap={categoryDisplayMap}
            onOpenPhoto={openById}
          />
        )}
      </>
      </div>
      </div>
      )}

      <SearchParamWatcher name="photo" onChange={setPhotoParam} />

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
