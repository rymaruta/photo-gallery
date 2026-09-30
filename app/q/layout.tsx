import type { Metadata } from "next";
import { appPageMetadata, siteConfig } from "../../lib/utils/seo";
import { ROUTES } from "../../lib/routes";
import { resolveOgImage } from "../../lib/server/photos";

// **検索結果に出さない。** 中身は日ごとに変わり、HTML には問題が入っていない
// （画面が日付のファイルを読む）ので、検索に出しても空の殻が載るだけ。
// 共有されたリンクのカードには `/q` の見出しと説明を出す——`openGraph` を書かないと
// ルートから継いで「サイト名・トップの URL」のカードになる
const TITLE = "今日の一問";
const DESCRIPTION = "毎日1枚、撮影スポットの写真。4つの中からどこかを当てる。";

// 画像はトップと同じ代表写真（`openGraph` を書くとルートの画像も継がれない）。
// **今日の問題の写真は載せない**——カードで答えの写真が先に見えてしまう
export async function generateMetadata(): Promise<Metadata> {
    const ogImage = await resolveOgImage(siteConfig.url);
    const title = `${TITLE} | ${siteConfig.name}`;
    return {
        ...appPageMetadata(ROUTES.QUIZ, TITLE),
        description: DESCRIPTION,
        openGraph: {
            type: "website",
            locale: "ja_JP",
            url: `${siteConfig.url}${ROUTES.QUIZ}`,
            siteName: siteConfig.name,
            title,
            description: DESCRIPTION,
            images: [{ url: ogImage, alt: siteConfig.name }],
        },
        twitter: { card: "summary_large_image", title, description: DESCRIPTION, images: [ogImage], creator: siteConfig.twitterHandle },
    };
}

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
