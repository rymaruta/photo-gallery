import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/lib/utils/seo";
import { ROUTES } from "@/lib/routes";

// 利用規約。**このサイトが実際にしていることだけを書く**（雛形の丸写しをしない）。
// 数字は実装から取った実測値で、変えたときは両方を直すこと:
//   1枚 50MB       api-user/src/upload.ts の MAX_UPLOAD_BYTES
//   1人 1000枚     api-user/src/photoLimit.ts の PHOTO_LIMIT_PER_USER
//   ストーリー24時間 api-user/src/stories.ts の STORY_TTL_MS
//   受け付ける形式  api-user/src/uploadPolicy.ts の ALLOWED_*_TYPES
// 内容を変えたときは「最終更新日」も必ず更新すること。
const LAST_UPDATED = "2026年9月17日";

export const metadata: Metadata = {
    // サイト名は `app/layout.tsx` の `template` が付ける（privacy と同じ理由でここでは足さない）
    title: "利用規約",
    description: "Journey Photo の利用条件、投稿できるもの、禁止事項、著作権の扱いについて説明します。",
    alternates: { canonical: `${siteConfig.url}/terms` },
    openGraph: {
        type: "website",
        locale: siteConfig.locale.ja,
        url: `${siteConfig.url}/terms`,
        siteName: siteConfig.name,
        title: "利用規約",
        description: "利用条件、投稿できるもの、禁止事項、著作権の扱いについて。",
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

export default function TermsPage() {
    return (
        <main className="mx-auto max-w-3xl px-4 py-10">
            <h1 className="text-2xl font-bold tracking-tight">利用規約</h1>
            <p className="mt-1.5 text-xs text-white/50">最終更新日: {LAST_UPDATED}</p>

            <div className="mt-8">
                <Section title="1. はじめに">
                    <p>
                        {siteConfig.name}（{siteConfig.url}、以下「当サイト」）は、旅の写真を公開・閲覧するための個人運営のウェブサイトです。
                        本規約は、当サイトの利用条件を定めるものです。当サイトを利用された方は、本規約に同意したものとみなします。
                    </p>
                    <p>
                        個人情報の取り扱いについては
                        <Link href={ROUTES.PRIVACY} prefetch={false} className="underline decoration-white/30 underline-offset-2 hover:text-white">プライバシーポリシー</Link>
                        をご覧ください。
                    </p>
                </Section>

                <Section title="2. アカウント">
                    <ul className="list-disc pl-5 space-y-1">
                        <li>写真を投稿するには、メールアドレスでのアカウント登録が必要です。閲覧だけであれば登録は要りません。</li>
                        <li>パスワードの管理はご自身の責任でお願いします。心当たりのない利用に気づいた場合は、プロフィール設定から「すべての端末からログアウト」を行い、パスワードを変更してください。</li>
                        <li>1つのアカウントを複数人で共有しないでください。</li>
                        <li>アカウントはいつでもご自身で削除できます（プロフィール設定の「退会」）。退会すると、投稿した写真・コメント・プロフィールは削除されます。</li>
                    </ul>
                </Section>

                <Section title="3. 投稿できるもの">
                    <ul className="list-disc pl-5 space-y-1">
                        <li>画像は JPEG / PNG / WebP / AVIF / HEIC、ストーリーの動画は MP4 / WebM / MOV を受け付けます。</li>
                        <li>1ファイルあたり 50MB まで、1アカウントあたり 1,000枚までです。</li>
                        <li>ストーリーは投稿から24時間で自動的に消えます。残したいものは「ギャラリーに残す」で写真として保存できます。</li>
                        <li>
                            写真に含まれる位置情報（GPS）は、アップロードの前にご自身の端末側で取り除いてから送信されます。
                            撮影地として地図に出す位置は、投稿・編集画面でご自身が選んだ場合にのみ保存されます。
                        </li>
                    </ul>
                </Section>

                <Section title="4. 禁止事項">
                    <p>当サイトの利用にあたり、次の行為を禁止します。</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>他人の著作権・肖像権・プライバシーその他の権利を侵害する投稿</li>
                        <li>ご自身に権利のない写真・動画の投稿（他人が撮影したもの、web上から取得したものなど）</li>
                        <li>被写体となった方の同意を得ていない、その方の権利を害するおそれのある投稿</li>
                        <li>わいせつな内容、暴力的な内容、差別的な表現、特定の個人や集団への攻撃・いやがらせ</li>
                        <li>法令に違反する行為、犯罪行為を助長する投稿</li>
                        <li>虚偽の情報を用いた他人へのなりすまし</li>
                        <li>広告・勧誘・スパムを目的とした投稿</li>
                        <li>当サイトのサーバーやネットワークに過大な負荷をかける行為、不正アクセスを試みる行為</li>
                        <li>自動化された手段による大量の投稿・取得</li>
                    </ul>
                    <p>
                        ほかの利用者からの反応を受け取りたくない場合は、その方をブロックできます。
                        不適切な投稿を見つけた場合は、写真の「通報する」からお知らせください。
                    </p>
                </Section>

                <Section title="5. 投稿された内容の権利">
                    <ul className="list-disc pl-5 space-y-1">
                        <li><strong className="text-white/90">投稿された写真・動画・文章の著作権は、投稿された方に帰属します。</strong>当サイトがその権利を取得することはありません。</li>
                        <li>
                            当サイトは、投稿された内容を当サイト上で表示・配信するために必要な範囲（サムネイルなど表示用の画像を作る、検索エンジンに載せる、サイト内の一覧や地図に出す、など）でのみ利用します。
                        </li>
                        <li>公開された写真は、インターネット上の誰からでも閲覧できます。検索エンジンの結果や、SNS でリンクを共有した際のプレビューにも表示されます。</li>
                        <li>非公開（下書き）にした写真は一覧や検索に出ませんが、静的なページとして生成済みの場合、削除・非公開の反映には数分かかることがあります。</li>
                        <li>投稿を削除すると、サーバー上の実体も削除されます。ただし、すでに他の方が保存・転載したものについては、当サイトでは対応できません。</li>
                    </ul>
                </Section>

                <Section title="6. 運営が削除・非公開にできる場合">
                    <p>
                        次のいずれかに当てはまると運営が判断した投稿・アカウントについては、事前の通知なく削除・非公開・利用停止とする場合があります。
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>本規約の禁止事項に当てはまるとき</li>
                        <li>法令または裁判所・行政機関の命令に反するとき</li>
                        <li>権利者からの申し立てがあり、これに応じる必要があると判断したとき</li>
                        <li>当サイトの運営に著しい支障が生じるとき</li>
                    </ul>
                    <p>
                        判断に異議がある場合は、下記の問い合わせ先までご連絡ください。
                    </p>
                </Section>

                <Section title="7. 免責">
                    <ul className="list-disc pl-5 space-y-1">
                        <li>当サイトは個人が運営しており、常時の稼働や、投稿された内容が失われないことを保証するものではありません。大切な写真は必ずご自身の手元にも保管してください。</li>
                        <li>サーバーの障害、通信の不具合、外部サービスの停止などにより、一時的に利用できないことがあります。</li>
                        <li>利用者どうしのやり取りや、利用者と第三者との間に生じたトラブルについて、当サイトは責任を負いません。</li>
                        <li>当サイトの利用によって生じた損害について、運営者の故意または重大な過失による場合を除き、責任を負いません。</li>
                    </ul>
                </Section>

                <Section title="8. 本規約の変更">
                    <p>
                        本規約は必要に応じて変更することがあります。変更した場合は、このページの内容と最終更新日を更新します。
                        変更後に当サイトを利用された場合、変更後の規約に同意したものとみなします。
                    </p>
                </Section>

                <Section title="9. 準拠法">
                    <p>本規約は日本法に準拠し、当サイトに関して紛争が生じた場合は、運営者の住所地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。</p>
                </Section>

                <Section title="10. お問い合わせ">
                    {siteConfig.contactEmail ? (
                        <p>本規約に関するお問い合わせは <a href={`mailto:${siteConfig.contactEmail}`} className="underline decoration-white/30 underline-offset-2 hover:text-white">{siteConfig.contactEmail}</a> までご連絡ください。</p>
                    ) : (
                        <p>お問い合わせ先は準備中です。</p>
                    )}
                </Section>
            </div>
        </main>
    );
}
