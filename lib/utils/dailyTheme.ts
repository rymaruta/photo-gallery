import { TAG_CHOICES } from "./tagChoices";

/**
 * **今日のテーマ**（iOS の `DailyTheme.swift` の写し・2026-10-15）。
 *
 * **サーバーは何も持っていない。** テーマは日付から決まる（固定の一覧を日で回す）ので、
 * アプリと Web の全員が同じ日に同じテーマを見るのに、通信は1回も要らない。
 * 「参加する」はそのタグを入れた投稿画面を開くだけ。**参加人数は出さない**（数えていない）。
 *
 * ⚠️ **一覧と順番は iOS と同じにする。** ずれるとアプリと Web で今日のテーマが割れる
 * （`dailyTheme.test.ts` が iOS で数えた日付の値で縛る）。
 */
export type DailyThemeEntry = {
    /** 投稿に入れるタグ（`TAG_CHOICES` の中から） */
    tag: string;
    title: { ja: string; en: string };
    prompt: { ja: string; en: string };
};

export const DAILY_THEMES: readonly DailyThemeEntry[] = [
    { tag: "夕焼け", title: { ja: "光と影", en: "Light and shadow" }, prompt: { ja: "光がつくる特別な瞬間を見つけよう。", en: "Find a moment shaped by light." } },
    { tag: "山", title: { ja: "山と空", en: "Mountains and sky" }, prompt: { ja: "雄大な自然がつくる、心を動かす風景を。", en: "Landscapes that move you." } },
    { tag: "朝", title: { ja: "朝のはじまり", en: "First light" }, prompt: { ja: "一日の最初の色を撮ってみませんか。", en: "Catch the day's first colour." } },
    { tag: "海", title: { ja: "水のある風景", en: "By the water" }, prompt: { ja: "海・湖・川——水がある場所の一枚を。", en: "Sea, lake or river." } },
    { tag: "夜", title: { ja: "夜のあかり", en: "Night lights" }, prompt: { ja: "暗くなってから見えてくるものを。", en: "What only appears after dark." } },
    { tag: "花", title: { ja: "足もとの色", en: "Colour underfoot" }, prompt: { ja: "小さくても、目を引いた色を。", en: "Small things that caught your eye." } },
    { tag: "神社", title: { ja: "その土地の場所", en: "Places of the land" }, prompt: { ja: "その土地にしかない場所を訪ねて。", en: "Somewhere only there." } },
];

/** 西暦1年1月1日を1とした、1970-01-01 の通し日数（iOS の `ordinality(of: .day, in: .era)`） */
const EPOCH_ORDINAL = 719163;

/**
 * 今日のテーマ。区切りは**見ている端末の暦の1日**（日付が変わった瞬間に切り替わる）。
 * 土地の年月日を取り出し、協定世界時の正午に置いてから数える（iOS と同じ割り当て）。
 */
export function dailyThemeFor(now: Date = new Date()): DailyThemeEntry {
    const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12) / 86_400_000) + EPOCH_ORDINAL;
    const n = DAILY_THEMES.length;
    return DAILY_THEMES[((day % n) + n) % n];
}

/**
 * 投稿画面の `?tag=` を読む。**テーマのタグだけを受け取る**——任意の語を URL から
 * 入れられると、リンク1本で人の投稿に知らない語を混ぜられる。
 */
export function readThemeTag(raw: string | null | undefined): string | null {
    if (!raw) return null;
    return DAILY_THEMES.some((t) => t.tag === raw) && TAG_CHOICES.includes(raw) ? raw : null;
}

/**
 * 今日のテーマに**今日もう参加したか**（iOS の `DailyTheme.hasJoined`・2026-10-31 束 1 H2）。
 * 自分の写真のうち、テーマのタグ（表記ゆれは `tagKey` で畳む）を持ち、**投稿日が端末の今日**の1枚があれば参加済み。
 * 参加済みの日はホームの札の「参加する」を、押せない「参加済み」に替える（同じ日に何度も促さない）
 */
export function hasJoinedTheme(
    theme: DailyThemeEntry,
    myPhotos: ReadonlyArray<{ tags?: unknown; createdAt?: unknown }>,
    tagKeyOf: (t: string) => string,
    now: Date = new Date(),
): boolean {
    const key = tagKeyOf(theme.tag);
    return myPhotos.some((p) => {
        const tags = Array.isArray(p.tags) ? p.tags : [];
        if (!tags.some((t) => typeof t === "string" && tagKeyOf(t) === key)) return false;
        const at = typeof p.createdAt === "string" ? new Date(p.createdAt) : null;
        return !!at && !Number.isNaN(at.getTime())
            && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    });
}
