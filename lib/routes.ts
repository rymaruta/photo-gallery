export const ROUTES = {
    HOME: "/",
    ABOUT: "/about",
    FAVORITES: "/favorites",
    HISTORY: "/history",
    ADMIN: "/admin",
    LOGIN: "/login",
    UPLOAD: "/user/upload",
    PHOTO: (id: string) => `/photo/${id}`,
} as const;
