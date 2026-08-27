// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
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
import { LocaleProvider } from "./i18n/context";
import { siteConfig, generateWebSiteStructuredData } from "../lib/utils/seo";

const inter = Inter({ subsets: ["latin"], weight: ["400", "700", "900"], display: "swap" });

// Instagram IAB / iOS Safari でブラウザUIを除いた実際の表示領域を使う
// viewportFit=cover でノッチ・ホームインジケーター領域の safe-area-inset を有効化
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
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
    locale: siteConfig.locale.ja,
    alternateLocale: siteConfig.locale.en,
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    images: [
      {
        url: siteConfig.ogImage.startsWith("http") 
          ? siteConfig.ogImage 
          : `${siteConfig.url}${siteConfig.ogImage}`,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage.startsWith("http") 
      ? siteConfig.ogImage 
      : `${siteConfig.url}${siteConfig.ogImage}`],
    creator: siteConfig.twitterHandle,
  },
  alternates: {
    canonical: siteConfig.url,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Search Console / Bing の確認トークン（siteConfig 経由・未設定なら出力しない）
    ...(siteConfig.gscVerification ? { google: siteConfig.gscVerification } : {}),
    ...(siteConfig.bingVerification ? { other: { "msvalidate.01": siteConfig.bingVerification } } : {}),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const webSiteStructuredData = generateWebSiteStructuredData();
  
  return (
    <html lang="ja">
      <head>
        {/*
          CSS が届かなかったときの最低限の下地。
          スタイルシートが 404/403 になると真っ白＋既定フォントで「壊れた」ページに
          見えてしまう。下の自己修復が効くまでの数百ミリ秒を、せめて黒背景で見せる。
          本体CSS（globals.css）が同じ値を指定するので、正常時の見た目は変わらない。
        */}
        <style dangerouslySetInnerHTML={{ __html: "html,body{background:#000;color:#fff;margin:0}" }} />
        {/* 画像配信元(CloudFront)へ事前接続し、最初の画像の DNS+TLS 待ちを削減（LCP改善）。
            **本番ドメインを直書きしない。** 直書きだった頃は staging の全ページが
            開くたびに本番CDNへ無駄な接続を張り、実際の配信元（staging のCDN）には
            preconnect が効かない——狙った LCP 改善が staging で再現しなかった。
            未設定なら出さない（本番へフォールバックしない。CLAUDE.md の方針）。 */}
        {process.env.NEXT_PUBLIC_CLOUDFRONT_URL ? (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_CLOUDFRONT_URL} crossOrigin="" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_CLOUDFRONT_URL} />
          </>
        ) : null}
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

          error イベントだけでは取りこぼす経路が2つある:
          (1) <link rel=stylesheet> は Next が head の先頭に置くため、
              このスクリプトが動く前に error が発火しうる（キャッシュ済みの失敗など）
          (2) CDN/WAF が 200 + HTML本文 を返すと error にならず「規則ゼロ」になる
          そこで load 後に「CSS規則が1つでも当たっているか」を直接確かめる。
          JS だけ動いて CSS が無い状態は水和ウォッチドッグでは検知できないため必須。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var KEY="jp_asset_reload_at";function rl(){var now=Date.now(),last=0;try{last=Number(sessionStorage.getItem(KEY)||0)}catch(x){return}if(last&&now-last<60000)return;try{sessionStorage.setItem(KEY,String(now))}catch(x){return}location.reload()}addEventListener("error",function(e){var t=e.target;if(!t||typeof t.tagName!=="string")return;var tag=t.tagName.toUpperCase();var isAsset=tag==="SCRIPT"||(tag==="LINK"&&String(t.rel||"").toLowerCase().indexOf("stylesheet")>-1);if(!isAsset)return;rl()},true);addEventListener("load",function(){try{var ls=document.querySelectorAll('link[rel~="stylesheet"]');if(!ls.length)return;for(var i=0;i<ls.length;i++){var s=ls[i].sheet;if(!s)continue;try{if(s.cssRules&&s.cssRules.length)return}catch(x){return}}rl()}catch(e){}})}catch(e){}})();`,
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
          クールダウンの控えは **sessionStorage**（＝タブごと）。localStorage に
          置いていた頃は全タブで共有だったので、1つのタブが自己修復すると、
          同じく壊れている2つ目以降のタブは最大10分そのまま操作できなかった
          （すぐ上の資産チェックは最初から sessionStorage で、そちらが正しい）。
          再読込をまたいでも消えないので、ループ防止の役目は変わらない。
          正常時は水和と同時にフラグが立つため発火しない。React に依存せず <head> で動く。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var K="jp_hydrate_recover_at";function reheal(){try{if(document.documentElement.getAttribute("data-hydrated")==="1")return;var now=Date.now(),last=0;try{last=Number(sessionStorage.getItem(K)||0)}catch(e){}if(last&&now-last<600000)return;try{sessionStorage.setItem(K,String(now))}catch(e){}var done=false,go=function(){if(done)return;done=true;if(document.documentElement.getAttribute("data-hydrated")==="1")return;location.reload()};var ps=[];try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){ps.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).catch(function(){}))}}catch(e){}try{if(window.caches&&caches.keys){ps.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}).catch(function(){}))}}catch(e){}Promise.all(ps).then(go,go);setTimeout(go,3000)}catch(e){}}addEventListener("load",function(){setTimeout(reheal,12000)})}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${inter.className} min-h-screen flex flex-col bg-black text-white`}>
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
              {/* Header: 黒背景に白字のモダンなデザイン */}
              <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-md border-b border-white/10">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                <div className="relative max-w-5xl mx-auto flex items-center justify-between h-[64px] md:h-[72px] px-6 md:px-8">
                  <p className={`${inter.className} text-2xl md:text-3xl font-bold tracking-tight text-white m-0`}>
                    <Link
                      href="/"
                      className="inline-block hover:opacity-70 transition-opacity duration-200 relative group"
                    >
                      <span className="relative z-10">Journey Photo</span>
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
              </MusicProvider>
            </AuthProvider>
          </LocaleProvider>
        </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
