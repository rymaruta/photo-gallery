# SEO 対策と推奨実装

このドキュメントでは、現在の SEO 実装の整理と、追加で推奨する施策をまとめています。

---

## 現在の実装まとめ

| 項目 | 実装状況 | 場所・備考 |
|------|----------|------------|
| **メタデータ** | ✅ | `app/layout.tsx`: title, description, keywords, metadataBase |
| **Open Graph** | ✅ | layout / 各ページ: og:type, og:image, og:url, siteName, locale |
| **Twitter Card** | ✅ | summary_large_image, title, description, images, creator |
| **canonical** | ✅ | layout: alternates.canonical。写真ページ: generateMetadata で URL 指定 |
| **hreflang** | ✅ | alternates.languages（ja, en, x-default）で多言語対応 |
| **robots** | ✅ | `app/robots.ts`: allow /, disallow /api/, /admin/, /login/, /upload/, sitemap URL |
| **sitemap.xml** | ✅ | `app/sitemap.ts`: トップ・about・favorites・history・gallery・各写真ページ |
| **構造化データ（JSON-LD）** | ✅ | WebSite（layout）, ImageGallery / CollectionPage / Organization（トップ）, ImageObject（写真詳細）, **BreadcrumbList**（about / favorites / history / gallery / 写真詳細） |
| **Google Search Console 検証** | ✅ | layout の verification.google。DNS TXT または HTML タグで検証 |

---

## 追加で推奨する施策

### 1. Google Search Console の設定（推奨）

1. [Google Search Console](https://search.google.com/search-console) にアクセスし、プロパティを追加（URL プレフィックスで `https://journey-photo.com` を登録）。
2. **「所有権の確認」** で **HTML タグ** を選び、表示された `content="..."` の値をコピー。
3. プロジェクトの **`app/layout.tsx`** で、`metadata.verification` を有効化する。

   ```ts
   verification: {
     google: "ここにコピーした検証コードを貼る",
   },
   ```

4. 本番デプロイ後、Search Console で「確認」をクリック。
5. **サイトマップ** に `https://journey-photo.com/sitemap.xml` を送信。

これでインデックス状況や検索クエリを確認できます。

---

### 2. OGP 画像の用意（推奨）

- **推奨サイズ**: 1200 × 630 px（Facebook / X 共通）。
- **配置**: `public/images/og-image.jpg`（`lib/utils/seo.ts` の `siteConfig.ogImage` で参照）。
- **暫定**: `og-image.jpg` が無い場合は `npm run prepare:og-image` で `sample1.jpg` のコピーを作成できます。本番では 1200×630 px の専用画像に差し替えることを推奨します。
- トップページや写真のイメージが分かる画像にすると、SNS シェア時の見栄えが良くなります。
- 本番の絶対 URL で配信されるように、`metadataBase`（layout）と `siteConfig.url` が本番ドメインになっているか確認してください。

---

### 3. パフォーマンス（Core Web Vitals）

- **画像**: すでに Next.js の `<Image>` や適切なサイズ指定があれば維持。遅延読み込み（loading="lazy"）も有効にしておく。
- **LCP**: トップのファーストビュー画像を優先読み込みする場合は、`priority` や `fetchPriority="high"` の検討。
- **CLS**: 画像に `width` / `height` または `aspect-ratio` を指定してレイアウトシフトを防ぐ（既存実装を維持）。

---

### 4. コンテンツ・内部リンク

- 各写真の **title / description / タグ** を充実させると、検索と構造化データの質が上がります。
- **about ページ** でサイトの目的・作者を簡潔に書いておくと、サイト全体の文脈が伝わります。
- トップから写真詳細へのリンクはすでにあるため、内部リンクは確保されています。

---

### 5. 検索・SNSで見つけてもらうために

| 施策 | 内容 |
|------|------|
| **写真ページの OGP** | ✅ 実装済み。各写真詳細でその写真を `og:image` に使用。SNS でシェアすると写真がプレビューに表示される。 |
| **Twitter 画像の alt** | ✅ 実装済み。写真ページの Twitter Card に画像の alt を付与（アクセシビリティ・一部クライアントで表示）。 |
| **構造化データ（Photograph）** | ✅ 実装済み。写真詳細ページで `@type: Photograph` の JSON-LD を出力。画像検索やリッチリザルトの候補になる。 |
| **sameAs（SNS リンク）** | 環境変数で設定可能。**Instagram だけ使う場合**は **NEXT_PUBLIC_INSTAGRAM_URL** だけ設定すればよい（例: `https://www.instagram.com/your_handle`）。複数 SNS を使う場合は **NEXT_PUBLIC_SAME_AS** をカンマ区切りで追加（例: `https://instagram.com/xxx,https://twitter.com/xxx`）。 |
| **Search Console・sitemap** | 上記「1. Google Search Console の設定」のとおり、プロパティ登録・サイトマップ送信（`/sitemap.xml`）でインデックス状況を確認できる。 |

### 6. その他の推奨

| 施策 | 内容 |
|------|------|
| **BreadcrumbList** | ✅ 実装済み。about / favorites / history / gallery の各 layout および写真詳細で `generateBreadcrumbStructuredData` を出力（検索結果のパンくず表示の可能性あり）。 |
| **記事・キャプション** | ブログや「撮影メモ」ページを増やすと、検索キーワードとコンテンツ量を増やせます。 |
| **OGP 画像のサイズ** | SNS では 1200×630 px が推奨。写真詳細では元画像をそのまま `og:image` にしている。トリミングされた 1200×630 を出したい場合は、別画像を用意してメタデータで指定する運用も可能。 |

---

## チェックリスト（本番公開前）

- [ ] **NEXT_PUBLIC_SITE_URL**（または `siteConfig.url`）が本番ドメイン（例: `https://journey-photo.com`）になっている
- [ ] **OGP 画像**（`og-image.jpg` など）を配置し、`/images/og-image.jpg` または設定パスでアクセスできる
- [ ] **Google Search Console** でドメインを登録し、`verification.google` を設定して検証済み
- [ ] **sitemap.xml** を Search Console に送信済み
- [ ] **robots.txt** で `/admin/`, `/login/`, `/upload/` を disallow 済み（実装済み）
- [ ] 主要ページ（トップ・写真詳細・about・favorites・history・gallery）で **title / description / keywords** が重複なく設定されている（実装済み）
- [ ] 写真詳細で **OG 画像** にその写真の URL が使われている（実装済み）
- [ ] **検索・SNS**: 本番では **NEXT_PUBLIC_INSTAGRAM_URL** を `.env.production` に設定済み（例: `https://www.instagram.com/maru_chaannn`）

---

## 参照

- **メタ・構造化データ**: `app/layout.tsx`, `app/photo/[id]/page.tsx`, `lib/utils/seo.ts`
- **サイトマップ**: `app/sitemap.ts`
- **robots**: `app/robots.ts`
