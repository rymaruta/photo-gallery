/**
 * ストーリーの文字（好きな場所・字体・色。**何枚でも置ける**）。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」「複数のテキストを別々に置くのもやりたい」
 *
 * ## 画像に焼き込まない
 *
 * 文字は**データとして持つ**（文言・位置・字体・色・大きさ・下地）。焼き込むと:
 *   - 「ギャラリーに残す」（`storyKeep.ts`）で、文字入りの写真が
 *     作品として残る——このサイトは**写真が主役**
 *   - あとから直せない／端末の解像度でぼける
 *
 * ## `caption` は文字たちから作る
 *
 * 残したときの題（`storyKeep`）も、検索に出る文章も、これまでどおり
 * `caption` を読む。**文言を2か所で持たない**ように、`caption` は
 * 置いた文字を繋いだもの（`storyTextsCaption`）をサーバーが書く。
 *
 * ## 鍵で持つ（生の色や px ではなく）
 *
 * 受け取るのは**一覧に在る鍵**だけ。任意の CSS を通さないので、
 * サーバーの検証が「一覧に在るか」で済み、読めない組み合わせも作れない。
 *
 * ⚠️ **このファイルは `api-user/src/storyText.ts` と同じ中身。**
 * クライアントから api-user は import できない（別パッケージ・別ビルド。
 * ルートの型検査に api-user が入ると `next build` が落ちる＝`7276c2b8`）。
 * **複製した規則は静かにずれる**ので、
 * `scripts/__tests__/storyTextParity.test.ts` がコードの一致で縛る。
 */

/** 字体。**ファミリと太さの組み合わせ**（見た目の系統として1つの鍵にする） */
export const STORY_FONTS = {
    // 既定。本文と同じ系統
    gothic: { label: "ゴシック", css: '"Hiragino Sans","Noto Sans JP",system-ui,-apple-system,sans-serif', weight: 600 },
    // 太ゴシック。インスタの既定に近い、写真の上でいちばん強い
    bold: { label: "太ゴシック", css: '"Hiragino Sans","Noto Sans JP",system-ui,-apple-system,sans-serif', weight: 900 },
    // 明朝。旅の写真に添える一言に合う
    mincho: { label: "明朝", css: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif', weight: 600 },
    // 丸ゴシック。⚠️ **端末に無ければゴシックに落ちる**（iOS/macOS には在るが、
    // Android と Windows は標準で持たない）。落ちても読める並びにしてある
    maru: { label: "丸ゴシック", css: '"Hiragino Maru Gothic ProN","M PLUS Rounded 1c","Hiragino Sans",system-ui,sans-serif', weight: 600 },
    // 等幅。数字や英字を並べるとき
    mono: { label: "等幅", css: 'ui-monospace,SFMono-Regular,Menlo,"Noto Sans Mono CJK JP",monospace', weight: 600 },
} as const;

export type StoryFontKey = keyof typeof STORY_FONTS;
export const STORY_FONT_KEYS = Object.keys(STORY_FONTS) as StoryFontKey[];

/**
 * 色。**写真の上で読める色だけ**を選んである。
 * 下地（`bg`）を付けたときは、この色が下地になり文字は白か黒へ反転する。
 */
export const STORY_COLORS = {
    white: { label: "白", hex: "#ffffff", on: "#000000" },
    black: { label: "黒", hex: "#111111", on: "#ffffff" },
    red: { label: "赤", hex: "#ff453a", on: "#ffffff" },
    orange: { label: "橙", hex: "#ff9f0a", on: "#000000" },
    yellow: { label: "黄", hex: "#ffd60a", on: "#000000" },
    lime: { label: "黄緑", hex: "#b5e853", on: "#000000" },
    green: { label: "緑", hex: "#32d74b", on: "#000000" },
    mint: { label: "ミント", hex: "#63e6e2", on: "#000000" },
    sky: { label: "空", hex: "#64d2ff", on: "#000000" },
    blue: { label: "青", hex: "#0a84ff", on: "#ffffff" },
    purple: { label: "紫", hex: "#bf5af2", on: "#ffffff" },
    pink: { label: "桃", hex: "#ff6482", on: "#000000" },
} as const;

export type StoryColorKey = keyof typeof STORY_COLORS;
export const STORY_COLOR_KEYS = Object.keys(STORY_COLORS) as StoryColorKey[];

/**
 * 大きさ。**絵の幅に対する割合**で持つ（px で持つと、撮った端末と
 * 見る端末で違う大きさになる）。
 *
 * **段階ではなく無段階。** 4段階のチップ（A A A A）で出していたが、
 * 並べても違いが見分けられず**気づかれなかった**（owner:「文字の大きさも
 * 変えたいよね」——控えは在ったのに見つからなかった）。
 * つまみで連続に変える方が、何ができるかが一目で分かる。
 */
export const STORY_SIZE_MIN = 0.03;
export const STORY_SIZE_MAX = 0.16;
export const STORY_SIZE_DEFAULT = 0.078;
export const STORY_SIZE_STEP = 0.002;

export function clampStoryTextSize(v: unknown): number {
    const n = typeof v === "number" && Number.isFinite(v) ? v : STORY_SIZE_DEFAULT;
    return Math.min(STORY_SIZE_MAX, Math.max(STORY_SIZE_MIN, Math.round(n * 1000) / 1000));
}

/** 下地。`none` は影だけ（写真がうるさいと読みにくいので `soft`/`solid` を用意） */
export const STORY_BGS = ["none", "soft", "solid"] as const;
export type StoryBgKey = (typeof STORY_BGS)[number];

/**
 * 置いた文字1つ。位置は**中心**の割合（0〜1）。
 * **並びが重なり順**——後ろの要素ほど手前に出る。
 */
export type StoryText = {
    text: string;
    x: number;
    y: number;
    /** 絵の幅に対する割合（`STORY_SIZE_MIN`〜`STORY_SIZE_MAX`） */
    size: number;
    font: StoryFontKey;
    color: StoryColorKey;
    bg: StoryBgKey;
};

/** 見せ方の既定（新しく足した文字の姿）。白・太ゴシック */
export const DEFAULT_STORY_TEXT: Omit<StoryText, "text" | "x" | "y"> = {
    size: STORY_SIZE_DEFAULT, font: "bold", color: "white", bg: "none",
};

/**
 * 1枚目の既定の位置。**真ん中ではなく少し上**——下書きの画面は
 * 下半分が操作の欄なので、中央に出すと打った文字が自分で見えない（実測）。
 */
export const FIRST_STORY_TEXT_POS = { x: 0.5, y: 0.32 };

/** 置ける数。**多いほど読めなくなる**ので、画面が破綻しない範囲で切る */
export const STORY_TEXTS_MAX = 5;
/** 1つあたりの長さ（`caption` の上限と同じ。サーバーが最後にもう一度切る） */
export const STORY_TEXT_LEN_MAX = 200;

/**
 * 端まで行かせない。**中心の割合なので 0 や 1 にすると半分が画面の外**へ出る。
 * 掴んで動かす側と、受け取って保存する側の**両方**がこれを通る。
 */
export const STORY_TEXT_MIN = 0.06;
export const STORY_TEXT_MAX = 0.94;

export function clampStoryTextPos(v: unknown): number {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0.5;
    return Math.min(STORY_TEXT_MAX, Math.max(STORY_TEXT_MIN, Math.round(n * 1000) / 1000));
}

/** 新しく足す1つ（位置は呼ぶ側が決める——重ならないように少しずらす） */
export function newStoryText(x: number, y: number): StoryText {
    return { text: "", x: clampStoryTextPos(x), y: clampStoryTextPos(y), ...DEFAULT_STORY_TEXT };
}

/**
 * 受け取った値を、**一覧に在る鍵だけ**に直す。
 *
 * 知らない鍵は既定へ落とす（弾いて丸ごと捨てると、字体を1つ増やした日に
 * 古いクライアントの投稿から文字の位置が消える）。**位置は必ず挟む。**
 * **文言が空のものは落とす**——置き場所だけの項目は画面に何も描けない。
 */
export function sanitizeStoryTexts(input: unknown): StoryText[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const pick = <T extends string>(v: unknown, keys: readonly T[], fallback: T): T =>
        typeof v === "string" && (keys as readonly string[]).includes(v) ? (v as T) : fallback;
    const out: StoryText[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const o = raw as Record<string, unknown>;
        const text = (typeof o.text === "string" ? o.text : "").slice(0, STORY_TEXT_LEN_MAX).trim();
        if (!text) continue;
        out.push({
            text,
            x: clampStoryTextPos(o.x),
            y: clampStoryTextPos(o.y),
            size: clampStoryTextSize(o.size),
            font: pick(o.font, STORY_FONT_KEYS, DEFAULT_STORY_TEXT.font),
            color: pick(o.color, STORY_COLOR_KEYS, DEFAULT_STORY_TEXT.color),
            bg: pick(o.bg, STORY_BGS, DEFAULT_STORY_TEXT.bg),
        });
        if (out.length >= STORY_TEXTS_MAX) break;
    }
    return out.length > 0 ? out : undefined;
}

/**
 * 置いた文字から `caption` を作る。**文言を2か所で持たない**ための1本。
 * 残したときの題も、検索に出る文章も、これを読む。
 */
export function storyTextsCaption(texts: readonly StoryText[]): string {
    return texts.map((t) => t.text).join("\n").trim();
}
