import type { Metadata } from "next";
import NotFoundClient from "./NotFoundClient";

/**
 * 404 の殻。**`metadata` を出すためだけにサーバー側に置く。**
 *
 * 中身（`NotFoundClient`）は `"use client"` で、クライアント部品は
 * `metadata` を export できない。その結果このページは
 * **`robots` を2つ出していた**（実ビルドで確認）:
 *
 *     <meta name="robots" content="noindex"/>        ← Next が 404 に自動で付ける
 *     <meta name="robots" content="index, follow"/>  ← ルートの layout
 *
 * Google は「最も制限の強いもの」を採るので実害は出ていないが、
 * **どちらが意図か次に読む人に分からない**。しかもこのリポジトリは
 * `robots` の差し替えで一度事故を起こしている（`412477e`——
 * `/users/<id>` を index にしたら googlebot の指定が丸ごと消えた）。
 *
 * ここで `robots` を書くと**ルートのオブジェクトごと差し替わる**ので、
 * 意図（索引に入れない・リンクは辿ってよい）が1か所で読めるようになる。
 */
export const metadata: Metadata = {
    robots: { index: false, follow: true },
};

export default function NotFound() {
    return <NotFoundClient />;
}
