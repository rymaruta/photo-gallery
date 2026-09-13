import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **黒地に薄い白は読めない。** Chromium で全ページの文字を実測したところ、
// 半透明の文字が基準（WCAG AA・普通の文字で 4.5:1）を下回っていた:
//
//   text-white/30 → 2.46:1   text-white/35 → 3.01:1
//   text-white/40 → 3.66:1   text-white/45 → 4.41:1   text-white/50 → 5.28:1
//
// いちばん効いていたのは**新規登録のパスワード条件**（2.48:1）——読めないと
// アカウントが作れない文。ほかに写真ページの撮影情報のラベル（3.16:1）、
// フッターの著作権表示（2.48:1・全ページ）など。
//
// **測定の道具に穴があった**ことも記録する: Tailwind v4 は `oklab(… / 0.4)` を
// 出すので、`rgb()` の正規表現で読む実装は**半透明の文字を全部飛ばし、
// 「全ページ合格」という嘘の結果**を返していた。既知の下地2色に塗って
// 読み戻す形に直して初めて出た（測定スクリプトは scratchpad の `a11y/contrast.mjs`）。
//
// jsdom は CSS を評価しないので、ここでは**直した箇所が薄い指定に戻っていないか**
// だけを見る。全画面の実測はブラウザでしかできない。

const ROOT = join(__dirname, "..", "..");

/**
 * 黒地でのコントラスト比。`#rrggbb` を実際に計算する
 * （「任意の色は読めるか分からないので弾く」にしたら、取り消し操作の赤
 *  `text-[#ff453a]`（6.16:1）まで弾いた。分からないなら計算すればよい）
 */
function ratioOnBlack(hexColor: string, alpha = 1): number {
    const h = hexColor.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) * alpha);
    const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const lum = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return (lum + 0.05) / 0.05;
}

/**
 * 灰色系は「意図して付けた色」ではなく**薄い白の言い換え**。黒地での実測:
 *   gray-400 8.27:1 ／ gray-500 4.34:1 ／ gray-600 2.78:1 ／ gray-700 2.04:1
 * 500 以上は届かない
 */
const GRAY_MIN_FAIL = 500;

/**
 * コメントを空白に潰す（行数は保つ）。JSX のコメント（波括弧で包んだもの）も含む。
 * ここの説明に閉じ記号を書くと、その場でコメントが終わって構文が壊れる（実際に踏んだ）
 */
function stripComments(src: string): string {
    return src
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, " "));
}

/**
 * **禁止ではなく許可で見る。** 「薄いものを弾く」形にしていたら、
 * `text-white/5`（単桁）・`text-white/[0.3]`（任意値）・`text-gray-600`
 * （別の色系統へ逃がす）が全部素通りした——**いちばん捕まえたい方向**が
 * 抜けていた。黒文字（白地）も見ていなかった。
 *
 * 通すのは、黒地／白地で 4.5:1 に届くと分かっているものだけ:
 *   `text-white`（21:1）・`text-white/46` 以上（4.58:1〜）
 *   `text-black`（21:1）・`text-black/55` 以上（4.76:1〜）
 */
const COLOR_TOKEN = /(?:^|[\s"'`{:\]])((?:(?:[\w-]+|\[[^\]]*\]|group-\[[^\]]*\]):)*)text-(white|black|\[[^\]]*\]|[a-z]+-\d{2,3})(\/(\[[^\]]*\]|\d{1,3}))?/g;

/** 見送ってよい接頭辞＝「触ったとき」の状態だけ。`md:` などの画面幅は常に効くので見る */
const INTERACTION_PREFIX = /^(hover|focus|focus-visible|active|group-hover|group-focus|disabled|placeholder|visited|peer-\w+)$/;

/**
 * @param monochromeOnly 白・黒以外の色相を見ない。**全体の走査ではこちらを使う**
 *   ——警告の amber、エラーの red のように**意図して付けた色**まで「読めるか
 *   分からない」で弾いてしまう（実際、全体に当てた瞬間に14件が誤検知で出た）。
 *   目印を書いた行では、逆に「別の色相へ逃がす」変異を捕まえたいので見る
 */
function unreadableTokens(cls: string, monochromeOnly = false): string[] {
    const bad: string[] = [];
    for (const m of cls.matchAll(COLOR_TOKEN)) {
        const [, prefix, hue, , amount] = m;
        // 触ったときの状態は見送る（土台が通っていれば足りる）。
        // **画面幅の指定（`md:` 等）は見送らない**——その幅では常にその色になる
        if (prefix && prefix.split(":").filter(Boolean).every((x) => INTERACTION_PREFIX.test(x))) continue;
        // `text-[11px]` は**文字の大きさ**で色ではない（最初これを色と誤認して
        // 守っている8件が一斉に落ちた）。任意値は中身が色のときだけ見る
        // 任意の色（`text-[#333333]`）は**全体の走査でも弾く**。灰色なら
        // 「白黒以外だから見送る」に当たらないのに、任意値を丸ごと見送っていた
        if (hue.startsWith("[")) {
            const hex = /^\[(#[0-9a-f]{3,8})\]$/i.exec(hue)?.[1];
            if (hex) {
                const a = amount !== undefined && Number.isFinite(Number(amount)) ? Number(amount) / 100 : 1;
                if (ratioOnBlack(hex, a) < 4.5) bad.push(m[0].trim());
            } else if (/^\[(rgb|hsl|oklch|oklab|color|var\()/i.test(hue)) {
                bad.push(m[0].trim());   // 計算できない書き方は「分からない」ので弾く
            }
            continue;   // `text-[11px]` のような大きさは色ではないので素通し
        }
        // 灰色系は「意図して付けた色」ではなく**薄い白の言い換え**なので、
        // 全体の走査でも見る（黒地では -400 以下がおおむね 4.5:1 に届かない）
        const grayLevel = /^(?:gray|neutral|zinc|slate|stone)-(\d{2,3})$/.exec(hue)?.[1];
        if (grayLevel) {
            if (Number(grayLevel) >= GRAY_MIN_FAIL) bad.push(m[0].trim());
            continue;
        }
        // それ以外の色相（警告の amber・エラーの red・リンクの sky）は
        // **意図して付けた色**。目印を書いた行でだけ「逃がしていないか」を見る
        if (hue !== "white" && hue !== "black") { if (!monochromeOnly) bad.push(m[0].trim()); continue; }
        if (amount === undefined) continue;                                            // 素の white/black は 21:1
        const n = Number(amount);
        if (!Number.isFinite(n)) { bad.push(m[0].trim()); continue; }                   // /[0.3] のような任意値
        const min = hue === "white" ? 46 : 55;
        if (n < min) bad.push(m[0].trim());
    }
    return bad;
}

/** その行が「読めないと困る文字」であるもの。目印の文字列で行を特定する */
/**
 * `[ファイル, 目印, 説明, 親から色を継ぐ?]`。
 * 4つ目が true の行は**自分で色を持たなくてよい**（親から継ぐ）。それでも
 * 「薄い色で上書きしていないか」は見る——親を守っても子で上書きされたら
 * 気づけない、というレビュー指摘への答え
 */
const GUARDED: Array<[string, string, string, boolean?]> = [
    ["app/signup/page.tsx", "英大文字・小文字・数字", "パスワードの条件（読めないと登録できない）"],
    ["app/signup/page.tsx", "写真のアップロードができるようになります", "新規登録の説明"],
    ["app/login/page.tsx", "写真をアップロードするにはログインが必要です", "ログインの説明"],
    ["app/login/page.tsx", "パスワードをお忘れですか", "パスワード再設定への導線"],
    ["app/components/Footer.tsx", "© Journey Photo", "全ページに出る著作権表示"],
    ["app/privacy/page.tsx", "最終更新日: {LAST_UPDATED}", "プライバシーポリシーの更新日"],
    // 子の <Link>（/70）を親と取り違えていたので、包む <p> を直接の目印にする
    ["app/components/CommentSection.tsx", '<p className="mb-4 text-xs', "コメントの案内"],
    ["app/map/page.tsx", "GPS 付きの写真をアップロード", "地図が空のときの案内"],
    // 画面に出る文字が変数で、目印にできないもの。コードの断片を目印にする
    ["app/components/FilterBar.tsx", "showCount ? <span", "絞り込みのチップの件数"],
    ["app/components/CollectionPageClient.tsx", "{r.count}", "関連する集約ページの件数"],
    // 撮影情報のカードは `ExifSpecs.tsx` に1本化した（写真ページと拡大表示が
    // 同じ部品を使う）。ラベルと値の両方を見る——薄いのはラベル側だった
    ["app/components/ExifSpecs.tsx", "<dt ", "撮影情報のラベル（カメラ・レンズ…）"],
    ["app/components/ExifSpecs.tsx", "<dd ", "撮影情報の値"],
    // 訪問者が読む画面（コメントがある／メニューを開いた／拡大した状態）。
    // **ブラウザの実測は「そのとき描かれているもの」しか見られない**ので、
    // 状態を作らないと出てこない文字はここで縛る
    ["app/components/CommentSection.tsx", "No comments yet", "コメントが0件のときの案内"],
    ["app/components/CommentSection.tsx", "{timeAgo(c.t, locale)}", "コメントの時刻"],
    ["app/components/CommentSection.tsx", "{c.name}", "コメントした人の名前"],
    ["app/components/HeaderNav.tsx", 'navLabels.account || "Account"', "メニューの見出し"],
    ["app/components/GalleryModal/ModalKeyboardHelp.tsx", "下スワイプで閉じる", "拡大表示の操作の案内"],
    ["app/not-found.tsx", ">404<", "404 の見出し"],
    ["app/components/MusicCard.tsx", "{label}{songs.length > 1", "BGM のラベル"],
    ["app/components/DeleteConfirmModal.tsx", "text-[13px] mb-6", "削除確認の本文"],
    ["app/components/DeleteAccountModal.tsx", "text-[13px] mb-5", "退会確認の本文"],
    // プロフィール（実ブラウザで「年表」タブが 3.66:1 だったのを実測）
    ["app/users/UserProfileClient.tsx", 'active ? "text-white" :', "非選択のタブ（投稿／年表）"],
    ["app/users/UserProfileClient.tsx", "うち非公開", "本人にだけ出る非公開の枚数"],
    // 投稿タブと年表タブの2か所に同じものがある（両方見る）
    ["app/users/UserProfileClient.tsx", "justify-center py-24", "写真が0枚のときの案内（外枠の色）"],
    // **子で上書きされたら気づけない**ので、文字そのものの行も見る
    ["app/users/UserProfileClient.tsx", "No photos yet", "写真が0枚のときの案内（文字）", true],
    ["app/users/UserProfileClient.tsx", "{g.photos.length}", "年表の月ごとの枚数"],
    // 訪問者が届くのに残っていた分（レビュー指摘）
    ["app/users/UserProfileClient.tsx", "musicServiceLabel(songEmbed.service)", "BGM の配信元（Spotify など）"],
    ["app/users/UserProfileClient.tsx", "Scan to open this profile", "QR の説明（白いカードの上）"],
    ["app/users/search/page.tsx", "@{u.username}", "利用者検索の @名"],
    ["app/users/search/page.tsx", "{u.bio}", "利用者検索の自己紹介"],
    ["app/favorites/page.tsx", "text-white/50 text-xs", "お気に入りが空のときの案内"],
    ["app/components/stories/StoriesBar.tsx", "text-[11px] text-white/50 px-1 pb-1", "ストーリーの読み込み失敗"],
];

/**
 * 目印の行を**すべて**探す。**コメント行は数えない**（「最終更新日」は
 * 注意書きにも出てくる）。同じ形が2か所にある画面（写真0枚の案内は
 * 投稿タブと年表タブの2つ）で、片方だけ直すのを防ぐ
 */
function findLines(file: string, needle: string): { src: string[]; hits: number[] } {
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    const hits: number[] = [];
    src.forEach((l, i) => {
        if (l.includes(needle) && !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)) hits.push(i);
    });
    return { src, hits };
}

/**
 * その文字を包む要素の色の指定。**まず同じ行を見る**——三項で書いてある場合
 * （`${active ? "…" : "text-white/50"}`）は className の頭だけを取ると
 * 色を取り逃がす。同じ行に無ければ、改行して書いてあるとみて上へたどる
 */
function classNameFor(src: string[], i: number): string {
    const hasColor = (l: string) => /text-white(\/\d+)?\b|text-black(\/\d+)?\b|text-\[#|text-gray/.test(l);
    if (i >= 0 && hasColor(src[i])) return src[i];
    for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        if (/className=/.test(src[j]) && hasColor(src[j])) return src[j];
        if (/className=/.test(src[j])) return src[j];   // 指定はあるが色が無い＝既定の色
    }
    return "";
}

describe("読めない濃さの文字に戻っていないか", () => {
    it.each(GUARDED)("%s の「%s」（%s）", (file, needle) => {
        const { src, hits } = findLines(file, needle);
        expect(hits.length, `${file} に「${needle}」の行が無い`).toBeGreaterThan(0);
        for (const i of hits) {
            const cls = classNameFor(src, i);
            expect(unreadableTokens(cls), `${file}:${i + 1} が 4.5:1 に届かない: ${cls.slice(0, 110)}`).toEqual([]);
        }
    });

    // 目印の文字列だけを見ていると、その行から色の指定が消えたときに
    // 「薄くない」で通ってしまう。濃さの指定が残っていることも見る
    it.each(GUARDED.filter((g) => !g[3]))("%s の「%s」は濃さの指定を持っている", (file, needle) => {
        const { src, hits } = findLines(file, needle);
        expect(hits.length, `${file} に「${needle}」の行が無い`).toBeGreaterThan(0);
        for (const i of hits) {
            const cls = classNameFor(src, i);
            expect(/text-white(\/\d+)?\b|text-\[#|text-gray|text-black/.test(cls),
                `色の指定が見当たらない（既定の色に落ちていないか）: ${src[i]?.trim().slice(0, 80)}`).toBe(true);
        }
    });

    // 判定そのものの自己確認。**「薄いものを弾く」形で素通りしたもの**を並べる
    it("判定が抜け道を塞いでいる", () => {
        // 通す
        for (const ok of ['text-white/50', 'text-white/46', 'text-white', 'text-black/55', 'text-black',
                          'text-[11px] ${active ? "text-black/55" : "text-white/50"}']) {
            expect(unreadableTokens(ok), ok).toEqual([]);
        }
        // 弾く（下の3つは「薄いものを弾く」形では全部素通りしていた）
        for (const ng of ['text-white/40', 'text-white/45', 'text-white/5', 'text-white/[0.3]',
                          'text-gray-600', 'text-slate-500', 'text-black/50', 'text-black/10',
                          'text-[#444444]', 'text-[#666]', '[&>p]:text-white/10', 'group-[.open]:text-white/5']) {
            expect(unreadableTokens(ng, true).length, ng).toBeGreaterThan(0);
        }
        // 計算できるものは計算する（意図して付けた色を「分からない」で弾かない）
        expect(unreadableTokens('text-[#ff453a]', true), "取り消しの赤（6.16:1）を弾いている").toEqual([]);
        expect(unreadableTokens('text-[#888]', true), "#888（5.92:1）を弾いている").toEqual([]);
        expect(unreadableTokens('text-gray-400', true), "gray-400（8.27:1）を弾いている").toEqual([]);
        // hover / placeholder は土台と別。ここでは見ない
        expect(unreadableTokens('text-white/50 hover:text-white/40')).toEqual([]);
        expect(unreadableTokens('text-white placeholder:text-white/35')).toEqual([]);
        // **画面幅の指定は見送らない**（その幅では常にその色になる）
        expect(unreadableTokens('text-white/50 md:text-white/20').length, "md: を見送っている").toBeGreaterThan(0);
        expect(unreadableTokens('sm:text-white/30').length).toBeGreaterThan(0);
        // `text-[11px]` は文字の大きさで色ではない（色と誤認して8件落とした）
        expect(unreadableTokens('text-[11px] text-white/50')).toEqual([]);
        expect(unreadableTokens('text-[#555555]').length, "任意の色を通している").toBeGreaterThan(0);
    });
});

// **1か所ずつ目印を書く形は、増えたぶんを守れない。**
// （実際、前の周は直したうちの10行しか守れていなかった）
// リポジトリ全体を1つの規則で見る: 黒地/白地の文字は 4.5:1 に届く濃さだけ。
// **アイコンと装飾は別基準**（WCAG 1.4.11 は 3:1、純粋な装飾は対象外）なので
// 免除の一覧を持つ——ここに足すときは「なぜ文字ではないか」を書くこと。
describe("app 全体: 読めない濃さの文字を新しく増やさない", () => {
    /**
     * 免除。`[ファイル, その行を見分ける印, 理由]`。
     * **印にはその行のクラス指定そのものを書く**（アイコン名だけだと、同じ
     * アイコンを使う別の行や `import` の行まで黙らせる）。
     * 比率は黒地での実測値（`scripts/audit-text-contrast.mjs` と同じ式）。
     */
    const EXEMPT: Array<[string, string, string]> = [
        // 純粋な装飾のアイコン（WCAG 1.4.11 の対象外。比率は参考）
        ["app/admin/page.tsx", 'PlusIcon className="w-8 h-8 text-white/30"', "追加の目印。隣に文字がある（2.46:1）"],
        ["app/components/MiniPlayer.tsx", 'MusicalNoteIcon className="w-4 h-4 text-white/30"', "アートワークが無いときの絵（2.46:1）"],
        ["app/components/MusicCard.tsx", 'MusicalNoteIcon className="w-6 h-6 text-white/30"', "同上（2.46:1）"],
        ["app/favorites/page.tsx", 'HeartIcon className="w-8 h-8 text-white/30"', "空のときの絵（2.46:1）"],
        ["app/user/drafts/page.tsx", 'PhotoIcon className="w-12 h-12 mx-auto mb-3 text-white/20"', "空のときの絵（1.66:1）"],
        ["app/user/profile/page.tsx", 'UserCircleIcon className="w-10 h-10 text-white/30"', "アバターが無いときの絵（2.46:1）"],
        ["app/user/profile/page.tsx", 'MagnifyingGlassIcon className="w-4 h-4 text-white/30 absolute', "入力欄の中の絵（2.46:1）"],
        ["app/user/upload/page.tsx", 'PhotoIcon className="w-10 h-10 text-white/40 mb-2"', "選ぶ前の絵（3.66:1）"],
        ["app/user/upload/page.tsx", 'UserCircleIcon className="w-10 h-10 text-white/40"', "アバターが無いときの絵（3.66:1）"],
        ["app/components/Thumb.tsx", '<svg className="w-8 h-8 text-white/40"', "画像を読めなかったときの絵（3.66:1）"],
        ["app/components/UserAvatar.tsx", "${iconClassName} text-white/40", "アバターが無いときの既定の絵（3.66:1）"],
        ["app/components/FilterBar.tsx", '"text-white/70 animate-pulse" : "text-white/35"', "入力欄の中の絵（3.01:1）"],
        ["app/users/search/page.tsx", "-translate-y-1/2 w-4 h-4 text-white/35", "入力欄の中の絵（3.01:1）"],
        // アイコンだけの操作。**非テキストの基準は 3:1**（1.4.11）なので /40 で足りる。
        // 文字と同じ /50 に上げると、控えめにしてある操作が目立ちすぎる
        // ——シャッフル・リピートは「切」の状態で、隣の送りボタン（/60）と
        // 見分けが付かなくなっていた（実際に一度上げてしまい、戻した）
        ["app/components/AddToHomeScreenHint.tsx", '"-m-1 p-1 text-white/40 hover:text-white/70"', "閉じる（3.66:1）"],
        ["app/components/CommentSection.tsx", "p-1 text-white/40 hover:text-red-400", "コメントを削除（3.66:1）"],
        ["app/components/MiniPlayer.tsx", '"text-fuchsia-300" : "text-white/40', "シャッフル・リピートの「切」（3.66:1）"],
        ["app/components/MiniPlayer.tsx", 'aria-label="閉じる" className="p-1.5 text-white/40', "閉じる（3.66:1）"],
        ["app/photo/[id]/PhotoPageClient.tsx", '"p-1.5 text-white/40 hover:text-white/70 active:scale-95', "MV を外す（3.66:1）"],
        ["app/user/profile/page.tsx", '"px-1.5 py-1 text-white/40 hover:text-red-400', "曲を削除（3.66:1）"],
        ["app/users/UserProfileClient.tsx", "bg-black/0 text-white/0", "hover で初めて出る覆い（既定は完全に透明）"],
        // **この走査は「黒地」を前提にしている。** 白い下地の上の文字は別
        ["app/components/PhotoMap.tsx", 'loc.className = "text-xs text-gray-600"', "地図のポップアップは白地（gray-600 で約 7.5:1）"],
    ];
    const isExempt = (file: string, line: string) =>
        EXEMPT.some(([f, marker]) => f === file && line.includes(marker));

    it("免除の一覧以外に、4.5:1 に届かない文字が無い", async () => {
        // `fs.globSync` は型定義に無い版があるので、自前で辿る
        const { readdirSync, statSync } = await import("node:fs");
        const files: string[] = [];
        const walk = (rel: string) => {
            for (const name of readdirSync(join(ROOT, rel))) {
                const child = rel ? `${rel}/${name}` : name;
                if (statSync(join(ROOT, child)).isDirectory()) { if (name !== "__tests__") walk(child); }
                else if (name.endsWith(".tsx")) files.push(child);
            }
        };
        walk("app");
        expect(files.length, "走査するファイルが見つからない").toBeGreaterThan(30);
        const bad: string[] = [];
        for (const rel of files) {
            // **コメントは先に消す。** 行頭だけを見ていたので、複数行の
            // `{/* … */}` の2行目以降が素のコードとして走査されていた
            // ——「以前は text-white/40 だった」と経緯を1行書くだけで落ちる
            // （app 配下に、除外されない継続行が197行あった）
            const src = stripComments(readFileSync(join(ROOT, rel), "utf8")).split("\n");
            src.forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
                if (isExempt(rel, line)) return;
                const tokens = unreadableTokens(line, true);
                if (tokens.length) bad.push(`${rel}:${i + 1} ${tokens.join(" ")}  ${line.trim().slice(0, 70)}`);
            });
        }
        expect(bad, `読めない濃さの文字が増えている:\n${bad.join("\n")}`).toEqual([]);
    });

    // **`import` の行で満たされない印にする。** アイコン名だけを印にしていたら、
    // 免除したい行を消しても `import { PhotoIcon }` が残っていて緑のままだった
    it("免除の一覧が古くなっていない（実在しない行を免除し続けない）", () => {
        for (const [file, marker, why] of EXEMPT) {
            const lines = readFileSync(join(ROOT, file), "utf8").split("\n")
                .filter((l) => !/^\s*import\b/.test(l) && l.includes(marker));
            expect(lines.length, `${file} に「${marker}」の行が無い（${why}）`).toBeGreaterThan(0);
        }
    });
});
