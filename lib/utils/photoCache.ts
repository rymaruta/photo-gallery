/**
 * 写真の控え（Service Worker が持つ `journey-photo-img-v1`）を、画面側から
 * 1件だけ捨てる。
 *
 * ## なぜ要るか
 *
 * `public/sw.js` の写真はキャッシュ優先で、**寿命も再検証も無い**
 * （中身が uuid のURLなので、古いものが返るという心配が無いため）。
 * 問題は「写真ではないもの」を控えてしまった場合で、代表例が
 * キャプティブポータル（ホテル・空港の Wi-Fi）が画像の要求に返す
 * ログインページ。別オリジンの写真は応答が **opaque＝中身も種別も
 * 読めない**ので、SW 側では弾きようが無い（同一オリジンの回は
 * `isStorablePhoto` が種別で弾く）。
 *
 * 一度そうなると、キャッシュ優先なので**再読込しても直らない**
 * ——新しい写真を80枚見て押し出すか、サイトデータを消すまで割れたまま。
 * `_next/static` には水和ウォッチドッグ（`app/layout.tsx`）という回復路が
 * あるが、写真には無かった。
 *
 * ## 判断
 *
 * 画面が「この画像は読み込めなかった」と分かった時点が、控えが毒を
 * 食っているかどうかを知れる唯一の瞬間。**復号できない控えは、
 * 機内モードでも役に立たない**ので、捨てて損は無い。
 * サーバー側でもう消えた写真（404）なら、そもそも控えを持っていて
 * 意味が無い。通信が落ちているだけで控えが健全なら、そもそも
 * 読み込みは成功するのでここへは来ない。
 *
 * Cache Storage はページからも同じオリジンで開けるので、SW への
 * メッセージ経路は足さない（触る面を増やさない）。
 *
 * ## 一度で捨て切れない場合がある（承知のうえ・未実測）
 *
 * `handlePhoto` は控えを `await` せずに応答を返すので、**毒を最初に食う
 * その瞬間**は「ここの `delete` が先に着いて空振り → 直後に `put` が入る」が
 * ありうる。次の表示はキャッシュヒットして同じように失敗するので、そこで
 * 捨てられる＝1表示ぶん遅れるだけ。**`put` を待つ形にはしない**——
 * 毎回の表示を遅らせることになり、`handlePhoto` のコメントが名指しで
 * 避けている形だから。
 */

/**
 * 写真の入れ物の名前。**`public/sw.js` の `IMG_CACHE_NAME` と同じ値**。
 * ずれると黙って何も捨てなくなるので、
 * `lib/utils/__tests__/photoCache.test.ts` が実物と突き合わせる。
 */
export const PHOTO_CACHE_NAME = "journey-photo-img-v1";

/**
 * 読み込みに失敗した画像の控えを捨てる。
 *
 * @param url 実際に取りに行った URL（`<picture>` があるので、呼び出し側は
 *            `currentSrc` を優先して渡すこと。控えのキーは URL 完全一致）
 */
export async function dropCachedPhoto(url: string | null | undefined): Promise<void> {
    if (!url) return;
    try {
        // `caches` はプライベートモードや古い端末では無い。無ければ何もしない
        if (typeof caches === "undefined" || !caches?.open) return;
        const cache = await caches.open(PHOTO_CACHE_NAME);
        // `ignoreVary` は保険。控えた応答が `Vary` を持つと、ヘッダの
        // 揃わない要求（ここで組み立てる素の Request）では一致しない。
        // 本丸の opaque はヘッダ一覧が空なので影響しないが、同一オリジン側で
        // CloudFront が `Vary` を返すかは**実測していない**。キーは URL の
        // 完全一致のままなので、付けて困ることは無い
        await cache.delete(url, { ignoreVary: true });
    } catch {
        // 捨てられなくても致命的ではない（次の手段はサイトデータの削除）
    }
}
