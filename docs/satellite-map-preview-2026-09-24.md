# Journey Photo 衛星ハイブリッドマップ試作（2026-09-24）

## 適用範囲・既存機能

- 新ブランチ `design/satellite-hybrid-map-20260924` は **PR #150 の `design/cinematic-map-preview-20260924` から分岐した依存PR**。 `develop`、`main`、本番環境は未変更。
- 写真ピン、クラスタ、公開可能な公式スポット、現在地、エリア検索、ガイド詳細、行きたい保存は **既存の1つのLeaflet地図** 上に残す。別の地図を作らない。
- 参考の旅行アプリ用モックのような自然な色と実際の地理的描写を優先し、**ベース画像は本物の衛星・航空写真**にする。ダーク地図をCSSで衛星っぽく塗るのではない。

## 高精細衛星写真の条件（必須）

MapTilerの正規の**Satellite Hybrid v4** スタイルをMapLibre背景レイヤーへ指定する。MapTilerは公開Web向けのAPIキーが必要なサービスであり、ユーザーのキーを推測・自動作成・コミットしない。

```sh
NEXT_PUBLIC_JOURNEY_MAPTILER_KEY=<MapTiler Cloudで発行したブラウザ用キー>
```

- 上記をローカル `.env.local` または対象プレビューのビルド環境変数で設定して再起動・再ビルドする。 `NEXT_PUBLIC_` なのでブラウザから閲覧可能。**秘密鍵や管理者用キーを入れない。** MapTiler Cloudで閲覧元ドメイン（ローカルとプレビュー、本番を使用する場合は本番ドメイン）を許可して他を拒否し、利用量・料金・画像ライセンスを確認する。
- 実装は `https://api.maptiler.com/maps/hybrid-v4/style.json?key=...` を利用。衛星写真はMapTilerの正式なスタイルと配信元から描画し、地名などの最低限のラベルを残しつつ、`boundary`/`admin`/`maritime`/`territorial` に該当するレイヤーを非表示。**元の衛星画像に既に焼き込まれた線や国境は除去できない**ため、スタイルでコントロール可能なベクターレイヤーのみ対象。
- **キー未設定**の場合は既存のOpenFreeMap実ベクター地図を表示し、「衛星写真にはキーが必要」と表示。**衛星版が完成して見えていると報告しない**。通信・キー・スタイルの失敗時も読みやすい従来のOSM実地図に戻し、必要なら失敗を表示する。
- 実衛星モードでは、前ブランチにあった暗色塗り・NASA低解像度地形ラスタを**一切重ねない**。写真そのものの自然な色を使う。背景地図以外の写真ピン・ガイドカード・現在地などは引き続き通常表示。
- MapTilerと衛星データ提供者の著作権・帰属は地図内で可視にする。**利用規約・帰属の最終確認は公開前の必須ゲート。**

公式参考: [MapTiler Satellite Hybrid](https://docs.maptiler.com/sdk-js/examples/built-in-styles/) / [MapTiler APIキー](https://docs.maptiler.com/cloud/api/authentication-key/) / [キーの閲覧元制限](https://docs.maptiler.com/guides/maps-apis/maps-platform/how-to-protect-your-map-key/)

## CI検証・スクリーンショットの条件

- `app/map/__tests__/satelliteHybrid.test.ts` はキー未設定のフォールバック、正式URL生成、境界線非表示ルール、ラベル維持を検証する**コードテスト**。これだけでは衛星写真が取得できた証拠にならない。
- PRのスクショ用GitHub Actionsは **`secrets.JOURNEY_MAPTILER_PREVIEW_KEY`** が設定されていれば、実Next.jsの地図を起動して`data-basemap="satellite-ready"`を確認し、**real-satellite**と付いたファイル名で390×844/1280×800の未選択・選択状態を保存する。
- プレビューキーが無い場合は実衛星モードを撮らず、既存の**vector fallback**しか撮れないとファイル名に明示する。`satellite-ready`が表示できないときはCIを失敗させる。**いままでの#150の地図スクショを新しい衛星スクショとして再利用しない。**
- CIの3地点はランナー内の隔離されたfixture。 `content/spots.json`、実ユーザーデータ、公式代表画像、公開座標には触れない。
- 最終受け入れには、**実衛星タイルが見える**日本の沿岸部／山間部と海外の離島のスマホ・PCスクショ、現在地の許可/拒否、写真ピンが多数の画面、一覧と保存、ピンの背景への視認性、通信量・料金を確認する。

## 残る公開前の制約

PR #150側のMapLibreとLeafletブリッジは試作用CDN読込のまま。本番公開前にnpm固定依存・自己配信への変更、WebGLやCSPの実機テスト、衛星提供元の利用許諾、出典の正式レビューを行う。PR #150 とこのブランチのどちらを採用するかオーナーのスクショ確認後に決める。**PRを勝手にマージ/公開しない。**
