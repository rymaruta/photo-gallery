import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
