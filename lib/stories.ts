// インスタ風ストーリーのフロントエンド用ヘルパー

export type Story = {
    id: string;
    src: string;
    userId: string;
    displayName?: string;
    mediaType?: "image" | "video";
    caption?: string;
    /** ストーリーBGM（30秒プレビュー）。付いていると視聴中に再生できる */
    song?: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string };
    createdAt: string;
    expiresAt: string;
};

export type StoryViewer = {
    userId: string;
    displayName?: string;
    at?: string;
};

export type StoryGroup = {
    userId: string;
    displayName: string;
    items: Story[];
};

// API のレスポンスからユーザーごとのストーリーグループを作る。
// - 期限切れ・不正なレコードは除外
// - 各グループ内は投稿順（古い→新しい）
// - グループの並び: 自分が先頭、それ以外は最新投稿が新しい順
export function groupStories(stories: Story[], ownUserId?: string | null, now: number = Date.now()): StoryGroup[] {
    const valid = stories.filter((s) =>
        s && typeof s.src === "string" && s.src &&
        typeof s.userId === "string" && s.userId &&
        typeof s.expiresAt === "string" && Date.parse(s.expiresAt) > now,
    );

    const byUser = new Map<string, Story[]>();
    for (const s of valid) {
        const list = byUser.get(s.userId) ?? [];
        list.push(s);
        byUser.set(s.userId, list);
    }

    const groups: StoryGroup[] = [];
    for (const [userId, items] of byUser) {
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        groups.push({
            userId,
            displayName: items.find((i) => i.displayName)?.displayName ?? "ユーザー",
            items,
        });
    }

    groups.sort((a, b) => {
        if (ownUserId) {
            if (a.userId === ownUserId && b.userId !== ownUserId) return -1;
            if (b.userId === ownUserId && a.userId !== ownUserId) return 1;
        }
        const aLatest = a.items[a.items.length - 1]?.createdAt ?? "";
        const bLatest = b.items[b.items.length - 1]?.createdAt ?? "";
        return bLatest.localeCompare(aLatest);
    });

    return groups;
}

// 「3時間前」形式の経過時間表示
export function timeAgo(iso: string, locale: "ja" | "en", now: number = Date.now()): string {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const diffMin = Math.max(0, Math.floor((now - t) / 60000));
    if (diffMin < 1) return locale === "en" ? "now" : "たった今";
    if (diffMin < 60) return locale === "en" ? `${diffMin}m` : `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return locale === "en" ? `${diffHour}h` : `${diffHour}時間前`;
    const diffDay = Math.floor(diffHour / 24);
    return locale === "en" ? `${diffDay}d` : `${diffDay}日前`;
}

// 既読管理（localStorage）。期限切れ分は掃除する。
const SEEN_KEY = "jp_seen_stories";

export function loadSeenStoryIds(): Set<string> {
    try {
        const raw = localStorage.getItem(SEEN_KEY);
        if (!raw) return new Set();
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return new Set();
        const now = Date.now();
        const entries = Object.entries(parsed as Record<string, number>)
            .filter(([, t]) => typeof t === "number" && now - t < 25 * 60 * 60 * 1000);
        return new Set(entries.map(([id]) => id));
    } catch {
        return new Set();
    }
}

export function markStorySeen(id: string): void {
    try {
        const raw = localStorage.getItem(SEEN_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
        const now = Date.now();
        // 25時間より古い既読記録は掃除（ストーリー自体が24時間で消えるため）
        for (const [k, t] of Object.entries(parsed)) {
            if (typeof t !== "number" || now - t > 25 * 60 * 60 * 1000) delete parsed[k];
        }
        parsed[id] = now;
        localStorage.setItem(SEEN_KEY, JSON.stringify(parsed));
    } catch {
        /* ignore */
    }
}

export function hasUnseen(group: StoryGroup, seen: Set<string>): boolean {
    return group.items.some((s) => !seen.has(s.id));
}
