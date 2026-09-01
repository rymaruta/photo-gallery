import type { Photo } from "@/lib/data/photos";
import PhotoPageClient from "./PhotoPageClient";
import type { Metadata } from "next";
import { splitStoredDate } from "@/lib/utils/photoDate";
import { ja } from "../../i18n/labels";
import { siteConfig } from "@/lib/utils/seo";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import { loadAllPhotos } from "@/lib/server/photos";
import { relatedSections, adjacentPhotos } from "@/lib/utils/related";
import { withPlaceholderParam } from "../../../lib/server/staticParams";

// 写真データを読み込む関数
async function loadPhoto(id: string): Promise<Photo | null> {
    const photos = await loadAllPhotos();
    return photos.find((p) => p.id === id) || null;
}

// 静的生成用のパラメータ生成関数
export async function generateStaticParams() {
    const photos = await loadAllPhotos();
    // 写真が0件でも1件は返す（空だと output: export がビルドを落とす）
    return withPlaceholderParam(
        photos
            .filter((photo) => photo.published !== false)
            .map((photo) => ({ id: photo.id })),
        "id",
    );
}

// メタデータ生成
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const photo = await loadPhoto(id);
    
    if (!photo) {
        return {
            title: "Photo Not Found",
            description: "The photo you are looking for does not exist.",
        };
    }
    
    // **日本語のサイトに "Untitled" を出さない。** 言い回しは既存に揃える
    // （`/admin`・`/user/drafts`・下書きの既定タイトルはどれも「無題」）。
    // タイトルは空にできる
    // （`sanitizeTitle` が空なら属性ごと REMOVE する）ので、公開のまま
    // 名前の無い写真が実在しうる。`a287ee3` で潰した「日本語UIに残る英語」
    // と同じ型だった
    const title = getLocalized(photo.title, "ja") || getLocalized(photo.title, "en") || "無題";
    const descriptionParagraphs = getLocalizedParagraphs(photo.description, "ja");
    const ownDescription = descriptionParagraphs.length > 0
        ? descriptionParagraphs.join(" ")
        : getLocalizedParagraphs(photo.description, "en").join(" ");
    // **説明が無いときに、サイトのキャッチコピーを名乗らない。**
    // 説明を空にした写真が全部**同じ meta description** を持つことになり、
    // しかも「この写真の説明はサイトの宣伝文です」と申告する形になる。
    // 分かっている事実だけで組み立て、それも無ければサイトの説明に落とす。
    //
    // **要素ごとに助詞を分ける。** 最初は「・」で連ねて「〜で撮影した写真。」
    // と書いたが、(a) カテゴリを「で撮影した」の目的語にしてしまう
    // （`風景で撮影した写真`）、(b) 日付だけのときに「2024年で撮影した」と
    // 非文法的になる、(c) **カテゴリの生スラッグがそのまま出る**
    // （`東京・landscape・2024年で…`。実データ30枚中19枚が英語スラッグで、
    // 画面は `app/i18n/labels.ts` の日本語ラベルを出している）——`a287ee3`
    // で潰した「日本語UIに残る英語」を作っていた。
    const year = splitStoredDate(String(photo.date ?? ""))?.y;
    const categoryRaw = (photo.category ?? "").toString().trim().toLowerCase();
    const categoryLabel = (ja.category.names as Record<string, string>)[categoryRaw]
        || (photo.category ?? "").toString().trim();
    const place = (photo.location ?? "").toString().trim();
    const when = year ? `${year}年に` : "";
    const where = place ? `${place}で` : "";
    const what = categoryLabel ? `${categoryLabel}の写真。` : "写真。";
    // 場所も日付も無ければ「撮影した」を付けない（`撮影した風景の写真。`
    // は日本語として落ち着かない）
    const description = ownDescription
        || (place || year ? `${where}${when}撮影した${what}` : "")
        || (categoryLabel ? `${categoryLabel}の写真。` : "")
        || siteConfig.description;
    
    const imageUrl = photo.src.startsWith("http") 
        ? photo.src 
        : `${siteConfig.url}${photo.src}`;
    
    const pageUrl = `${siteConfig.url}/photo/${id}`;
    
    return {
        // サイト名は app/layout.tsx の `template` が付ける。ここでも足すと
        // `未完の大聖堂 | Journey Photo | 旅フォトギャラリー | Journey Photo 旅フォトギャラリー`
        // になり、検索結果で切られる位置に定型文が45〜60字並ぶ。
        title,
        description: description,
        keywords: [
            ...(photo.tags || []),
            photo.category || "",
            photo.location || "",
        ].filter(Boolean),
        authors: photo.photographer ? [{ name: photo.photographer }] : undefined,
        openGraph: {
            type: "website",
            locale: "ja_JP",
            url: pageUrl,
            siteName: siteConfig.name,
            title: title,
            description: description,
            images: [
                {
                    url: imageUrl,
                    // **実寸を持たないなら寸法を出さない。** 1200x630 を決め打ちして
                    // いたが、width/height を持つ写真は0枚（30枚中）なので
                    // **全ページが嘘の寸法を申告していた**。SNS 側はそれを信じて
                    // 領域を確保するので、共有カードで写真が切れる・伸びる。
                    // 分からないなら黙る方がよい（省略すれば取得側が実寸を見る）。
                    ...(photo.width && photo.height ? { width: photo.width, height: photo.height } : {}),
                    alt: getLocalized(photo.alt, "ja") || getLocalized(photo.alt, "en") || title,
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title: title,
            description: description,
            images: [imageUrl],
            creator: siteConfig.twitterHandle,
        },
        alternates: {
            canonical: pageUrl,
            // hreflang は出さない。ja と en が**同じURL**を指していて、
            // 「2言語版がある」と申告しながら中身は1つ、という状態だった。
            // 言語切替の UI は R-1 で削除済みで、別URLの英語版は存在しない。
        },
    };
}

type PageProps = {
    params: Promise<{ id: string }>;
};

export default async function PhotoPage({ params }: PageProps) {
    const { id } = await params;
    const photos = await loadAllPhotos();
    const photo = photos.find((p) => p.id === id) ?? null;
    // 回遊リンク（同投稿者/同場所/前後）をビルド時に計算して静的HTMLに焼き込む。
    // クライアント取得を待たずにクローラーが内部リンクを辿れるようにする（SEO）。
    const initialRelated = photo
        ? {
            ...relatedSections(photo, photos, 8),
            ...adjacentPhotos(photo, photos),
        }
        : undefined;
    return <PhotoPageClient photoId={id} initialPhoto={photo ?? undefined} initialRelated={initialRelated} />;
}
