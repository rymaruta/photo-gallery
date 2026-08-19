import type { NextConfig } from "next";
import { execSync } from "child_process";

/**
 * ビルドIDをコミットに固定する。
 *
 * 既定ではビルドのたびにランダムなIDが振られ、HTML と RSC ペイロードに
 * 埋め込まれる。そのため「ソースも写真も変わっていない定期ビルド」でも
 * 全ページの中身が変わり、
 *   - CloudFront の無効化が毎回サイト全体に及ぶ（写真も巻き添えで消える）
 *   - S3 へ 1200 ファイル書き直す
 * ということが起きていた。同じ内容なら同じ出力になるようにする。
 */
function buildId(): string | null {
    const fromCI = process.env.GITHUB_SHA;
    if (fromCI) return fromCI;
    try {
        return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    } catch {
        return null; // git が無い環境では Next の既定に任せる
    }
}

const nextConfig: NextConfig = {
    generateBuildId: buildId,
  // 本番環境: S3+CloudFrontで静的サイトとして配信するため、静的エクスポートが必要
  // ローカル開発: API Routesは使用（本番ではAPI Gateway + Lambdaを使用するため app/api はビルドに含めない）
  output: "export",
  images: { unoptimized: true },
  // 静的エクスポートビルド時は scripts/prepare-static-build.js が app/api を
  // _api_build_backup に退避するため、ここで webpack 除外は不要
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
};

export default nextConfig;
