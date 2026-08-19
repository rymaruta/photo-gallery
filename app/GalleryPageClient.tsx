"use client";

import React from "react";
import FilterBar from "./components/FilterBar";
import StoriesBar from "./components/stories/StoriesBar";
import { useLocale } from "./i18n/context";
import useGallery from "../lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import GalleryModal from "./components/GalleryModal";
import { capitalize } from "../lib/utils/string";
import { usePhotos } from "../lib/hooks/usePhotos";
import { useAuth } from "./auth/context";
import { fetchFollowingSet } from "../lib/hooks/useFollow";
import type { Photo } from "@/lib/data/photos";

export default function GalleryPageClient() {
  const { locale, labels } = useLocale();
  const { photos } = usePhotos();
  const { isAuthenticated } = useAuth();

  // フォロー中フィード用: フォローしている userId 集合（認証時のみ取得）
  const [followingIds, setFollowingIds] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!isAuthenticated) { setFollowingIds(new Set()); return; }
    let aborted = false;
    void fetchFollowingSet().then((set) => { if (!aborted) setFollowingIds(new Set(set)); });
    return () => { aborted = true; };
  }, [isAuthenticated]);

  const {
    PHOTOS,
    filters,
    setFilters,
    filteredPhotos,
    currentIndex,
    open,
    close,
    next,
    prev,
  } = useGallery(photos, followingIds);

  // URLパラメータ(?photo=)から画像IDを取得してモーダルを開く。
  // 一覧タップは個別ページへ直接遷移するが、ビルド前の新着写真は
  // 静的ページが無いため、この経路（モーダル）だけが閲覧手段になる。
  // useGallery の URL 同期(replaceState)がマウント直後に ?photo= を消すため、
  // effect で読むと間に合わない。初回レンダー時に ref へ先読みしておく。
  const initialPhotoIdRef = React.useRef<string | null | undefined>(undefined);
  if (initialPhotoIdRef.current === undefined) {
    initialPhotoIdRef.current = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("photo");
  }
  React.useEffect(() => {
    const photoId = initialPhotoIdRef.current;
    if (!photoId || filteredPhotos.length === 0) return;
    const index = filteredPhotos.findIndex((p: Photo) => p.id === photoId);
    if (index !== -1) {
      initialPhotoIdRef.current = null;
      open(index);
    }
  }, [filteredPhotos, open]);

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      if (p.category) set.add(p.category);
    }
    return [...Array.from(set)];
  }, [PHOTOS]);

  const tags = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of PHOTOS) {
      for (const t of p.tags ?? []) set.add(t);
    }
    return Array.from(set);
  }, [PHOTOS]);

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
      />

      <>
        <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
          {locale === "en"
            ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
            : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
        </div>

        {filteredPhotos.length === 0 && filters.feed === "following" ? (
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
          />
        )}
      </>

      {currentIndex !== null && filteredPhotos[currentIndex] && (
        <GalleryModal
          photos={filteredPhotos}
          currentIndex={currentIndex}
          onClose={close}
          onNext={next}
          onPrev={prev}
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />
      )}
    </main>
  );
}
