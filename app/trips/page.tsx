import TripsClient from "./TripsClient";
import { spotLinksById } from "../../lib/data/spotLink";

/**
 * 旅行プラン（`/trips`）の**サーバー側の殻**。
 *
 * 🔴 **役目は1つ——台帳をここで解いて、画面に要る項目だけ渡すこと。**
 *
 * 画面（`TripsClient`）は `"use client"` なので、そこから
 * `content/spots.json` を読むと**全文がこのページのチャンクに載る**
 * （`lib/data/spotLink.ts` が実測つきで書いている）。
 * 使うのは名前・地域・スラッグだけなので、**解いてから渡す**。
 *
 * 静的書き出し（`output: export`）なので、これはビルド時に1回だけ走る。
 */
export default function TripsPage() {
    return <TripsClient spots={spotLinksById()} />;
}
