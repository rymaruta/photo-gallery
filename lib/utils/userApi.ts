import { authenticatedFetch, publicFetch } from "./api";

export type UserProfile = {
    userId: string;
    username: string;
    displayName: string;
    bio?: string;
    avatarKey?: string;
    role?: "admin" | "user";
    createdAt: string;
    updatedAt: string;
};

export type CreateUserPayload = {
    username: string;
    displayName: string;
    bio?: string;
};

export type UpdateUserPayload = {
    displayName?: string;
    bio?: string;
    avatarKey?: string;
};

export async function createUser(payload: CreateUserPayload): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
        const res = await authenticatedFetch("/users", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const data = await res.json() as { user?: UserProfile; error?: string };
        if (!res.ok) return { success: false, error: data.error ?? "登録に失敗しました" };
        return { success: true, user: data.user };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "エラーが発生しました" };
    }
}

export async function getMe(): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
        const res = await authenticatedFetch("/users/me");
        if (res.status === 404) return { success: false, error: "NOT_FOUND" };
        const data = await res.json() as { user?: UserProfile; error?: string };
        if (!res.ok) return { success: false, error: data.error ?? "取得に失敗しました" };
        return { success: true, user: data.user };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "エラーが発生しました" };
    }
}

export async function updateMe(payload: UpdateUserPayload): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
        const res = await authenticatedFetch("/users/me", {
            method: "PUT",
            body: JSON.stringify(payload),
        });
        const data = await res.json() as { user?: UserProfile; error?: string };
        if (!res.ok) return { success: false, error: data.error ?? "更新に失敗しました" };
        return { success: true, user: data.user };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "エラーが発生しました" };
    }
}

export async function getUserPublic(username: string): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
        const res = await publicFetch(`/users/${encodeURIComponent(username)}`);
        if (res.status === 404) return { success: false, error: "NOT_FOUND" };
        const data = await res.json() as { user?: UserProfile; error?: string };
        if (!res.ok) return { success: false, error: data.error ?? "取得に失敗しました" };
        return { success: true, user: data.user };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "エラーが発生しました" };
    }
}
