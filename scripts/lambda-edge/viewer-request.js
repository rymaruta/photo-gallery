/**
 * Lambda@Edge Viewer Request: リライト + OGP用に X-Photo-Id / X-Original-Host を付与
 * - /photo/[id] → /photo/_/（Next 静的エクスポートは photo/_/index.html）、X-Photo-Id: [id]
 * - /admin/edit/[id] → /admin/edit/_/
 * - /about（末尾スラッシュなし）→ /about/（S3 の about/index.html を返すため）
 */
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri || "";
  const headers = request.headers || {};

  const host = headers.host && headers.host[0] && headers.host[0].value;
  if (host) {
    request.headers["x-original-host"] = [{ key: "X-Original-Host", value: host }];
  }

  // 末尾スラッシュなしのパス → / を付与（S3 の index.html を返すため）
  if (uri === "/about") {
    request.uri = "/about/";
    return request;
  }
  if (uri === "/admin") {
    request.uri = "/admin/";
    return request;
  }

  const photoMatch = uri.match(/^\/photo\/([^/]+)\/?$/);
  if (photoMatch) {
    const id = photoMatch[1];
    request.uri = "/photo/_/";
    if (id !== "_") {
      request.headers["x-photo-id"] = [{ key: "X-Photo-Id", value: id }];
    }
    return request;
  }

  if (/^\/admin\/edit\/[^/]+\/?$/.test(uri)) {
    request.uri = "/admin/edit/_/";
  }
  return request;
};
