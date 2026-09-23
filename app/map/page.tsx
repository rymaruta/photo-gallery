import MapPageClient from "./MapPageClient";
import { spotPins } from "../../lib/data/spotLink";

/**
 * 撮影地マップ（`/map`）の**サーバー側の殻**。
 *
 * 🔴 **役目は1つ——公式スポットの台帳をここで解いて、地図に要る項目だけ渡すこと。**
 *
 * 画面（`MapPageClient`）は `"use client"` なので、そこから
 * `content/spots.json` を読むと**全文がこのページのチャンクに載る**
 * （`lib/data/spotLink.ts` の注記。台帳に1件入れてビルドして実測済み）。
 * 地図が使うのは名前・地域・スラッグ・座標の4つだけなので、**解いてから渡す**。
 *
 * 静的書き出し（`output: export`）なので、これはビルド時に1回だけ走る。
 */
export default function MapPage() {
    return <MapPageClient spots={spotPins()} />;
}
