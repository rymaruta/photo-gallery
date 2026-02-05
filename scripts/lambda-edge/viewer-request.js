/**
 * Lambda@Edge Viewer Request: リライト + OGP用に X-Photo-Id / X-Original-Host を付与
 * Next.js 静的エクスポートは xxx.html をルートに出力するため、パスを .html に合わせる。
 * - /photo/[id] → /photo/_.html、X-Photo-Id: [id]
 * - /admin/edit/[id] → /admin/edit/_.html
 * - /about, /admin, /favorites など → /about.html, /admin.html, /favorites.html ...
 */
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  let uri = request.uri || "";
  const headers = request.headers || {};

  const host = headers.host && headers.host[0] && headers.host[0].value;
  if (host) {
    request.headers["x-original-host"] = [{ key: "X-Original-Host", value: host }];
  }

  // 誤って /next/ でリクエストされた場合に /_next/ へリライト（キャッシュ・プロキシで _ が落ちた場合の救済）
  if (uri.startsWith("/next/")) {
    request.uri = "/_next/" + uri.slice(6);
    return request;
  }

  // 静的ルート: Next は about.html, admin.html 等を出力（index.html ではない）
  const staticRoutes = [
    ["/about", "/about.html"],
    ["/about/", "/about.html"],
    ["/admin", "/admin.html"],
    ["/admin/", "/admin.html"],
    ["/favorites", "/favorites.html"],
    ["/favorites/", "/favorites.html"],
    ["/gallery", "/gallery.html"],
    ["/gallery/", "/gallery.html"],
    ["/history", "/history.html"],
    ["/history/", "/history.html"],
    ["/login", "/login.html"],
    ["/login/", "/login.html"],
    ["/news", "/news.html"],
    ["/news/", "/news.html"],
    ["/upload", "/upload.html"],
    ["/upload/", "/upload.html"],
  ];
  for (const [path, file] of staticRoutes) {
    if (uri === path) {
      request.uri = file;
      return request;
    }
  }

  const photoMatch = uri.match(/^\/photo\/([^/]+)\/?$/);
  if (photoMatch) {
    const id = photoMatch[1];
    request.uri = "/photo/_.html";
    if (id !== "_") {
      request.headers["x-photo-id"] = [{ key: "X-Photo-Id", value: id }];
    }
    return request;
  }

  if (/^\/admin\/edit\/[^/]+\/?$/.test(uri)) {
    request.uri = "/admin/edit/_.html";
  }
  return request;
};
