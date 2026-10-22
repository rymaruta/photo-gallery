/**
 * scripts/edge/canonical-redirect.js
 *
 * **正規の URL へ寄せる 301（www・末尾スラッシュ・`.html`）。**（2026-10-22）
 *
 * GSC で同じページが別の URL で拾われていた:
 *   - `https://www.journey-photo.com/…`  → `https://journey-photo.com/…`
 *   - `/spots/x/`（末尾スラッシュ）       → `/spots/x`
 *   - `/spots/x.html`・`/index.html`     → `/spots/x`・`/`
 *
 * ## どこで動かすか（新しい費用の出る仕組みは足さない）
 *
 * 本番の CloudFront の既定ビヘイビアには、**すでに viewer-request のエッジ関数が付いている**
 * （`/foo` → `/foo.html` の書き換え・OGP。コードはこのリポジトリに無く、CloudFormation の外で作られた
 * Lambda@Edge。`scripts/diagnose-aws.js` の `edgeFunctionNote`）。その関数の**頭で**このファイルの
 * `redirectFor` を呼び、301 を返すときは元の処理に進まない。起動の回数は今と同じ＝費用は増えない。
 *
 *   Lambda@Edge（いまの形）:   exports.handler = withCanonicalRedirect(元の handler)
 *   CloudFront Functions:     `cloudFrontFunctionRedirect(event)` が値を返せばそれを return
 *
 * 🔴 **CloudFront Functions の実行環境でも動く書き方**にしてある（`require` なし・ES5 の範囲＋`const`/`let`）。
 * どちらの形の event も受けるので、どちらの関数に貼っても同じ規則になる。
 *
 * ## 出し方（owner の作業。このリポジトリからはエッジの関数を配らない）
 *
 *   1. us-east-1 の Lambda@Edge（本番の既定ビヘイビアの viewer-request）のコードを開き、このファイルを
 *      同じ zip に `canonical-redirect.js` として置く。handler の最後を
 *      `exports.handler = require("./canonical-redirect").withCanonicalRedirect(元の handler)` にする
 *   2. 「新しいバージョンを発行」→ Lambda のコンソールの「テスト」で、
 *      `scripts/__tests__/edgeCanonicalRedirect.test.ts` の event の形（www・`/x/`・`/x.html`・
 *      `/_next/…`・`/offline.html`・`/en`）を流し、301 と素通りを確かめる（配信には繋がない＝本番に影響なし）
 *   3. 既定ビヘイビアの viewer-request の紐付けを新しいバージョンに替える（`/_next/static/*` には付けない）
 *   4. 反映後に `curl -sI` で確かめ、戻すときは紐付けを前のバージョンへ戻す
 *
 * ⚠️ staging の配信には**エッジの関数が付いていない**（`provision-env.js` の `stripLambdaAssociations`）。
 * 本番の関数を staging に付けると本番のログと課金に乗るので、staging の配信では確かめられない。
 *
 * ## 触らないもの（既存の振る舞いを壊さない）
 *
 *   - GET / HEAD 以外（フォームやアプリの送信を 301 で GET に化けさせない）
 *   - `/_next/**`・`/api/**`・`/uploads/**`・`/profiles/**`・`/_` で始まるもの（静的ファイル・画像・API）
 *     ——ただし www の寄せだけは掛ける（同じパスのまま apex へ）
 *   - 拡張子のあるファイル（`.js`・`.css`・`.txt`（RSC）・`.xml`・`.png`…）。`.html` だけを外す
 *   - 本物の `.html` として配っているもの（`/offline.html`＝Service Worker の受け皿・`/404.html`＝
 *     カスタムエラー応答・`/google*.html`＝Search Console の確認ファイル）
 *   - `/en`・`/en/**`（このリポジトリのビルドには無いが、エッジの関数側で扱っている可能性がある。
 *     確かめていないので、www の寄せ以外は元の処理に任せる）
 *   - クエリは残す（`?photo=…` などの状態を落とさない）
 *
 * ## 安全
 *
 *   - 行き先は**同じサイトの中だけ**。www のときだけ絶対 URL（`https://journey-photo.com`）、
 *     それ以外は `/` で始まる相対の行き先。先頭の `//` は1本に畳む（`//evil.example/` を
 *     スキーム相対の URL として返さない＝開いたリダイレクトにしない）
 *   - 規則を当てても URL が変わらないときは何もしない（301 のループを作らない）
 */

var APEX_HOST = "journey-photo.com";
var WWW_HOST = "www.journey-photo.com";

/**
 * 旧サイトの URL（GSC で 404 と出ていたもの・2026-10-22）。いまのページに**はっきり当たるものだけ**。
 * 当たりの無いもの（`/photo/18` のような数字の id・消えた写真）は 404 のまま
 */
var LEGACY_REDIRECTS = {
    "/gallery": "/",
    "/journey/domestic/hikarinomichi": "/spots/miyajidake-jinja",
};

/** パスの規則（末尾スラッシュ・`.html`）を掛けない頭 */
var PASSTHROUGH_PREFIXES = ["/_next/", "/api/", "/uploads/", "/profiles/"];

/** 本物の `.html` として配っているもの（外すと壊れる） */
function isRealHtmlFile(path) {
    return path === "/offline.html" || path === "/404.html" || /^\/google[0-9a-z]+\.html$/i.test(path);
}

function isPassthroughPath(path) {
    if (path === "/en" || path.indexOf("/en/") === 0) return true;
    if (path.charAt(1) === "_") return true; // `/_next/…`・`/_not-found…`
    for (var i = 0; i < PASSTHROUGH_PREFIXES.length; i++) {
        if (path.indexOf(PASSTHROUGH_PREFIXES[i]) === 0) return true;
    }
    return false;
}

/** 最後の区切りに拡張子があるか（`.html` を含む） */
function extensionOf(path) {
    var last = path.slice(path.lastIndexOf("/") + 1);
    var m = /\.([0-9a-z]+)$/i.exec(last);
    return m ? m[1].toLowerCase() : "";
}

/**
 * パスを正規の形にする。変えないものはそのまま返す。
 *   `/a/` → `/a`、`/a.html` → `/a`、`/index.html`・`/a/index.html` → `/`・`/a`
 */
function canonicalPath(rawPath) {
    // 1回で収まる形まで掛ける（`/a/.html` → `/a/` → `/a` を2回の 301 にしない）。形は短くなる一方なので数回で止まる
    var path = rawPath;
    for (var i = 0; i < 4; i++) {
        var next = canonicalPathOnce(path);
        if (next === path) break;
        path = next;
    }
    return path;
}

function canonicalPathOnce(rawPath) {
    // 先頭の `//` は1本に畳む（スキーム相対の URL を作らない）
    var path = rawPath.replace(/^\/{2,}/, "/");
    if (path === "") return "/";
    if (isPassthroughPath(path)) return path;
    // 末尾のスラッシュ（いくつでも）を外す。`/` そのものは残す
    var trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
    if (trimmed === "") trimmed = "/";
    if (isPassthroughPath(trimmed)) return trimmed;
    var ext = extensionOf(trimmed);
    if (ext === "html" && !isRealHtmlFile(trimmed)) {
        var noExt = trimmed.replace(/\.html$/i, "");
        if (/\/index$/.test(noExt)) noExt = noExt.slice(0, -"/index".length);
        trimmed = noExt === "" ? "/" : noExt;
    }
    return trimmed;
}

/**
 * 行き先（`Location`）を返す。寄せなくてよいときは `null`。
 * @param {{ host?: string, uri: string, querystring?: string, method?: string }} req
 *   querystring は `a=1&b=2` の形（先頭の `?` なし）
 */
function canonicalRedirectTarget(req) {
    var method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return null;
    var uri = typeof req.uri === "string" && req.uri.charAt(0) === "/" ? req.uri : null;
    if (uri === null) return null;
    // 逆スラッシュ・制御文字を含むものは触らない（ブラウザは `/\evil` を `//evil` と読む＝相対の行き先が外へ出る）
    if (/[\\\u0000-\u001f\u007f]/.test(uri)) return null;
    var host = (req.host || "").toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
    var toApex = host === WWW_HOST;
    var path = canonicalPath(uri);
    if (Object.prototype.hasOwnProperty.call(LEGACY_REDIRECTS, path)) path = LEGACY_REDIRECTS[path];
    if (!toApex && path === uri) return null;
    // クエリも行き先のパスと同じく、16進を大文字に・生の非 ASCII をエンコードする（見出しに非 ASCII を入れない）
    var qs = req.querystring ? "?" + locationSafe(req.querystring) : "";
    return (toApex ? "https://" + APEX_HOST : "") + locationSafe(path) + qs;
}

/**
 * 行き先のパスを `Location` に載せられる形にする（**転送するときだけ**掛ける。転送しない URL の綴りは変えない）。
 *   - 百分率エンコードの16進は大文字にそろえる（`%e3` → `%E3`。ページの canonical・サイトマップと同じ形
 *     ＝転送先がもう一度別の綴りで拾われない）
 *   - 生の非 ASCII（エンコードされずに届いた日本語）はエンコードする。見出しに非 ASCII を入れると
 *     Lambda@Edge は応答ごと落とす（502）
 *   - NFC / NFD の違いには触らない（デコードしないので、届いたバイト列のまま。S3 の鍵の形を推測しない）
 */
function locationSafe(path) {
    return path
        .replace(/%[0-9a-f]{2}/gi, function (m) { return m.toUpperCase(); })
        .replace(/[^\u0021-\u007e]+/g, function (m) {
            try { return encodeURIComponent(m); } catch (_e) { return ""; }
        });
}

/** 301 の応答の見出し（Lambda@Edge と CloudFront Functions で形が違うので、値だけここで決める） */
var REDIRECT_CACHE_CONTROL = "public, max-age=86400";

// ── Lambda@Edge（viewer-request）───────────────────────────

/** CloudFront Functions の querystring（オブジェクト）を `a=1&b=2` に戻す */
function cfFunctionQuery(qs) {
    if (!qs || typeof qs !== "object") return "";
    var parts = [];
    for (var key in qs) {
        if (!Object.prototype.hasOwnProperty.call(qs, key)) continue;
        var v = qs[key];
        var push = function (item) {
            parts.push(item && item.value !== undefined && item.value !== "" ? key + "=" + item.value : key);
        };
        if (v && v.multiValue && v.multiValue.length) {
            for (var j = 0; j < v.multiValue.length; j++) push(v.multiValue[j]);
        } else push(v);
    }
    return parts.join("&");
}

/** Lambda@Edge の viewer-request の event から、301 の応答を返す（寄せないときは null） */
function lambdaEdgeRedirect(event) {
    var request = event && event.Records && event.Records[0] && event.Records[0].cf && event.Records[0].cf.request;
    if (!request) return null;
    var hostHeader = request.headers && request.headers.host && request.headers.host[0];
    var location = canonicalRedirectTarget({
        host: hostHeader ? hostHeader.value : "",
        uri: request.uri,
        querystring: request.querystring,
        method: request.method,
    });
    if (!location) return null;
    return {
        status: "301",
        statusDescription: "Moved Permanently",
        headers: {
            location: [{ key: "Location", value: location }],
            "cache-control": [{ key: "Cache-Control", value: REDIRECT_CACHE_CONTROL }],
        },
    };
}

/**
 * 既存の Lambda@Edge の handler を包む。301 を返すときは元の handler を呼ばない。
 * 元の handler が callback 形（`(event, context, callback)`）でも async 形でも動く
 */
function withCanonicalRedirect(handler) {
    return function (event, context, callback) {
        var res = lambdaEdgeRedirect(event);
        if (res) {
            if (typeof callback === "function") { callback(null, res); return undefined; }
            return Promise.resolve(res);
        }
        return handler(event, context, callback);
    };
}

// ── CloudFront Functions（viewer-request）───────────────────

/** CloudFront Functions の event から 301 の応答を返す（寄せないときは null） */
function cloudFrontFunctionRedirect(event) {
    var request = event && event.request;
    if (!request) return null;
    var location = canonicalRedirectTarget({
        host: request.headers && request.headers.host ? request.headers.host.value : "",
        uri: request.uri,
        querystring: cfFunctionQuery(request.querystring),
        method: request.method,
    });
    if (!location) return null;
    return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
            location: { value: location },
            "cache-control": { value: REDIRECT_CACHE_CONTROL },
        },
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        APEX_HOST: APEX_HOST,
        WWW_HOST: WWW_HOST,
        canonicalPath: canonicalPath,
        locationSafe: locationSafe,
        LEGACY_REDIRECTS: LEGACY_REDIRECTS,
        canonicalRedirectTarget: canonicalRedirectTarget,
        lambdaEdgeRedirect: lambdaEdgeRedirect,
        withCanonicalRedirect: withCanonicalRedirect,
        cloudFrontFunctionRedirect: cloudFrontFunctionRedirect,
        cfFunctionQuery: cfFunctionQuery,
    };
}
