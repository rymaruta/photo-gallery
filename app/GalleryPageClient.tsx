"use client";

import React from "react";
import { tagKey } from "@/lib/utils/collections";
import FilterBar from "./components/FilterBar";
import StoriesBar from "./components/stories/StoriesBar";
import { useLocale } from "./i18n/context";
import useGallery from "../lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";
import SearchParamWatcher from "./components/SearchParamWatcher";
import { capitalize } from "../lib/utils/string";
import { usePhotos } from "../lib/hooks/usePhotos";
import { useAuth } from "./auth/context";
import { useToast } from "../lib/hooks/useToast";
import { fetchFollowingSet } from "../lib/hooks/useFollow";

// フィルタバーに出すタグ数の上限（枚数の多い順）。残りは検索で辿る
const POPULAR_TAG_LIMIT = 10;

export default function GalleryPageClient() {
  const { locale, labels } = useLocale();
  const { showToast } = useToast();
  const { photos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
  const { isAuthenticated, loading: authLoading } = useAuth();

  // フォロー中フィード用: フォローしている userId 集合（認証時のみ取得）
  const [followingIds, setFollowingIds] = React.useState<Set<string>>(new Set());
  // 一覧の取得失敗を「誰もフォローしていない」と混ぜない（SW-b1）。
  // 混ぜると、フォロー中フィードが空表示に化けて気づけない
  const [followingError, setFollowingError] = React.useState(false);
  const [followingReloadKey, setFollowingReloadKey] = React.useState(0);
  /**
   * フォロー中の集合が**確定したか**。
   *
   * 初期値は空の Set なので、取得が終わる前のフィードは必ず0件になる
   * ——そのまま「フォローした人の写真がここに集まります。」を出すと、
   * 何人もフォローしている人にも、回線が遅い間ずっと「誰もフォローして
   * いない人」の画面を見せることになる。**「まだ来ていない」は、来たことを
   * 知る仕掛けがある場合だけ書ける**（`usePhotos` に `loaded` を足したのと
   * 同じ理由。`FollowButton` も `resolved` で同じことをしている）。
   */
  const [followingLoaded, setFollowingLoaded] = React.useState(false);
  React.useEffect(() => {
    // **「まだ分からない」を未ログインと混ぜない。** セッションの復元は
    // 非同期で、その間 `isAuthenticated` は false（`app/auth/context.tsx`
    // の初期値は `loading: true`）。ここで確定させてしまうと、
    // `/?feed=following` を再読込・ブックマーク・戻るで開いた人に、
    // 消したはずの「0人」の画面をまた見せることになる——`feed` は URL に
    // 載るので、これは主経路。
    //
    // **判定の出所はここ1つにする。** 表示側でも `authLoading` を見ると、
    // 同じことを2か所で決めることになり、片方を壊しても気づけない
    // （実際、両方に置いたらこの行を消しても全テストが通った）。
    if (authLoading) return;
    if (!isAuthenticated) {
      setFollowingIds(new Set());
      // ログアウトすると切替タブ自体が消えるので、失敗表示を残すと
      // 「もう一度読み込む」しか無い画面から抜けられなくなる（レビュー指摘）
      setFollowingError(false);
      setFollowingLoaded(true);   // 取得しない＝これで確定
      return;
    }
    let aborted = false;
    setFollowingError(false);
    setFollowingLoaded(false);
    fetchFollowingSet()
      .then((set) => { if (!aborted) setFollowingIds(new Set(set)); })
      .catch(() => { if (!aborted) setFollowingError(true); })
      .finally(() => { if (!aborted) setFollowingLoaded(true); });
    return () => { aborted = true; };
  }, [authLoading, isAuthenticated, followingReloadKey]);

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
  } = useGallery(photos, followingIds);

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

    if (filteredPhotos.length === 0) {
      // 絞り込みの結果が空。ここに来ると下の救済（絞り込みを外して開く）まで
      // 届かないので、取れていないなら理由を出す。
      // **ただし手元のスナップショットにある写真は別**——`?feed=following` は
      // フォロー集合が届くまで空になるので、写真APIが落ちている場面では
      // ここに来る。開ける写真まで断ってしまう（レビューが実測）
      if (!photosLoaded && photosFailed && !PHOTOS.some((p) => p.id === photoParam)) { tellCouldNotLoad(); return; }
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
    // 方に倒す。ビルド後の新着写真はこのモーダルが唯一の閲覧手段で、
    // 「フォロー中」を見ている人には自分宛ての通知がほぼ全部この経路
    // （自分の写真はフォロー中フィードに出ない）。
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
        || filters.query.trim() !== "" || filters.feed !== "all";
      if (narrowed) {
        setFilters({ category: "all", selectedTags: [], query: "", feed: "all" });
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

  const categoryDisplayMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    const names = labels.category.names ?? {};
    for (const key of categories) {
      map[key] = key === "all" ? labels.category.all : names[key] ?? capitalize(key.replace(/-/g, " "));
    }
    for (const p of PHOTOS) {
      const k = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
      if (k && !map[k]) map[k] = names[k] ?? capitalize(k.replace(/-/g, " "));
    }
    return map;
  }, [labels, categories, PHOTOS]);

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
      {/* タイトル: モバイルでは非表示（ヘッダーナビにサイト名がある） */}
      <div className="hidden sm:flex sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
        <div className="flex-1">
          <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
            {labels.site?.title ?? "Gallery"}
          </h1>
          {renderSubtitle(labels.site?.subtitle)}
        </div>
      </div>

      {/* フィード切替: すべて / フォロー中（ログイン時のみ表示） */}
      {isAuthenticated && (
        <div className="inline-flex items-center gap-1 p-1 mb-3 rounded-full bg-white/5 ring-1 ring-white/10">
          {(["all", "following"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilters({ feed: f })}
              aria-pressed={filters.feed === f}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filters.feed === f ? "bg-white text-black" : "text-white/70 hover:text-white"
              }`}
              style={{ touchAction: "manipulation" }}
            >
              {f === "all" ? (locale === "en" ? "All" : "すべて") : (locale === "en" ? "Following" : "フォロー中")}
            </button>
          ))}
        </div>
      )}

      {/* ストーリー（24時間で消える投稿） */}
      <StoriesBar />

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

      <>
        {/* 件数も「まだ分からない」ときは出さない。本文を伏せながら
            「結果: 0 件」と言い続けるのは、伏せた意味が無い */}
        {!(followingError && filters.feed === "following")
          && !(filters.feed === "following" && !followingLoaded) && (
          <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
            {locale === "en"
              ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
              : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
          </div>
        )}

        {followingError && filters.feed === "following" ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-white/60 text-center">
            <p className="text-sm">
              {locale === "en"
                ? "Couldn't load who you follow."
                : "フォロー中の一覧を読み込めませんでした。"}
            </p>
            <button
              onClick={() => setFollowingReloadKey((k) => k + 1)}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
              style={{ touchAction: "manipulation" }}
            >
              {locale === "en" ? "Retry" : "もう一度読み込む"}
            </button>
          </div>
        ) : filters.feed === "following" && !followingLoaded ? (
          // まだ分からない。**「0人です」とは言わない**が、真っ白でも困る
          // ——実測: 応答が返らない回線では 5秒・20秒・45秒のいずれでも
          // フィルタバーの直後がフッターで、読み込み中とも失敗とも分からない
          <div className="py-16 text-center text-sm text-white/50" role="status" aria-live="polite">
            {locale === "en" ? "Loading…" : "読み込み中…"}
          </div>
        ) : filteredPhotos.length === 0 && filters.feed === "following"
          && filters.category === "all" && filters.selectedTags.length === 0 && !filters.query.trim() ? (
          // **0件の理由が「フォローが0人」のときだけ、この文言にする。**
          // 検索語やカテゴリで0件になった回にも出していたので、抜けるには
          // 「みんなの写真を見る」→まだ0件→「フィルターをリセット」と
          // 2手かかっていた（下の分岐はリセットで feed ごと戻せる）。
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-white/60 text-center">
            <p className="text-sm">
              {locale === "en"
                ? "Photos from people you follow will show up here."
                : "フォローした人の写真がここに集まります。"}
            </p>
            <button
              onClick={() => setFilters({ feed: "all" })}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
              style={{ touchAction: "manipulation" }}
            >
              {locale === "en" ? "Explore all photos" : "みんなの写真を見る"}
            </button>
          </div>
        ) : filteredPhotos.length === 0 && PHOTOS.length === 0 ? (
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
              onClick={() => setFilters({ category: "all", selectedTags: [], query: "", sort: "new", feed: "all" })}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
              style={{ touchAction: "manipulation" }}
            >
              {locale === "en" ? "Reset filters" : "フィルターをリセット"}
            </button>
          </div>
        ) : (
          <GalleryGrid
            photos={filteredPhotos}
            locale={locale}
            categoryDisplayMap={categoryDisplayMap}
            onOpenPhoto={openById}
          />
        )}
      </>

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
