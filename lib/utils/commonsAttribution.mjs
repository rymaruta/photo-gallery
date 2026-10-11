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
 * 決まった形の文から作者の名前を取る（取れたら、その名前と残りの文）。
 *   - Commons の英語の決まり文句「No machine-readable author provided. X assumed (based on copyright claims).」: 推定された名前
 *   - 「X from ja , the copyright holder of this work, hereby publishes it…」（権利者の宣言）: X
 * 🔴 日本語版の「…だと推定されます」と、作者のお願い文（「This Photo was taken by X . Feel free to use my photos…」
 * 「X You are free to use this picture …」）は**名前にしない**——#272 のレビューの判断どおり、名前ではない欄として扱う
 */
const NAME_FROM_PHRASE = [
    { re: /^\s*no machine-readable author provided\.\s*(.+?)\s+assumed\s*\(based on copyright claims\)\.?/i, keepRest: true },
    { re: /^\s*(.+?)\s+from\s+[a-z]{2,3}\s*,\s*the copyright holder of this work, hereby publishes it\b[\s\S]*$/i, keepRest: false },
];

/** ライセンスの名前（作者の欄の後ろに付くもの）。CC BY・CC0・GFDL */
const LICENSE_NAME = String.raw`(?:cc[-\s]?by(?:[-\s]?sa)?(?:[-\s]?\d(?:\.\d)?)?|cc[-\s]?zero|cc0|gfdl)`;
/**
 * 作者の欄の後ろのライセンスの文（「/ CC-BY-SA-4.0」「, Lizenz: CC-BY-SA 4.0 DE」「, License CC BY-SA」
 * 「/ CC BY 3.0 (DE)」「/ CC BY-SA 4.0 (via Wikimedia Commons)」）。ライセンスは画面が別に出すので重ねない。
 * ライセンスの後ろに短い添え（国・版・「via …」）しか無いときだけ（お願い文の続く長い欄は触らない）
 */
const TRAILING_LICENSE = new RegExp(
    String.raw`\s*[,/]\s*(?:(?:lizenz|license|licence)\s*:?\s*)?${LICENSE_NAME}(?![a-z])[\w\s.()-]{0,40}$`,
    "i",
);

/**
 * 作者の欄の飾りを落とす。名前そのものは作者の書いたまま（2026-10-03・2026-10-11 に規則を足した）
 *   - Wiki の「( talk )」「( talk | contribs )」「( talk · contribs )」「( トーク )」「（ 会話 ）」、閉じていない「( talk」
 *   - 前置きの「photo:」「Foto:」「撮影:」・「User:」「en:User:」「w:en:」（他の Wiki の利用者ページへのリンクの書き方）
 *   - Wiki の署名（「-- 名前 07:54, 23 February 2010 (UTC)」）の日時
 *   - Wiki のリンクの書き方（「[[User:|Patricia Santos]]」→ 見える字、「[//…/User:X X]」→ X）
 *   - 「No machine-readable author provided. X assumed (based on copyright claims).」→ X（`NAME_FROM_PHRASE`。
 *     日本語版の「…だと推定されます」と作者のお願い文は名前にしない＝#272 の判断どおり）
 *   - 「(The) original uploader was X at en.wikipedia」「… at English Wikipedia .」→ X
 *   - 後ろのライセンスの文（「/ CC-BY-SA-4.0」「, Lizenz: …」）。「©」は作者の求める表記なので残す
 *   - 「(This photo was) taken with <カメラ>」の後置き
 * 🔴 URL だけの欄（「https://www.flickr.com/photos/…/」）は**そのまま**残す。Flickr から移した写真で、
 * 作者を指す唯一の表記（CC BY 4.0 は作者の情報への URI での表示を認める）。名前を推し量って書き換えない
 * @param {string} author
 * @returns {string}
 */
export function cleanCommonsAuthor(author) {
    let a = String(author ?? "");
    for (const { re, keepRest } of NAME_FROM_PHRASE) {
        const m = re.exec(a);
        if (m) a = keepRest ? `${m[1]} ${a.slice(m[0].length)}` : m[1];
    }
    a = a
        // [[User:X|見える字]] → 見える字、[[User:X]] → X、[//url 見える字] → 見える字
        .replace(/\[\[([^\]|]*)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.replace(/^[^:]*:/, ""))
        .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, "$1")
        .replace(/[(（]\s*(talk|トーク|会話)(\s*[|·•/]\s*(contribs|contributions|投稿記録))?\s*[)）]/gi, " ")
        .replace(/\s*\(\s*talk\s*$/i, "")
        // 「FOTO:FORTEPAN / …」は Fortepan が求める表記そのものなので残す
        .replace(/^\s*(photo|photograph|foto|撮影)\s*[:：]\s*(?!fortepan\b)/i, "")
        .replace(/^\s*(the\s+)?original uploader was\s+(.+?)\s+at\s+(the\s+)?[\w.-]*\s*(language\s+)?wikipedia\s*\.?\s*$/i, "$2")
        .replace(/^\s*w\s*:\s*[a-z]{2,3}\s*:\s*/i, "")
        .replace(/(^|\/)\s*([a-z]{2,3}\s*:\s*)?user\s*:\s*/gi, (_, sep) => (sep ? "/ " : ""))
        // 署名の「-- 名前 07:54, 23 February 2010 (UTC)」「… 2020年11月21日 (土) 01:16 (UTC)」→ 名前
        .replace(/^\s*-{2,}\s+/, "")
        .replace(/\s+\d{1,2}:\d{2},\s*\d{1,2}\s+[a-z]+\s+\d{4}\s*\(utc\)\s*$/i, "")
        .replace(/\s+\d{4}年\d{1,2}月\d{1,2}日\s*[(（][^)）]*[)）]\s*\d{1,2}:\d{2}\s*\(utc\)\s*$/i, "")
        .replace(/\s+(this (photo|image|picture) was )?taken with\s.*$/i, "")
        .replace(TRAILING_LICENSE, "")
        .replace(/\s+/g, " ")
        .trim();
    return a;
}

/** 作者の欄に入る決まり文句・お願い文（名前ではないもの） */
const PLACEHOLDER_AUTHOR = new RegExp([
    "推定されます", "コンピュータが読み取れる", "投稿者自身", "自分で撮影", "作者不明", "^不明", "お願い",
    "own work", "unknown author", "^unknown$", "anonymous", "please", "feel free", "i would appreciate",
    "credit (me|its author)", "this (image|photo|picture) (is|was)", "you are free", "want to use this image",
    "wikimedia commons user", "\\((utc|est|cet)\\)", "^author$",
    // 2026-10-11: 「Unknown Unknown」「Unknown photographer」（名前の欄を「不明」で埋めたもの）
    "^(unknown\\s*)+$", "^unknown (photographer|creator)$", "no machine-readable author",
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
    if (a.length > MAX_AUTHOR_LENGTH) return true;
    return hasPlaceholderPhrase(a);
}

/**
 * **決まり文句・お願い文だけで名前ではない作者の欄か**（長さは見ない）。空も true。
 * 代表写真（人か AI 照合が1枚ずつ確かめた行）はこちらで見る——長いが正しい表記
 * （「Jean-Marc Rosier (de/from http://… + http://… )」）を長さだけで落とさない（2026-10-11）
 * @param {string} author 平文にして飾りを落としたもの
 * @returns {boolean}
 */
export function hasPlaceholderPhrase(author) {
    const a = String(author ?? "").trim();
    if (!a) return true;
    return PLACEHOLDER_AUTHOR.test(a);
}

/** 作者の欄が名前でないときに出す字（パブリックドメイン・CC0 だけ。CC BY 系は写真ごと出さない） */
export const UNKNOWN_AUTHOR_LABEL = "作者不明";

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
    // PD-Detroit（Detroit Publishing Co. の写真・アメリカでの出版年による）も同じ扱い（2026-10-11 レビュー）
    return /\bpd[-\s]?us(?![a-z])|\bpd[-\s]?usgov|\bpd[-\s]?detroit\b|public domain in the united states/i.test(`${license ?? ""} ${code ?? ""}`);
}

/**
 * **Flickr の Public Domain Mark を根拠にしたパブリックドメイン**（`PD-author-FlickrPDM`）。
 * Public Domain Mark は「権利が無いと思う」という印で、権利者の放棄（CC0）ではない。Flickr から
 * 直接の作例でも出していない（`toFlickrSample`）ので、Commons 経由でもそろえて出さない（2026-10-11 レビュー）
 */
export function isFlickrPdMark(license, code) {
    return /\bpd-author-flickrpdm\b/i.test(`${license ?? ""} ${code ?? ""}`);
}

/** 表示しないパブリックドメイン（アメリカだけ・Flickr の Public Domain Mark） */
export function isUnusablePublicDomain(license, code) {
    return isUsOnlyPublicDomain(license, code) || isFlickrPdMark(license, code);
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
    const nonUs = names.filter((t) => !isUnusablePublicDomain("", t));
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

/** CC・GFDL の**ライセンスのテンプレート**（部品の `Cc-by-layout`・`Cc-pd-mark-footer` などは含まない） */
const CC_BY_TEMPLATE = /^cc-by(-sa)?-(\d(?:\.\d)?)(?:-([a-z]{2,}))?$/i;
const OTHER_FREE_TEMPLATE = /^(cc-zero|cc0|gfdl(-[\w.]+)?)$/i;
/** 写真そのものの権利の欄がある印（美術品＋写真・自分で撮った写真） */
const PHOTO_MARK_TEMPLATE = /^(art photo|self-photographed|own photograph)$/i;

/**
 * **ページのテンプレートから、写真のライセンスを決める。**（2026-10-03・#278 のレビュー）
 *
 * extmetadata が "Public domain" でも、ページに CC BY・CC0・GFDL のテンプレートが**一緒に**付いて
 * いることがある。多くは「写っている美術品・文章が PD、写真そのものは CC BY」。これを PD として
 * 出すと、作者表示の要る写真を表示なしで使うことになる。
 *
 * - CC・GFDL が付いていない → `{ kind: "pd", code }`（code は `pdBasisOf`・無ければ undefined）
 * - 写真の欄がある印（Art Photo・Self-photographed・Own photograph）があり、CC BY（-SA）が1つだけで
 *   ほかの CC・GFDL が無い → **写真は CC BY**: `{ kind: "cc", license, licenseUrl, code }`
 *   （例: 桂浜の龍馬像の写真＝Art Photo＋Cc-by-3.0、プラハ城の展示＝Self-photographed＋Cc-by-3.0-de）
 * - それ以外（GFDL も付く・写真の印が無い・CC が2つ…）→ 決められない:
 *   `{ kind: "unknown", code: "mixed:…" }`。表示しない（例: 若狭の歌碑＝Self＋Cc-by-3.0＋GFDL で、
 *   作者の欄は歌の作者・野口雨情になっている）
 * @param {string[]} templates
 * @returns {{ kind: "pd", code?: string } | { kind: "cc", license: string, licenseUrl: string, code: string } | { kind: "unknown", code: string }}
 */
export function photoLicenseOf(templates) {
    const names = (templates ?? [])
        .map((t) => String(t ?? "").replace(/^template:/i, "").trim())
        .filter((t) => t && !t.includes("/"));
    const free = names.filter((t) => CC_BY_TEMPLATE.test(t) || OTHER_FREE_TEMPLATE.test(t));
    const pd = pdBasisOf(names);
    if (free.length === 0) return pd ? { kind: "pd", code: pd } : { kind: "pd" };
    const cc = free.filter((t) => CC_BY_TEMPLATE.test(t));
    if (free.length === 1 && cc.length === 1 && names.some((t) => PHOTO_MARK_TEMPLATE.test(t))) {
        const [, sa, ver, jur] = CC_BY_TEMPLATE.exec(cc[0]);
        return {
            kind: "cc",
            license: `CC BY${sa ? "-SA" : ""} ${ver}${jur ? ` ${jur.toLowerCase()}` : ""}`,
            licenseUrl: `https://creativecommons.org/licenses/by${sa ? "-sa" : ""}/${ver}/${jur ? `${jur.toLowerCase()}/` : ""}`,
            code: cc[0].toLowerCase(),
        };
    }
    return { kind: "unknown", code: `mixed:${[pd, ...free].filter(Boolean).join(",")}` };
}

/** 団体の名前らしい語（構造化データの creator の型を Organization にする） */
const ORGANIZATION_NAME = /\b(section|agency|government|museum|library|archives?|bureau|office|ministry|department|corporation|company|inc\.?|ltd\.?|association|society|university|army|navy|police|council|institute|foundation|commission|survey)\b|株式会社|有限会社|協会|大学|博物館|美術館|図書館|資料館|役所|役場|庁|省|局|委員会|財団|観光|組合/i;

/**
 * 作者が団体（組織）の名前か。分からないものは人として扱う
 * @param {string} name
 * @returns {boolean}
 */
export function isOrganizationName(name) {
    return ORGANIZATION_NAME.test(String(name ?? ""));
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
