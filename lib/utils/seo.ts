// lib/utils/seo.ts
// SEO設定と構造化データ生成用のユーティリティ
import { spacelessName } from "./nameVariants";
import { personNodeId } from "./personId";
import { metaText } from "./metaText";

/**
 * 公開する画像URLを、**サイトのドメインに揃える**。
 *
 * **同じ写真が2つのホストで出ていた。** 実ビルド（2026-09-12）:
 *
 *     sitemap-images.xml の <image:loc>  30件 = journey-photo.com 19 + d1s3….cloudfront.net 11
 *     og:image                           138ページ = 69 + 69
 *
 * どちらも**同じ CloudFront ディストリビューション**（`EYRLTGCPOS9E4`）の
 * 別名で、返るバイトは同一。それでも検索エンジンには**別々の画像**に見える
 * ので、画像検索の評価が2つに割れ、しかも半分は正規のドメインではない側に
 * 付く（実データの30枚で 19 / 11 に割れている。下の「訂正」も読むこと）。
 *
 * **保存済みのデータは書き換えない。** 移行（`scripts/normalize-image-urls.js`）
 * も用意してあるが、本番のDBを触るのは owner の判断で、しかも**出す側で
 * 揃えれば SEO の問題はそれで解ける**（宣言するURLが1つになる）。
 * ここは「出すときに揃える」側。
 *
 * **訂正（2026-09-13・コードを読んで確かめた）。** 「保存側は直ったので
 * これは後片付け」は**写真の本体URLには当てはまらない**:
 *
 *     api-user/src/upload.ts   `canonicalUploadUrl(publicUrl, CLOUDFRONT_URL)`
 *     api/src/upload.ts        `${CLOUDFRONT_URL}/${key}`
 *     deploy-api.yml           本番の cloudfrontUrl は CloudFront の既定ドメイン
 *
 * ＝**これから上がる写真も既定ドメインで保存される**。直っているのは
 * ビルドが作る派生（`generate-thumbnails.js` は `PUBLIC_BASE_URL` を優先）
 * の方だけ。つまり移行を1回流しても、次の投稿からまた割れる
 * ——**出す側で揃えるこの関数が、恒常的な受け皿**になる。
 *
 * **画像以外にも使う。** ストーリーの動画（`<video src>`）も同じ
 * `/uploads/**` から同じ配信で出るので、同じ規則で揃える
 * （別名の関数は作らない——同じ規則を2つの名前で持たない）。
 *
 * **揃えるのは自分の配信ドメインだけ。** 知らないホストは触らない
 * （曲のアートワークなど、別のところから来るURLがある）。
 */
const CDN_HOST = (() => {
    try {
        return new URL(process.env.NEXT_PUBLIC_CLOUDFRONT_URL || "").host;
    } catch {
        return "";
    }
})();

export function publicImageUrl(src: string | undefined): string {
    const v = (src ?? "").trim();
    if (!v) return "";
    const base = process.env.NEXT_PUBLIC_SITE_URL || "https://journey-photo.com";
    if (!/^https?:\/\//i.test(v)) return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
    try {
        const u = new URL(v);
        if (CDN_HOST && u.host === CDN_HOST) {
            const site = new URL(base);
            u.protocol = site.protocol;
            u.host = site.host;
            return u.toString();
        }
        return v;
    } catch {
        return v;
    }
}

export const siteConfig = {
    name: "Journey Photo | 旅フォトギャラリー",
    description: "旅の記憶を写真で残す。国内外の旅行写真・風景写真・スナップ写真を集めたフォトギャラリー。旅先の景色や日常のひとこまを届けます。",
    descriptionEn: "A travel photography gallery capturing journeys, landscapes, and everyday moments.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://journey-photo.com",
    // **写真が1枚も無いときの落とし先。** 以前ここに
    // `/images/og-image.jpg` と書いてあったが、そのファイルは
    // **リポジトリにもビルド成果物にも存在しない**（git の全履歴にも
    // 一度も現れない）。16ページがこの URL を OGP 画像として出しており、
    // トップを SNS に貼っても画像が出なかった。
    // 通常は `resolveOgImage`（`lib/server/photos.ts`）がビルド時に
    // 一番新しい公開写真を返す。**この値を直接読むページはもう無い**が、
    // 落とし先と `Organization.logo` がここから引くので残す
    // ——同じパスを3か所に散らさないため。
    ogImage: "/icon-512.png",
    twitterHandle: "@JourneyPhoto",
    author: "Journey Photo",
    // `en` は落とした。参照していたのは `og:locale:alternate` だけで、
    // 英語版の URL は存在しない（言語切替は `6d72bfb` で削除済み）
    locale: {
        ja: "ja_JP",
    },
    // 環境名（prod / staging）。ビルド時に注入する。robots.txt の出し分けに使う。
    //
    // **既定を "prod" にしない。** ここが最後まで残っていた「本番への
    // フォールバック」で、よりによってクロール許可の切り替えだった。
    // 注入し忘れたビルドは「許可する側の robots.txt」を出すので、
    // staging の内容が本番と同じURLの重複コンテンツとして拾われる。
    // 未設定なら prod ではない扱い＝全面拒否に倒す。
    //
    // 逆側（本番なのに拒否を出してしまう取り違え）は、
    // scripts/deploy-static-site.js の assertRobotsMatchesTarget が
    // アップロード直前に止める。
    envName: process.env.NEXT_PUBLIC_ENV_NAME || "",
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
                const imageUrl = publicImageUrl(photo.src);
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
    /** 投稿者。`author` をその人のプロフィールへ結ぶのに使う */
    userId?: string;
    license?: string;
    copyrightOwner?: string;
    copyrightYear?: string;
    location?: string;
    coords?: { lat: number; lng: number };
    /** 座標が地名から引いたおおよその値（街の中心）なら true。GeoCoordinates には出さない */
    geoApprox?: boolean;
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
    // **説明はこのページの言語で1本だけ。**
    //
    // 以前は日英を `" / "` で併記していた（「両言語のクエリで拾えるように」）。
    // 実ビルドの JSON-LD はこうなっていた:
    //
    //     description: "北海道にも春が訪れ… / Spring has come to Hokkaido…"
    //
    // 同じページの `<meta name="description">` は**日本語だけ**を出して
    // いる。schema.org の
    // `description` は「そのものの説明」で、2言語を `/` で繋いだ文字列は
    // どちらの言語としても読めない。`locale` は `ja` 固定で英語ページは
    // 存在しないので（`og:locale:alternate` も同じ理由で撤去済み）、
    // このページの言語を出し、無いときだけもう一方に落とす。
    //
    // **英語がサイトから消えたわけではない**——写真ページは `sr-only` の
    // 英語ブロックを静的HTMLに持つ（実ビルドで28/30）。そこをどうするかは
    // 別の判断として残している。
    //
    // **題の別言語は捨てていない**——`alternateName` が持つ（あちらは
    // 「別の呼び名」を置く正しい場所で、混ぜ物にならない）。
    // 1行に均す（`metaText` の説明を参照）。JSON-LD の description と
    // caption、画像サイトマップの caption がここから出る
    const description = metaText(descOf(locale) || descOf(other));

    const imageUrl = publicImageUrl(photo.src);

    const structuredData: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        "@id": `${siteConfig.url}/photo/${photo.id}`,
        contentUrl: imageUrl,
        // 名前が無い写真は実在する（`sanitizeTitle` は空なら属性ごと消す）。
        // `""` を出すと、同じページのパンくずが出す名前と食い違う
        name: title || "無題",
        ...(altTitle && altTitle !== title ? { alternateName: altTitle } : {}),
        // **説明が無いときにサイトのキャッチコピーを名乗らない。**
        // 「この写真の説明はサイトの宣伝文です」と機械可読で配ることになり、
        // 説明を空にした写真が全部同じ description を持つ。分からないなら
        // 黙る（撮影日で採ったのと同じ判断）
        ...(description ? { description } : {}),
        ...(description ? { caption: description } : {}),
        url: `${siteConfig.url}/photo/${photo.id}`,
        representativeOfPage: true,
    };

    // Google 画像検索向けメタデータ（データがある項目だけ出力）
    if (photo.thumbSrc) {
        structuredData.thumbnailUrl = publicImageUrl(photo.thumbSrc);
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
    //
    // **`author` も出す。そして `url` でプロフィールへ結ぶ。**
    //
    // 一度は `creator` だけだった。`creator` も正しい語だが、**人名で
    // 探されたときに効くのは「この30ページは同じ人のもの」と機械に
    // 言えること**で、そのための標準の語は `author`（`ImageObject` は
    // `CreativeWork` なので両方使える）。しかも名前を書くだけでは
    // **同姓同名と区別が付かない**——`url` を添えて初めて
    // 「`/users/<id>` に居るその人」という一つの実体を指せる。
    //
    // 実測（2026-09-12・実ビルド）: 写真ページ30枚はどれも表示名を5回
    // 出しているのに、**構造化データでは `creator` の名前だけ**で、
    // プロフィールへ結ぶものが1つも無かった（`author` も
    // `<meta name="author">` も無し）。
    if (credit) {
        const person: Record<string, unknown> = { "@type": "Person", name: credit };
        // 空白を詰めた別表記も添える（「丸田 竜平」→「丸田竜平」）。
        // プロフィールの `Person` と同じ規則で作る＝30枚の写真ページと
        // `/users/<id>` が**同じ名前の集合**を名乗る
        const alt = spacelessName(credit);
        if (alt) person.alternateName = alt;
        if (photo.userId) {
            const profileUrl = `${siteConfig.url}/users/${photo.userId}`;
            person.url = profileUrl;
            // **`/users/<id>` の `Person` と同じ節点だと名乗る。**
            // `url` だけだと「同じ人らしい」までで、言い切ってはいない
            person["@id"] = personNodeId(profileUrl);
        }
        structuredData.creator = person;
        structuredData.author = person;
    }
    
    if (photo.location) {
        const contentLocation: Record<string, unknown> = {
            "@type": "Place",
            name: photo.location,
        };
        
        // **おおよその座標は「撮影地点」として出さない。** 画面では
        // 「地図で見る」を消したのに、構造化データにだけ街の中心を
        // GeoCoordinates として書くと、検索エンジンにはそこで撮ったと伝わる
        if (photo.coords && !photo.geoApprox) {
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
        // **実在するファイルを指す。** ここも `/images/og-image.jpg`
        // （リポジトリにもビルド成果物にも無い）を指していた。ロゴは
        // 「一番新しい写真」では意味が通らないのでアイコンを使う
        // （パスは `siteConfig.ogImage` の1か所から引く）
        logo: {
            "@type": "ImageObject",
            url: `${siteConfig.url}${siteConfig.ogImage}`,
            width: 512,
            height: 512,
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
/**
 * フィードの場所（`<link rel="alternate" type="application/rss+xml">`）。
 *
 * **`alternates` を書くページは、必ずこれを混ぜること。**
 * Next のメタデータは `alternates` を**オブジェクトごと差し替える**ので、
 * ルートのレイアウトに書いても、子が `alternates: { canonical }` を返した
 * 瞬間に消える——実際、トップページがそうで**フィードの宣言が
 * どのページにも出ていなかった**（実ビルドの141枚中、出ていたのは
 * 404 の2枚だけ）。`INDEXABLE_ROBOTS` が同じ理由で同じ形にしてある
 * （あちらは `/users/<id>` が googlebot の指定を落とした）。
 */
export const FEED_ALTERNATE = {
    types: { "application/rss+xml": [{ url: `${siteConfig.url}/feed.xml`, title: siteConfig.name }] },
};

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
/**
 * 「検索結果に出す」ページの robots。
 *
 * **`robots` はキー単位ではなくオブジェクトごと差し替わる。**
 * `app/layout.tsx` が `googleBot: { "max-image-preview": "large" … }` を
 * 持っているのに、子が `robots: { index: true, follow: true }` とだけ書くと
 * **その拡張が消える**——実測で、`index, follow` なのに `googlebot` の
 * meta が無いのは `/users/<id>` だけだった。写真を検索に出すサイトで
 * 画像プレビューの拡大許可を落とすのは痛い。継ぐのではなく**ここから引く**。
 */
export const INDEXABLE_ROBOTS = {
    index: true,
    follow: true,
    googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
    },
} as const;

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
