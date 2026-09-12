import type { Metadata } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Photo } from "@/lib/data/photos";
import { siteConfig, INDEXABLE_ROBOTS, publicImageUrl } from "@/lib/utils/seo";
import UserProfileClient from "../UserProfileClient";
import { withPlaceholderParam } from "../../../lib/server/staticParams";
import PROFILES from "../../data/profiles.json";
import { personEntity } from "../../../lib/utils/personEntity";

// ユーザープロフィールの静的生成版（/users/<userId>）。
// ビルド時点の photos.json に投稿があるユーザーごとにページを生成し、
// 表示名・投稿数・最新作品を使ったユーザー個別の OGP カードを付ける。
// ビルド後に登録された新規ユーザーは /users?id=<userId>（クエリ版）で表示される。

async function loadPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data) as Photo[];
    }
    return [];
}

type UserSummary = {
    displayName: string;
    photoCount: number;
    latestPhotoSrc?: string;
};

async function loadUserSummary(userId: string): Promise<UserSummary | null> {
    const photos = await loadPhotos();
    // **ここは「投稿が新しい順」で正しい。**
    //
    // 一度サイト全体の規則（撮影日 → 投稿日）に寄せたが、それは誤りだった
    // ——この並びが決めるのは OGP の代表画像で、対応するのはプロフィールの
    // 「投稿」タブ（`/user/photos` が返す投稿順）。撮影日順にすると、
    // EXIF の撮影日を持つ写真（＝古い日付）が全部下に沈み、**代表画像だけが
    // 画面の先頭と食い違う**。
    //
    // 直すべきだったのは `??` の方だけ。`date: ""` を「値がある」と見なして
    // いたので、空文字の行が `localeCompare` で最下段に落ちていた
    // （`lib/utils/related.ts` のテストに同じ話がある）。`||` に揃える。
    const userPhotos = photos
        .filter((p) => p.userId === userId && p.published !== false)
        .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")));
    if (userPhotos.length === 0) return null;
    return {
        displayName: userPhotos.find((p) => p.displayName)?.displayName ?? "ユーザー",
        photoCount: userPhotos.length,
        // **出すURLはサイトのドメインに揃える**（`publicImageUrl`）。
        // この値は OGP（`images`・`twitter.images`）と Person の `image` の
        // 3か所へ渡る——**ここで揃えれば3か所とも揃う**。揃える前は
        // このページだけ CloudFront の既定ドメインで出ていた（実ビルドで確認）
        latestPhotoSrc: userPhotos[0]?.src ? publicImageUrl(userPhotos[0].src) : undefined,
    };
}

export async function generateStaticParams() {
    const photos = await loadPhotos();
    const ids = new Set<string>();
    for (const p of photos) {
        // ここで作れるのは「公開写真が1枚以上ある人」のページだけ。
        // 入力の photos.json が生成時に非公開とストーリーを落としている
        // （scripts/sync-photos-from-ddb.js の filter）ので、この行で
        // 絞りを緩めても、全部を非公開にした人の userId はそもそも来ない。
        // ※以前ここに「公開写真の有無で絞らない（全非公開でもページを残す）」
        //   というコメントがあったが、上記の理由で**効いていなかった**。
        // 全非公開にした人のページは次のビルドで消えるが、ハード404には
        // ならない: 404ページ（app/not-found.tsx → notFoundRedirect.ts）が
        // /users?id=<userId> のクエリ版へ振り替え、中身は API から描ける。
        // 静的な枠を全員分残したければ、ビルド入力に「全ユーザーのID一覧」を
        // 別途書き出す必要がある（photos.json からは決められない）。
        if (p.userId) ids.add(p.userId);
    }
    // ユーザーが0人でも1件は返す（空だと output: export がビルドを落とす）
    return withPlaceholderParam(Array.from(ids).map((id) => ({ id })), "id");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const summary = await loadUserSummary(id);

    if (!summary) {
        return { title: "プロフィール", description: siteConfig.description };
    }

    const title = `${summary.displayName}の旅フォト`;
    // **自己紹介があれば、それを説明文にする。**
    //
    // 組み立てた文（「…さんが Journey Photo で旅の写真をN枚公開中。」）は
    // **投稿数以外どの人でも同じ**で、人名で探した人に「この人は誰か」を
    // 何も伝えない。自己紹介は本人が書いた唯一の自己記述なので、
    // 検索結果のスニペットとしても、機械の同定材料としても強い。
    //
    // **長すぎたら組み立て文に落とす**——検索結果で切られる長さ（およそ
    // 120文字）を大きく超える自己紹介は、途中で切れて意味をなさない。
    // 短すぎる（10文字未満）ものも落とす（「よろしく」だけ、等）。
    // 材料は `app/data/profiles.json`（ビルド時に users テーブルから引く）。
    const bio = (PROFILES as Record<string, { bio?: string }>)[id]?.bio?.replace(/\s+/g, " ").trim() ?? "";
    const generated = `${summary.displayName}さんが Journey Photo で旅の写真を${summary.photoCount}枚公開中。旅先の風景やスナップをお楽しみください。`;
    const description = bio.length >= 10 && bio.length <= 120
        ? `${bio}（Journey Photo で旅の写真を${summary.photoCount}枚公開中）`
        : generated;
    const url = `${siteConfig.url}/users/${id}`;
    const images = summary.latestPhotoSrc
        // **寸法は出さない。** 代表画像はその人の最新投稿で縦横比はまちまち、
        // しかも `photos.json` の30枚は1枚も `width`/`height` を持っていない
        // （実測 0/30）。写真ページは同じ理由で寸法をやめてある
        // （`app/photo/[id]/page.tsx` のコメント）——ここだけ 3:2 の
        // 決め打ちが残っていた
        ? [{ url: summary.latestPhotoSrc, alt: title }]
        : undefined;

    return {
        // サイト名は親から降りる `template` が付ける（`app/users/layout.tsx`
        // が `title` を素の文字列で置いていた間は降りてこず、この
        // `<title>` だけサイト名が落ちていた）
        title,
        // **検索結果に出す。** 親のレイアウトが `/users?id=` を隠すために
        // `robots: { index: false }` を置いており、**子がこのキーを書かない
        // かぎりそのまま降りる**（Next のメタデータ結合）。その結果、
        // sitemap.xml に載せている静的なプロフィールページ全部が
        // `noindex` で出ていた——「見に来い」と呼んで「載せるな」と言う形で、
        // Search Console では「送信された URL が noindex です」になる。
        // 表示名・投稿数入りの title/description/OGP も Person の JSON-LD も
        // 全部そのために作っているのに、一つも使われていなかった。
        // **`robots` はオブジェクトごと差し替わる。** `{ index: true,
        // follow: true }` とだけ書くと、ルートが持っている
        // `googleBot: { "max-image-preview": "large" … }` が消える
        // （実測で、この1ページだけ `googlebot` の meta を失っていた）
        robots: INDEXABLE_ROBOTS,
        description,
        alternates: { canonical: url },
        openGraph: {
            type: "profile",
            url,
            siteName: siteConfig.name,
            title: `${title} | Journey Photo`,
            description,
            ...(images ? { images } : {}),
        },
        twitter: {
            card: "summary_large_image",
            title: `${title} | Journey Photo`,
            description,
            ...(summary.latestPhotoSrc ? { images: [summary.latestPhotoSrc] } : {}),
        },
    };
}

export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const summary = await loadUserSummary(id);

    // ProfilePage 構造化データ（検索結果でのプロフィール理解を助ける）
    const jsonLd = summary
        ? {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            mainEntity: personEntity({
                id,
                displayName: summary.displayName,
                image: summary.latestPhotoSrc,
                profile: (PROFILES as Record<string, { bio?: string; website?: string; instagram?: string }>)[id],
            }),
        }
        : null;

    return (
        <>
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
                />
            )}
            <UserProfileClient key={id} userId={id} />
        </>
    );
}
