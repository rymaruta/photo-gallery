import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番環境: S3+CloudFrontで静的サイトとして配信するため、静的エクスポートが必要
  // 開発時の /api は serverless-offline（api/）にプロキシ。app/api は廃止済み。
  output: "export",
  // rewrites は開発時のみ使用。output: export と併存するため Next が警告するが、開発では有効・本番では使わない想定。→ docs/NOTES.md
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:3002/api/:path*" }];
    }
    return [];
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "journey-photo.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "www.journey-photo.com", pathname: "/uploads/**" },
      { protocol: "https", hostname: "d1s3dwwzgxf5ni.cloudfront.net", pathname: "/uploads/**" },
    ],
  },
  // 静的エクスポート: API は app に含めず、本番は API Gateway + Lambda、開発時は rewrites で serverless-offline にプロキシ。
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
