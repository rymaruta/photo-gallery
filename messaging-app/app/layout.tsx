import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talk - Messaging App",
  description: "LINE-style messaging demo built with Next.js + SSE",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#06C755",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="antialiased">
        <div className="mx-auto max-w-md min-h-screen bg-white shadow-lg">
          {children}
        </div>
      </body>
    </html>
  );
}
