// 404 ページからの自動リダイレクト先を決める純関数。
// 静的エクスポートではビルド後に増えた写真/ユーザーの個別ページが存在しないため、
// クエリパラメータ版のURLに振り替えて表示を救済する。
//
// 集約ページ（/tag /location /category /camera）も同じ問題を持つ。写真を編集して
// 新しいタグや撮影地を付けると、その写真のページにはリンクが出るのに、
// 次のビルド（最大6時間後）までリンク先が存在せずハード404になる。
// トップは ?tags= / ?category= / ?q= で絞り込めるので、そこへ振り替える
// （lib/hooks/useGallery.ts の readFiltersFromUrl が読む）。
export function resolveNotFoundRedirect(pathname: string): string | null {
    const photoMatch = pathname.match(/^\/photo\/([^/]+?)(?:\.html)?\/?$/);
    if (photoMatch && photoMatch[1]) {
        return `/?photo=${encodeURIComponent(photoMatch[1])}`;
    }
    const userMatch = pathname.match(/^\/users\/([^/]+?)(?:\.html)?\/?$/);
    if (userMatch && userMatch[1]) {
        return `/users?id=${encodeURIComponent(userMatch[1])}`;
    }

    const tagMatch = pathname.match(/^\/tag\/([^/]+?)(?:\.html)?\/?$/);
    if (tagMatch && tagMatch[1]) {
        return `/?tags=${encodeURIComponent(decodeSlug(tagMatch[1]))}`;
    }
    // 機材ページも同じ振り替え。**`/?q=` に落とすので、検索の haystack に
    // カメラ名が入っていることが対になる**（`lib/hooks/useGallery.ts`）。
    // 無いと振り替えた先が必ず0件になる（撮影地で一度踏んだ形）。
    const cameraMatch = pathname.match(/^\/camera\/([^/]+?)(?:\.html)?\/?$/);
    if (cameraMatch && cameraMatch[1]) {
        return `/?q=${encodeURIComponent(decodeSlug(cameraMatch[1]))}`;
    }
    const categoryMatch = pathname.match(/^\/category\/([^/]+?)(?:\.html)?\/?$/);
    if (categoryMatch && categoryMatch[1]) {
        return `/?category=${encodeURIComponent(decodeSlug(categoryMatch[1]))}`;
    }
    // 撮影地は専用のフィルタが無いのでフリーワード検索に載せる
    // （useGallery の query は location も対象にしている）
    const locationMatch = pathname.match(/^\/location\/([^/]+?)(?:\.html)?\/?$/);
    if (locationMatch && locationMatch[1]) {
        return `/?q=${encodeURIComponent(decodeSlug(locationMatch[1]))}`;
    }
    return null;
}

/** パス片は percent-encoded で来る。フィルタ値は生の文字列なので戻す。 */
function decodeSlug(slug: string): string {
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}
