import type { Photo } from "@/lib/data/photos";
import { dedupeCameraName } from "../../../lib/utils/cameraName";
import PhotoPageClient from "./PhotoPageClient";
import type { Metadata } from "next";
import { splitStoredDate } from "@/lib/utils/photoDate";
import { ja } from "../../i18n/labels";
import { siteConfig, publicImageUrl } from "@/lib/utils/seo";
import { getLocalized, getLocalizedParagraphs } from "@/lib/data/photos";
import { loadAllPhotos } from "@/lib/server/photos";
import { initialRelatedFor } from "@/lib/utils/related";
import { withPlaceholderParam } from "../../../lib/server/staticParams";
import { photoAltText } from "../../../lib/utils/photoAlt";
import { metaText } from "@/lib/utils/metaText";

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
    const ownTitle = getLocalized(photo.title, "ja") || getLocalized(photo.title, "en") || "無題";
    const descriptionParagraphs = getLocalizedParagraphs(photo.description, "ja");
    // **1行に均す。** 利用者は段落の中でも改行するので、素で入れると
    //  `<meta name="description">` の属性値に生の改行が残る
    //  （実ビルドで写真ページ5枚 × 3メタ）。`app/users/[id]` は
    //  自己紹介に同じ処理を前からしていた
    const ownDescription = metaText(descriptionParagraphs.length > 0
        ? descriptionParagraphs.join(" ")
        : getLocalizedParagraphs(photo.description, "en").join(" "));
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
    // **題に撮影地を添える。**
    //
    // 実データ30枚のうち**29枚は題だけ**で、「白鳥と湖」「紅白」「Cafe」の
    // ように**実際に打たれる検索語に当たらない**（撮影地が題に入っているのは
    // 1枚だけ）。写真ページは索引に出せるページの約6割なので、ここが
    // 当たらないと他は誤差になる。
    //
    // **既に題に入っているなら足さない**（「山中湖の朝｜山中湖」を作らない）。
    // 表示は `| Journey Photo 旅フォトギャラリー` が後ろに付いて切られうるが、
    // **切られるのは見た目だけで、検索語との突き合わせは全文で行われる**。
    //
    // **逆向きも見る。** 判定が「題が撮影地を含むか」だけだったので、
    // **撮影地の方が題を含む**回に重ねていた（実ビルド:
    // 「オペラ・ガルニエ｜オペラ・ガルニエ（パリ）」＝サイトで一番長い題）。
    // そのときは**撮影地を出す**——題を丸ごと含んでいるので何も失わず、
    // 「（パリ）」のぶん情報が増える。
    // **`includes` を先に見る**（題＝撮影地のときに題を残すため）。
    // 「海」が「…海浜公園」に含まれるような回は、撮影地が題で始まって
    // いないので `startsWith` に掛からない（実データで確認）。
    const title = !place || ownTitle.includes(place) ? ownTitle
        : place.startsWith(ownTitle) ? place
            : `${ownTitle}｜${place}`;

    // **説明に機材を添える。**
    //
    // 機材名で作例を探す人が実在する（案D の前提）。説明の中央値は59文字で、
    // 検索結果に出る長さ（およそ120文字）に対して余裕がある。
    // **書かれた説明は消さず、事実を括弧で足すだけ**——長い説明には足さない
    // （切られて括弧が開いたまま終わる）。
    // **同じ言葉を二度書かない。** 組み立てた説明（「東京で撮影した風景の
    // 写真。」）は既に撮影地を含むので、そこに撮影地を足すと
    // 「東京で撮影した風景の写真。（東京）」になる。**書かれた説明**には
    // 撮影地も足すが、組み立てた説明には機材だけを足す
    // （既存のテストがこの重複を見つけた）。
    const camera = dedupeCameraName(photo.exif?.camera);
    const withFacts = (base: string, extra: (string | undefined)[]) => {
        const facts = extra.filter(Boolean).join(" / ");
        return facts && base.length <= 80 ? `${base}（${facts}）` : base;
    };

    // **書かれた説明に既に撮影地が入っていたら足さない。**
    // 実データ2枚で「北海道にも春が訪れ…（**北海道** / SONY ILCE-7M3）」
    // 「**大阪**府万博にて…（**大阪** / …）」になっていた。
    // 組み立て文の重複だけ塞いで、こちら側は素通りしていた
    const description = (ownDescription
        && withFacts(ownDescription, [ownDescription.includes(place) ? undefined : place, camera]))
        || (place || year ? withFacts(`${where}${when}撮影した${what}`, [camera]) : "")
        || (categoryLabel ? withFacts(`${categoryLabel}の写真。`, [camera]) : "")
        || siteConfig.description;
    
    // 出すURLはサイトのドメインに揃える（`publicImageUrl`）。同じ配信の
    // 別名で2つに割れていた——実測 138ページ中 69ページが CloudFront の既定ドメイン
    const imageUrl = publicImageUrl(photo.src);
    
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
        // **作者を名乗る。** `photographer` は実データ30件中0件なので、
        // これまで `<meta name="author">` は一度も出ていなかった
        // （実ビルドで確認）。表示名（`displayName`）に落として、
        // 投稿者のプロフィールへ `url` で結ぶ——人名で探されたときに
        // 「この30ページは同じ人のもの」と機械に伝わる唯一の線
        authors: (() => {
            const name = photo.photographer || photo.displayName;
            if (!name) return undefined;
            return [photo.userId
                ? { name, url: `${siteConfig.url}/users/${photo.userId}` }
                : { name }];
        })(),
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
                    // いた（コミット済みの古い断面では width/height を持つ写真が
                    // 0枚で、**全ページが嘘の寸法を申告していた**。本番の公開写真は
                    // 2026-09-05 の実測で全部持っている）。SNS 側はそれを信じて
                    // 領域を確保するので、共有カードで写真が切れる・伸びる。
                    // 分からないなら黙る方がよい（省略すれば取得側が実寸を見る）。
                    ...(photo.width && photo.height ? { width: photo.width, height: photo.height } : {}),
                    // 共有カードの alt も本体と同じ組み方に寄せる（`photoAlt.ts`）
                    alt: photoAltText(photo, "ja") || photoAltText(photo, "en") || title,
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
    // **リンクに要る項目だけ渡す。** 丸ごと渡すと、説明も EXIF もタグも
    // 付いた写真オブジェクトが最大18個、**全写真ページの HTML に**埋め込まれる
    // （RSC ペイロード）。組み立ては `initialRelatedFor` に置いてある
    // ——ここに `map(slimForLinks)` と書くと、**1つ消しても誰も気づかない**
    const initialRelated = photo ? initialRelatedFor(photo, photos, 8) : undefined;
    return <PhotoPageClient photoId={id} initialPhoto={photo ?? undefined} initialRelated={initialRelated} />;
}
