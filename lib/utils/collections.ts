// lib/utils/collections.ts
// タグ / 場所 / カテゴリの集約（ランディング）ページ用の純関数ユーティリティ。
// fs や JSX を持たないため、サーバー・クライアント・テストのどこからでも読める。

import type { Photo } from "../data/photos";
import { dedupeCameraName } from "./cameraName";
import { sortByNewest } from "./photoOrder";
import { photoIsInLocation } from "./related";
import { stripLoneSurrogates } from "./text";

/**
 * 集約ページの種類。
 *
 * `camera` は 2026-09-09 に追加。**同じ機械に鍵を1つ挿すだけ**で、
 * sitemap・OGP・JSON-LD・404救済・相互リンクが丸ごと付いてくる。
 *
 * **数えて分かったこと**（公開30枚・2026-09-12 に本体の関数で実測）:
 *
 *     タグ    59種 → **8ページ**（3枚以上）
 *     撮影地  14種 → **7ページ**（2枚以上・`MIN_INDEXABLE_LOCATION`）
 *     カテゴリ 6種 → **3ページ**  機材 4種 → 2ページ
 *
 * 機材は SONY の2機種だけで公開30枚のうち24枚を覆う。
 *
 * **訂正**: ここに一度「撮影地は0ページ（全部 noindex）」と書いたが**誤り**。
 * 素朴な集計で数えて、この関数群を通していなかった。撮影地は
 * `photosInCollection` の**緩い一致**で既に束ねてある（下のコメント参照）。
 * **数えるときは必ずここの関数を通すこと。**
 */
export type CollectionType = "tag" | "location" | "category" | "camera";

/**
 * カテゴリの日本語表記を英語キーへ寄せる表。
 * 「風景」と「landscape」が別ページになると、同じ内容が2つのURLに分かれて
 * どちらも弱くなるため、集約ページを作る段階で1つにまとめる。
 * 表記ゆれ（建物→建築）もここで吸収する。
 */
export const CATEGORY_ALIASES: Record<string, string> = {
    "風景": "landscape",
    "自然": "nature",
    "建築": "architecture",
    "建物": "architecture",
    "街": "street",
    // **決まった選択肢（`CATEGORY_CHOICES`）に載せた語は、ここにも要る。**
    // 載せないと日本語のままスラッグになり（`/category/動物`）、同じものを
    // 指す綴りが増えたときに別ページへ割れる。実際 owner のデータには
    // 「ご飯」1枚があり、選択肢の「食べ物」を押すと**2ページに割れていた**。
    // **代表の表示名は先に書いた方**（建築／建物 → 建築 と同じ規則）なので、
    // 選択肢に出す語を先に置く。
    "人物": "people",
    "動物": "animal",
    "食べ物": "food",
    "ご飯": "food",
    "写真": "photography",
    "イラスト": "illustration",
    "デザイン": "design",
};

/**
 * **タグの決まった選択肢の別名表**（日本語 → 既にデータに在る英語スラッグ）。
 *
 * `CATEGORY_ALIASES` とは**別の表にする**。あちらに足すと
 * `collections.test.ts` が「別名表にある slug は `labels.category.names` にも
 * 要る」と要求する——`winter` は**カテゴリではない**のに、カテゴリの表示名の
 * 表に置くことになる。軸が違うものを同じ表に混ぜない。
 *
 * ⚠️ **この表は `TAG_CHOICES` と1対1で、それ以上には増やさない。**
 * 「別名表を私が毎回直す形」は一度断られている（`木/tree/trees`・
 * `白鳥/swan`…と際限なく増えて静かに古くなるため）。ここが違うのは
 * **決まった選択肢そのもの**だからで、選択肢が20語なら表も20語で止まる。
 * `tagChoices.test.ts` が**両方向**を見張る（選択肢に在って表に無い／
 * 表に在って選択肢に無い、のどちらでも落ちる）。
 *
 * 寄せ先を英語にしているのは、**既に英語で保存された写真と同じページに
 * なる**ため（実データ: `winter` 12枚・`sunset` 2枚・`forest` 2枚・
 * `snow`/`sea`/`mountain`/`lake`/`flowers`/`cherry`/`shrine`/`park` 各1枚）。
 * 見出しに出る文字は**いちばん多く使った生表記**（`pickRepresentative`）なので、
 * 選択肢から押した日本語が増えれば見出しは日本語に寄る。
 */
export const TAG_ALIASES: Record<string, string> = {
    "春": "spring", "夏": "summer", "秋": "autumn", "冬": "winter",
    "雪": "snow", "雨": "rain", "朝": "morning", "夜": "night", "夕焼け": "sunset",
    "海": "sea", "山": "mountain", "湖": "lake", "川": "river",
    "森": "forest", "空": "sky", "花": "flowers", "桜": "cherry", "紅葉": "autumn-leaves",
    "神社": "shrine", "公園": "park",
};

/**
 * カテゴリの表示名（スラッグ → 日本語）。`CATEGORY_ALIASES` の逆引きで、
 * 同じスラッグに複数の日本語が寄っていれば**表の先頭**（建築／建物 → 建築）。
 *
 * 集約ページの見出し・title・説明文は `labelForSlug`（最初に一致した写真の
 * 生の値）で決めていたので、`street` と書いた写真しか無いカテゴリは
 * 「streetの写真（1枚）」「streetカテゴリの旅写真」と英語スラッグが日本語文に
 * 混ざり、`landscape` は「風景」——**写真の並び順で見出しが変わる**状態だった
 * （実ビルドの `out/category/street.html` で確認）。写真ページ側は
 * `labels.category.names` で日本語にしているので、そちらと揃える
 * （表そのものは `app/i18n/labels.ts` と一致することをテストで縛る）。
 */
export function categoryDisplayName(slug: string): string | undefined {
    for (const [ja, alias] of Object.entries(CATEGORY_ALIASES)) {
        if (alias === slug) return ja;
    }
    return undefined;
}

/**
 * **保存されている生のカテゴリ値 → 画面に出す名前。**
 *
 * `app/i18n/labels.ts` の `category.names` は**スラッグで引く表**
 * （`architecture` → `建築`）。ところが写真ページは**生の値をそのまま鍵**に
 * していたので、別名で保存された写真だけ表に当たらず生のまま出ていた:
 *
 *     写真ページのチップ「建物」 → 飛び先 /category/architecture（見出し「建築の写真」）
 *     ほかの写真ページ「建築」   → 同じ先
 *     集約ページのチップ「建築6」 → 同じ先
 *
 * 実ビルドで数えて1ページ（実データは `建築`2 / `architecture`3 / **`建物`1**）。
 * **同じ場所を指すのに、そこだけ違う言葉**を出していた。
 * この関数の上にある `categoryDisplayName` のコメントは「写真ページ側は
 * `labels.category.names` で日本語にしているので、そちらと揃える」と書くが、
 * **別名で保存された値では揃っていなかった**。
 *
 * 表に無い値（`ご飯` など、別名表に載っていないカテゴリ）は生のまま返す。
 */
export function categoryLabel(raw: string | undefined, names: Record<string, string>): string {
    const v = (raw ?? "").trim();
    if (!v) return "";
    return names[slugify(v, "category")] ?? v;
}

/**
 * スラッグの長さ（バイト）の上限。
 *
 * **スラッグはファイル名になる。** 静的書き出しは `/location/<slug>` に対して
 * `out/location/<slug>.html` と `.next/server/app/location/<slug>.segments` を
 * 掘る。Linux のファイル名上限は **255 バイト**で、`.segments` の9バイトを
 * 引くと 246 バイトしか使えない。撮影地の上限は 200 **文字**なので、
 * 日本語（1文字3バイト）なら **83文字で超える**。
 *
 * 超えると `ENAMETOOLONG` で `next build` が落ちる——**誰か1人が保存した
 * 瞬間から、新しい写真も削除の反映も一切出せなくなる**（消えたページを
 * S3 から消す site-rebuild も同じビルドを通る）。下の `.` / `..` と同じ型で、
 * 実際に 83文字で落ち 82文字で通ることを確かめた。
 *
 * 余裕をみて 200 バイトで切る。切った結果が別の撮影地とぶつかることは
 * ありうるが、**ページが1つに混ざる**のと**サイト全体が出せない**のとでは
 * 後者の方がはるかに悪い。表示に使う値（`location` そのもの）は切らない。
 */
const MAX_SLUG_BYTES = 200;

/** UTF-8 のバイト数（`Buffer` も `TextEncoder` も使わない。この関数は画面からも読む） */
function utf8Len(codePoint: number): number {
    if (codePoint < 0x80) return 1;
    if (codePoint < 0x800) return 2;
    if (codePoint < 0x10000) return 3;
    return 4;
}

/** バイト数で切る。**文字の途中では切らない**（孤立サロゲートを作らない） */
function clampSlugBytes(s: string): string {
    let bytes = 0;
    for (const ch of s) bytes += utf8Len(ch.codePointAt(0)!);
    if (bytes <= MAX_SLUG_BYTES) return s;
    let out = "";
    bytes = 0;
    for (const ch of s) {
        const b = utf8Len(ch.codePointAt(0)!);
        if (bytes + b > MAX_SLUG_BYTES) break;
        out += ch;
        bytes += b;
    }
    // 切った先が区切りだと `旅行-` のような尻尾が残る
    return out.replace(/-+$/, "");
}

/**
 * 値を URL スラッグへ正規化する（小文字化・trim・空白をハイフンに）。
 * 日本語はそのまま（URLでは percent-encoded）。**長さで切る**（下の理由）。
 */
export function slugify(value: string, type?: CollectionType): string {
    const base = normalizeSlugChars(value);
    if (/^\.+$/.test(base)) return "";
    // **タグにも同じ別名表を当てる。** 実データで「風景3枚 / landscape 1枚」
    // 「ご飯1枚 / restaurant 3枚」「建物1枚 / architecture 2枚」のように、
    // **同じ主題が別々の写真に別の言語で付いて**2ページに割れていた。
    // どちらも 3枚（`MIN_INDEXABLE_COUNT`）に届かず**両方 noindex**になる形。
    // 寄せると3〜4枚になって検索に載る。
    //
    // **新しい表は作らない。** カテゴリで既に持っている表を使う
    // （表を増やすと、owner が育てないぶん静かに古くなる——別名表を
    //  「私が毎回直す」形は一度断られている）。
    //
    // 副産物として `tagKey` も寄るので、入力画面の候補チップ
    // （`collectOwnValues`）が畳まれて**選びやすくなる**。
    if ((type === "category" || type === "tag") && Object.hasOwn(CATEGORY_ALIASES, base)) return CATEGORY_ALIASES[base];
    // **タグだけの表**（決まった選択肢のぶん）。カテゴリには当てない
    // ——`winter` はカテゴリではないので、`/category/winter` を作らない
    if (type === "tag" && Object.hasOwn(TAG_ALIASES, base)) return TAG_ALIASES[base];
    const cut = clampSlugBytes(base);
    // **切った結果が `.` だけになることもある。** 上の判定は切る前の値を
    // 見ているので、`"...(250個)x"` は全ドットではない → 通過 → 切ると
    // 全部ドットになる。同じ守りを切ったあとにもう一度当てる。
    return /^\.+$/.test(cut) ? "" : cut;
}

/**
 * **比較のための正規化。長さで切らない。**
 *
 * `slugify` をそのまま比較に使ってはいけない——あちらはファイル名の上限に
 * 合わせて 200 バイトで切るので、**タイトル＋説明＋撮影地をつないだ長い
 * 文字列**に掛けると後ろが落ちる。実データ30件のうち16件は連結が 200 バイトを
 * 超え、**8件は撮影地がその外側**にある（`/location/<スラッグ>` を
 * `/?q=<スラッグ>` に振り替える404救済が、その8件で必ず0件になっていた）。
 *
 * 切ってよいのは「URL とファイル名になる値」だけ。比べるだけの経路はこちら。
 */
export function normalizeForSearch(value: string): string {
    return normalizeSlugChars(value);
}

/** `slugify` と `normalizeForSearch` が共有する、文字の正規化だけの部分 */
function normalizeSlugChars(value: string): string {
    const base = (value ?? "").toString().trim().toLowerCase()
        .replace(/\s+/g, "-")
        // **URL のパスに置けない文字を落とす。** タグ・撮影地・カテゴリは
        // 自由入力で、そのまま `/tag/<値>` のパス片になる。写真サイトでは
        // `F/2.8`・`24/70mm`・`白/黒`・`東京 / 渋谷`・`#旅` はごく普通の入力。
        //
        //  - `/` `\` … 静的書き出しはファイル名を `旅行%2F2024.html` と
        //    パーセントエンコードして保存するが、参照側（collectionPath）は
        //    1回だけエンコードするので `/tag/…%2F2024` になる。S3 は
        //    リクエストパスを1回デコードしてキーにするため、
        //    `tag/旅行/2024.html` を探して**永久に当たらない**。
        //    サイトマップにも canonical にもその 404 が載る。
        //  - `?` `#` … URL のクエリ・フラグメント区切り。同上。
        //  - `%` … 二重エンコードの入口。decodeURIComponent が化ける。
        .replace(/[/\\?#%]+/g, "-")
        // **制御文字も落とす。** `\u0000` が混じると、静的書き出しの
        // `mkdir` が `ERR_INVALID_ARG_VALUE: must be a string without null
        // bytes` で落ちる（`/` と同じく「パスに置けない文字」）。他の C0 も
        // URL とファイル名の両方で扱いが定まらない。`\s` に当たるのは
        // タブ・改行だけなので、上の空白の正規化では落ちきらない。
        .replace(/[\u0000-\u001F\u007F-\u009F]+/g, "-")
        // **孤立サロゲートも落とす。** 切り詰めが絵文字を割った値が保存されて
        // いると、`encodeURIComponent` がここで `URIError` を投げる。
        // 一度 collectionPath 側だけで掃除したが**それは誤りだった**——
        // ルート（generateStaticParams）は slugify の値をそのまま使うので、
        // **ページの実体が置かれる URL と、リンク・canonical・サイトマップの
        // URL が食い違う**（どこからもリンクの無いページと、0件の404 ができる）。
        // `/` や `%` を落としているのと同じ場所・同じ理由で落とす。
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : ""))
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    // **`.` と `..` は捨てる**（判定は呼び出し側の `slugify` が持つ）。
    // パス片としては「今のディレクトリ／親」の意味になり、Next の静的
    // 書き出しが `/location/..` を `/` に解決して「Requested and resolved
    // page mismatch」でビルドごと落ちる。誰か1人が保存した瞬間から
    // **新しい写真も削除の反映も一切出せなくなる**（消えたページを S3 から
    // 消す site-rebuild も同じビルドを通る）。
    return base;
}

/**
 * タグの同一性を見るキー。
 *
 * 表示は生のタグ（`Mount Fuji`・`#旅`）のままで、**比べるときだけ**
 * スラッグに寄せる。集約ページの404救済は `?tags=<スラッグ>` に振り替える
 * ので、生のタグとスラッグが同じ画面に並ぶ場面がある——そのとき完全一致で
 * 比べると、**同じタグのチップが2つ**出て、片方は件数0・もう片方は
 * 押しても選択が外れない、という形になる。
 *
 * `slugify` が空を返す値（`-` `###` `...`）は生の小文字に落とす。空のまま
 * 比べると別々のタグ同士が一致してしまうため（`3a0e3ce` で塞いだ穴）。
 */
export function tagKey(value: string | undefined): string {
    const raw = (value ?? "").toString().trim().toLowerCase();
    return slugify(raw, "tag") || raw;
}

/**
 * 検索エンジンに載せてよい最小の写真枚数（タグ・カテゴリ・機材）。
 * 写真1〜2枚＋定型文だけのページを大量に作ると「中身の薄いサイト」と
 * 判断されて全体の評価が下がる。人がサイト内から辿る分には見られる。
 * **撮影地だけは別の線**（`MIN_INDEXABLE_LOCATION`）。
 */
export const MIN_INDEXABLE_COUNT = 3;

/**
 * **撮影地だけは2枚から載せる。**
 *
 * 実データの `/location/*` は14ページ中10ページが2枚以下で、全部 noindex
 * だった——「高屋神社」「国営ひたち海浜公園」のような**具体語で1位を
 * 狙える唯一のページ**を、こちらから検索に出すなと言っている状態。
 * 「旅行 写真」のような語で30枚のサイトが勝てない以上、**勝てるのは
 * そこだけ**なので、3枚から2枚へ開ける（実測 4ページ → **7ページ**）。
 *
 * **1枚からにはしない（一度 1 にして戻した）。** 1枚の撮影地ページは、
 * **その写真の個別ページと中身が同じ**になる——写真ページの題は
 * `a2158892` 以降 `「天空の鳥居｜香川県 観音寺市 高屋神社」` と撮影地を
 * 含み、説明という**このサイトにしか無い文章**も持つ。集約ページの側は
 * 同じ1枚と定型文だけ。実データの1枚ページ7件すべてがこの形だった
 * （`バルセロナ` `フィンランド` `北海道` `大阪` `福岡` `国営ひたち海浜公園`
 *  `高屋神社`）。同じ語で自分の2ページを競わせて、弱い方も出している。
 *
 * **「ほかにこんな写真も」は枚数に数えない。** あれは他のページにも出る
 * 写真で、そのページ固有の中身ではない（数えると、`フィンランド` のように
 * 近い写真が0件のページまで載せることになる）。
 *
 * **タグ・カテゴリ・機材は3枚のまま。** あちらは一般語で、「winter の
 * 写真1枚」のページは世界中にありふれている——薄いページを量産する側に
 * 倒れる。撮影地は固有名詞で、そのページが持つ写真は**このサイトにしか
 * 無い**。ここが線引きの理由。
 *
 * **これは測定ではなく判断。** 数週間後に Search Console の
 * 「ページ」で、撮影地ページが登録されているか・除外されているかを見て
 * 見直すこと（owner が登録済みなので見られる）。
 */
export const MIN_INDEXABLE_LOCATION = 2;

/** そのページを検索エンジンに載せてよいか */
export function isIndexableCollection(count: number, type: CollectionType): boolean {
    return count >= (type === "location" ? MIN_INDEXABLE_LOCATION : MIN_INDEXABLE_COUNT);
}

/**
 * 統合前の旧スラッグのうち、実際に写真が使っているもの。
 *
 * カテゴリを統合すると、それまで公開していた `/category/風景` などが
 * 生成されなくなる。静的エクスポート + dynamicParams=false ではリダイレクトの
 * 層が無いためハード404になり、外部リンクや検索結果からの流入を落としてしまう。
 * 旧URLもページとして残し、canonical で統合後へ寄せる。
 */
export function legacyCategorySlugs(photos: Photo[]): string[] {
    return legacyAliasSlugs(photos, (p) => [p.category]);
}

/**
 * タグ側の旧スラッグ。**`/tag/風景` を残す。**
 *
 * カテゴリと同じ理由——統合すると `/tag/風景` が生成されなくなり、
 * 静的エクスポート（`dynamicParams=false`）ではリダイレクトの層が無いので
 * **ハード404**になる。外部リンクと、既に Google が持っている URL を
 * 落とすことになる（`sitemap.xml` は3枚未満を載せないので送信済みの
 * 50件には入っていないが、**内部リンクからクロールされている**）。
 */
export function legacyTagSlugs(photos: Photo[]): string[] {
    return legacyAliasSlugs(photos, (p) => p.tags ?? []);
}

/** 別名表で統合された「統合前の名前」のうち、実際に写真が使っているもの */
function legacyAliasSlugs(photos: Photo[], pick: (p: Photo) => readonly unknown[]): string[] {
    const out = new Set<string>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        for (const v of pick(p)) {
            // **`slugify` が別名表を引くときと同じ正規化で引く。**
            // ここだけ手書きの正規化にしていたので、`#風景` のように
            // `slugify` 側では落ちる文字を含む値が「旧URL」から漏れていた
            // （`slugify("#風景","tag")` は `landscape` を返すのに、
            //  こちらは `#風景` を表に引けず `/tag/風景` を生成しない
            //  ＝統合前に公開していた URL が**ハード404**になる）。
            const raw = normalizeSlugChars(typeof v === "string" ? v : "");
            // 別名表に載っていて、かつ統合後の名前と違うものだけが「旧URL」
            const canonical = CATEGORY_ALIASES[raw];
            if (canonical && canonical !== raw) out.add(raw);
        }
    }
    return [...out];
}

/** ルートパラメータ（既にデコード済みのことが多いが念のため）を安全にデコードして正規化 */
function normalizeParam(slug: string, type?: CollectionType): string {
    let s = slug ?? "";
    try {
        s = decodeURIComponent(s);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    return slugify(s, type);
}

/** 写真から、指定タイプの生の値（表示ラベル候補）を取り出す */
function valuesFor(p: Photo, type: CollectionType): string[] {
    if (type === "tag") {
        return (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
    }
    if (type === "location") {
        return p.location ? [p.location.toString().trim()].filter(Boolean) : [];
    }
    if (type === "camera") {
        // **`dedupeCameraName` を必ず通す。** 保存済みの値には二重のメーカー名が
        // 残っている（実データに "Hasselblad Hasselblad X2D II 100C"）。
        // 通さないと**同じ機種が2つに割れる**（片方は永久に1枚のまま noindex）。
        // `as` で握らない。`Photo["exif"]` は `camera?: string` と定義済みで、
        // 握ると**将来の改名を tsc が止めなくなる**（このコミットが
        // `CollectionPageClient` で潰したのと同じ型の穴を別の場所に作っていた）
        const camera = dedupeCameraName(p.exif?.camera);
        return camera ? [camera] : [];
    }
    // category
    return p.category ? [p.category.toString().trim()].filter(Boolean) : [];
}

const isPublished = (p: Photo) => p.published !== false;

/**
 * 代表の表記を決める共通の規則: **いちばん多く使われた生表記 → 同数なら文字順**。
 *
 * **一覧のチップと、飛んだ先の見出しは同じ字でなければならない。**
 * `/tag/architecture` には「建物」と「architecture」の両方の写真が入るので、
 * 「最初に当たった生表記」で決めると**写真の並び順で字が変わる**。
 * `photos.json` は `createdAt` 降順なので、**英語表記のタグを付けた写真を
 * 1枚投稿するだけで、インデックス済みページの H1 が変わる**
 * （実測: 正順「建物」／逆順「architecture」）。
 *
 * 一度 `labelForSlug` にだけこの規則を入れて `collectEntries` を置いてきた。
 * 結果、実データで**チップ「#自然」→ 飛んだ先「#nature の写真（4枚）」**と
 * **チップ「#建物」→「#architecture の写真（3枚）」**の2組が食い違っていた。
 * だから規則はここ1つに置き、両方から呼ぶ。
 *
 * 規則そのものは入力画面の候補チップ（`lib/utils/ownValues.ts`）と同形。
 */
function pickRepresentative(votes: Map<string, number>): string | undefined {
    if (votes.size === 0) return undefined;
    return [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** 集約エントリのラベル（カテゴリだけは日本語の表示名を優先する） */
function entryLabel(type: CollectionType, slug: string, votes: Map<string, number>): string {
    return (type === "category" && categoryDisplayName(slug)) || pickRepresentative(votes) || slug;
}

export type CollectionEntry = { slug: string; label: string; count: number };

/**
 * 全写真から、指定タイプの一意な集約エントリ（slug / 代表ラベル / 件数）を集める。
 * 同一写真内での重複はカウントしない。件数降順・slug 昇順で安定ソート。
 */
export function collectEntries(photos: Photo[], type: CollectionType): CollectionEntry[] {
    const bySlug = new Map<string, { votes: Map<string, number>; count: number }>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        const seen = new Set<string>();
        for (const v of valuesFor(p, type)) {
            const slug = slugify(v, type);
            if (!slug) continue;
            const cur = bySlug.get(slug) ?? { votes: new Map<string, number>(), count: 0 };
            // **表記の票は、畳む前に必ず数える。** `seen` の後ろに置くと、
            // 1枚の中で2通り書いた片方の票だけが入る（`ownValues.ts` が
            // 同じ場所で踏んで直した形）
            cur.votes.set(v, (cur.votes.get(v) ?? 0) + 1);
            // 件数は写真1枚につき1回だけ
            if (!seen.has(slug)) {
                seen.add(slug);
                cur.count++;
            }
            bySlug.set(slug, cur);
        }
    }
    // 撮影地の件数は photosInCollection と**同じ関数**で数える
    // （`photoIsInLocation`。向きも同じ）。
    // ここが1件ずつの加算だと、ページの見出し「（N枚）」と実際に並ぶ枚数、
    // そして noindex の判定（MIN_INDEXABLE_COUNT）が食い違う。
    if (type === "location") {
        return [...bySlug.entries()]
            .map(([slug, { votes }]) => {
                const label = entryLabel(type, slug, votes);
                return {
                    slug,
                    label,
                    count: photos.filter((p) => isPublished(p) && photoIsInLocation(p.location, label)).length,
                };
            })
            .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
    }
    return [...bySlug.entries()]
        .map(([slug, { votes, count }]) => ({ slug, label: entryLabel(type, slug, votes), count }))
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/**
 * 指定 slug に一致する（公開）写真を返す。
 *
 * **撮影地だけは包含で見る（`photoIsInLocation`）。**
 * ここが完全一致だったせいで、生成側と回遊リンクが食い違っていた:
 * 写真ページの「「パリ」の他の写真」は部分一致で3枚出るのに、そこから
 * 飛ぶ `/location/パリ` は**自分1枚**しか無い、という状態。
 * 実データ14件の撮影地は、完全一致だと**1つも 3枚に届かない**（当時は
 * 撮影地も3枚が線だったので、14ページすべてが noindex・サイトマップ0件
 * ——SEO のために作ったランディングが1枚も検索に出ていなかった）。
 *
 * 撮影地は「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」のように
 * 入れ子の書き方が混ざる。タグ・カテゴリは離散的なラベルなので完全一致のまま。
 *
 * **向きがある。** 一度 `sameLocation`（対称）を使っていたので、
 * **広い方の写真が狭いページに載っていた**——`/location/オペラ・ガルニエ（パリ）`
 * が、撮影地が「パリ」の写真を数えて2枚になり、`MIN_INDEXABLE_LOCATION = 2`
 * を通り抜けていた（1枚のページは載せない、と決めてあるのに）。
 * 詳しい実測は `photoIsInLocation` の説明に書いた。
 */
/**
 * その集約ページに載る写真。**新しい順に並べて返す。**
 *
 * 以前は並べ替えていなかったので、入力配列の順（＝`photos.json` の
 * `createdAt` 降順）がそのまま出ていた。ホームは `date || createdAt` で
 * 並べるので、**同じ絞り込みでも `/tag/風景` と `/?tags=風景` で順が違う**
 * ——実データ30枚のうち28枚が別の位置に来る。どちらも「新しい順」を
 * 名乗るので、利用者には「さっき上にあった写真が下にある」としか見えない。
 *
 * 並べ方を入力配列に任せないこと自体も要る: 呼び出し側（静的生成・
 * サイトマップ・関連ページ）が渡す配列の作り方が変わると、黙って順が変わる。
 */
export function photosInCollection(photos: Photo[], type: CollectionType, slug: string): Photo[] {
    const target = normalizeParam(slug, type);
    if (!target) return [];
    if (type === "location") {
        const label = labelForSlug(photos, "location", slug);
        return sortByNewest(photos.filter((p) => isPublished(p) && photoIsInLocation(p.location, label)));
    }
    return sortByNewest(photos.filter((p) => isPublished(p) && valuesFor(p, type).some((v) => slugify(v, type) === target)));
}

/** slug に対応する代表表示ラベル（`pickRepresentative` の規則）。無ければデコードした slug。 */
export function labelForSlug(photos: Photo[], type: CollectionType, slug: string): string {
    const target = normalizeParam(slug, type);
    // **日本語の表示名を当てるのはカテゴリだけ。タグには当てない。**
    //
    // 一度タグにも当てた（`/tag/architecture` が「#architecture の写真」と、
    // **日本語のサイトに英語スラッグ**を出していたため。カテゴリは
    // `d9f33cbf` で同じ理由から日本語へ寄せている）。**が、巻き戻した。**
    //
    // `/category/architecture` が既に「建築の写真」を名乗っているので、
    // タグも「建築」にすると**同じ名前のページが2つ**できる。しかも
    // `建物` と打った写真を、誰も打っていない「建築」という第3の語で
    // 呼ぶことになる。**カテゴリが日本語の呼び名を持ち、タグは打たれた
    // ままを見せる**、で役割が分かれているのが正しい。
    // 英語スラッグが見出しに出る件は、`title` を種別ごとに分けた
    // （`#architecture の写真` と `建築の写真`）ことで区別は付く。
    //
    // この判断は `collections.test.ts` の
    // 「タグ・撮影地には当てない（別名と同じ綴りでも生の値）」が守っている。
    if (type === "category") {
        const name = categoryDisplayName(target);
        if (name) return name;
    }
    // **「最初に当たった生表記」では決めない**（理由は `pickRepresentative`）。
    // 一覧のチップ（`collectEntries`）と同じ規則・同じ関数で決める。
    //
    // **数えるのは公開写真だけ。** `collectEntries` と `photosInCollection` は
    // どちらも `isPublished` で絞るので、ここだけ非公開の表記に票を持たせると
    // 「並んでいる写真のどれにも無い字」が見出しになりうる。
    const votes = new Map<string, number>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        for (const v of valuesFor(p, type)) {
            if (slugify(v, type) !== target) continue;
            votes.set(v, (votes.get(v) ?? 0) + 1);
        }
    }
    const rep = pickRepresentative(votes);
    if (rep) return rep;
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}

const TYPE_PATH: Record<CollectionType, string> = { tag: "tag", location: "location", category: "category", camera: "camera" };

/** 集約ページの相対 URL（/tag/<encoded slug> 等） */
export function collectionPath(type: CollectionType, slug: string): string {
    // slug は「素の値」でも「パーセントエンコード済み」でも来る
    // （ルートのパラメータは非ASCIIだとエンコードされた形で渡ってくる）。
    // そのまま encodeURIComponent すると % 自体が %25 になり、
    // /location/%25E6%259D%25B1%25E4%25BA%25AC のような**存在しないURL**を
    // canonical に出していた（検索エンジンには 404 を正規URLとして申告していた）。
    // 一度デコードしてから1回だけエンコードする。
    let raw = slug ?? "";
    try {
        raw = decodeURIComponent(raw);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    // **保険。** 掃除の本体は `slugify` にある（ルートとリンクが同じ値に
    // なるのはそちらのおかげ）。ここは slugify を通っていない値が渡ったとき
    // のためだけに残す——`encodeURIComponent` は孤立サロゲートで `URIError`
    // を投げ、静的ビルドではそれがビルドごと止める。
    let encoded;
    try {
        encoded = encodeURIComponent(raw);
    } catch {
        encoded = encodeURIComponent(stripLoneSurrogates(raw));
    }
    return `/${TYPE_PATH[type]}/${encoded}`;
}

/**
 * そのページの**正規URL**（旧カテゴリなら統合後を指す）。
 *
 * canonical と JSON-LD（ImageGallery の url・パンくず）が別々にURLを
 * 組んでいて、旧カテゴリで食い違っていた: `/category/風景` は
 * canonical が `/category/landscape` を指すのに、構造化データは
 * `/category/風景` を名乗る——「評価を統合後にまとめる」という目的に
 * 対して、構造化データが逆を言っていた。組み立てを1か所にする。
 */
export function canonicalCollectionPath(type: CollectionType, slug: string): string {
    // タグも別名表で統合するので、旧スラッグの canonical は統合後へ向ける
    const canonicalSlug = type === "category" || type === "tag" ? slugify(decodeURIComponentSafe(slug), type) : slug;
    return collectionPath(type, canonicalSlug);
}

export type CollectionCopy = { title: string; description: string; heading: string; breadcrumb: string };

/** ランディングページの見出し・メタ文言（日本語主体・ページ固有の導入文つき） */
export function collectionCopy(type: CollectionType, label: string, count: number): CollectionCopy {
    const kindJa = type === "tag" ? "タグ" : type === "location" ? "撮影地"
        : type === "camera" ? "カメラ" : "カテゴリ";
    const heading =
        type === "location" || type === "category" ? `${label}の写真`
            : type === "camera" ? `${label} で撮った写真`
                : `#${label} の写真`;
    // サイト名は app/layout.tsx の `template` が付ける（同上）。
    //
    // **見出しと同じ組み方にする。** 以前は種別に関係なく
    // `${label}の写真（N枚）` だったので、**`/tag/風景` と `/category/風景`
    // の `<title>` が枚数しか違わなかった**（実ビルドで確認。枚数が
    // 一致すれば完全に同じになる）。見出し（`heading`）は前から
    // 種別を出し分けているので、そちらに揃える:
    //
    //     タグ    #風景 の写真（4枚）
    //     カテゴリ 風景の写真（16枚）
    //     機材    SONY ILCE-7M3 で撮った写真（24枚）  ← 「…の写真」より自然
    //     撮影地   パリの写真（3枚）
    //
    // **別名の旧URL同士（`/tag/風景` と `/tag/landscape`）は同じままでよい**
    // ——あちらは canonical で統合後に寄せてある（同じページの別名なので、
    // 題が同じなのが正しい）。
    const title = `${heading}${count ? `（${count}枚）` : ""}`;
    const description =
        type === "camera"
            // 機材名で検索する人に向けた文。作例・設定（絞り・シャッター速度・ISO）が
            // このページの中身なので、それを名指しする
            ? `${label} で撮影した旅の写真${count ? `${count}枚` : ""}を掲載。絞り・シャッター速度・ISO・レンズ（EXIF）と撮影地つきで、実際の作例をまとめています。${label} の作例をお探しの方へ。`
            : type === "location"
            ? `${label}で撮影した旅の写真${count ? `${count}枚` : ""}を掲載。現地で切り取った風景やスナップを、撮影地・カメラ情報（EXIF）付きで紹介します。${label}への旅の参考にどうぞ。`
            : type === "category"
                ? `${label}カテゴリの旅写真${count ? `${count}枚` : ""}を掲載。国内外の旅先で撮影した${label}の作品を、撮影地やカメラ情報（EXIF）と合わせて閲覧できます。`
                : `「${label}」に関する旅の写真${count ? `${count}枚` : ""}を掲載。${label}のタグが付いた作品を、撮影地・カメラ情報（EXIF）付きでまとめています。`;
    return { title, description, heading, breadcrumb: `${kindJa}: ${label}` };
}

/**
 * 同タイプの他の集約エントリ（現在の slug を除く・件数順）。
 * ランディングページ同士の相互リンク（孤立防止・回遊）に使う。
 */
export function relatedEntries(photos: Photo[], type: CollectionType, slug: string, limit = 12): CollectionEntry[] {
    const current = slugify(decodeURIComponentSafe(slug), type);
    return collectEntries(photos, type)
        .filter((e) => e.slug !== current)
        .slice(0, limit);
}

function decodeURIComponentSafe(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}
