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
        // 公式撮影地ガイドの索引。**写真の投稿が0枚の場所も載る**面なので、
        // 写真の一覧（`/location`）とは別に入口が要る。フッターは全ページに
        // 出るので、写真から来た人にも見つかる（撮影地マップと同じ理由）
        { href: ROUTES.SPOTS, label: locale === "en" ? "Photo spots" : "撮影スポット" },
        { href: ROUTES.FAVORITES, label: navLabels.favorites || (locale === "en" ? "Liked Photos" : "いいねした写真") },
        // 保存した写真。**いいねとは別の棚**なので、並べて出して違いを見せる
        { href: ROUTES.SAVES, label: navLabels.saves || (locale === "en" ? "Saved Photos" : "保存した写真") },
        // 行きたい場所（保存した撮影スポット）。**いいねとは別物**。
        // 入口がスポット詳細の「行きたい」ボタンしか無いと、押したあとに
        // 見に行く場所が無い（`BottomNav` は別の作業中なので触らない）
        { href: ROUTES.SAVED_SPOTS, label: locale === "en" ? "Want to go" : "行きたい場所" },
        { href: ROUTES.TERMS, label: locale === "en" ? "Terms" : "利用規約" },
        { href: ROUTES.PRIVACY, label: locale === "en" ? "Privacy" : "プライバシーポリシー" },
    ];

    return (
        <footer
            className="border-t border-white/10 bg-bg"
            /**
             * 🔴 **その画面自身の下の帯のぶんを、ここで空ける。**
             *
             * 帯（「保存」「削除」「投稿する」）は下部タブバーの**上**に乗るので、
             * `body` の下の余白（タブバーのぶん）だけでは足りず、
             * **フッターの最後の行が帯の裏に入って押せなくなる**
             * （2026-09-22 に実測: `/user/highlights` と `/user/edit` で
             *  いちばん下まで送ると7本とも `elementFromPoint` が帯を返した）。
             *
             * `body` の `padding-bottom` が空けるのは下部タブバーのぶん
             * （`--bottom-bar-h`）だけなので、画面ごとの帯のぶんはここで足す。
             * （以前は `body` に高さが固定されていて、その余白自体が効いて
             * いなかった。`globals.css` の `html` の注を見よ。）
             *
             * 高さは帯自身が出す（`usePageBarHeight`）。帯の無い画面では 0。
             */
            style={{ paddingBottom: "var(--page-bar-h, 0px)" }}
        >
            <div className="max-w-5xl mx-auto px-6 md:px-8 py-10 md:py-12">
                <div className="flex flex-col items-center gap-5 text-center">
                    {/* ブランド + タグライン */}
                    <div>
                        <p className="inline-flex items-center gap-1.5 text-base font-bold tracking-wide text-white">
                            <PaperAirplaneIcon className="w-3.5 h-3.5 -rotate-45 text-link" />
                            Journey Photo
                        </p>
                        <p className="mt-1.5 text-xs text-white/50">
                            {locale === "en"
                                ? "Moments that move someone's next journey."
                                : "旅の一瞬を、誰かの次の旅へ。"}
                        </p>
                    </div>

                    {/* ナビゲーション */}
                    <nav aria-label={locale === "en" ? "Footer" : "フッター"}
                        className="flex flex-wrap justify-center gap-x-5">
                        {links.map(({ href, label }) => (
                            // **先読みしない**（理由と実測は `app/components/GalleryGrid.tsx` の
                            // カードのコメント。静的書き出し＋`no-store` 配信なので、画面に
                            // 入るたびに行き先を丸ごと落とし直す）
                            <Link
                                key={href}
                                href={href}
                                prefetch={false}
                                // **押す的は高さ24px**（WCAG 2.5.8・Lighthouse の target-size）。
                                // 字の高さ14pxのままだと全ページで落ちていた。行の間隔は
                                // 的の高さで取る（以前の gap-y-2 ＝ 行ピッチ21px → 24px）
                                className="inline-flex items-center min-h-[24px] text-xs text-white/50 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {label}
                            </Link>
                        ))}
                    </nav>

                    <p className="text-[11px] text-white/50">
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
