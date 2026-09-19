"use client";

import React from "react";
import { tagKey } from "@/lib/utils/collections";
import { categoryChipMap } from "@/lib/utils/categoryMap";
import FilterBar from "./components/FilterBar";
import FeaturedSections from "./components/FeaturedSections";
import StoriesBar from "./components/stories/StoriesBar";
import { useLocale } from "./i18n/context";
import useGallery from "../lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import { GRID_SIZES_5XL } from "./components/gridSizes";
import GalleryModal from "./components/GalleryModal";
import SearchParamWatcher from "./components/SearchParamWatcher";
import { usePhotos } from "../lib/hooks/usePhotos";
import { useToast } from "../lib/hooks/useToast";
import { useAuth } from "./auth/context";
import TimelineFeed from "./components/TimelineFeed";
import Link from "next/link";
import { ROUTES } from "../lib/routes";

// フィルタバーに出すタグ数の上限（枚数の多い順）。残りは検索で辿る
const POPULAR_TAG_LIMIT = 10;

export default function GalleryPageClient() {
  const { locale, labels } = useLocale();
  const { showToast } = useToast();
  const { photos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
  const { isAuthenticated, userId, loading: authLoading } = useAuth();
  const ownUserId = isAuthenticated ? userId : null;

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
  } = useGallery(photos, ownUserId);

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
  const scopeFromUrlRef = React.useRef((() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return q.has("scope") || q.has("photo");
  })());
  const scopeDecidedRef = React.useRef(false);
  React.useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      if (filters.scope !== "all") setFilters({ scope: "all" });
      return;
    }
    if (scopeFromUrlRef.current || scopeDecidedRef.current) return;
    scopeDecidedRef.current = true;
    setFilters({ scope: "mine" });
    // `filters.scope` は意図的に依存に入れない——入れると、利用者が「すべて」を
    // 押すたびに「自分」へ戻す形になる（決めるのは確定した1回だけ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAuthenticated]);


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

  return (
    <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
      {/* **スマホでは見出しが1つも無かった。** 下のタイトルは `hidden sm:flex`
          の中なので、狭い画面では `display:none` ＝読み上げの木からも消える。
          ホームはこのサイトの入口なのに、h1 が無く「何のページか」を見出しから
          辿れない（実測: 390px 幅で h1 が0件）。**見た目は変えない**——
          画面に出さない見出しを1つ置く。広い画面では下の h1 が出るので、
          `sm:hidden` で重複させない */}
      <h1 className="sr-only sm:hidden">{labels.site?.title ?? "Gallery"}</h1>

      {/* タイトル: モバイルでは非表示（ヘッダーナビにサイト名がある） */}
      <div className="hidden sm:flex sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
        <div className="flex-1">
          <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
            {labels.site?.title ?? "Gallery"}
          </h1>
          {renderSubtitle(labels.site?.subtitle)}
        </div>
      </div>

      {/* 誰の写真を見るか（ログイン中だけ）。owner:「この画面は、タブで切り替えて、
          自分の写真かフォロー中の人の写真みれるようにしたい」。
          「すべて」は未ログインの人が見るのと同じ一覧。既定は「自分」（上の effect） */}
      {isAuthenticated && (
        <div role="group" aria-label={locale === "en" ? "Whose photos" : "誰の写真を見るか"}
             className="inline-flex items-center gap-1 p-1 mb-3 rounded-full bg-white/5 ring-1 ring-white/10">
          {([
            { key: "mine", label: locale === "en" ? "Mine" : "自分" },
            { key: "following", label: locale === "en" ? "Following" : "フォロー中" },
            { key: "all", label: locale === "en" ? "All" : "すべて" },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilters({ scope: t.key })}
              aria-pressed={filters.scope === t.key}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filters.scope === t.key ? "bg-white text-black" : "text-white/70 hover:text-white"
              }`}
              style={{ touchAction: "manipulation" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ストーリー（24時間で消える投稿） */}
      <StoriesBar />

      {/* フォロー中: 絞り込み・件数・グリッドは出さず、投稿者つきのカードが投稿順に流れる
          （フォローした人の写真をサムネだけで並べると誰の写真か分からない）。
          `?photo=` は上の effect が「すべて」へ外して開く */}
      {isAuthenticated && filters.scope === "following" ? (
        <div className="max-w-xl mx-auto">
          <TimelineFeed locale={locale} />
        </div>
      ) : (
      <>
      <FilterBar
        categories={categories}
        tags={tags}
        values={filters}
        onChange={setFilters}
        className="mb-4"
        locale={locale}
        categoryDisplayMap={categoryDisplayMap}
        tagCounts={tagCounts}
      />

      {/* **おすすめ（運営が選ぶ）。**
          **絞り込み中は出さない**——絞った結果の上に、絞りと関係ない写真が
          並ぶと何を見ているか分からなくなる。
          1枚も選ばれていなければ、この部品が自分で何も出さない */}
      {filters.scope === "all" && filters.category === "all" && filters.selectedTags.length === 0
        && !filters.query.trim() && (
        <FeaturedSections
          photos={PHOTOS}
          categoryNames={labels.category?.names ?? {}}
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
          onOpenPhoto={openById}
        />
      )}

      <>
        <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
            {locale === "en"
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
        ) : filteredPhotos.length === 0 && filters.scope === "mine" && isAuthenticated
          && filters.category === "all" && filters.selectedTags.length === 0 && !filters.query.trim() ? (
          // **「自分」で0枚は「条件に一致しない」ではない**——まだ投稿していないだけ。
          // ログイン直後の既定がこのタブなので、最初に見るのはここ。投稿への導線を出す
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
            <p className="text-sm">
              {locale === "en" ? "You haven't posted any photos yet." : "まだ写真を投稿していません。"}
            </p>
            <Link href={ROUTES.UPLOAD} prefetch={false}
                  className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors">
              {locale === "en" ? "Share your first photo" : "最初の写真を投稿"}
            </Link>
          </div>
        ) : filteredPhotos.length === 0 && PHOTOS.length > 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-white/60">
            <p className="text-sm">
              {locale === "en" ? "No photos match the current filters." : "条件に一致する写真がありません。"}
            </p>
            <button
              onClick={() => setFilters({ category: "all", selectedTags: [], query: "", sort: "new" })}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
              style={{ touchAction: "manipulation" }}
            >
              {locale === "en" ? "Reset filters" : "フィルターをリセット"}
            </button>
          </div>
        ) : (
          <GalleryGrid
                        sizes={GRID_SIZES_5XL}
            photos={filteredPhotos}
            locale={locale}
            categoryDisplayMap={categoryDisplayMap}
            onOpenPhoto={openById}
          />
        )}
      </>
      </>
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
        />
      )}
    </main>
  );
}
