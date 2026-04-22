export const ROUTES = {
    HOME: "/",
    ABOUT: "/about",
    FAVORITES: "/favorites",
    HISTORY: "/history",
    ADMIN: "/admin",
    LOGIN: "/login",
    UPLOAD: "/upload",
    PHOTO: (id: string) => `/photo/${id}`,
} as const;
