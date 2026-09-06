import PHOTOS_JSON from "@/app/data/photos.json";

// ビルド時に静的生成された写真詳細ページの ID 一覧。
// 静的エクスポート（output: "export"）では /photo/[id] のページは
// ビルド時点の photos.json に存在する写真しか生成されない。
// ビルド後にアップロードされた写真の /photo/<id> は S3 に存在せず 404 になるため、
// その場合はトップページのモーダル表示（/?photo=<id>）へフォールバックする。
// 翌日の定期再ビルドで静的ページが生成されると、自動的に /photo/<id> に切り替わる。
const BUILT_PHOTO_IDS = new Set(
    (PHOTOS_JSON as Array<{ id: string }>).map((p) => p.id),
);

// ビルド時に投稿があるユーザーは /users/<id> が静的生成されている
// （ユーザー個別の OGP カード付き）。それ以外はクエリ版にフォールバック。
const BUILT_USER_IDS = new Set(
    (PHOTOS_JSON as Array<{ userId?: string; published?: boolean }>)
        .filter((p) => p.userId && p.published !== false)
        .map((p) => p.userId as string),
);

export const ROUTES = {
    HOME: "/",
    FAVORITES: "/favorites",
    MAP: "/map",
    PRIVACY: "/privacy",
    ADMIN: "/admin",
    LOGIN: "/login",
    SIGNUP: "/signup",
    UPLOAD: "/user/upload",
    DRAFTS: "/user/drafts",
    EDIT: (id: string) => `/user/edit?id=${encodeURIComponent(id)}`,
    PROFILE_EDIT: "/user/profile",
    USER_SEARCH: "/users/search",
    PHOTO: (id: string) =>
        BUILT_PHOTO_IDS.has(id)
            ? `/photo/${id}`
            : `/?photo=${encodeURIComponent(id)}`,
    USER_PROFILE: (id: string) =>
        BUILT_USER_IDS.has(id)
            ? `/users/${encodeURIComponent(id)}`
            : `/users?id=${encodeURIComponent(id)}`,
} as const;

/** 同一オリジン判定のためだけの土台。実在しない TLD を使う（誤って外へ出さない） */
const SAME_ORIGIN_SENTINEL = "https://same-origin.invalid";

/**
 * ログイン後の戻り先として受け取ってよいパスか。
 *
 * **サイト内の絶対パスだけを通す。** ここを緩めるとオープンリダイレクト
 * （`/login?next=https://evil.example` で外部へ飛ばす踏み台）になる。
 *  - `/` 始まりでないもの（`https://…`・`javascript:` など）を弾く
 *  - `//host` はスキーム相対で外部へ出るので弾く
 *  - `/\` はブラウザによっては `//` と同じに解釈されるので弾く
 * 通らなければ null を返し、呼び出し側が既定の行き先に落とす。
 */
export function safeNextPath(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw) return null;
    // 相対パス（"photo/abc"）や別スキーム（"javascript:"）を先に落とす
    if (!raw.startsWith("/")) return null;
    // **前方一致で "//" を弾くだけでは足りなかった。** URL のパーサは
    // タブ・改行・CR を**解釈の前に取り除く**ので、`/<TAB>/evil.com` は
    // `//evil.com` と同じ意味になる。前方一致は素通りするので、
    //   https://journey-photo.com/login?next=%2F%09%2Fevil.com
    // を踏ませるだけで外部へ飛ばせた（ログイン済みなら無操作で発火する）。
    // 列挙をやめて**パーサに判定させる**。制御文字もバックスラッシュも、
    // 将来の解釈差も、これで一括で塞がる。
    let u: URL;
    try {
        u = new URL(raw, SAME_ORIGIN_SENTINEL);
    } catch {
        return null;
    }
    if (u.origin !== SAME_ORIGIN_SENTINEL) return null;
    // 解釈しなおした形を返す（紛れ込んだ制御文字はここで落ちる）
    return u.pathname + u.search + u.hash;
}

/** ログイン画面へ。戻り先を添える（省略時は既定＝自分のプロフィール） */
export function loginWithNext(next?: string | null): string {
    const safe = safeNextPath(next);
    return safe ? `${ROUTES.LOGIN}?next=${encodeURIComponent(safe)}` : ROUTES.LOGIN;
}
