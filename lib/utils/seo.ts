// lib/utils/seo.ts
// SEO設定と構造化データ生成用のユーティリティ

export const siteConfig = {
    name: "Journey Photo | 旅フォトギャラリー",
    description: "旅の記憶を写真で残す。国内外の旅行写真・風景写真・スナップ写真を集めたフォトギャラリー。旅先の景色や日常のひとこまを届けます。",
    descriptionEn: "A travel photography gallery capturing journeys, landscapes, and everyday moments.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://journey-photo.com",
    ogImage: "/images/og-image.jpg",
    twitterHandle: "@JourneyPhoto",
    author: "Journey Photo",
    locale: {
        ja: "ja_JP",
        en: "en_US",
    },
    // 環境名（prod / staging）。ビルド時に注入する。robots.txt の出し分けに使う。
    envName: process.env.NEXT_PUBLIC_ENV_NAME || "prod",
    // 計測（すべて公開情報・ページソースに出る値）。未設定なら何も出さない。
    // 既定値は置かない。以前は本番の GA4 ID が既定だったため、
    // staging のアクセスが本番の解析に混ざる状態だった。
    gaId: process.env.NEXT_PUBLIC_GA_ID || "",                       // GA4 測定ID（公開情報）
    plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "", // Plausible を使う場合のドメイン（GA未使用時）
    gscVerification: process.env.NEXT_PUBLIC_GSC_VERIFICATION || "", // Google Search Console のメタタグ確認トークン
    // 問い合わせ先（プライバシーポリシーに掲載）。AdSense の審査では連絡手段が見られる。
    contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
    // AdSense のパブリッシャーID（ca-pub-...）。設定するまで広告タグは出力しない。
    adsenseClientId: process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID || "",
    bingVerification: process.env.NEXT_PUBLIC_BING_VERIFICATION || "", // Bing の msvalidate.01
};

/**
 * 構造化データ（JSON-LD）を生成 - ギャラリーページ用
 */
export function generateStructuredData(
    photos: Array<{ id: string; title?: string | { ja?: string; en?: string }; src: string }>,
    // タグ・撮影地・カテゴリのページも同じ関数を使う。渡さないと
    // **約35個のURLが「自分はトップページだ」と申告する**（name も
    // description も url も siteConfig 直書きだった）。
    // 正しい値は CollectionPage.tsx が既に組み立てている。
    page?: { name?: string; description?: string; url?: string },
) {
    return {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        name: page?.name || siteConfig.name,
        description: page?.description || siteConfig.description,
        url: page?.url || siteConfig.url,
        image: photos
            .filter((photo) => photo.id && photo.src)
            .map((photo) => {
                const imageUrl = photo.src.startsWith("http") 
                    ? photo.src 
                    : `${siteConfig.url}${photo.src}`;
                return {
                    "@type": "ImageObject",
                    "@id": `${siteConfig.url}/photo/${photo.id}`,
                    contentUrl: imageUrl,
                    name: typeof photo.title === "string" 
                        ? photo.title 
                        : photo.title?.ja || photo.title?.en || "",
                };
            }),
    };
}

/**
 * 個別写真ページ用の構造化データを生成
 */
export function generatePhotoStructuredData(photo: {
    id: string;
    title?: string | { ja?: string; en?: string };
    description?: string | { ja?: string[]; en?: string[] };
    src: string;
    thumbSrc?: string;
    tags?: string[];
    photographer?: string;
    displayName?: string;
    license?: string;
    copyrightOwner?: string;
    copyrightYear?: string;
    location?: string;
    coords?: { lat: number; lng: number };
    /** 撮影日（EXIF 由来）。dateCreated はこちらを使う */
    date?: string;
    createdAt?: string;
    updatedAt?: string;
    width?: number;
    height?: number;
}, locale: "ja" | "en" = "ja") {
    const titleOf = (loc: "ja" | "en") =>
        typeof photo.title === "string" ? photo.title : photo.title?.[loc] || "";
    const descOf = (loc: "ja" | "en") => {
        if (typeof photo.description === "string") return photo.description;
        const arr = photo.description?.[loc];
        return Array.isArray(arr) ? arr.join(" ") : "";
    };
    const other: "ja" | "en" = locale === "ja" ? "en" : "ja";
    const title = titleOf(locale) || titleOf(other) || "";
    const altTitle = titleOf(other);
    // 説明は日英を併記（両言語のクエリで拾えるように）
    const descMain = descOf(locale);
    const descOther = descOf(other);
    const description = [descMain, descOther && descOther !== descMain ? descOther : ""]
        .filter(Boolean).join(" / ");

    const imageUrl = photo.src.startsWith("http")
        ? photo.src
        : `${siteConfig.url}${photo.src}`;

    const structuredData: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        "@id": `${siteConfig.url}/photo/${photo.id}`,
        contentUrl: imageUrl,
        name: title,
        ...(altTitle && altTitle !== title ? { alternateName: altTitle } : {}),
        description: description || siteConfig.description,
        ...(description ? { caption: description } : {}),
        url: `${siteConfig.url}/photo/${photo.id}`,
        representativeOfPage: true,
    };

    // Google 画像検索向けメタデータ（データがある項目だけ出力）
    if (photo.thumbSrc) {
        structuredData.thumbnailUrl = photo.thumbSrc.startsWith("http")
            ? photo.thumbSrc
            : `${siteConfig.url}${photo.thumbSrc}`;
    }
    if (photo.tags && photo.tags.length > 0) {
        structuredData.keywords = photo.tags.join(", ");
    }
    // license は URL 形式のみ有効（自由文はここでは出さない）。取得ページとして写真ページを提示
    if (photo.license && /^https?:\/\//.test(photo.license)) {
        structuredData.license = photo.license;
        structuredData.acquireLicensePage = `${siteConfig.url}/photo/${photo.id}`;
    }
    // 権利表記（自由文OKのフィールド）
    const credit = photo.photographer || photo.displayName;
    if (credit) structuredData.creditText = credit;
    const copyright = photo.license && !/^https?:\/\//.test(photo.license)
        ? photo.license
        : (photo.copyrightOwner ? `© ${photo.copyrightYear ?? ""} ${photo.copyrightOwner}`.replace(/\s+/g, " ").trim() : "");
    if (copyright) structuredData.copyrightNotice = copyright;

    // 作者。photographer だけを見ていたため、実データ（30件中0件）では
    // 一度も出力されていなかった。creditText 側は displayName に落ちているので、
    // 同じ値を使う（「クレジットはあるのに作者は空」という状態をやめる）。
    if (credit) {
        structuredData.creator = {
            "@type": "Person",
            name: credit,
        };
    }
    
    if (photo.location) {
        const contentLocation: Record<string, unknown> = {
            "@type": "Place",
            name: photo.location,
        };
        
        if (photo.coords) {
            contentLocation.geo = {
                "@type": "GeoCoordinates",
                latitude: photo.coords.lat,
                longitude: photo.coords.lng,
            };
        }
        
        structuredData.contentLocation = contentLocation;
    }
    
    if (photo.width && photo.height) {
        structuredData.width = photo.width;
        structuredData.height = photo.height;
    }
    
    // dateCreated は「撮った日」。createdAt（登録日時）を入れていたため、
    // ページ本文が 2024-10-12 と表示している写真の構造化データが
    // 2026-04-12 を申告していた（実データで約1年半のずれ）。
    // datePublished（公開日）は登録日時のままでよい。
    // **createdAt にフォールバックしない。** 撮影日を持つのは30枚中8枚で、
    // 残りは「撮った日」としてアップロード日を申告していた。
    // 本文側（PhotoPageClient）も同じ理由で行ごと出さないようにしてある。
    // 分からないなら黙る方が、嘘を機械可読で配るより良い。
    if (photo.date) structuredData.dateCreated = photo.date;
    if (photo.createdAt) structuredData.datePublished = photo.createdAt;

    if (photo.updatedAt) {
        structuredData.dateModified = photo.updatedAt;
    }

    return structuredData;
}

/**
 * サイト全体の構造化データ（Organization）を生成
 */
export function generateOrganizationStructuredData() {
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        logo: {
            "@type": "ImageObject",
            url: `${siteConfig.url}${siteConfig.ogImage}`,
        },
        sameAs: [
            // SNSアカウントがあれば追加
            // "https://www.instagram.com/your_handle",
        ],
    };
}

/**
 * BreadcrumbList構造化データを生成
 */
export function generateBreadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            item: item.url,
        })),
    };
}

/**
 * WebSite構造化データを生成（検索ボックス用）
 */
export function generateWebSiteStructuredData() {
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        potentialAction: {
            "@type": "SearchAction",
            target: {
                "@type": "EntryPoint",
                urlTemplate: `${siteConfig.url}/?q={search_term_string}`,
            },
            "query-input": "required name=search_term_string",
        },
    };
}

/**
 * ログイン後に使う画面（お気に入り・アップロード・管理など）のメタデータ。
 *
 * これらは "use client" のページで metadata を持てないため、ルートの
 * メタデータをそのまま継承していた。結果として **canonical がトップページを
 * 指し**、検索エンジンには「/favorites はトップと同じページ」と申告していた。
 * 中身も（ログインしないと何も出ないので）検索結果に出す価値が無い。
 *
 * 各セグメントの layout.tsx から使う。
 */
export function appPageMetadata(path: string, title: string) {
    return {
        title,
        alternates: { canonical: `${siteConfig.url}${path}` },
        // 検索結果に出さない。リンクは辿ってよい（サイト内の回遊は残す）
        robots: { index: false, follow: true },
    };
}


/**
 * 配下に複数ページを持つセグメント用。canonical は持たせない。
 *
 * レイアウトのメタデータは子のページにも継承される。canonical を書くと
 * /user/upload も /user/drafts も「/user が正規URL」と名乗ることになり、
 * しかも /user というページは存在しない——存在しないURLを正規URLとして
 * 申告する形になる（撮影地ページの二重エンコードで踏んだのと同じ形）。
 */
export function noindexMetadata(title: string) {
    return {
        title,
        // canonical は出さない。
        //
        // 書くと子のページにも継承され、/user/upload も /user/drafts も
        // 「/user が正規URL」と名乗る（しかも /user というページは無い）。
        // かといって省くと、ルートの canonical をそのまま継承して
        // 「これはトップページです」と申告する——どちらも嘘になる。
        // null を渡すと <link rel="canonical"> 自体が出なくなる。
        // 検索結果に出さないページなので、これでよい。
        alternates: { canonical: null },
        robots: { index: false, follow: true },
    };
}
