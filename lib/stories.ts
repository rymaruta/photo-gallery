// インスタ風ストーリーのフロントエンド用ヘルパー

import type { StoryText, StoryVoteState } from "./utils/storyText";

/**
 * ストーリーの公開範囲。**サーバーの一覧と対**
 * （`api-user/src/storyVisibility.ts` の `STORY_PUBLIC` /
 * `STORY_FOLLOWERS_ONLY`）。ずれると、画面で「フォロワーのみ」を選んでも
 * サーバーが知らない値として扱う——`storyVisibility` は知らない値を
 * **狭い側**に倒すので全員には出ないが、「全員に公開」を選んだつもりが
 * フォロワー限定になる。`scripts/__tests__/storyVisibilityParity.test.ts`
 * が値そのものを突き合わせる（`STORY_REACTIONS` と同じ手）。
 *
 * **「親しい友達」はまだ無い。** 人を選ぶ一覧の新設が要るので、
 * ここに値を足すのはそれを作るときに一緒に。
 */
export const STORY_VISIBILITIES = ["public", "followers"] as const;
export type StoryVisibility = (typeof STORY_VISIBILITIES)[number];

export type Story = {
    id: string;
    src: string;
    userId: string;
    displayName?: string;
    mediaType?: "image" | "video";
    caption?: string;
    /**
     * 撮影地。**残したときにそのまま写真の撮影地になる**（`storyKeep.ts`）
     * ＝地図と `/location/<スラッグ>` に載る。ここが空だと、残しても本人が
     * 編集画面で打つまで何にも繋がらない。
     */
    location?: string;
    /** ストーリーBGM（30秒プレビュー）。付いていると視聴中に再生できる */
    /** startSec = 30秒プレビュー内の再生開始位置（投稿者が「好きな部分」を指定できる） */
    song?: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string; startSec?: number };
    /** 画像ストーリーの表示秒数（投稿者が指定）。未指定なら既定の5秒 */
    durationSec?: number;
    /**
     * 写真の上に置いた文字（何枚でも・それぞれ位置と見せ方を持つ）。
     * **並びが重なり順**——後ろほど手前。
     *
     * `caption` は**これを繋いだもの**をサーバーが書く（文言を2か所で
     * 持たない）。無ければ従来どおり `caption` を下の帯に出す。
     */
    texts?: StoryText[];
    /**
     * 届いた返信の数。**投稿者にしか入っていない**
     * （`getStories` が所有者以外から落とす）。見た人に「このストーリーに
     * 何件届いたか」を知らせないため——誰が反応したかは閲覧者と同じく
     * 本人だけのもの。
     */
    replyCount?: number;
    /**
     * 投票スタンプの票の状態。**投票スタンプを持つ行にだけ**サーバーが付ける。
     * `counts` は投稿者と票を入れた人にだけ入る（`api-user/src/storyVotes.ts`）。
     */
    vote?: StoryVoteState;
    /**
     * 公開範囲。**無い＝全員に公開**（この列が生まれる前の投稿はそう扱う）。
     * 絞るのはサーバー——`getStories` が、フォローしていない人の
     * `"followers"` を返さない（`api-user/src/storyVisibility.ts`）。
     * 画面はこれで何も隠さない（届いている時点で見てよいもの）。
     */
    visibility?: StoryVisibility;
    /**
     * 返信を受けるか。**無い＝受ける**（返信が生まれたときからの姿）。
     * `false` のとき `StoryViewer` は返信の帯ごと出さない——押せない欄を
     * 置かないため。断るのはサーバー側（`postStoryReply` が 403）で、
     * ここは「押せない入口を出さない」だけ。
     */
    allowReplies?: boolean;
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
    /**
     * 退会した人。名前を伏せる（返信一覧・コメント欄と同じ）。
     *
     * 一度「プロフィールへは飛ばさない」と書いたが、**閲覧者の行は
     * `<div>` でリンクだったことが一度も無い**（`StoryViewer`）。
     * 実際に変わるのは名前と、アバターを出さないことだけ。
     */
    deleted?: boolean;
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
//
// **利用者ごとに分ける。** 共有キー1本だった頃は、同じ端末で
// 別の人がログインすると前の人の既読リングが付いて見えたので、
// ログアウトのたびに**全部消していた**。その結果、
// **同じ人がログインし直すと、一度見たストーリーが新着に戻る**
// （owner の報告）。鍵を分ければ、消さずに両方満たせる
// ——`useFavorites` が同じ理由で先に同じ形にしてある。
const SEEN_KEY = "jp_seen_stories";

let activeUserId: string | null = null;
const keyFor = (uid: string | null) => (uid ? `${SEEN_KEY}:${uid}` : SEEN_KEY);
const currentKey = () => keyFor(activeUserId);

/**
 * いまのアカウントを教える。`auth/context` が checkAuth / ログイン成功 /
 * ログアウト / 退会で呼ぶ（`setFavoritesUser` と同じ場所）。
 *
 * ⚠️ **`setAuthState` より先に呼ぶこと。** 後だと、`StoriesBar` が
 * ログイン確定で走らせる読み直しが**前の鍵**を読む。
 */
export function setSeenStoriesUser(userId: string | null): void {
    activeUserId = userId;
}

/**
 * 退会した人の既読記録を端末から消す。同じ userId では二度と
 * ログインできないので、読めない鍵付きデータを残さない
 * （`removeFavoritesUserData` と同じ判断）。
 */
export function removeSeenStoriesUserData(userId: string): void {
    try {
        localStorage.removeItem(keyFor(userId));
    } catch { /* ignore */ }
}

/** 別タブの変更が既読記録のものか（`storage` イベントの判定） */
export function isSeenStoriesKey(key: string | null): boolean {
    // `key === null` は「まとめて消した」。どの鍵か分からないので読み直す
    return key === null || key === currentKey();
}

export function loadSeenStoryIds(): Set<string> {
    try {
        const raw = localStorage.getItem(currentKey());
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
        const raw = localStorage.getItem(currentKey());
        const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
        const now = Date.now();
        // 25時間より古い既読記録は掃除（ストーリー自体が24時間で消えるため）
        for (const [k, t] of Object.entries(parsed)) {
            if (typeof t !== "number" || now - t > 25 * 60 * 60 * 1000) delete parsed[k];
        }
        parsed[id] = now;
        localStorage.setItem(currentKey(), JSON.stringify(parsed));
    } catch {
        /* ignore */
    }
}

/**
 * 未ログインで付いた既読記録（共有キー）を消す。
 *
 * **ログイン中のぶんは消さない。** 鍵が利用者ごとに分かれたので、
 * 前の人の既読が次の人に見えることはもう無い——消していたせいで
 * **同じ人がログインし直すと一度見たストーリーが新着に戻っていた**。
 *
 * 共有キーの方は残す理由が無いので掃除する（いまは `StoriesBar` が
 * 未ログインでは何も描かないので普通は空だが、鍵を分ける前の記録が
 * 残っている端末がある）。
 */
export function clearSeenStories(): void {
    try {
        localStorage.removeItem(SEEN_KEY);
    } catch { /* ignore */ }
}

export function hasUnseen(group: StoryGroup, seen: Set<string>): boolean {
    return group.items.some((s) => !seen.has(s.id));
}
