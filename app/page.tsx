"use client";

import React, { startTransition } from "react";
import FilterBar from "./components/FilterBar";
import LocaleToggle from "./components/LocaleToggle";
import { useLocale } from "./i18n/context";

import type { Photo } from "./data/photos";
import useGallery from "@/lib/hooks/useGallery";
import GalleryGrid from "./components/GalleryGrid";
import { capitalize } from "../lib/utils/string";
import { generateStructuredData, generateOrganizationStructuredData, generateCollectionPageStructuredData } from "../lib/utils/seo";
import { log } from "../lib/utils/log";
import { publicFetch, PUBLIC_FETCH_TIMEOUT_MS } from "../lib/utils/api";
import {
  getBuildTimePhotosList,
  getCachedPhotos,
  setCachedPhotos,
  normalizePhotos,
  applyPublished,
} from "../lib/photos-initial";

/** 一覧は 10 件ごとにページ分割 */
const PAGE_SIZE = 10;

export default function Page() {
  const { locale, setLocale, labels } = useLocale();
  // 初期値は常にビルド時データ（F5 時のハイドレーション不一致を防ぐ）。例外時は空配列で落ちないようにする
  const [photos, setPhotos] = React.useState<Photo[]>(() => {
    try {
      return getBuildTimePhotosList();
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  /** "timeout" = タイムアウト, "error" = その他 */
  const [loadErrorType, setLoadErrorType] = React.useState<"timeout" | "error">("error");

  const loadPhotos = React.useCallback(async () => {
    setLoadError(false);

    const cached = getCachedPhotos();
    if (cached && cached.length > 0) {
      setPhotos(cached);
    }
    const initial = cached && cached.length > 0 ? cached : getBuildTimePhotosList();
    if (initial.length === 0) {
      setLoading(true);
    }

    const finishLoading = (list: Photo[]) => {
      startTransition(() => {
        setPhotos(list);
        setCachedPhotos(list);
        setLoadError(false);
        setLoading(false);
      });
    };

    try {
      // 1) 同一オリジンの静的 JSON を優先（本番で確実に同じオリジンへ問い合わせるため絶対URLを使用）
      const staticUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/app/data/photos.json`
          : "/app/data/photos.json";
      const staticTimeoutMs = 2500;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), staticTimeoutMs);
      let fromStatic = false;
      try {
        const res = await fetch(staticUrl, { cache: "no-store", signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          finishLoading(applyPublished(normalizePhotos(data)));
          fromStatic = true;
          return;
        }
      } catch {
        clearTimeout(timeoutId);
      }

      if (fromStatic) return;

      // 2) フォールバック: API から取得
      const response = await publicFetch(
        "/photos",
        { cache: "no-store" },
        PUBLIC_FETCH_TIMEOUT_MS
      );
      if (response.ok) {
        const data = await response.json();
        finishLoading(applyPublished(normalizePhotos(data)));
      } else {
        log.error("写真の取得に失敗しました");
        setLoadErrorType("error");
        setLoadError(true);
      }
    } catch (error) {
      const isTimeout =
        error instanceof Error && error.name === "AbortError";
      log.error(isTimeout ? "写真取得がタイムアウトしました" : "写真取得エラー:", error);
      setLoadErrorType(isTimeout ? "timeout" : "error");
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // LCP 短縮: 先頭1枚だけ画像を preload し、ブラウザの帯域を集中させる（12枚まとめより体感が速い）
  React.useEffect(() => {
    if (!photos.length) return;
    const src = photos[0]?.src;
    if (!src || !src.startsWith("http")) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = src;
    document.head.appendChild(link);
    return () => {
      try {
        link.remove();
      } catch {
        /* ignore */
      }
    };
  }, [photos]);

  // 初回でデータが無いときに長時間ロードしたらタイムアウト表示にして再試行できるようにする
  React.useEffect(() => {
    if (!loading || photos.length > 0) return;
    const timeoutMs = 8000;
    const t = setTimeout(() => {
      setLoadError(true);
      setLoadErrorType("timeout");
      setLoading(false);
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [loading, photos.length]);

  // タブに戻ったときに一覧を再取得（スマホで別タブで編集・アップロードした変更を即時反映）
  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadPhotos();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadPhotos]);

  // トップは詳細リンク方式のためモーダル用の currentIndex/open/close は未使用。フィルター・一覧用のみ利用。
  const { PHOTOS, filters, setFilters, filteredPhotos } = useGallery(photos);

  // 10 件ごとのページネーション（1 始まり）
  const [currentPage, setCurrentPage] = React.useState(1);

  const totalPages = Math.max(1, Math.ceil(filteredPhotos.length / PAGE_SIZE));

  // フィルター変更時は 1 ページ目に戻す
  const filtersSignature = React.useMemo(
    () => JSON.stringify({ c: filters.category, t: filters.selectedTags, q: filters.query, s: filters.sort }),
    [filters.category, filters.selectedTags, filters.query, filters.sort]
  );
  React.useEffect(() => {
    setCurrentPage(1);
  }, [filtersSignature]);

  // 現在ページのスライス（フィルタは使わずスライスのみ。src が無い場合は GalleryGrid 内でプレースホルダー表示）
  const photosToShow = React.useMemo(
    () => filteredPhotos.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredPhotos, currentPage]
  );
  const pageFrom = filteredPhotos.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageTo = Math.min(currentPage * PAGE_SIZE, filteredPhotos.length);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

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
    const category = labels?.category;
    const names = category?.names ?? {};
    const allLabel = category?.all ?? "All";
    for (const key of categories) {
      map[key] = key === "all" ? allLabel : names[key] ?? capitalize(key.replace(/-/g, " "));
    }
    for (const p of PHOTOS) {
      const k = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
      if (k && !map[k]) map[k] = names[k] ?? capitalize(k.replace(/-/g, " "));
    }
    return map;
  }, [labels, categories, PHOTOS]);

  // subtitle を string | string[] のどちらでも扱うヘルパー（モバイルでタイトに詰める）
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
        {/* モバイル: inline-block + 改行で安定して詰める。sm以上はインラインで続ける */}
        <span className="inline-block align-baseline sm:inline">{first}</span>
        {/* モバイルのみ確実に改行 */}
        {rest ? <br className="block sm:hidden" /> : null}
        {rest ? (
          <span
            // モバイルでは微負の上マージンで段落間を詰める。必要なら値を調整してください。
            className="inline-block align-baseline sm:inline -mt-1 sm:mt-0"
            style={{ lineHeight: "1.05" }}
          >
            {rest}
          </span>
        ) : null}
      </p>
    );
  };

  // 構造化データ（JSON-LD）。例外時は空オブジェクトで落ちないようにする
  const structuredData = React.useMemo(() => {
    try {
      return generateStructuredData(PHOTOS ?? []);
    } catch {
      return { "@context": "https://schema.org", "@type": "ImageGallery", image: [] };
    }
  }, [PHOTOS]);

  const collectionPageData = React.useMemo(() => {
    try {
      return generateCollectionPageStructuredData(PHOTOS ?? []);
    } catch {
      return { "@context": "https://schema.org", "@type": "CollectionPage", mainEntity: { "@type": "ItemList", numberOfItems: 0, itemListElement: [] } };
    }
  }, [PHOTOS]);

  const organizationData = React.useMemo(() => {
    try {
      return generateOrganizationStructuredData();
    } catch {
      return { "@context": "https://schema.org", "@type": "Organization", name: "PhotoGallery" };
    }
  }, []);

  const structuredDataHtml = React.useMemo(() => {
    try {
      return JSON.stringify(structuredData);
    } catch {
      return "{}";
    }
  }, [structuredData]);
  const collectionPageDataHtml = React.useMemo(() => {
    try {
      return JSON.stringify(collectionPageData);
    } catch {
      return "{}";
    }
  }, [collectionPageData]);
  const organizationDataHtml = React.useMemo(() => {
    try {
      return JSON.stringify(organizationData);
    } catch {
      return "{}";
    }
  }, [organizationData]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: structuredDataHtml }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: collectionPageDataHtml }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: organizationDataHtml }}
      />
      <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
          <div className="flex-1">
            <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
              {labels.site?.title ?? "Gallery"}
            </h1>

            {renderSubtitle(labels.site?.subtitle)}
          </div>

          <div className="flex-shrink-0">
            <LocaleToggle
              locale={locale}
              setLocale={setLocale}
              labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
            />
          </div>
        </div>

        <FilterBar
          categories={categories}
          tags={tags}
          values={filters}
          onChange={(next) => setFilters(next)}
          className="mb-4"
          locale={locale}
          categoryDisplayMap={categoryDisplayMap}
        />

        {loading && !loadError && photos.length === 0 ? (
          <p className="text-center text-white/50 text-sm py-8" role="status" aria-live="polite" aria-label={locale === "en" ? "Loading" : "読み込み中"}>
            {locale === "en" ? "Loading…" : "読み込み中…"}
          </p>
        ) : loadError && photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-white/80 mb-4">
              {loadErrorType === "timeout"
                ? (locale === "en"
                  ? "Request timed out (8s). Please try again."
                  : "接続がタイムアウトしました（8秒）。しばらくしてから再試行してください。")
                : (locale === "en"
                  ? "Failed to load photos."
                  : "写真の読み込みに失敗しました")}
            </p>
            <button
              type="button"
              onClick={() => loadPhotos()}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              aria-label={locale === "en" ? "Retry" : "再試行"}
            >
              再試行
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3 sm:mb-4 text-xs sm:text-sm text-white/70">
              {locale === "en"
                ? `${labels.gallery?.resultsCount ?? "Results"}: ${filteredPhotos.length}`
                : `${labels.gallery?.resultsCount ?? "結果"}: ${filteredPhotos.length} 件`}
              {filteredPhotos.length > 0 && (
                <span className="text-white/50 ml-1">
                  {(labels.gallery?.pageRange ?? (locale === "en" ? "{{from}}-{{to}} of {{total}}" : "{{from}}-{{to}} 件目（全 {{total}} 件）"))
                    .replace("{{from}}", String(pageFrom))
                    .replace("{{to}}", String(pageTo))
                    .replace("{{total}}", String(filteredPhotos.length))}
                </span>
              )}
            </div>

            <GalleryGrid
              photos={photosToShow}
              linkToDetailPage
              locale={locale}
              categoryDisplayMap={categoryDisplayMap}
            />

            {totalPages > 1 && (
              <div className="mt-6 relative z-[50] min-h-[52px] flex items-center justify-center" style={{ isolation: "isolate" }}>
                <nav
                  className="flex items-center justify-center gap-3 py-2"
                  aria-label={locale === "en" ? "Pagination" : "ページネーション"}
                  style={{ touchAction: "manipulation" }}
                >
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={!hasPrev}
                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 cursor-pointer"
                    aria-label={labels.gallery?.prevPage ?? (locale === "en" ? "Previous page" : "前のページ")}
                  >
                    {labels.gallery?.prevPage ?? (locale === "en" ? "Previous" : "前へ")}
                  </button>
                  <span className="text-white/60 text-sm tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={!hasNext}
                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 cursor-pointer"
                    aria-label={labels.gallery?.nextPage ?? (locale === "en" ? "Next page" : "次のページ")}
                  >
                    {labels.gallery?.nextPage ?? (locale === "en" ? "Next" : "次へ")}
                  </button>
                </nav>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
