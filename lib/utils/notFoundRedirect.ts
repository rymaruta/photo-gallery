// 404 ページからの自動リダイレクト先を決める純関数。
// 静的エクスポートではビルド後に増えた写真/ユーザーの個別ページが存在しないため、
// クエリパラメータ版のURLに振り替えて表示を救済する。
export function resolveNotFoundRedirect(pathname: string): string | null {
    const photoMatch = pathname.match(/^\/photo\/([^/]+?)(?:\.html)?\/?$/);
    if (photoMatch && photoMatch[1]) {
        return `/?photo=${encodeURIComponent(photoMatch[1])}`;
    }
    const userMatch = pathname.match(/^\/users\/([^/]+?)(?:\.html)?\/?$/);
    if (userMatch && userMatch[1]) {
        return `/users?id=${encodeURIComponent(userMatch[1])}`;
    }
    return null;
}
