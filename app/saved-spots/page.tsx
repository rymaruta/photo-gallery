import SavedSpotsClient from "./SavedSpotsClient";
import { spotLinksBySlug } from "../../lib/data/spotLink";

/**
 * 行きたい場所（`/saved-spots`）の**サーバー側の殻**。
 *
 * 🔴 **役目は1つ——台帳をここで解いて、画面に要る項目だけ渡すこと。**
 *
 * 画面（`SavedSpotsClient`）は `"use client"` なので、そこから
 * `content/spots.json` を読むと**全文がこのページのチャンクに載る**
 * （台帳に1件入れてビルドして実測。`lib/data/spotLink.ts` の注記）。
 * 使うのは名前・地域・スラッグの3つだけなので、**解いてから渡す**。
 *
 * 静的書き出し（`output: export`）なので、これはビルド時に1回だけ走る。
 */
export default function SavedSpotsPage() {
    return <SavedSpotsClient spots={spotLinksBySlug()} />;
}
