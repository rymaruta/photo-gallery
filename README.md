# Photo Gallery

Next.js を使ったシンプルなギャラリーアプリです。  
TypeScript + Tailwind CSS + Heroicons を導入して開発しています。

---

## 📖 目次
1. プロジェクト概要
2. セットアップ手順
3. 開発環境の構築
4. Git 操作
5. 今後の予定

---

## 1. プロジェクト概要
このリポジトリは Next.js をベースにしたギャラリーアプリです。  
TypeScript と Tailwind CSS を導入し、Heroicons を利用して UI を強化しています。

---

## 2. セットアップ手順
### Next.js プロジェクト作成
```bash
npx create-next-app@latest
cd photo-gallery/
npm run dev
```
## 2. セットアップ手順
### Next.js プロジェクト作成
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

## 3. 開発環境の構築
### 環境リセットと再インストール
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```
### TypeScript 導入
```bash
npm install --save-dev typescript @types/react @types/node
npm install --save-dev @types/react @types/react-dom
```
### Heroicons 導入
```bash
npm install @heroicons/react
```
### Tailwind CSS 導入
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```
## 4. Git 操作
# Git 初期化
```bash
git init
```
# ファイルをステージング
```bash
git add .
```
# コミット
```bash
git commit -m "初期版ギャラリーを保存"
```
# GitHubで新しいリポジトリを作成（例: photo-gallery）
```bash
git remote set-url origin https://github.com/rymaruta/photo-gallery.git
```
# ブランチ名を main に揃える
```bash
git branch -M main
```
# push
```bash
git push -u origin main
```
## 5. 今後の予定
▶　画像アップロード機能の追加  
▶　モーダル表示の実装  
▶　Tailwind を活用したデザイン改善  