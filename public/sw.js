// Journey Photo Service Worker
//
// 役割は2つ:
//   1. PWA Share Target の POST を受け取り、ファイルを IndexedDB に格納してから
//      /user/upload?from=share へリダイレクトする
//   2. オフラインでも「一度見たページが開く」ようにする
//
// **2 は後から足した。** それまでは GET を一切キャッシュしないどころか、
// 起動のたびに Cache Storage を全消ししていたので、ホーム画面に追加できて
// 全画面で開くのに**機内モードではブラウザのエラー画面**になっていた。
//
// 設計の方針（この順で優先する）:
//   - **戻ってきた人のサイトを壊さない。** HTML は必ずネットワーク優先。
//     キャッシュを先に返すと、古いアプリシェルを配信し続けて
//     「表示はされるが一切タップできない」に戻る（過去に踏んだ形）
//   - `_next/static/**` だけキャッシュ優先。中身がハッシュ名なので、
//     内容が変われば必ず別のURLになる＝古いものを返しようがない
//   - 判断が付かないものはキャッシュしない。想定外は素通し
//
//   - **写真は別のキャッシュに分けて、件数で追い出す。** ページや資産と
//     同じ入れ物に入れると、写真を数十枚見ただけで受け皿と JS を押し出す
//     （その事故は既に一度踏んでいる。`trimCache` の説明を見よ）

const SHARE_DB = "journey-photo-share";
const SHARE_STORE = "files";

// キャッシュ名にバージョンを持たせる。**activate で他のバージョンだけ消す**
// （全消しに戻すと、自分が入れたばかりの分まで毎回消えてオフラインが0点に戻る）。
const CACHE_VERSION = "v1";
const CACHE_NAME = `journey-photo-${CACHE_VERSION}`;

/**
 * 写真の控え。**ページ・資産とは別の入れ物にする。**
 *
 * 同じ入れ物にすると、写真を数十枚見ただけで受け皿（`offline.html`）と
 * `_next/static` を押し出す——「一度見たページが開く」という元の目的が
 * 崩れる（`trimCache` の説明にある事故と同じ形）。数え方も追い出しも別。
 *
 * **バージョンも別にする（`CACHE_VERSION` を混ぜない）。** ページの控えは
 * 刻印（`x-sw-cached-at`）の形式が変わりうるので版上げで捨ててよいが、
 * 写真は uuid のURLで中身が変わらないので、捨てる理由が無い。混ぜると
 * ページ側の都合で版を上げた瞬間に**全端末の写真の控えが消える**
 * （機内モードで「枠だけ」に逆戻り）。ここを上げるのは、控え方そのものを
 * 変えたときだけ。
 */
const IMG_CACHE_VERSION = "v1";
const IMG_CACHE_NAME = `journey-photo-img-${IMG_CACHE_VERSION}`;

/**
 * 写真の控えの上限（件数）。
 *
 * **バイト数では数えない。** `<img>` の要求は no-cors なので応答は
 * opaque で、`Response` から中身の大きさを読めない（ブラウザは容量計算に
 * 数MBの下駄を履かせる実装もある）。**数えられないものを数えたふりを
 * しない**——件数で切って、容量で断られたら半分捨ててやり直す。
 *
 * 一覧1画面がおよそ 12〜20 枚なので、80 は「直前に見た数画面ぶん」。
 * **この数字は測って決めたものではない**（この環境から実機の容量を
 * 測れない）。際限なく増やさないための歯止め。
 */
const MAX_IMAGE_ENTRIES = 80;

/**
 * オフラインの受け皿。**JavaScript を要求しないページにすること。**
 *
 * 最初は `/` の HTML を使っていたが、Next のページは必ず
 * `/_next/static` のチャンクを要求する。それらは実際に一度取得したときしか
 * キャッシュに入らないので、「検索から /photo/xxx に来てホーム画面に追加した
 * が、トップページは一度も開いていない」端末では**JS の揃わない HTML**が出る。
 * すると React が動かず `data-hydrated` が付かず、app/layout.tsx の水和
 * ウォッチドッグが12秒後に **Cache Storage を全消しして SW を解除**し、
 * オフラインのまま再読込 → ブラウザのエラー画面。オフライン機能ごと消える
 * 自壊コースだった。素の HTML なら水和もチャンクも要らない。
 */
const OFFLINE_URL = "/offline.html";

// 最初に必ず持っておくもの
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            // 1つでも失敗したら install ごと落ちる addAll は使わない
            // （オフラインで開いた瞬間に更新が入ると、その後ずっと入らない）。
            await Promise.all(PRECACHE_URLS.map((u) => cache.add(u).catch(() => undefined)));
        } catch (e2) {
            // 取れなくても起動は続ける
        }
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
    // **他のバージョンだけ消す。** 以前はここで全消ししていた——GET を
    // 一切キャッシュしない設計だったので「残存キャッシュは古いアプリシェルを
    // 配信し続ける原因にしかならない」という理由づけで、それ自体は正しかった。
    // キャッシュを持つようになった今は、消す対象を自分の旧版に限る。
    try {
        if (self.caches && caches.keys) {
            const keys = await caches.keys();
            // **写真の控えも残す。** ここから漏らすと、起動のたびに
            // 全部消えてオフラインで写真が出ない（元の全消しに逆戻り）
            const keep = [CACHE_NAME, IMG_CACHE_NAME];
            await Promise.all(keys.filter((k) => keep.indexOf(k) === -1).map((k) => caches.delete(k)));
        }
    } catch (e2) {
        // 失敗しても致命的ではない
    }
    await self.clients.claim();
})()));

function openShareDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SHARE_DB, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(SHARE_STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveSharedFiles(files, title, text) {
    const db = await openShareDb();
    const tx = db.transaction(SHARE_STORE, "readwrite");
    const store = tx.objectStore(SHARE_STORE);
    // 既存の共有データはクリア。**保険であって、これが前回分を消している
    // わけではない**——書く id は `"current"` 固定（履歴上ずっとそう）なので、
    // 下の `put` が同じキーを上書きする時点で前回分は残らない。
    // 効くのは id を変えたときだけ。変異で確かめたら**この行を外しても
    // 何も変わらなかった**ので、目的を書いておく。
    await new Promise((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve();
        clearReq.onerror = () => reject(clearReq.error);
    });
    const id = "current";
    store.put({ id, files, title: title ?? "", text: text ?? "", t: Date.now() });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 保存してよい応答か。判断が付かないものは入れない */
function isStorable(res) {
    if (!res || !res.ok || res.status !== 200) return false;
    // opaque（cross-origin の no-cors）は中身を確かめられないうえ容量も食う。
    // opaqueredirect も同じ。206（部分）は status で落ちる。
    //
    // ここを `type === "basic"` と書くと、意図（opaque を入れない）より狭い
    // うえに**ブラウザ専用の値**に依存する（Node の Response は "default"）。
    // 呼ぶ前に同一オリジンへ絞ってあるので、除外側を書く方が正確。
    return res.type !== "opaque" && res.type !== "opaqueredirect";
}

/** 中身がハッシュ名の資産。内容が変われば必ず別のURLになる */
function isImmutableAsset(url) {
    return url.pathname.startsWith("/_next/static/");
}

/**
 * ページの控えのキー。**クエリを落とす。**
 *
 * Cache API はクエリまで含めて別物として扱うので、
 * `?utm_source=` `?fbclid=` の付いた検索・SNS 流入が、同じページなのに
 * 際限なく別エントリになる。静的書き出しでは同じ HTML なので分ける意味が無い。
 */
function navKey(request) {
    const u = new URL(request.url);
    return u.origin + u.pathname;
}

/** ページの控えの上限。超えたら古い順に捨てる（Cache API のキーは挿入順） */
const MAX_PAGE_ENTRIES = 60;

/**
 * ハッシュ名の資産の上限。
 *
 * **この数字は測って決めたものではない**（この環境にビルド成果物が無い）。
 * 「際限なく増やさない」ための歯止めであって、チューニングされた値ではない。
 * 見直すときは `out/_next/static` のファイル数を数えること
 * ——収まらないと**同じ版の資産どうしで追い出し合って**キャッシュが
 * ほとんど効かなくなる。
 *
 * **要るのは「1回のデプロイ分」ではなく「2回分＋α」。** `CACHE_VERSION` は
 * 固定で、`activate` が消すのは別のキャッシュ名だけなので、デプロイを
 * またぐと**旧版と新版の資産が同じキャッシュに同居する**。
 */
const MAX_ASSET_ENTRIES = 150;

/**
 * 控えを受け皿として出してよい期限。
 *
 * Cache API は Cache-Control を見ない。デプロイ側は「HTML は no-store
 * 配信だから即削除して安全」という前提で古いキーを消しているので、
 * ここに寿命が無いと**削除した写真・非公開にした写真のページが、それを
 * 見たことのある端末に残り続ける**（消える経路が「本人がその URL を
 * 再訪してオンラインで成功する」しかない）。日をまたぐ程度で切る。
 */
const PAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAMP_HEADER = "x-sw-cached-at";

/** 保存時刻を刻んで控える。body は clone 済みのものを渡すこと */
function withStamp(res) {
    const headers = new Headers(res.headers);
    headers.set(STAMP_HEADER, String(Date.now()));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** 受け皿として出してよいほど新しいか */
function isFreshEnough(res) {
    const at = Number(res && res.headers && res.headers.get(STAMP_HEADER));
    if (!at) return false;
    const age = Date.now() - at;
    // **負の経過時間は「新しい」ではない。** 端末の時計を巻き戻すと
    // `Date.now() - at` が負になり、この控えが永久に新しいままになる
    // （実測: 1日戻すと実時間25時間後でも、30日戻すと10日後でも出た）。
    // 上のコメントが心配している「消した写真のページが端末に残り続ける」が
    // 巻き戻した日数ぶん延びる。分からないときは控えを使わない側へ倒す
    return age >= 0 && age < PAGE_MAX_AGE_MS;
}

/**
 * 上限を超えたぶんを古い順に捨てる。**種類ごとに分けて数える。**
 *
 * 以前は `cache.keys()` の全件を `MAX_PAGE_ENTRIES` と比べていた。
 * この控えには**ページ・ハッシュ名の資産・受け皿（offline.html と
 * manifest）が同居している**ので、ページを60件見るより先に上限へ達し、
 * 古い順＝**受け皿と資産から消えていた**:
 *   - `_next/static/**` が消える ＝ オフラインで開いても JS の揃わない
 *     HTML になる。「一度見たページが開く」という目的そのものが崩れる
 *     （中身は静的書き出しなので出るが、操作は効かない）
 *   - `manifest.webmanifest` は**二度と入り直さない**（precache は
 *     install でしか走らず、install は sw.js のバイトが変わるまで
 *     再実行されない）。`offline.html` は下で入れ直しているので戻る
 * コメントは「ページの控えの上限」と書いてあり、実装はそうなっていなかった。
 */
function isPrecacheEntry(url) {
    return PRECACHE_URLS.indexOf(url.pathname) !== -1;
}

async function trimCache(cache) {
    try {
        const keys = await cache.keys();
        const pages = [];
        const assets = [];
        for (const k of keys) {
            const url = new URL(k.url);   // cache.keys() は Request を返す
            // 受け皿は追い出さない。ここが無いと、上の説明のとおり
            // manifest が二度と戻らない
            if (isPrecacheEntry(url)) continue;
            if (isImmutableAsset(url)) assets.push(k);
            else pages.push(k);
        }
        for (const [list, max] of [[pages, MAX_PAGE_ENTRIES], [assets, MAX_ASSET_ENTRIES]]) {
            const extra = list.length - max;
            for (let i = 0; i < extra; i++) await cache.delete(list[i]);
        }
    } catch (e) {
        // 捨てられなくても致命的ではない
    }
}

/**
 * ページ（ナビゲーション）は**必ずネットワーク優先**。
 * キャッシュを先に返すと古いアプリシェルを配信し続け、
 * 「表示はされるが一切タップできない」に戻る。
 * 落ちたときだけ、同じURLの控え → トップページ の順に出す。
 */
async function handleNavigate(request) {
    try {
        const res = await fetch(request);
        if (isStorable(res)) {
            const stamped = withStamp(res.clone());
            caches.open(CACHE_NAME).then(async (c) => {
                await c.put(navKey(request), stamped);
                await trimCache(c);
                // precache を取り逃していたら、ここで埋める。install は
                // sw.js のバイトが変わるまで再実行されないので、
                // 一度失敗すると受け皿がゼロのままになる。
                if (!(await c.match(OFFLINE_URL))) await c.add(OFFLINE_URL).catch(() => undefined);
            }).catch(() => undefined);
        }
        return res;
    } catch (e) {
        const cached = await caches.match(navKey(request), { cacheName: CACHE_NAME });
        // 古すぎる控えは出さない（消したはずのページを出さないため）
        if (cached && isFreshEnough(cached)) return cached;
        const shell = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
        if (shell) return shell;
        throw e;
    }
}

/**
 * ハッシュ名の資産だけキャッシュ優先（古いものを返しようがない）。
 *
 * 読み出しが投げたら素通しに倒す。ここが投げると `_next/static` が
 * 返らず、**サイトごと止まる**（「表示はされるが一切タップできない」）。
 */
async function handleImmutable(request) {
    try {
        const cached = await caches.match(request);
        if (cached) return cached;
    } catch {
        // 控えを読めない端末では、ただの素通しとして扱う
    }
    const res = await fetch(request);
    if (isStorable(res)) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(async (c) => {
            await c.put(request, copy);
            // **ここでも上限を見る。** ページを開かずに資産だけ増える経路
            // （プリフェッチ）があるので、ナビゲーション側だけでは効かない
            await trimCache(c);
        }).catch(() => undefined);
    }
    return res;
}

/**
 * 写真として控えてよい要求か。
 *
 * **ホスト名では判定しない。** この SW は `public/` に置く素のファイルで、
 * ビルド時に環境変数（`NEXT_PUBLIC_CLOUDFRONT_URL`）を埋め込めない。
 * 代わりに「画像として要求されていて、うちが組み立てるパスの形」で見る
 * ——`uploads/<sub>/…`（写真の実体・サムネ）は
 * `lib/utils/uploadPolicy.ts` が組み立てる形で、**キーが uuid**。
 *
 * **アバター・カバー（`profiles/<sub>`）は入れない。** あちらは
 * uuid ではなく**固定キーで中身だけ差し替わる**（`api-user/src/profile.ts`
 * が `CacheControl: "no-store"` を付け、アップロード側も PUT に同じものを
 * 付けている＝アプリが2か所で「キャッシュさせない」と明示している）。
 * 表示側に `?v=` は無いので、ここで控えるとアイコンを変えても
 * **差し替えが一生届かない**（Cache API は Cache-Control を見ない）。
 * カバーまで機内モードで出したいなら、先に表示側へ更新時刻を通すこと。
 *
 * これで曲のアートワーク（`is1-ssl.mzstatic.com/image/…`）や計測の画像も
 * 入らない。**手を出す先を最小にする**（触らなければ壊せない）。
 */
function isPhotoRequest(request, url) {
    if (request.destination !== "image") return false;
    // 素のHTTPは扱わない（本番は CloudFront の https だけ）
    if (url.protocol !== "https:") return false;
    return url.pathname.startsWith("/uploads/");
}

/**
 * 写真として控えてよい応答か。
 *
 * **`isStorable` と違って opaque を通す。** あちらは同一オリジンの
 * ページ・資産用で、中身を確かめられないものを入れない方針。
 *
 * **「写真は必ず opaque」ではない。** 写真の URL は2種類あり、実データ
 * （`app/data/photos.json` の30枚）では **19枚が `journey-photo.com`
 * ＝同一オリジン**・11枚が CloudFront の既定ドメイン＝別オリジンだった
 * （`normalize-image-urls` を流すと前者に寄る）。同一オリジンなら応答は
 * 読めるので、**読める回は中身の種別まで見る**。
 *
 * なぜ種別を見るか——キャプティブポータル（ホテル・空港の Wi-Fi）は
 * 画像の要求にも **200 で自分のログインページ（HTML）を返す**。
 * `ok && status === 200` だけだと、その HTML が「写真」として控えられ、
 * ここはキャッシュ優先なので**以後ずっと割れた画像**になる。寿命も
 * 検証も無いので、再読込では直らない（資産には水和ウォッチドッグという
 * 回復路があるが、写真には無い）。
 *
 * 読める回で種別が分からない（ヘッダが無い）ときは控えない側へ倒す。
 *
 * **opaque は従来どおり通す**——中身も種別も確かめようが無いので、
 * ここで弾くと別オリジンの写真を1枚も控えられなくなる。代償は前から
 * 書いてあるとおり「**404 の応答も控えうる**」こと（opaque は
 * `status === 0` なので下の `ok` の枝に来ない）。うちの画像URLは uuid で
 * 内容が固定なので中身が古くなることは無く、404 になるのは消された写真
 * ——その写真は一覧から消えるので、控えを引きに来る画面がもう無い。
 * **毒を食った場合の出口は画面側**（`lib/utils/photoCache.ts`。読み込みに
 * 失敗したら、その URL の控えを捨てる）。
 *
 * S3 に置く写真は全部 `image/*`（presign は許可リストの種別を署名に
 * 入れ、サムネ生成は `image/webp`・`image/avif`）なので、正当な写真が
 * この判定で落ちることは無い。
 */
function isStorablePhoto(res) {
    if (!res) return false;
    // リダイレクトの中身は分からない（追った先が何かも分からない）
    if (res.type === "opaqueredirect") return false;
    if (res.type === "opaque") return true;
    if (!res.ok || res.status !== 200) return false;
    const ct = (res.headers && res.headers.get("content-type")) || "";
    return ct.toLowerCase().indexOf("image/") === 0;
}

/** 写真の控えを古い順に捨てる（Cache API のキーは挿入順） */
async function trimImages(cache, max) {
    try {
        const keys = await cache.keys();
        const extra = keys.length - max;
        for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
    } catch {
        // 捨てられなくても致命的ではない
    }
}

/**
 * 写真はキャッシュ優先。**中身が uuid のURLなので古いものを返しようがない**
 * （`_next/static` と同じ理由）。
 *
 * 控えるのは**応答を返したあと**。`await` してから返すと、機内モードの
 * 準備のために毎回の表示を遅らせることになる。
 *
 * **Cache Storage が投げても素通しに倒す。** ここが投げると
 * `respondWith` に渡した Promise ごと落ちて、ネットワークが生きていても
 * 写真が1枚も出ない（`fetch` にすら行かない）。
 */
async function handlePhoto(request) {
    try {
        const cached = await caches.match(request, { cacheName: IMG_CACHE_NAME });
        if (cached) return cached;
    } catch {
        // 控えを読めない端末では、ただの素通しとして扱う
    }
    const res = await fetch(request);
    if (isStorablePhoto(res)) {
        const copy = res.clone();
        // **やり直す用の写しを、1回目の put の前に取っておく。**
        // `Cache.put` は中身を読み切るので、失敗したあとの `copy` は
        // 使用済み（disturbed）で、同じものをもう一度 put すると
        // 必ず TypeError になる。取り直せないものは取り直せない。
        let spare = null;
        try { spare = copy.clone(); } catch { spare = null; }
        caches.open(IMG_CACHE_NAME).then(async (c) => {
            try {
                await c.put(request, copy);
            } catch {
                // **容量で断られたら半分捨ててやり直す。** opaque は
                // ブラウザが数MBの下駄を履かせることがあり、件数の上限だけ
                // では足りない端末がある。諦めても次の1枚からは入る
                // （直後の trimImages が空きを作る）が、いま見ている写真を
                // 落とす理由も無い。
                await trimImages(c, Math.floor(MAX_IMAGE_ENTRIES / 2));
                if (spare) { try { await c.put(request, spare); } catch { /* 諦める */ } }
            }
            await trimImages(c, MAX_IMAGE_ENTRIES);
        }).catch(() => undefined);
    }
    return res;
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Share Target: POST /user/upload を受け取る
    if (event.request.method === "POST" && url.pathname === "/user/upload") {
        event.respondWith((async () => {
            try {
                const formData = await event.request.formData();
                const files = formData.getAll("photos").filter((f) => f instanceof File);
                const title = formData.get("title");
                const text = formData.get("text");
                await saveSharedFiles(files, title, text);
            } catch (e) {
                // 失敗してもアップロードページには遷移させる
                console.error("[sw] share target error:", e);
            }
            return Response.redirect("/user/upload?from=share", 303);
        })());
        return;
    }

    // ここから下は GET・同一オリジンだけ。**それ以外は素通し**
    // （API・画像CDN・計測などに手を出さない。触らなければ壊せない）。
    if (event.request.method !== "GET") return;
    // **写真だけは別オリジン（画像CDN）でも扱う。** ここより下は同一
    // オリジン限定なので、この分岐を後ろに置くと一生届かない
    if (isPhotoRequest(event.request, url)) {
        event.respondWith(handlePhoto(event.request));
        return;
    }
    if (url.origin !== self.location.origin) return;
    // ※ `/sw.js` の除外は置かない。**死にコードだから。**
    //   ブラウザが SW スクリプトを取りに行く要求は fetch イベントに来ないし、
    //   ページから明示的に `fetch("/sw.js")` しても navigate でも
    //   `_next/static` でもないので、どのみち素通しになる。
    //   「守っているつもりの1行」を残さない。

    if (event.request.mode === "navigate") {
        event.respondWith(handleNavigate(event.request));
        return;
    }
    if (isImmutableAsset(url)) {
        event.respondWith(handleImmutable(event.request));
    }
});
