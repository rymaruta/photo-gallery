import type { Metadata } from "next";
import Link from "next/link";
import { siteConfig } from "@/lib/utils/seo";

// プライバシーポリシー。実際にこのサイトが行っている処理だけを書く（雛形の丸写しをしない）。
// 内容を変えたときは「最終更新日」も必ず更新すること。
//
// iPhone アプリ（App Store のプライバシーポリシー URL）もこのページを指している。
// アプリの機能の記述は iOS リポジトリの実装と、`api-user/src` の実装に合わせてある
// （2026-10-18: 公開プロフィール・すれちがい・旅のトランク・光と天気の知らせ・Pro の購入・退会）。
const LAST_UPDATED = "2026年10月18日";

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
        <section className="pt-6 mt-6 border-t border-line first:mt-0 first:pt-0 first:border-t-0">
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
                        iPhone 向けアプリ「Journey Photo」（以下「アプリ」）も、当サイトと同じアカウント・同じサーバーで動いています。
                        本ポリシーでは、当サイトとアプリが取得する情報とその扱いについて説明します。アプリだけの機能には「（iPhone アプリ）」と書いています。
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
                        <li>プロフィール情報（表示名、ユーザー名、自己紹介、居住地、外部リンクなど、ご自身で入力された内容）</li>
                        <li>投稿された写真、およびタイトル・説明・撮影地・タグなど、ご自身で入力された情報</li>
                        <li>写真から読み取った撮影情報（カメラ・レンズ・絞り・ISO・撮影日時など）</li>
                        <li>フォロー、いいね、保存、コメント、ストーリー（返信・投票を含む）、共同アルバム、行きたい場所、旅行プラン、親しい友達、ブロック、通報など、ご自身の操作の記録</li>
                        <li>プッシュ通知の宛先となる端末の識別子（アプリで通知を許可した場合。「5. 機能ごとの情報の扱い」）</li>
                        <li>Pro の購入に関する取引の情報（アプリで購入した場合。「5. 機能ごとの情報の扱い」）</li>
                        <li>旅のトランクのラベル・硬貨・部品などの記録（アプリ。「5. 機能ごとの情報の扱い」）</li>
                    </ul>
                </Section>

                <Section title="3. 写真の位置情報（GPS）の扱い">
                    <p>
                        アップロードされた写真は、保存する前にブラウザまたはアプリの中で再圧縮されます。この処理により
                        <strong className="text-white/90">写真ファイルに埋め込まれた GPS 座標などのメタデータは取り除かれます</strong>。
                        公開される画像ファイルから正確な撮影位置が読み取られることはありません。
                    </p>
                    <p>
                        撮影地を地図で扱うための座標は、次の場合に保存されます。保存するのは、サーバーで
                        <strong className="text-white/90">おおよそ1km程度の精度に丸めた値</strong>のみです。
                        保存した座標は、公開した写真とともに地図などに表示されます。
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>ウェブサイト: アップロード画面の「写真のGPSから撮影地を自動入力」がオンのとき（初期状態はオンです。いつでもオフにできます）</li>
                        <li>iPhone アプリ: 写真に位置情報があり、そこから自動で入った撮影地名を変えずに投稿したとき、または写真の近くの撮影スポットを撮影地にしたとき。撮影地を書き換えたり空にしたりした場合は、写真の位置情報は送りません</li>
                        <li>撮影地を候補から選んだとき、または位置情報の無い写真で撮影スポットを選んだときは、選んだ場所の座標</li>
                    </ul>
                    <p>
                        撮影地名を自動で入れるときは、写真の座標を当サイトのサーバーへ送り、サーバーで約1kmに丸めてから
                        OpenStreetMap（Nominatim）に問い合わせます。このとき送られた座標そのものは保存しません。
                    </p>
                </Section>

                <Section title="4. 公開プロフィールに表示される情報">
                    <p>
                        プロフィールは、ログインしていない方を含め、誰でも閲覧できます。公開されるのは次の項目です。
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>ご自身で設定した項目: 表示名、ユーザー名、アイコン、カバー写真、自己紹介、居住地、ひとこと、外部リンク（Instagram・ウェブサイト）、テーマの色、プロフィールの曲、旅アルバムの名前・カバー・曲、ピン留めした写真（公開中で、公開範囲を絞っていない写真のみ）</li>
                        <li>メダル（公開した写真の撮影地・季節・時刻などから自動で付くもの）と、名前の横に出すメダル</li>
                        <li>Pro であるかどうかと、Pro の印の形。名前の横の Pro の印を外している場合は、Pro ではない形で公開します</li>
                        <li>特別な乗車券の券面を表示してよいか（Pro の間だけ「はい」）。この項目は Pro の印を外しても変わらないため、印を外していても、いま Pro であるかどうかは他の方に分かります</li>
                        <li>サポーターの番号・申し込んだ日・続けた月数（Pro を購入した方）。App Store の取引番号・商品・有効期限は公開しません。TestFlight などの試験用の環境での購入による番号は、ご本人にだけ表示します</li>
                        <li>認証済みの印（運営が付けた場合。ご本人が外している場合は公開しません）</li>
                    </ul>
                    <p>
                        居住地は自由入力のプロフィール項目で、撮影地の集約ページや地図には使いません。
                        光と天気の知らせを受け取るかどうかの設定は公開しません。
                    </p>
                </Section>

                <Section title="5. 機能ごとの情報の扱い">
                    <p><strong className="text-white/90">すれちがい（iPhone アプリ）</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>初期状態はオフです。オンにすると、Bluetooth で近くにいるアプリの利用者を見つけ、「乗車券」に選んだご自身の公開写真1枚をカードとして交換します。いつでもオフにできます。</li>
                        <li>
                            オンの間、端末は次の内容を Bluetooth の電波で出します: 乗車券の写真のID、ひとこと（20字まで）、乗車券の「発」「着」の字（6字まで）、居住地を出すかどうかの印、券面の種類。
                            連絡先・位置・端末の識別子は出しません。
                        </li>
                        <li>
                            <strong className="text-white/90">この内容は暗号化していません。</strong>
                            アプリ以外の機器も含め、近くの Bluetooth 機器から読み取ることができ、写真のIDから公開中の写真の一覧を通じて持ち主が分かります。
                            出す値は乗車券を変えるまで同じで、日ごとに変わる仕組みはありません。ブロックした相手の端末にも届くことがあります。
                        </li>
                        <li>居住地を出す設定にしている場合、受け取った方の端末に、あなたのプロフィールの居住地から都道府県が表示されます。</li>
                        <li>
                            受け取ったカード、すれちがった場所（市区町村の名前と、粗く丸めた位置）と日時は、その iPhone の中にだけ保存し、当サイトのサーバーには送りません。
                            場所は、撮影地マップで位置情報の利用を許可している場合にだけ記録し、市区町村の名前を調べるときは約1kmに丸めた位置を Apple の地図サービスに渡します。
                        </li>
                        <li>受け取ったカードの写真と持ち主の名前・アイコン・居住地は、当サイトの公開中の写真の一覧と公開プロフィールから取得して表示します。</li>
                        <li>カードに「ありがとう」を送ると、相手の写真にあなたの名前でいいねが届きます。</li>
                    </ul>

                    <p className="pt-1"><strong className="text-white/90">旅のトランク（iPhone アプリ）</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>
                            写真を公開すると、投稿ごとにラベルと硬貨が配られます（1日の数などの上限があります）。サーバーには、ラベル（撮影地の名前・国、季節、時間帯、節目、配られた日時、トランクに貼った位置）、
                            選んだトランクの型、硬貨の枚数、部品・かけら・付けている部品、ラベルを受け取るかどうかの設定を保存します。これらはご本人だけが見られ、公開しません。
                        </li>
                        <li>
                            同じ写真を消して上げ直してラベルや硬貨を集めることを防ぐため、配った投稿の記録を別に保存します。
                            記録するのは、写真の撮影日時・機種・画像の大きさから作った短い符号（撮影日時の無い写真は写真のIDから作った符号）、同じ投稿のまとまりを表す符号、配った節目、1日に配った数、24時間以内に硬貨を配った投稿のIDと時刻です。
                        </li>
                        <li>
                            この記録は、写真やラベルを消しても消しません。符号は新しい方から3,000件まで残し、古いものから消します。硬貨を配った投稿の記録は24時間を過ぎたものから消します。
                            ラベル・硬貨そのものは、投稿から24時間以内に写真を削除・非公開にした場合に取り消されることがあります。
                        </li>
                        <li>退会すると、トランクの内容と上の記録はどちらも削除します。</li>
                    </ul>

                    <p className="pt-1"><strong className="text-white/90">光と天気の知らせ・プッシュ通知（iPhone アプリ）</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>
                            アプリで通知を許可すると、端末の通知用の識別子（APNs のデバイストークン）をサーバーに保存し、いいね・コメント・フォローなどのお知らせを Apple のプッシュ通知サービス（APNs）経由で送ります。
                            通知の文面には、操作した方の名前などが含まれます。識別子は1人につき10台分まで保存し、アプリで通知を受け取らない設定にしたとき、同じ端末で別の方がログインしたとき、退会したとき、Apple から無効と知らされたときに外します。
                        </li>
                        <li>
                            光と天気の知らせは Pro の機能です。「行きたい場所」に入れた撮影スポット（新しい方から20件まで）について、当サイトのサーバーが Apple の天気サービス（WeatherKit）からスポットの天気予報を取得し、毎日20時（日本時間）に、翌日の朝・夕の見込みが良い場所があれば1通だけ知らせます。
                        </li>
                        <li>
                            WeatherKit に送るのは撮影スポットの座標（約1kmに丸めた値）と時刻帯だけで、あなたの現在地や、あなたを識別する情報は送りません。
                            同じ日に二度送らないために、最後に知らせた日付を保存します。知らせを受け取らない設定にした場合は、その設定を保存します。
                        </li>
                    </ul>

                    <p className="pt-1"><strong className="text-white/90">Pro の購入（iPhone アプリ）</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>Pro は App Store の自動更新の定期購入です。支払いは Apple が処理し、当サイトはクレジットカードなどの支払い情報を受け取りません。ウェブサイトでは販売していません。</li>
                        <li>購入するときに、あなたの利用者IDから作った識別子（appAccountToken）を Apple に渡し、購入とアカウントを結び付けます。</li>
                        <li>
                            購入の後、アプリが Apple の署名付きの取引情報をサーバーへ送ります。また、更新・返金などの際に App Store から知らせを受け取ります。
                            サーバーには、商品、取引の番号、購入日・有効期限、自動更新の有無、本番と試験用のどちらの環境か、Pro だった期間、取引とアカウントの結び付け（過去の持ち主の履歴を含む）、処理済みの知らせの番号を保存します。
                        </li>
                        <li>購入した方にはサポーターの番号を付けます。公開する範囲は「4. 公開プロフィールに表示される情報」のとおりです。</li>
                    </ul>
                </Section>

                <Section title="6. 利用目的">
                    <ul className="list-disc pl-5 space-y-1">
                        <li>写真ギャラリーの表示・運営</li>
                        <li>アカウントの認証、投稿された写真の管理</li>
                        <li>お知らせ・プッシュ通知の送信、Pro の提供</li>
                        <li>サイトの利用状況の把握と改善</li>
                        <li>不正利用の防止</li>
                    </ul>
                </Section>

                <Section title="7. アクセス解析ツールについて">
                    <p>
                        当サイト（ウェブサイト）は、利用状況を把握するために Google アナリティクス（GA4）を利用しています。
                        Google アナリティクスはデータの収集のために Cookie を使用し、匿名のトラフィックデータを収集します。
                        このデータは匿名で収集されており、個人を特定するものではありません。アプリにはアクセス解析・広告の仕組みを入れていません。
                    </p>
                    <p>
                        収集の仕組みや Google におけるデータの利用については、
                        <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-link hover:text-link underline underline-offset-2">
                            Google のポリシーと規約
                        </a>
                        をご確認ください。ブラウザの設定で Cookie を無効にすることで、収集を拒否することもできます。
                    </p>
                </Section>

                <Section title="8. 広告配信について">
                    <p>
                        当サイトでは、将来的に第三者配信の広告サービス（Google AdSense など）を利用する場合があります。
                        その際、広告配信事業者はユーザーの興味に応じた広告を表示するために Cookie を使用することがあります。
                    </p>
                    <p>
                        Cookie を無効にする方法や Google AdSense に関する詳細は、
                        <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer" className="text-link hover:text-link underline underline-offset-2">
                            広告 – ポリシーと規約 – Google
                        </a>
                        をご確認ください。
                    </p>
                </Section>

                <Section title="9. 第三者への提供・委託先">
                    <p>当サイトは、法令に基づく場合を除き、取得した情報を第三者に販売・提供しません。ただし、運営のために以下のサービスを利用しています。</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li><strong className="text-white/90">Amazon Web Services</strong> — 写真・データの保存、配信、認証（Cognito）</li>
                        <li><strong className="text-white/90">Google アナリティクス</strong> — アクセス解析（ウェブサイトのみ）</li>
                        <li><strong className="text-white/90">OpenStreetMap（Nominatim）</strong> — 撮影地名の解決（座標は約1kmに丸めた値のみ送信）</li>
                        <li><strong className="text-white/90">Apple</strong> — App Store（Pro の購入と取引の確認）、プッシュ通知（APNs）、天気予報（WeatherKit。撮影スポットの座標のみ送信）、曲の検索（検索した語のみ送信）。アプリでは、旅やすれちがいの場所の名前を調べるために、約1kmに丸めた位置を Apple の地図サービスに渡します</li>
                    </ul>
                </Section>

                <Section title="10. 投稿された写真の公開範囲">
                    <p>
                        投稿された写真は、公開設定にした場合にインターネット上で誰でも閲覧できる状態になり、検索エンジンにも収集されます。
                        「下書き」として保存した写真は非公開で、ご本人以外は閲覧できず、検索エンジンにも公開されません。
                    </p>
                </Section>

                <Section title="11. 退会・データの削除">
                    <p>
                        アカウントをお持ちの方は、設定ページの「危険な操作」から退会（アカウント削除）を行えます。この操作は取り消せません。
                    </p>
                    <p><strong className="text-white/90">退会すると削除されるもの</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>アカウント（メールアドレスなど）、プロフィール、アイコン・カバー写真</li>
                        <li>投稿した写真・ストーリーと、それらに付いたコメント・返信。公開済みのページも作り直して取り除きます</li>
                        <li>フォロー、いいね・保存した写真の一覧、行きたい場所、旅行プラン、親しい友達、ブロック、お知らせ、ご自身が作った共同アルバムとハイライト</li>
                        <li>旅のトランクの内容と、配った投稿の記録</li>
                        <li>プッシュ通知の端末の識別子、光と天気の知らせの記録</li>
                        <li>Pro の取引とあなたのアカウントの結び付け</li>
                        <li>アプリでは、その端末に残っているすれちがいの記録と設定など、あなたの控え</li>
                    </ul>
                    <p className="pt-1"><strong className="text-white/90">退会しても残るもの</strong></p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>退会済みであることの記録（利用者ID・ユーザー名・退会日時）。退会したアカウントが復活するのを防ぎ、コメントの名前を伏せるために使います。現在、この記録を自動で消す期限は設けていません</li>
                        <li>他の方の写真に書いたコメントと、他の方のストーリーへの返信（その写真・ストーリーが削除されるまで）。名前は「退会したユーザー」と表示します</li>
                        <li>どの写真にいいね・保存をしたかの個別の印（利用者IDと写真IDのみ）</li>
                        <li>不適切な投稿の通報の記録（通報した方のIDと、書かれた補足）</li>
                        <li>他の方の共同アルバムに参加していた印と、ご自身が発行した招待リンクの記録</li>
                        <li>Pro の取引の結び付けが、ご自身から別のアカウントへ移っていた場合の、過去の持ち主の履歴</li>
                        <li>サーバーの動作記録（ログ）に含まれる利用者IDなど</li>
                    </ul>
                    <p>
                        Pro の定期購入は、退会しても Apple 側では解約されません。解約は App Store のサブスクリプションの設定から行ってください。
                    </p>
                </Section>

                <Section title="12. お問い合わせ">
                    {siteConfig.contactEmail ? (
                        <p>
                            本ポリシーに関するお問い合わせは{" "}
                            <a href={`mailto:${siteConfig.contactEmail}`} className="text-link hover:text-link underline underline-offset-2">
                                {siteConfig.contactEmail}
                            </a>{" "}
                            までご連絡ください。
                        </p>
                    ) : (
                        <p>お問い合わせ先は準備中です。</p>
                    )}
                </Section>

                <Section title="13. 本ポリシーの変更">
                    <p>
                        本ポリシーの内容は、必要に応じて変更することがあります。変更した場合は、本ページに掲載するとともに最終更新日を更新します。
                    </p>
                </Section>
            </div>

            <div className="mt-10 pt-6 border-t border-line">
                <Link href="/" prefetch={false} className="text-sm text-white/60 hover:text-white transition-colors">← ホームに戻る</Link>
            </div>
        </main>
    );
}
