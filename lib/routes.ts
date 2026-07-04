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

export const ROUTES = {
    HOME: "/",
    ABOUT: "/about",
    FAVORITES: "/favorites",
    HISTORY: "/history",
    ADMIN: "/admin",
    LOGIN: "/login",
    SIGNUP: "/signup",
    UPLOAD: "/user/upload",
    PROFILE_EDIT: "/user/profile",
    MAP: "/map",
    PHOTO: (id: string) =>
        BUILT_PHOTO_IDS.has(id)
            ? `/photo/${id}`
            : `/?photo=${encodeURIComponent(id)}`,
    USER_PROFILE: (id: string) => `/users?id=${encodeURIComponent(id)}`,
} as const;
