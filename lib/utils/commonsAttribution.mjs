// lib/utils/commonsAttribution.mjs
//
// **Wikimedia Commons の写真の「作者・ライセンス・人物」を読む規則。**（2026-10-03）
//
// 収集スクリプト（`scripts/collect-commons-samples.mjs`・Node でそのまま走る）と、
// 表示側（`lib/data/spotSamples.ts`）の**両方が同じこのファイルを読む**。規則を2か所に
// 持つと片方だけ直して静かにずれるので、TypeScript ではなく .mjs で1本にした
// （`tsconfig.json` の `allowJs` で型検査からも読める）。

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/**
 * 文字の実体参照をほどく。**1回だけ**（`&amp;lt;` は `&lt;` のまま＝二重にほどかない）。
 * 数字の参照（`&#12354;`・`&#x3042;`）も読む
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
    return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body) => {
        const lower = body.toLowerCase();
        if (lower.startsWith("#x")) {
            const n = Number.parseInt(lower.slice(2), 16);
            return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m;
        }
        if (lower.startsWith("#")) {
            const n = Number.parseInt(lower.slice(1), 10);
            return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m;
        }
        return NAMED_ENTITIES[lower] ?? m;
    });
}

/**
 * HTML を平文にする。タグを剥がし、実体参照を1回だけほどき、空白を畳む
 * @param {unknown} html
 * @returns {string}
 */
export function stripHtml(html) {
    return decodeEntities(String(html ?? "").replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * 作者の欄の飾りを落とす（Wiki の「( talk )」「( トーク )」、「photo:」「User:」の前置き、
 * 「(This photo was) taken with <カメラ>」の後置き）。名前そのものは作者の書いたまま
 * @param {string} author
 * @returns {string}
 */
export function cleanCommonsAuthor(author) {
    return String(author ?? "")
        .replace(/\(\s*(talk|トーク|会話)\s*\)/gi, " ")
        .replace(/^\s*(photo|photograph|撮影)\s*[:：]\s*/i, "")
        .replace(/^\s*user\s*:\s*/i, "")
        .replace(/\s+(this (photo|image|picture) was )?taken with\s.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** 作者の欄に入る決まり文句・お願い文（名前ではないもの） */
const PLACEHOLDER_AUTHOR = new RegExp([
    "推定されます", "コンピュータが読み取れる", "投稿者自身", "自分で撮影", "作者不明", "^不明", "お願い",
    "own work", "unknown author", "^unknown$", "anonymous", "please", "feel free", "i would appreciate",
    "credit (me|its author)", "this (image|photo|picture) (is|was)", "you are free", "want to use this image",
    "wikimedia commons user", "\\((utc|est|cet)\\)", "^author$",
].join("|"), "i");

/** 名前として長すぎる（説明やお願い文が混ざっている）とみなす長さ */
export const MAX_AUTHOR_LENGTH = 80;

/**
 * **名前ではない作者の欄か。** 決まり文句（「推定されます」「Own work」「投稿者自身」
 * 「Unknown author」「不明」…）・お願い文・署名の日時・長すぎるものは名前として使えない。
 * CC BY 系ではこれを「作者が無い」と扱い、写真ごと使わない
 * @param {string} author 平文にして飾りを落としたもの
 * @returns {boolean}
 */
export function isPlaceholderAuthor(author) {
    const a = String(author ?? "").trim();
    if (!a) return true;
    if (a.length > MAX_AUTHOR_LENGTH) return true;
    return PLACEHOLDER_AUTHOR.test(a);
}

/**
 * Commons の extmetadata から作者名を決める。**Attribution（作者が求める表記）→ Artist の順**。
 * Credit（「投稿者自身による著作物」などの出所の欄）には頼らない。
 * 名前として使えなければ空文字
 * @param {Record<string, { value?: unknown } | undefined>} meta
 * @returns {string}
 */
export function authorFromMeta(meta) {
    for (const key of ["Attribution", "Artist"]) {
        const a = cleanCommonsAuthor(stripHtml(meta?.[key]?.value));
        if (a && !isPlaceholderAuthor(a)) return a;
    }
    return "";
}

/**
 * **アメリカだけのパブリックドメイン**（PD-US 系）か。日本では保護期間内のことがあるので使わない
 * @param {string} license LicenseShortName
 * @param {string} [code] extmetadata の License（テンプレートの名前・例 "pd-us"）
 * @returns {boolean}
 */
export function isUsOnlyPublicDomain(license, code) {
    // 🔴 「PD-user」（投稿者が自分で放棄）を PD-US と取り違えない（`us` の後に字が続くものは別物）
    return /\bpd[-\s]?us(?![a-z])|\bpd[-\s]?usgov|public domain in the united states/i.test(`${license ?? ""} ${code ?? ""}`);
}

/**
 * パブリックドメインの**根拠のテンプレート**の名前を、ファイルのページが使うテンプレートの一覧から選ぶ。
 * （2026-10-03）
 *
 * Commons の extmetadata は、パブリックドメインならどの根拠でも `LicenseShortName` が
 * "Public domain"、`License` が "pd"、`UsageTerms` が "Public domain" になる（作例の 60 枚で実測）。
 * **これだけでは PD-US（アメリカでだけパブリックドメイン）と見分けられない**ので、
 * ページの `Template:PD-…` を見る。
 *
 * - 部品のテンプレート（`PD-Layout`・`PD-two`・`…-text`・`PD-old-auto-…` の中身・"/" の付く下位ページ）は根拠ではない
 * - 日本でも通る根拠（PD-self・PD-user・PD-author-…・PD-Japan…・PD-old…）が1つでもあれば、それを返す
 *   （例: `PD-Japan` と `PD-US-expired` の両方が付く古写真は、日本の根拠で使える）
 * - アメリカだけの根拠しか無ければ、それを返す（`isUsOnlyPublicDomain` が落とす）
 * - 根拠が見つからなければ undefined（表示しない）
 * @param {string[]} templates "Template:PD-self" または "PD-self"
 * @returns {string | undefined} 例 "PD-self"
 */
export function pdBasisOf(templates) {
    const names = (templates ?? [])
        // 転送の名前（"Pd-old"）も同じ根拠として "PD-" にそろえる
        .map((t) => String(t ?? "").replace(/^template:/i, "").trim().replace(/^pd-/i, "PD-"))
        .filter((t) => /^PD-/.test(t) && !t.includes("/"))
        .filter((t) => !/^pd-(layout|two)$|-text$|^pd-old-(x|auto)-|^pd-old-warning/i.test(t));
    const nonUs = names.filter((t) => !isUsOnlyPublicDomain("", t));
    const order = [/^pd-self$/i, /^pd-user/i, /^pd-author/i, /^pd-japan/i, /^pd-old/i];
    const rank = (t) => {
        const i = order.findIndex((re) => re.test(t));
        return i < 0 ? order.length : i;
    };
    const pick = (list) => [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
    return pick(nonUs) ?? pick(names);
}

/**
 * パブリックドメインの1枚について、**根拠のテンプレートの名前が分かっているか**。
 * extmetadata の総称（"pd"・空）では分からない＝PD-US かもしれない
 * @param {string} [code] 確定ファイルの licenseCode
 * @returns {boolean}
 */
export function hasPdBasis(code) {
    return /^pd-/i.test(String(code ?? "").trim());
}

/**
 * **人物の権利の印**（Restrictions・カテゴリの personality rights など）があるか
 * @param {string} text
 * @returns {boolean}
 */
export function hasPersonalityMark(text) {
    return /personality|肖像権|identifiable (person|people)|consent/i.test(String(text ?? ""));
}

/**
 * **人や催しが主役の写真**の語（ファイル名・題で見る）。撮影地の作例ではなく、
 * 写っている人の権利が絡みやすい。催しそのものが撮影地（祭りの行など）なら使わない
 */
// 「Festival Hall」「concert hall」は建物なので除く
export const EVENT_OR_PERSON = /\b(festival(?!\s+hall)|rallye|rally|marathon|parade|concert(?!\s+hall)|cosplay|cosplayer|portrait|wedding|matsuri|race|player|idol)\b|フェスティバル|マラソン|パレード|コンサート|コスプレ|ポートレート|結婚式|選手|ライブ|祭り|まつり/i;

/**
 * 撮影地そのものが催し（祭りなど）か。そうなら催しの写真こそが作例なので、上の語では落とさない
 * @param {{ name?: string; aliases?: string[]; category?: string }} spot
 * @returns {boolean}
 */
export function isEventSpot(spot) {
    if (spot?.category === "祭り") return true;
    return EVENT_OR_PERSON.test([spot?.name, ...(spot?.aliases ?? [])].filter(Boolean).join(" "))
        || /祭|くんち|ねぶた|ねぷた|フェスタ|festa/i.test(String(spot?.name ?? ""));
}

/** Commons があらかじめ作っておく縮小版の幅（任意の幅は作り置きが無い） */
export const STANDARD_THUMB_WIDTHS = [1280, 960, 500, 330, 250];

/**
 * **元画像の URL から、元より小さい標準の幅の縮小版の URL を作る。**
 * API は元画像が頼んだ幅（1280）以下だと元画像の URL を返す。元画像はこちらの意図より重く、
 * EXIF も丸ごと残るので、表示には必ず縮小版を使う。形が違えば undefined
 * @param {string} url `https://upload.wikimedia.org/wikipedia/commons/a/ab/Name.jpg`
 * @param {number} width 元の幅
 * @param {number} height 元の高さ
 * @returns {{ url: string; width: number; height: number } | undefined}
 */
export function standardThumbOf(url, width, height) {
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/.exec(String(url ?? "").split("?")[0]);
    if (!m || !(width > 0) || !(height > 0)) return undefined;
    const w = STANDARD_THUMB_WIDTHS.find((x) => x < width);
    if (!w) return undefined;
    return {
        url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${w}px-${m[2]}`,
        width: w,
        height: Math.round((height * w) / width),
    };
}
