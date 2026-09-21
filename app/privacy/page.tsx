import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/lib/utils/seo";

// プライバシーポリシー。実際にこのサイトが行っている処理だけを書く（雛形の丸写しをしない）。
// 内容を変えたときは「最終更新日」も必ず更新すること。
const LAST_UPDATED = "2026年8月19日";

export const metadata: Metadata = {
    // サイト名は `app/layout.tsx` の `template` が付ける。ここでも足すと
    // `プライバシーポリシー | Journey Photo | 旅フォトギャラリー | Journey Photo 旅フォトギャラリー`
    // になり、53文字中44文字が定型文になる（写真ページで同じものを直した）
    title: "プライバシーポリシー",
    description: "Journey Photo における個人情報・アクセス解析・Cookie の取り扱いについて説明します。",
    alternates: { canonical: `${siteConfig.url}/privacy` },
    openGraph: {
        type: "website",
        locale: siteConfig.locale.ja,
        url: `${siteConfig.url}/privacy`,
        siteName: siteConfig.name,
        // `og:site_name` が別に出るので、ここでもサイト名を足すと
        // カードに2回出る（`<title>` だけ直して og を見落としていた）
        title: "プライバシーポリシー",
        description: "個人情報・アクセス解析・Cookie の取り扱いについて。",
    },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="pt-6 mt-6 border-t border-white/10 first:mt-0 first:pt-0 first:border-t-0">
            <h2 className="text-base font-semibold mb-2.5">{title}</h2>
            <div className="text-sm text-white/75 leading-relaxed space-y-2.5">{children}</div>
        </section>
    );
}

export default function PrivacyPage() {
    return (
        <main className="mx-auto max-w-3xl px-4 py-10">
            <h1 className="text-2xl font-bold tracking-tight">プライバシーポリシー</h1>
            <p className="mt-1.5 text-xs text-white/50">最終更新日: {LAST_UPDATED}</p>

            <div className="mt-8">
                <Section title="1. はじめに">
                    <p>
                        {siteConfig.name}（{siteConfig.url}、以下「当サイト」）は、旅の写真を公開・閲覧するための個人運営のウェブサイトです。
                        本ポリシーでは、当サイトが取得する情報とその扱いについて説明します。
                    </p>
                </Section>

                <Section title="2. 取得する情報">
                    <p><strong className="text-white/90">閲覧するだけの方から取得する情報</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>アクセス解析による利用状況（閲覧ページ、参照元、おおよその地域、ブラウザ・端末の種類など）</li>
                        <li>ブラウザ内の保存領域（localStorage）に保存する表示設定（お気に入りにした写真のID、表示言語、ヒントを閉じたかどうかなど）。これらは端末内にのみ保存され、当サイトのサーバーには送信されません。</li>
                    </ul>
                    <p className="pt-1"><strong className="text-white/90">アカウント登録・写真投稿をされる方から取得する情報</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>メールアドレス、パスワード（認証基盤である Amazon Cognito が管理します。当サイトはパスワードを保持しません）</li>
                        <li>プロフィール情報（表示名、ユーザー名、自己紹介、外部リンクなど、ご自身で入力された内容）</li>
                        <li>投稿された写真、およびタイトル・説明・撮影地・タグなど、ご自身で入力された情報</li>
                        <li>写真から読み取った撮影情報（カメラ・レンズ・絞り・ISO・撮影日時など）</li>
                    </ul>
                </Section>

                <Section title="3. 写真の位置情報（GPS）の扱い">
                    <p>
                        アップロードされた写真は、保存する前にブラウザ上で再圧縮されます。この処理により
                        <strong className="text-white/90">写真ファイルに埋め込まれた GPS 座標などのメタデータは取り除かれます</strong>。
                        公開される画像ファイルから正確な撮影位置が読み取られることはありません。
                    </p>
                    <p>
                        撮影地を地図で扱うための座標は、アップロード画面の「写真のGPSから撮影地を自動入力」を
                        <strong className="text-white/90">オンにした場合にのみ</strong>保存されます。その際も、プライバシー配慮のため
                        <strong className="text-white/90">おおよそ1km程度の精度に丸めた値</strong>のみを保存します。この設定はいつでもオフにできます。
                    </p>
                </Section>

                <Section title="4. 利用目的">
                    <ul className="list-disc pl-5 space-y-1">
                        <li>写真ギャラリーの表示・運営</li>
                        <li>アカウントの認証、投稿された写真の管理</li>
                        <li>サイトの利用状況の把握と改善</li>
                        <li>不正利用の防止</li>
                    </ul>
                </Section>

                <Section title="5. アクセス解析ツールについて">
                    <p>
                        当サイトは、利用状況を把握するために Google アナリティクス（GA4）を利用しています。
                        Google アナリティクスはデータの収集のために Cookie を使用し、匿名のトラフィックデータを収集します。
                        このデータは匿名で収集されており、個人を特定するものではありません。
                    </p>
                    <p>
                        収集の仕組みや Google におけるデータの利用については、
                        <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-link hover:text-sky-300 underline underline-offset-2">
                            Google のポリシーと規約
                        </a>
                        をご確認ください。ブラウザの設定で Cookie を無効にすることで、収集を拒否することもできます。
                    </p>
                </Section>

                <Section title="6. 広告配信について">
                    <p>
                        当サイトでは、将来的に第三者配信の広告サービス（Google AdSense など）を利用する場合があります。
                        その際、広告配信事業者はユーザーの興味に応じた広告を表示するために Cookie を使用することがあります。
                    </p>
                    <p>
                        Cookie を無効にする方法や Google AdSense に関する詳細は、
                        <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer" className="text-link hover:text-sky-300 underline underline-offset-2">
                            広告 – ポリシーと規約 – Google
                        </a>
                        をご確認ください。
                    </p>
                </Section>

                <Section title="7. 第三者への提供・委託先">
                    <p>当サイトは、法令に基づく場合を除き、取得した情報を第三者に販売・提供しません。ただし、運営のために以下のサービスを利用しています。</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li><strong className="text-white/90">Amazon Web Services</strong> — 写真・データの保存、配信、認証（Cognito）</li>
                        <li><strong className="text-white/90">Google アナリティクス</strong> — アクセス解析</li>
                        <li><strong className="text-white/90">OpenStreetMap（Nominatim）</strong> — 撮影地名の解決（座標は約1kmに丸めた値のみ送信）</li>
                    </ul>
                </Section>

                <Section title="8. 投稿された写真の公開範囲">
                    <p>
                        投稿された写真は、公開設定にした場合にインターネット上で誰でも閲覧できる状態になり、検索エンジンにも収集されます。
                        「下書き」として保存した写真は非公開で、ご本人以外は閲覧できず、検索エンジンにも公開されません。
                    </p>
                </Section>

                <Section title="9. 退会・データの削除">
                    <p>
                        アカウントをお持ちの方は、プロフィール編集ページの「危険な操作」から退会（アカウント削除）を行えます。
                        退会すると、アカウント情報および投稿された写真は削除されます。この操作は取り消せません。
                    </p>
                </Section>

                <Section title="10. お問い合わせ">
                    {siteConfig.contactEmail ? (
                        <p>
                            本ポリシーに関するお問い合わせは{" "}
                            <a href={`mailto:${siteConfig.contactEmail}`} className="text-link hover:text-sky-300 underline underline-offset-2">
                                {siteConfig.contactEmail}
                            </a>{" "}
                            までご連絡ください。
                        </p>
                    ) : (
                        <p>お問い合わせ先は準備中です。</p>
                    )}
                </Section>

                <Section title="11. 本ポリシーの変更">
                    <p>
                        本ポリシーの内容は、必要に応じて変更することがあります。変更した場合は、本ページに掲載するとともに最終更新日を更新します。
                    </p>
                </Section>
            </div>

            <div className="mt-10 pt-6 border-t border-white/10">
                <Link href="/" prefetch={false} className="text-sm text-white/60 hover:text-white transition-colors">← ホームに戻る</Link>
            </div>
        </main>
    );
}
