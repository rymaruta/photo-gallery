# messaging-app

LINE風の1対1チャットアプリのデモ。Next.js (App Router) + Server-Sent Events (SSE) でリアルタイム配信を行います。

## 機能

- 初回起動時にアイコンと名前を登録
- 友だち一覧 / トーク一覧の2タブ切り替え
- 1対1チャット（テキスト送受信、既読表示、時刻表示）
- プロフィール編集（アイコン・名前・ステータスメッセージ）
- SSEによる他タブ・他デバイスへのリアルタイム反映
- デモ用Bot（クマ太郎・ねこさん・ぱんだ）が自動返信

## 技術スタック

- Next.js 15 (App Router, Route Handlers)
- React 19
- TypeScript (strict)
- Tailwind CSS
- Server-Sent Events（`/api/stream`）
- インメモリストア（`lib/store.ts`、`globalThis`でHMRを横断保持）

> **注意**: データはサーバープロセスのメモリに保持されるため、再起動で消えます。本番運用にはRedis/DB等への置き換えが必要です。

## セットアップ

```bash
cd messaging-app
npm install
npm run dev
```

ブラウザで http://localhost:3001 を開きます。

複数ユーザー間のメッセージングを試すには、別のブラウザ（またはシークレットウィンドウ）でも同じURLを開いて、それぞれ別の名前で登録してください。トーク一覧の「友だち」タブからお互いに話しかけられます。

## ディレクトリ

```
messaging-app/
├── app/
│   ├── page.tsx               # 初回登録
│   ├── chats/page.tsx         # トーク・友だち一覧
│   ├── chats/[roomId]/page.tsx # チャット画面
│   ├── profile/page.tsx       # プロフィール編集
│   └── api/
│       ├── users/route.ts
│       ├── rooms/route.ts
│       ├── messages/route.ts
│       └── stream/route.ts    # SSE
├── components/
│   ├── Header.tsx
│   └── Avatar.tsx
└── lib/
    ├── types.ts
    ├── store.ts               # インメモリ + EventEmitter
    └── client.ts              # localStorage helpers
```

## 動作仕組み（リアルタイム）

1. クライアントは `/api/stream` に EventSource で常時接続
2. メッセージ送信は `POST /api/messages` で行い、サーバー側 `EventEmitter` がブロードキャスト
3. 各クライアントは受信したイベントの種類に応じてREST再フェッチで状態を最新化
