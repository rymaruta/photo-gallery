export const ROUTES = {
    HOME: "/",
    ABOUT: "/about",
    FAVORITES: "/favorites",
    HISTORY: "/history",
    ADMIN: "/admin",
    LOGIN: "/login",
    SIGNUP: "/signup",
    SIGNUP_CONFIRM: "/signup/confirm",
    UPLOAD: "/user/upload",
    PHOTO: (id: string) => `/photo/${id}`,
    USER_PROFILE: (username: string) => `/users?u=${encodeURIComponent(username)}`,
    USER_EDIT: "/users/me/edit",
} as const;
