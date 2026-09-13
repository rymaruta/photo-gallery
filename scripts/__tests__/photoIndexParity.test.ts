import { describe, it, expect } from "vitest";
import photos from "../../app/data/photos.json";
import index from "../../app/data/photo-index.json";

/**
 * **軽い索引（`photo-index.json`）が `photos.json` とずれていないこと。**
 *
 * `lib/routes.ts` は「ビルド時に個別ページができている写真／利用者の id」を
 * 知るためだけに `photos.json` を**丸ごと** import していた。JSON の
 * モジュールは項目単位で落とせないので、説明文も EXIF もぼかしも一緒に
 * クライアントへ載る。そして `lib/routes.ts` を読むのはヘッダーとフッター
 * ＝**全ページ**。
 *
 * 実測（`npx next build` の出力を数えた）:
 *
 *     写真の中身を含むチャンク      36.2KB（説明文30件・exif 27件）
 *     それを読み込む生成済みHTML     138 / 140 ページ
 *     索引だけにした場合             1.4KB
 *
 * **同じデータを2つのファイルに持つ形なので、ずれたら静かに壊れる**
 * （索引が古いと、個別ページは在るのにリンクが `/?photo=<id>` の控えに
 *  落ちる＝せっかく作った静的ページに誰も辿り着けない）。
 * 生成は `scripts/sync-photos-from-ddb.js` の**同じ書き込み**で行い、
 * ここで突き合わせる。台帳の型2「複製した規則は静かにずれる」。
 *
 * **開発専用の口（`app/api/**`）は `photos.json` を直接書き換える**
 * （3か所）。あちらを使って写真を足すと、このテストが落ちて
 * 「同期をやり直せ」と教える形になる——`app/api` はビルド時に退避される
 * ので本番には影響しない。**落ちたら `npm run build` の同期を流し直すこと。**
 */
type P = { id?: unknown; userId?: unknown; published?: unknown };
const rows = photos as P[];

describe("photo-index.json は photos.json と揃っている", () => {
    it("写真の id が全部入っている（順番も同じ）", () => {
        const expected = rows.map((p) => p.id).filter((id): id is string => typeof id === "string" && !!id);
        expect(index.photoIds, "索引が古い（新しい写真のリンクが控えに落ちる）").toEqual(expected);
    });

    it("利用者の id は「公開写真を持つ人」だけ（重複なし）", () => {
        const expected = [...new Set(rows
            .filter((p) => p.userId && p.published !== false)
            .map((p) => p.userId as string))];
        expect(index.userIds).toEqual(expected);
    });

    // **索引に写真の中身を入れない**（入れたら元の木阿弥）
    it("索引は id だけを持つ（説明文や EXIF を持たない）", () => {
        expect(Object.keys(index).sort()).toEqual(["photoIds", "userIds"]);
        const raw = JSON.stringify(index);
        for (const heavy of ["description", "exif", "blurDataURL", "thumbSrc", "src"]) {
            expect(raw, `索引に ${heavy} が入っている`).not.toContain(heavy);
        }
    });

    // **突き合わせが空回りしていないことを確かめる**（写真0件の環境だと
    // 両方 `[]` で必ず一致する＝何も検証していない状態になる）
    it("突き合わせる対象が実際にある", () => {
        expect(rows.length, "写真が0件で、上の比較が空回りしている").toBeGreaterThan(0);
        expect(index.photoIds.length).toBeGreaterThan(0);
    });
});

/**
 * **作る側（`buildIndex`）を直接見る。**
 *
 * 上の突き合わせは「実データと一致するか」しか見ないので、
 * **実データに無い形の規則は確かめられない**。実際、非公開の写真は
 * 公開30枚の中に1枚も無いので、`published !== false` のふるいを外しても
 * 上の4本は緑のままだった（変異で確認）。規則を守るのはこちら。
 */
describe("buildIndex（索引の作り方）", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildIndex } = require("../sync-photos-from-ddb.js") as {
        buildIndex: (photos: unknown[]) => { photoIds: string[]; userIds: string[] };
    };

    // **非公開の投稿者は `/users/<id>` を持たない。** 載せると、静的ページが
    // 無い URL へリンクして**ハード404**になる（`dynamicParams = false`）
    it("非公開しか持たない人は userIds に入れない", () => {
        const out = buildIndex([
            { id: "a", userId: "u1", published: true },
            { id: "b", userId: "u2", published: false },
        ]);
        expect(out.userIds, "非公開しか持たない人を載せている").toEqual(["u1"]);
    });

    // `published` 未指定は公開（このリポジトリ全体の慣習）
    it("published を書いていない写真は公開として数える", () => {
        expect(buildIndex([{ id: "a", userId: "u1" }]).userIds).toEqual(["u1"]);
    });

    // **写真の id は非公開も入れる。** `/photo/<id>` の静的生成は
    // `published !== false` で絞るが、ここを合わせると**非公開に戻した
    // 写真のリンクが控えに落ちて**、本人の画面から個別ページへ行けなくなる
    // ——`photos.json` 自体が公開ぶんしか持たないので、ここでは絞らない
    it("写真の id は photos.json の並びそのまま", () => {
        expect(buildIndex([{ id: "a" }, { id: "b" }]).photoIds).toEqual(["a", "b"]);
    });

    it("id を持たない行は落とす（壊れた行で崩れない）", () => {
        expect(buildIndex([{ id: "a" }, {}, { id: "" }, { id: 42 }]).photoIds).toEqual(["a"]);
    });

    it("同じ人の写真が複数あっても userIds は1つ", () => {
        expect(buildIndex([{ id: "a", userId: "u1" }, { id: "b", userId: "u1" }]).userIds).toEqual(["u1"]);
    });
});

/**
 * **写真が1枚も無い環境でも、サイトがビルドできること。**
 *
 * `lib/routes.ts` は `new Set(PHOTO_INDEX.photoIds)` で索引を読む。型を
 * 書かないと、索引が**空配列のとき** TypeScript が `Set<never>` と推論し、
 * `.has(id: string)` が型エラーになる——**`npm run build` が落ちる**。
 *
 * 実際に落ちた（staging の run 375）。staging の DynamoDB は空
 * （本番の写真はコピーしない方針）なので、ビルド時の同期で索引が空になり、
 * **staging のデプロイが必ず落ちる**状態だった。
 * **手元のコミット済み `photo-index.json` は写真を持っているので再現しない**
 * ——空の索引を置いて初めて出る。`vitest` は型を見ないので、
 * ここでは**実際に `tsc` を走らせて**確かめる。
 */
describe("写真が1枚も無くてもビルドできる", () => {
    it("索引が空でも型が通る", async () => {
        const { execFileSync } = await import("node:child_process");
        const { readFileSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const root = join(__dirname, "..", "..");
        const idx = join(root, "app", "data", "photo-index.json");
        const before = readFileSync(idx, "utf8");
        try {
            writeFileSync(idx, JSON.stringify({ photoIds: [], userIds: [] }));
            // 落ちれば例外になる（`tsc` は型エラーで終了コード 2）
            execFileSync("npx", ["tsc", "--noEmit"], { cwd: root, stdio: "pipe" });
        } finally {
            // **控えから必ず戻す。** 戻し損ねると、以降のテストが空の索引で走る
            writeFileSync(idx, before);
        }
        expect(readFileSync(idx, "utf8"), "索引を戻し損ねている").toBe(before);
    }, 180_000);
});
