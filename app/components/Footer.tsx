"use client";

import Link from "next/link";
import { PaperAirplaneIcon } from "@heroicons/react/24/solid";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";

// サイト共通フッター。ヘッダーと同じ「Journey Photo」ブランドで統一した
// ミニマルな中央揃え構成（ブランド + タグライン + ナビ + コピーライト）。
export default function Footer() {
    const { locale, labels } = useLocale();
    const navLabels = labels.navigation || {};

    const links = [
        { href: ROUTES.HOME, label: navLabels.works || (locale === "en" ? "Works" : "作品") },
        // 撮影地マップはメニューの中にしか無かった。フッターは全ページに
        // 出るので、写真ページから来た人にも見つかる
        { href: ROUTES.MAP, label: navLabels.map || (locale === "en" ? "Map" : "撮影地マップ") },
        { href: ROUTES.FAVORITES, label: navLabels.favorites || (locale === "en" ? "Liked Photos" : "いいねした写真") },
        { href: ROUTES.PRIVACY, label: locale === "en" ? "Privacy" : "プライバシーポリシー" },
    ];

    return (
        <footer className="border-t border-white/10 bg-black">
            <div className="max-w-5xl mx-auto px-6 md:px-8 py-10 md:py-12">
                <div className="flex flex-col items-center gap-5 text-center">
                    {/* ブランド + タグライン */}
                    <div>
                        <p className="inline-flex items-center gap-1.5 text-base font-bold tracking-wide text-white">
                            <PaperAirplaneIcon className="w-3.5 h-3.5 -rotate-45 text-sky-400" />
                            Journey Photo
                        </p>
                        <p className="mt-1.5 text-xs text-white/40">
                            {locale === "en"
                                ? "Moments that move someone's next journey."
                                : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    {/* ナビゲーション */}
                    <nav className="flex flex-wrap justify-center gap-x-5 gap-y-2">
                        {links.map(({ href, label }) => (
                            <Link
                                key={href}
                                href={href}
                                className="text-xs text-white/50 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>

                    <p className="text-[11px] text-white/30">
                        {/* 年は出さない。ここは "use client" だが静的書き出しなので、
                            ビルド時の年が HTML に焼かれ、年が明けるとブラウザ側の
                            再描画とで食い違う（ハイドレーション不一致）。
                            再ビルドするまで古い年を出し続ける問題もある。
                            著作権表記に年は必須ではないので、持たない方を選ぶ。 */}
                        © Journey Photo
                    </p>
                </div>
            </div>
        </footer>
    );
}
