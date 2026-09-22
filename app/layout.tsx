// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { resolveOgImage } from "@/lib/server/photos";
import Link from "next/link";
import { Inter, Yusei_Magic, Yomogi } from "next/font/google";
import HeaderNav from "./components/HeaderNav";
import Footer from "./components/Footer";
import ToastProvider from "./components/ToastProvider";
import DisableSave from "./components/DisableSave";
import AssetRecovery from "./components/AssetRecovery";
import ProfileSetupBanner from "./components/ProfileSetupBanner";
import ErrorBoundary from "./components/ErrorBoundary";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import Analytics from "./components/Analytics";
import { AuthProvider } from "./auth/context";
import { MusicProvider } from "./music/MusicContext";
import MiniPlayer from "./components/MiniPlayer";
import BottomNav from "./components/BottomNav";
import { LocaleProvider } from "./i18n/context";
import { siteConfig, generateWebSiteStructuredData, INDEXABLE_ROBOTS, FEED_ALTERNATE } from "../lib/utils/seo";

/**
 * **日本語の字体を宣言する。**
 *
 * `Inter` は日本語のグリフを持たない。生成されるクラスは
 * `font-family: Inter, "Inter Fallback"` **だけ**で、総称ファミリ
 * （`sans-serif`）が付かない。`globals.css` の
 * `html, body { font-family: Arial, Helvetica, sans-serif }` は
 * **クラスの方が詳細度が高いので効かない**（実ビルドの CSS で確認）。
 *
 * つまりこのサイトの本文（ほぼ全部が日本語）は**どのフォントも宣言されて
 * いない**状態で、ブラウザの既定に落ちていた。既定は環境ごとに違う。
 * 一方**ヘッダーだけは `.site-header__nav` で
 * `"Noto Sans JP", system-ui, -apple-system, sans-serif` を宣言している**
 * ので、同じページの中で見出しと本文の字体が割れうる。
 *
 * `fallback` に**そのヘッダーと同じ並び**を渡して揃える
 * （`app/__tests__/fontStack.test.ts` が2つの一致を縛る）。
 * **新しい字体を持ち込んでいない**——`Noto Sans JP` は端末に在れば使う
 * 名前で、ここから webfont を落とすわけではない。
 *
 * **代償を測った。** `fallback` を渡すと Next は CLS 対策の
 * `Inter Fallback`（Arial を Inter の字幅に合わせた面）を出さなくなる。
 * 実ビルドをフォント 1.5 秒遅延で測った CLS は
 * **元 0.0008 / 変更後 0.0006**＝誤差。本文がほぼ日本語で Inter が
 * もともと当たらないため。
 *
 * ⚠️ **字体の見た目の差はこの環境では測れていない**（コンテナに CJK
 * フォントが1つしか無く、serif と sans-serif が同じ幅になる）。
 * 直したのは「総称ファミリも日本語の字体も宣言されていない」という
 * CSS の側の事実。
 */
const inter = Inter({
    subsets: ["latin"],
    weight: ["400", "700", "900"],
    display: "swap",
    fallback: ["Noto Sans JP", "system-ui", "-apple-system", "sans-serif"],
});

/**
 * **手書き2種**（ストーリーの文字だけで使う。owner の要望 2026-09-22
 * 「広告でよくある手書きのフォントも欲しい」「アオハルマーカー mini /
 * みぎかたあがり のフォントがいい」）。
 *
 * ⚠️ **名指しの2つはそのまま使えない。**
 *   - アオハルマーカーmini は**漢字を収録していない**（かな・英数字のみ）
 *   - みぎかたあがり は**漢字が69字だけ**
 *   どちらも文章に混ぜると「かなは手書き・漢字はゴシック」になる。
 *   さらに Web フォントはファイルを閲覧者全員へ配ることになるが、
 *   両方とも配布元（BOOTH）の規約に Web フォント可の明記が無い。
 *
 * そこで**見た目がいちばん近く、漢字を持ち、配ってよい**（SIL OFL）2つ:
 *   - `Yusei Magic`（油性マジック）＝マーカー書き
 *   - `Yomogi`（ヨモギ）＝ペンの走り書き
 *
 * **代償を抑える形**:
 *   - `preload: false`——全ページに `<link rel=preload>` を出さない。
 *     使うのはストーリーの文字だけで、ほとんどのページには1文字も無い
 *   - `display: "swap"`——落ちてくるまでは丸ゴシックで読める
 *   - `subsets` は**書かない**（次のコメント）。日本語は `unicode-range` で
 *     細かく割れて配られるので、**実際に落ちるのは使った字の範囲だけ**
 *
 * ⚠️ **`subsets` を書かない。** next/font が持つ一覧に `japanese` が無く
 * （`font-data.json` は cyrillic/greek-ext/latin/latin-ext だけ）、
 * `latin` と書くと**日本語の字が1つも入らない**。省くと全部の
 * `unicode-range` を取り込み、ブラウザは**使った範囲だけ**落とす。
 * 省くときは `preload: false` が要る（Next が止める）。
 *
 * ⚠️ **`fallback` も渡さない。** 渡すと next/font は**その並びを CSS 変数の
 * 中へ焼き込む**ので、`storyText.ts` の
 * `var(--font-marker),"Hiragino…",cursive` が実際にはこう展開される
 * （実ブラウザで `getComputedStyle` を読んで見つけた）:
 *
 *     "Yusei Magic",Hiragino Maru Gothic ProN,Hiragino Sans,sans-serif,
 *     "Hiragino Maru Gothic ProN","Hiragino Sans",cursive
 *      ^^^^^^^^^^ ここで総称ファミリに当たり、後ろ半分は永久に使われない
 *
 * 受け皿の並びは `storyText.ts` の1か所だけが持つ。渡さないと変数は
 * `"Yusei Magic","Yusei Magic Fallback"` になり、並びは `cursive` まで届く。
 *
 * ⚠️ **`adjustFontFallback: false` は効かない**（実ビルドで確かめた）。
 * 渡しても `@font-face{font-family:Yusei Magic Fallback;src:local(Arial);
 * size-adjust:111.71%}` は出て、変数にも入る。効かない指定は置かない。
 * 害は無い——この面は Arial なので**日本語の字を1つも持たず**、
 * CSS のフォント選択は字ごとに落ちるので、日本語は次の
 * `Hiragino Maru Gothic ProN` へ進む。
 */
const marker = Yusei_Magic({
    weight: ["400"],
    display: "swap",
    preload: false,
    variable: "--font-marker",
});
const scribble = Yomogi({
    weight: ["400"],
    display: "swap",
    preload: false,
    variable: "--font-scribble",
});
// Instagram IAB / iOS Safari でブラウザUIを除いた実際の表示領域を使う
// viewportFit=cover でノッチ・ホームインジケーター領域の safe-area-inset を有効化
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // **`manifest.webmanifest` が `theme_color` を宣言しているのに、
  // `<meta name="theme-color">` が1ページも無かった**（実ビルドで確認）。
  // マニフェストの色が効くのは**インストール後**で、ブラウザで見ている間の
  // ツールバーの色はこのメタタグが決める。真っ黒なサイトの上に既定の
  // 明るいツールバーが乗っていた。
  //
  // **新しい色を決めていない**——マニフェストが既に宣言している色を、
  // 閲覧中にも届くようにしただけ（`public/manifest.webmanifest` と同じ値。2026-09-21 に紺 `#050e17` へ——`globals.css` の `--color-bg` と同じ）。
  themeColor: "#050e17",
};

// **OGP 画像はビルド時に決める（静的な `metadata` から関数に変えた理由）。**
// 既定の `/images/og-image.jpg` は**存在しないファイル**で、トップページを
// SNS・LINE に貼っても画像が出ない状態だった（16ページがこの URL を出して
// いた）。新しく画像を作るのはデザインの判断なので、サイトが既に持って
// いるもの——一番新しい公開写真——を使う。詳しくは `resolveOgImage`。
export async function generateMetadata(): Promise<Metadata> {
  const ogImage = await resolveOgImage(siteConfig.url);
  return {
    metadataBase: new URL(siteConfig.url),
    manifest: "/manifest.webmanifest",
    // iOS Safari「ホーム画面に追加」で全画面スタンドアロン起動（アプリ体験）にする
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Journey Photo",
    },
    icons: {
      apple: "/icon-192.png",
    },
    // 旧 iOS 互換のため従来名も明示（Next は標準名 mobile-web-app-capable を出力するため）
    other: {
      "apple-mobile-web-app-capable": "yes",
    },
    title: {
      default: siteConfig.name,
      template: `%s | Journey Photo 旅フォトギャラリー`,
    },
    description: siteConfig.description,
    keywords: [
      "旅行写真", "旅フォト", "旅の写真", "旅行記", "旅行ギャラリー",
      "風景写真", "スナップ写真", "海外旅行", "国内旅行",
      "旅行", "旅", "ジャーニー", "フォト", "写真", "ギャラリー",
      "travel", "journey", "photo", "photography", "travel photography",
    ],
    authors: [{ name: "Journey Photo" }],
    creator: "Journey Photo",
    openGraph: {
      type: "website",
      // `alternateLocale`（og:locale:alternate = en_US）は落とした。
      // **英語版の URL は存在しない**（静的書き出しで HTML は1種類、
      // 言語の切り替えは `6d72bfb` で削除済み）。写真ページは同じ理由で
      // hreflang を消してあるのに、ここだけ別の形で「英語版がある」と
      // 申告し続けていた。
      locale: siteConfig.locale.ja,
      url: siteConfig.url,
      siteName: siteConfig.name,
      title: siteConfig.name,
      description: siteConfig.description,
      // **寸法は申告しない。** 実在しない固定画像を指していた頃の
      // 1200x630 が残っていたが、いま出すのは実際の写真で縦横比はまちまち
      // （`photos.json` は width/height を持たない）
      images: [{ url: ogImage, alt: siteConfig.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteConfig.name,
      description: siteConfig.description,
      images: [ogImage],
      creator: siteConfig.twitterHandle,
    },
    alternates: {
      canonical: siteConfig.url,
      // **フィードの場所を名乗る。** 置いただけでは誰も見つけない
      // ——ブラウザの拡張・収集サービスはこの宣言を見て購読先を出す。
      // **子が `alternates` を書くと消える**ので、書く側も混ぜること
      ...FEED_ALTERNATE,
    },
    // 中身は `lib/utils/seo.ts` の `INDEXABLE_ROBOTS`。子が
    // `robots` を書くとオブジェクトごと差し替わるので、同じものを
    // 2か所に書かない（`/users/<id>` がそれで googlebot の指定を落とした）
    robots: INDEXABLE_ROBOTS,
    verification: {
      // Search Console / Bing の確認トークン（siteConfig 経由・未設定なら出力しない）
      ...(siteConfig.gscVerification ? { google: siteConfig.gscVerification } : {}),
      ...(siteConfig.bingVerification ? { other: { "msvalidate.01": siteConfig.bingVerification } } : {}),
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteStructuredData = generateWebSiteStructuredData();
  
  return (
    <html lang="ja">
      <head>
        {/*
          CSS が届かなかったときの最低限の下地。
          スタイルシートが 404/403 になると真っ白＋既定フォントで「壊れた」ページに
          見えてしまう。下の自己修復が効くまでの数百ミリ秒を、せめて紺の下地で見せる。
          本体CSS（globals.css）が同じ値を指定するので、正常時の見た目は変わらない。
        */}
        <style dangerouslySetInnerHTML={{ __html: "html,body{background:#050e17;color:#fff;margin:0}" }} />
        {/* **画像配信元への事前接続はもう出さない。**
            以前はここで CloudFront の既定ドメインへ preconnect / dns-prefetch を
            張っていた。「最初の画像の DNS+TLS 待ちを削る」ためだが、
            **画面に描く画像URLを全部サイトのドメインに揃えた**ので
            （`lib/utils/seo.ts` の `publicImageUrl`）、その接続は**一度も使われない**。
            本番と同じ環境変数でビルドして数えた（2026-09-13）:

                out/**.html の src/srcset の絶対URL   981件 すべて journey-photo.com
                CloudFront の既定ドメインを指すタグ    preconnect と dns-prefetch だけ（140ページ）

            使わない相手への preconnect は、削ろうとしていた当の
            DNS+TLS を無駄に1本張る。画像はページと同じオリジンから来るので、
            その接続はもう開いている＝事前接続の相手がいない。 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteStructuredData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
        />
        {/*
          アセット読み込み失敗からの自己修復（インライン版）。
          React バンドル自体が読み込めないケースでは AssetRecovery コンポーネントは
          動かないため、HTML に直接埋め込んで CSS/JS の読み込み失敗を検知し
          1回だけ自動リロードする。lib/utils/assetRecovery.ts と同じキー・
          クールダウン（60秒）を共有するので二重リロードにはならない。

          **別オリジンは対象にしない。** ここが「`<script>` なら何でも」だったので、
          **広告ブロッカーが解析タグ（googletagmanager.com）を落とすだけで
          ページが自分でリロードしていた**。実ブラウザで A/B して確認した:

              GA が通る      読み込み 1回・リロードの印なし
              GA をブロック   読み込み 2回・navigation の type が "reload"

          **`lib/utils/assetRecovery.ts` の `isAssetElement` と同じ規則。**
          写しが2つあるのは、こちらが**チャンクより先に**動く必要があるため
          （React の部品では `<head>` の時点の失敗を拾えない）。
          最初あちらだけ直したが、**先に登録されるこちらが発火し続けていた**
          ——測って気づいた。突き合わせは
          `app/__tests__/assetRecoveryInline.test.ts` が振る舞いで行う。

          error イベントだけでは取りこぼす経路が2つある:
          (1) <link rel=stylesheet> は Next が head の先頭に置くため、
              このスクリプトが動く前に error が発火しうる（キャッシュ済みの失敗など）
          (2) CDN/WAF が 200 + HTML本文 を返すと error にならず「規則ゼロ」になる
          そこで load 後に「CSS規則が1つでも当たっているか」を直接確かめる。
          JS だけ動いて CSS が無い状態は水和ウォッチドッグでは検知できないため必須。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var KEY="jp_asset_reload_at";function rl(){var now=Date.now(),last=0;try{last=Number(sessionStorage.getItem(KEY)||0)}catch(x){return}if(last&&now-last<60000)return;try{sessionStorage.setItem(KEY,String(now))}catch(x){return}location.reload()}addEventListener("error",function(e){var t=e.target;if(!t||typeof t.tagName!=="string")return;var tag=t.tagName.toUpperCase();var url="";if(tag==="SCRIPT")url=t.src||"";else if(tag==="LINK"&&String(t.rel||"").toLowerCase().indexOf("stylesheet")>-1)url=t.href||"";else return;if(!url)return;var here=location.origin;if(!here)return;try{if(new URL(url,here).origin!==here)return}catch(x){return}rl()},true);addEventListener("load",function(){try{var ls=document.querySelectorAll('link[rel~="stylesheet"]');if(!ls.length)return;for(var i=0;i<ls.length;i++){var s=ls[i].sheet;if(!s)continue;try{if(s.cssRules&&s.cssRules.length)return}catch(x){return}}rl()}catch(e){}})}catch(e){}})();`,
          }}
        />
        {/*
          ハイドレーション・ウォッチドッグ（自己修復）。
          「見た目は正常だが一切タップできない（＝JS が水和していない）」状態は、
          古い Service Worker やキャッシュされた壊れたアプリシェルを iOS Safari 等が
          配信し続けると起こり、通常のリロードでは直らない（同じキャッシュを再配信するため）。
          そこで: 読み込み後 12 秒たっても data-hydrated が付かなければ（React が動いていない）、
          SW を解除しキャッシュを全消しして 1 回だけ再読込する。10 分クールダウンでループを防ぐ。
          **再読込の直前にもう一度 data-hydrated を見る。** 後片付け（SW 解除・
          キャッシュ全消し）には最大3秒かかり、その間に水和が終わることがある。
          無条件に再読込していたので、**遅い回線で入力中の内容が消えた**
          （アップロード画面のタイトル・キャプション）。間に合ったなら戻さない。
          **オフラインでは発火させない。** 通信が無いのに水和しないのは異常では
          ないうえ、ここで Cache Storage を全消しして SW を解除すると
          **オフライン機能ごと消えて、そのままブラウザのエラー画面**になる
          （オフラインなので再登録も控えの取り直しもできない）。
          `navigator.onLine` は true が当てにならない一方、false は信用してよい。
          クールダウンの控えは **sessionStorage**（＝タブごと）。localStorage に
          置いていた頃は全タブで共有だったので、1つのタブが自己修復すると、
          同じく壊れている2つ目以降のタブは最大10分そのまま操作できなかった
          （すぐ上の資産チェックは最初から sessionStorage で、そちらが正しい）。
          再読込をまたいでも消えないので、ループ防止の役目は変わらない。
          **控えを取れないなら諦める。** 読み書きが投げる端末（プライベート
          モード・サイトデータ拒否）では `last` が 0 のまま・控えも残らず、
          10分の歯止めが**一度も効かなかった**——水和できない状態が続く限り、
          読み込むたびに SW を解除し Cache Storage を全消しして再読込していた
          （テストで再現）。自己修復を1回も試さない方が、毎回巻き添えにするより軽い。
          すぐ上の資産チェックも同じ状況で `catch(x){return}` している。
          正常時は水和と同時にフラグが立つため発火しない。React に依存せず <head> で動く。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var K="jp_hydrate_recover_at";function reheal(){try{if(document.documentElement.getAttribute("data-hydrated")==="1")return;if(navigator.onLine===false)return;var now=Date.now(),last=0,ok=false;try{last=Number(sessionStorage.getItem(K)||0);ok=true}catch(e){}if(!ok)return;if(last&&now-last<600000)return;try{sessionStorage.setItem(K,String(now))}catch(e){return}var done=false,go=function(){if(done)return;done=true;if(document.documentElement.getAttribute("data-hydrated")==="1")return;location.reload()};var ps=[];try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){ps.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).catch(function(){}))}}catch(e){}try{if(window.caches&&caches.keys){ps.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}).catch(function(){}))}}catch(e){}Promise.all(ps).then(go,go);setTimeout(go,3000)}catch(e){}}addEventListener("load",function(){setTimeout(reheal,12000)})}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${inter.className} ${marker.variable} ${scribble.variable} min-h-screen flex flex-col bg-bg text-white`}>
        <Analytics />
        <DisableSave />
        <AssetRecovery />
        {/* ErrorBoundary の外に置く。
            data-hydrated="1" を立てているのはこの中の effect で、
            <head> の見張りはそれを「JSが動いた」の合図にしている。
            境界の中に入れていると、どこかのレンダーが投げた瞬間に
            この effect ごと捨てられ、フラグが立たない。
            利用者は「予期しないエラー」カードを読んでいるだけなのに、
            12秒後に見張りが Service Worker を解除し Cache Storage を消して
            強制リロードする（入力中のものは失われる）。 */}
        <ServiceWorkerRegister />
        <ErrorBoundary>
        <ToastProvider>
          <LocaleProvider>
            <AuthProvider>
              <MusicProvider>
              {/* Header: 紺の下地に白字（最終版モック） */}
              <header className="sticky top-0 z-50 bg-bar/70 backdrop-blur-md border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                <div className="relative max-w-5xl mx-auto flex items-center justify-between h-[64px] md:h-[72px] px-6 md:px-8">
                  {/* **文字を大きくしたときに譲る側。** `min-w-0` が無いと flex の
                      既定（`min-width:auto`）で縮まず、文字サイズ200%でヘッダーが
                      画面から 27px はみ出して**全ページが横スクロール**していた
                      （実測。WCAG 1.4.10 は拡大時に横スクロールを出さないことを求める）。
                      **100% では場所が余っているので見た目は変わらない。** */}
                  {/* **ロゴのマークは owner が出したアパーチャの画像そのもの**（2026-09-22）。
                      ファビコンとアプリのアイコンは既にこの絵なのに、**ヘッダーだけ
                      前の青い山が残っていた**——同じサイトが2つのマークを名乗っていた。

                      **絵は描き直さない。** owner の PNG を `scripts/icon-source/aperture.png`
                      に原寸で置き、配るのはその 64px の写し（`public/logo-aperture.png`・2.7KB）。
                      1254px を 28px の表示に配ると 560KB 払うことになるので縮めるだけで、
                      形は1画素も変えていない。
                      装飾なので読み上げには渡さない（`aria-hidden`＋空の `alt`）。 */}
                  <p className="font-serif text-[22px] md:text-[26px] font-bold tracking-tight text-white m-0 min-w-0">
                    <Link
                      href="/"
                      prefetch={false}
                      className="inline-flex items-center gap-2 min-w-0 max-w-full hover:opacity-70 transition-opacity duration-200 relative group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/logo-aperture.png" alt="" aria-hidden="true" width={32} height={32}
                           className="w-7 h-7 md:w-8 md:h-8 flex-shrink-0 rounded-md" />
                      {/* **切るなら「…」を見せる。** `truncate` は外側の `<p>` に
                          掛かっていたが、中身が `inline-flex` なので**省略記号が出ず、
                          文字が途中で断ち切られていた**（実測: 文字サイズ200%・幅390px で
                          48px ぶん欠けて「Journey Phot」になる。owner のスクショがこれ）。
                          縮む側は文字だけにして、詰まったときは「Journey Ph…」と見せる。 */}
                      <span className="relative z-10 min-w-0 truncate">Journey Photo</span>
                      <span className="absolute inset-0 bg-white/5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-0" />
              </Link>
            </p>

            <HeaderNav />
          </div>
        </header>

        {/* 名前が未設定のログインユーザーに、名前を決めてもらうよう促す */}
        <ProfileSetupBanner />

        {/* Main - 各ページで管理 */}
          <div className="flex-1">
            {children}
          </div>

              {/* Footer: 公式サイト風の洗練されたデザイン */}
              <Footer />

              {/* グローバル音楽のミニプレイヤー（再生中のみ表示） */}
              <MiniPlayer />

              {/* 画面下の5つのタブ。**全ページに常駐する**（owner の新デザイン）。
                  高さを `--bottom-bar-h` に出すので、ミニプレイヤーはその上に逃げる。
                  `body` の下余白（`app/globals.css`）も同じ変数を読む */}
              <BottomNav />
              </MusicProvider>
            </AuthProvider>
          </LocaleProvider>
        </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
