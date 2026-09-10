// インスタ風ストーリーのフロントエンド用ヘルパー

export type Story = {
    id: string;
    src: string;
    userId: string;
    displayName?: string;
    mediaType?: "image" | "video";
    caption?: string;
    /** ストーリーBGM（30秒プレビュー）。付いていると視聴中に再生できる */
    /** startSec = 30秒プレビュー内の再生開始位置（投稿者が「好きな部分」を指定できる） */
    song?: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string; startSec?: number };
    /** 画像ストーリーの表示秒数（投稿者が指定）。未指定なら既定の5秒 */
    durationSec?: number;
    /**
     * 届いた返信の数。**投稿者にしか入っていない**
     * （`getStories` が所有者以外から落とす）。見た人に「このストーリーに
     * 何件届いたか」を知らせないため——誰が反応したかは閲覧者と同じく
     * 本人だけのもの。
     */
    replyCount?: number;
    /**
     * ギャラリーに残したときの写真ID（`POST /stories/{id}/keep`）。
     * 立っていると、期限切れでも**S3 の実体は消えない**（持ち主が写真に
     * 移っている）。画面はこれで「残した」を出し分ける。
     */
    keptAs?: string;
    createdAt: string;
    expiresAt: string;
};

/**
 * ストーリーへのクイックリアクション。**サーバーの一覧と対**
 * （`api-user/src/storyReplies.ts` の `REACTIONS`）。ずれると、画面に出ている
 * 絵文字を押しても本文として保存される——`scripts/__tests__/storyReactionsParity.test.ts`
 * が突き合わせる。
 */
export const STORY_REACTIONS = ["❤️", "😍", "😂", "😮", "😢", "👏"] as const;

/** 届いた返信（投稿者だけが読める） */
export type StoryReply = {
    id: string;
    uid: string;
    name: string;
    emoji?: string;
    text?: string;
    t: string;
    /** 返信した人が退会している（サーバーが名前を伏せたときに立つ） */
    deleted?: boolean;
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
// - 形が壊れたレコードは除外
// - 各グループ内は投稿順（古い→新しい）
// - グループの並び: 自分が先頭、それ以外は最新投稿が新しい順
//
// **期限は端末の時計で判定しない。** サーバーが自分の時計で
// `expiresAt > :now` を絞ってから返す（`api-user/src/stories.ts` の
// GSI・Scan の両経路）。ここで重ねて判定すると、**端末の時計が進んでいる人
// だけストーリーが消える**——実測: サーバーが生きていると返した3件が、
// 端末 +1.5h で2件、+12h で1件、+23.5h で0件になった。しかも
// `StoriesBar` は取得に成功しているので**エラーも出ず**、「誰も投稿して
// いない」と同じ絵になる（自分で投稿した直後にも起きる）。
// 時計は端末ごとにずれるが、サーバーの時計は1つ。**サーバーを信じる。**
export function groupStories(stories: Story[], ownUserId?: string | null): StoryGroup[] {
    const valid = stories.filter((s) =>
        s && typeof s.src === "string" && s.src &&
        typeof s.userId === "string" && s.userId &&
        // **`createdAt` もここで見る。** 下の並べ替えが
        // `a.createdAt.localeCompare(...)` を無防備に呼ぶので、1件でも
        // 欠けていると**全員ぶんのストーリーが消える**（バーが
        // 「読み込めませんでした」だけになる）。サーバー側の同じ並べ替え
        // （`api-user/src/stories.ts`）は `String(a.createdAt ?? "")` で
        // 守っており、クライアントだけ素のままだった（対の乖離）
        typeof s.createdAt === "string" && s.createdAt &&
        // 形だけ見る（読めない `expiresAt` は壊れたレコード）。
        // 大小の比較はしない——上の但し書きを参照
        typeof s.expiresAt === "string" && Number.isFinite(Date.parse(s.expiresAt)),
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
/** 既読記録の置き場（別タブの変更を拾う側が参照する） */
export const SEEN_STORAGE_KEY = SEEN_KEY;

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

/**
 * 既読記録を全部消す。ログアウト・退会で呼ぶ（キーがユーザーで
 * 分かれていないため、次にログインした別の人に前の人の既読リングが
 * 付いて見え、未読の見逃しを生む）。
 */
export function clearSeenStories(): void {
    try {
        localStorage.removeItem(SEEN_KEY);
    } catch { /* ignore */ }
}

export function hasUnseen(group: StoryGroup, seen: Set<string>): boolean {
    return group.items.some((s) => !seen.has(s.id));
}
