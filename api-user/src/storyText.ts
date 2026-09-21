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
 * 傾き（度）。**時計回りが正。**
 *
 * ## 「無い＝0度」で読む
 *
 * 既に保存されているストーリーの `texts` は `rotate` を持たない。
 * `clampStoryTextRotate(undefined)` が 0 を返すので、**既存の投稿は
 * 1つも見た目が変わらない**（`extraImages`・`visibility` と同じ作法）。
 *
 * ## 1周ぶんだけ持つ
 *
 * −180〜180 に畳む。畳まないと、指で何周も回したときに 3600 のような値が
 * 入り、**読み込んだ側が同じ見た目に戻せるのに違う数字を持つ**——
 * 「同じものを2通りの値で表す」状態になる。
 *
 * 丸めるのは**1度**まで。これより細かくしても画面では見分けられず、
 * 保存する文字数だけ増える（`size` を小数3桁で切っているのと同じ判断）。
 */
export const STORY_ROTATE_DEFAULT = 0;

/** −180〜180 に畳む（180 は 180 のまま。−180 は 180 に寄せる） */
export function normalizeStoryRotate(deg: number): number {
    // `%` は負の数で負を返すので、+360 してからもう一度畳む
    const wrapped = ((deg % 360) + 360) % 360;
    return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function clampStoryTextRotate(v: unknown): number {
    const n = typeof v === "number" && Number.isFinite(v) ? v : STORY_ROTATE_DEFAULT;
    return normalizeStoryRotate(Math.round(n));
}

/**
 * スタンプ（写真の上に置く絵柄）。
 *
 * ## 絵の files を持たない
 *
 * 絵文字で出す。画像にすると **S3 と CDN と派生の生成**が増え、
 * ストーリーを見るたびに追加の要求が飛ぶ（このサイトは表示速度を
 * SEO より上に置いていない——`CLAUDE.md` の「優先度は SEO・表示速度・
 * 安定性」）。絵文字なら**要求が1本も増えない**。
 *
 * ⚠️ **絵柄は端末の絵文字に依存する**（`maru` の字体が Android で
 * ゴシックに落ちるのと同じ話）。どの端末でも「何の絵か」は伝わる、
 * 言葉に頼らない絵だけを選んである。
 *
 * ## 鍵で持つ（絵文字そのものではなく）
 *
 * 字体や色と同じ。受け取るのは**一覧に在る鍵**だけなので、
 * サーバーの検証が「一覧に在るか」で済み、任意の文字列（他人の画面で
 * 何が出るか分からないもの）を写真の上に置かれることも無い。
 */
export const STORY_STAMPS = {
    heart: { label: "ハート", glyph: "❤️" },
    star: { label: "星", glyph: "⭐" },
    sparkles: { label: "きらきら", glyph: "✨" },
    fire: { label: "炎", glyph: "🔥" },
    camera: { label: "カメラ", glyph: "📷" },
    pin: { label: "ピン", glyph: "📍" },
    plane: { label: "飛行機", glyph: "✈️" },
    mountain: { label: "山", glyph: "⛰️" },
    wave: { label: "波", glyph: "🌊" },
    sun: { label: "太陽", glyph: "☀️" },
    moon: { label: "月", glyph: "🌙" },
    flower: { label: "花", glyph: "🌸" },
} as const;

export type StoryStampKey = keyof typeof STORY_STAMPS;
export const STORY_STAMP_KEYS = Object.keys(STORY_STAMPS) as StoryStampKey[];

/**
 * 置いたもの1つに**共通する**ぶん。位置は**中心**の割合（0〜1）。
 * **並びが重なり順**——後ろの要素ほど手前に出る。
 */
type StoryItemBase = {
    x: number;
    y: number;
    /** 絵の幅に対する割合（`STORY_SIZE_MIN`〜`STORY_SIZE_MAX`） */
    size: number;
    /**
     * 傾き（度・時計回りが正）。
     *
     * **`?` を外さないこと。** 保存済みのストーリーの `texts` は
     * この項目を**実際に持たない**ので、必須にすると型が実データについて
     * 嘘をつく（読み戻した値を `StoryText` と名乗らせる経路がある）。
     * 読む側は必ず `clampStoryTextRotate(t.rotate)` を通す——あれが
     * `undefined` を 0 に落とすので、「無い＝0度」が1か所で決まる。
     */
    rotate?: number;
};

/**
 * 置いた文字1つ。
 *
 * **`kind` は `?` のまま。** 保存済みのストーリーの要素はこの項目を
 * 持たない——**無い＝文字**で読む（`rotate` と同じ作法）。
 */
export type StoryTextItem = StoryItemBase & {
    kind?: "text";
    text: string;
    font: StoryFontKey;
    color: StoryColorKey;
    bg: StoryBgKey;
};

/** 置いたスタンプ1つ。**字体も色も下地も持たない**（絵柄に効かない） */
export type StoryStampItem = StoryItemBase & {
    kind: "stamp";
    stamp: StoryStampKey;
};

/**
 * 投票スタンプ（「この景色、好き？」→ 2択）。
 *
 * **問いと2択は投稿者が書いた文言**で、字体や色は持たない（カードの
 * 見た目は1種類）。票そのものはここには無い——**ストーリーごとに1行**
 * （`storyvotes#<storyId>`・`api-user/src/storyVotes.ts`）に、投じた人と
 * 数を持つ。投稿の中に票を持つと、票が入るたびに投稿の行を書き換える
 * ことになる（投稿者以外が投稿の行を書く形になり、返信が
 * `storyreplies#` に分けたのと同じ理由で避ける）。
 *
 * **1投稿に1つだけ**（`sanitizeStoryTexts` が2つ目以降を落とす）。
 * 票はストーリー単位で数えるので、2つ置けると票の行き先が決まらない。
 */
export type StoryVoteItem = StoryItemBase & {
    kind: "vote";
    question: string;
    options: [string, string];
};

/**
 * 写真の上に置いたもの。**文字・スタンプ・投票を1つの並びで持つ。**
 *
 * 別の配列に分けると、**重なり順が決まらない**——「文字の上にスタンプ」
 * と「スタンプの上に文字」を置き分けられなくなる。動かす・回す・
 * 大きさを変えるの仕組みも、分ければ2組書くことになる。
 *
 * 名前は `StoryText` のまま（保存されている属性名が `texts` で、
 * 画面もサーバーもこの名前で呼んでいる。改名は別の作業）。
 */
export type StoryText = StoryTextItem | StoryStampItem | StoryVoteItem;

/** その要素はスタンプか（**無い＝文字**で読む） */
export function isStoryStamp(t: StoryText): t is StoryStampItem {
    return t.kind === "stamp";
}

/** その要素は投票か */
export function isStoryVote(t: StoryText): t is StoryVoteItem {
    return t.kind === "vote";
}

/**
 * その要素は文字か（**無い＝文字**で読む）。
 *
 * `!isStoryStamp(t) && !isStoryVote(t)` を `filter` に書くと、TS が
 * 述語を推論するかが式の形に依る。名前を付けた1本にして、
 * `filter(isStoryTextItem)` で必ず絞れるようにする。
 */
export function isStoryTextItem(t: StoryText): t is StoryTextItem {
    return t.kind !== "stamp" && t.kind !== "vote";
}

/**
 * 見せ方の既定（新しく足した文字の姿）。白・太ゴシック。
 *
 * **`rotate` は置かない**——既定が 0 で、`sanitizeStoryTexts` は 0 を
 * 書かないので、ここに置くと「新しい文字だけ 0 を持って保存で消える」
 * という、見比べたときに説明の付かない差ができる。
 */
export const DEFAULT_STORY_TEXT: Omit<StoryTextItem, "text" | "x" | "y" | "rotate" | "kind"> = {
    size: STORY_SIZE_DEFAULT, font: "bold", color: "white", bg: "none",
};

/**
 * 新しく置くスタンプの既定。
 *
 * **文字より大きめ。** 同じ `size`（絵の幅に対する割合）で出すと、
 * 絵文字は1文字ぶんしか無いので**文字列より小さく見える**。
 * 置いた直後に掴める大きさにしておく（小さすぎるとハンドルが
 * 潰れた箱の判定に掛かる）。
 */
export const DEFAULT_STORY_STAMP_SIZE = 0.14;

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

/** 新しく足す文字1つ（位置は呼ぶ側が決める——重ならないように少しずらす） */
export function newStoryText(x: number, y: number): StoryTextItem {
    return { text: "", x: clampStoryTextPos(x), y: clampStoryTextPos(y), ...DEFAULT_STORY_TEXT };
}

/** 新しく置くスタンプ1つ */
export function newStoryStamp(stamp: StoryStampKey, x: number, y: number): StoryStampItem {
    return {
        kind: "stamp", stamp,
        x: clampStoryTextPos(x), y: clampStoryTextPos(y),
        size: clampStoryTextSize(DEFAULT_STORY_STAMP_SIZE),
    };
}

/**
 * 投票の文言の長さ。**写真の上のカードに収まる長さ**で切る。
 *
 * 問いは1〜2行、選択肢はボタン1つに乗る短い語（「はい」「いいえ」の類）。
 * これより長いと、小さい画面（320px）でカードが写真を覆う。上限は判断。
 */
export const STORY_VOTE_QUESTION_MAX = 40;
export const STORY_VOTE_OPTION_MAX = 12;

/**
 * 新しく置く投票の既定。**問いは台帳の文言そのもの**
 * （「この景色、好き？」）。2択の既定は台帳に無いので判断——
 * 違う想定なら差し替える（PR 本文に明記）。
 */
export const STORY_VOTE_DEFAULT: { question: string; options: [string, string] } = {
    question: "この景色、好き？",
    options: ["はい", "いいえ"],
};

/**
 * 新しく置く投票の大きさ。**文字の既定より小さめ**——`size` はカードの
 * 字の大きさで、カードは問いと2つのボタンを持つので、文字と同じ字の
 * 大きさだと写真を覆う。
 */
export const DEFAULT_STORY_VOTE_SIZE = 0.05;

/** 新しく置く投票1つ（問いと2択は既定。置いたあとに直す） */
export function newStoryVote(x: number, y: number): StoryVoteItem {
    return {
        kind: "vote",
        question: STORY_VOTE_DEFAULT.question,
        options: [...STORY_VOTE_DEFAULT.options],
        x: clampStoryTextPos(x), y: clampStoryTextPos(y),
        size: clampStoryTextSize(DEFAULT_STORY_VOTE_SIZE),
    };
}

/**
 * 受け取った値を、**一覧に在る鍵だけ**に直す。
 *
 * 知らない鍵は既定へ落とす（弾いて丸ごと捨てると、字体を1つ増やした日に
 * 古いクライアントの投稿から文字の位置が消える）。**位置は必ず挟む。**
 * **文言が空のものは落とす**——置き場所だけの項目は画面に何も描けない。
 *
 * **スタンプは別の規則。** 文言を持たないので「空なら落とす」は当てない
 * ——代わりに**一覧に在る鍵でなければ落とす**（知らないスタンプを
 * 既定の絵柄に化けさせない。字体と違い、絵柄が変わると**別の意味**になる）。
 *
 * **投票は1つだけ・欠けたら落とす。** 問いか選択肢が空の投票は成立しない
 * （既定で埋めない——サーバーが文言を作ることになる）。2つ目以降は
 * 落とす（票はストーリー単位で数えるので、行き先が決まらない）。
 */
export function sanitizeStoryTexts(input: unknown): StoryText[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const pick = <T extends string>(v: unknown, keys: readonly T[], fallback: T): T =>
        typeof v === "string" && (keys as readonly string[]).includes(v) ? (v as T) : fallback;
    const out: StoryText[] = [];
    let seenVote = false;
    for (const raw of input) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const o = raw as Record<string, unknown>;
        // **傾きが 0 なら書かない。**
        //
        // 書かなければ、傾けていない文字の保存内容は**この変更の前と
        // 1バイトも変わらない**——「既存のストーリーが1つも変わらない」の
        // いちばん強い形で、読む側は元から「無い＝0度」を通るので
        // 経路も増えない。`size` は常に書くが、あちらは**既定が 0 ではない**
        // （書かないと「無い」と「既定」が区別できない）ので事情が違う。
        const rotate = clampStoryTextRotate(o.rotate);
        const common = {
            ...(rotate === 0 ? {} : { rotate }),
            x: clampStoryTextPos(o.x),
            y: clampStoryTextPos(o.y),
            size: clampStoryTextSize(o.size),
        };

        if (o.kind === "stamp") {
            // **知らない絵柄は落とす**（既定に化けさせない）。
            // 一覧を増やした日に古い画面が困ることは無い——増える側なので
            if (typeof o.stamp !== "string" || !(STORY_STAMP_KEYS as readonly string[]).includes(o.stamp)) continue;
            out.push({ kind: "stamp", stamp: o.stamp as StoryStampKey, ...common });
        } else if (o.kind === "vote") {
            // **1投稿に1つだけ。** 2つ目以降は落とす（上の docstring）
            if (seenVote) continue;
            const question = (typeof o.question === "string" ? o.question : "").slice(0, STORY_VOTE_QUESTION_MAX).trim();
            const opts = Array.isArray(o.options) ? o.options : [];
            const a = (typeof opts[0] === "string" ? opts[0] : "").slice(0, STORY_VOTE_OPTION_MAX).trim();
            const b = (typeof opts[1] === "string" ? opts[1] : "").slice(0, STORY_VOTE_OPTION_MAX).trim();
            // **欠けた投票は落とす**（既定で埋めない——サーバーが文言を作らない）
            if (!question || !a || !b) continue;
            seenVote = true;
            out.push({ kind: "vote", question, options: [a, b], ...common });
        } else {
            const text = (typeof o.text === "string" ? o.text : "").slice(0, STORY_TEXT_LEN_MAX).trim();
            if (!text) continue;
            out.push({
                ...common,
                text,
                font: pick(o.font, STORY_FONT_KEYS, DEFAULT_STORY_TEXT.font),
                color: pick(o.color, STORY_COLOR_KEYS, DEFAULT_STORY_TEXT.color),
                bg: pick(o.bg, STORY_BGS, DEFAULT_STORY_TEXT.bg),
            });
        }
        if (out.length >= STORY_TEXTS_MAX) break;
    }
    return out.length > 0 ? out : undefined;
}

/**
 * 置いた文字から `caption` を作る。**文言を2か所で持たない**ための1本。
 * 残したときの題も、検索に出る文章も、これを読む。
 */
export function storyTextsCaption(texts: readonly StoryText[]): string {
    // **スタンプは混ぜない。** `caption` は「残したときの題」と
    // 「検索に出る文章」になる（`storyKeep.ts` の `sanitizeTitle`）。
    // 絵柄は文章ではないので、入れると**題が絵文字だけの写真**ができる。
    // スタンプしか置いていない投稿は `caption` を持たない（それが正しい）。
    // **投票も混ぜない。** 「この景色、好き？」は題ではなく問いかけで、
    // 残したときに写真の題になると嘘になる（スタンプと同じ側）
    return texts.filter(isStoryTextItem).map((t) => t.text).join("\n").trim();
}
