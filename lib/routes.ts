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
    PHOTO: (id: string) => `/photo/${id}`,
    USER_PROFILE: (id: string) => `/users?id=${encodeURIComponent(id)}`,
} as const;
