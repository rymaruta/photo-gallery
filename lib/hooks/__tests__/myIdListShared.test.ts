import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * **「自分の一覧をサーバーから引く」処理を4つ目に写させない見張り。**
 *
 * サーバーは `likes#<uid>` / `saves#<uid>` / `spots#<uid>` を**同じ形の1行**
 * （新しい順のリスト＋`rev`）で持ち、書き込みの規則も
 * `api-user/src/userList.ts` 1つに寄せてある。引く側だけ増やすと、
 * 「まだ／聞けなかった／0件」の扱いが1つだけ直って静かにずれる。
 *
 * それを避けて `useMyPhotoIdList` を切り出したのに、**同じ回に書かれた
 * `useSavedSpots` が3つ目の写しとして残っていた**（切り出しに間に合わなかった）。
 * 人の目では見つからなかったので、見張りを置く。
 *
 * ## 何を見るか
 *
 * 取得の仕掛け（`new AbortController()` ＋ `userFetch`）を**自分で持って
 * いるフック**を数え、`useMyPhotoIdList` 以外に「自分の一覧」を引くものが
 * 現れたら落とす。落ちたら、写す前に共通部へ寄せられるか考えること
 * ——**寄せられない理由があるなら、下の免除に理由付きで足す**。
 */

const HOOKS_DIR = join(process.cwd(), "lib/hooks");

/**
 * 免除。**「自分の一覧」ではない取得**は共通部に寄せられない。
 *
 * | ファイル | なぜ寄せられないか |
 * |---|---|
 * | `useMyPhotoIdList` | 共通部そのもの |
 * | `useComments` | 写真ごとのコメント（他人のものも入る・ページ送りがある） |
 * | `useFollow` | フォローの状態（一覧ではなく1件の真偽） |
 * | `usePhotos` | 公開の写真一覧（認証が要らない） |
 * | `useSongSearch` / `useUserSearch` | 打った語で引く検索（一覧を持たない） |
 * | `useGallery` | 画面の状態（取得はしない） |
 * | `usePhotoLikes` / `usePhotoSave` | 1枚に対する押す口（一覧ではない） |
 * | `useMemberGate` | 権限の確認 |
 */
const EXEMPT = new Set([
    "useMyPhotoIdList.ts",
    "useComments.ts",
    "useFollow.ts",
    "usePhotos.ts",
    "useSongSearch.ts",
    "useUserSearch.ts",
    "useGallery.ts",
    "usePhotoLikes.ts",
    "usePhotoSave.ts",
    "useMemberGate.ts",
]);

describe("自分の一覧を引く処理は1つだけ", () => {
    const files = readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    it("見張りが本物のファイルを読めている（空振りで緑にならない）", () => {
        expect(files.length).toBeGreaterThan(10);
        expect(files).toContain("useMyPhotoIdList.ts");
        expect(files).toContain("useSavedSpots.ts");
    });

    it("`useMyPhotoIdList` 以外は取得の仕掛けを持たない", () => {
        const offenders = files.filter((f) => {
            if (EXEMPT.has(f)) return false;
            const src = readFileSync(join(HOOKS_DIR, f), "utf-8");
            return src.includes("new AbortController()") && src.includes("userFetch");
        });
        expect(offenders,
            "自分の一覧を引く処理を写している。`useMyPhotoIdList` の包みにするか、"
            + "寄せられない理由を EXEMPT に書いて足すこと").toEqual([]);
    });

    it("行きたい場所・保存・いいねは共通部の包み", () => {
        for (const f of ["useSavedSpots.ts", "useMySaves.ts", "useMyServerLikes.ts"]) {
            const src = readFileSync(join(HOOKS_DIR, f), "utf-8");
            expect(src, `${f} が共通部を使っていない`).toContain("useMyPhotoIdList");
        }
    });
});
