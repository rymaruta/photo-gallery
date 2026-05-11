export const ROUTES = {
    HOME: "/",
    ABOUT: "/about",
    FAVORITES: "/favorites",
    HISTORY: "/history",
    ADMIN: "/admin",
    LOGIN: "/login",
    UPLOAD: "/user/upload",
    PROFILE_EDIT: "/user/profile",
    PHOTO: (id: string) => `/photo/${id}`,
} as const;
