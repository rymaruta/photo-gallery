import { describe, it, expect } from "vitest";
import { ROUTES, safeNextPath, loginWithNext } from "../routes";
import PHOTOS_JSON from "@/app/data/photos.json";

const builtIds = (PHOTOS_JSON as Array<{ id: string }>).map((p) => p.id);

describe("ROUTES", () => {
    it("静的ルートが正しいパスを持つ", () => {
        expect(ROUTES.HOME).toBe("/");
        expect(ROUTES.FAVORITES).toBe("/favorites");
        expect(ROUTES.ADMIN).toBe("/admin");
        expect(ROUTES.LOGIN).toBe("/login");
        expect(ROUTES.UPLOAD).toBe("/user/upload");
        expect(ROUTES.PROFILE_EDIT).toBe("/user/profile");
    });

    it("ビルド時に存在する写真は /photo/:id を返す", () => {
        if (builtIds.length === 0) return; // photos.json が空の環境ではスキップ
        const id = builtIds[0];
        expect(ROUTES.PHOTO(id)).toBe(`/photo/${id}`);
    });

    it("ビルド後にアップロードされた（JSONにない）写真はモーダル表示のURLにフォールバックする", () => {
        const newId = "not-in-build-00000000-0000-0000-0000-000000000000";
        expect(builtIds).not.toContain(newId);
        expect(ROUTES.PHOTO(newId)).toBe(`/?photo=${newId}`);
    });

    it("フォールバックURLでは id が URL エンコードされる", () => {
        expect(ROUTES.PHOTO("a b/c")).toBe(`/?photo=${encodeURIComponent("a b/c")}`);
    });

    it("投稿があるユーザーは静的生成された /users/:id を返す", () => {
        const userIds = (PHOTOS_JSON as Array<{ userId?: string; published?: boolean }>)
            .filter((p) => p.userId && p.published !== false)
            .map((p) => p.userId as string);
        if (userIds.length === 0) return; // 投稿ユーザーがいない環境ではスキップ
        const id = userIds[0];
        expect(ROUTES.USER_PROFILE(id)).toBe(`/users/${encodeURIComponent(id)}`);
    });

    it("ビルド後に登録された新規ユーザーはクエリ版URLにフォールバックする", () => {
        const newUser = "new-user-00000000-0000-0000-0000-000000000000";
        expect(ROUTES.USER_PROFILE(newUser)).toBe(`/users?id=${newUser}`);
    });
});

// ログイン後の戻り先を URL から受け取る。**ここを緩めるとオープン
// リダイレクト**（`/login?next=https://evil.example` で外部へ飛ばす踏み台）
// になる。サイト内の絶対パスだけを通す。
describe("safeNextPath", () => {
    it.each([
        "/photo/abc",
        "/users?id=u1",
        "/user/edit?id=p1",
        "/",
    ])("サイト内のパスは通す: %s", (p) => {
        expect(safeNextPath(p)).toBe(p);
    });

    it.each([
        ["https://evil.example/x", "絶対URL"],
        ["http://evil.example", "絶対URL(http)"],
        ["//evil.example/x", "スキーム相対（外部へ出る）"],
        ["/\\evil.example", "ブラウザによっては // と同じに読まれる"],
        ["javascript:alert(1)", "スキーム"],
        ["photo/abc", "相対パス"],
        ["", "空"],
    ])("外へ出るものは弾く: %s（%s）", (raw) => {
        expect(safeNextPath(raw)).toBeNull();
    });

    it("文字列でなければ弾く", () => {
        expect(safeNextPath(undefined)).toBeNull();
        expect(safeNextPath(null)).toBeNull();
        expect(safeNextPath(123)).toBeNull();
    });
});

describe("loginWithNext", () => {
    it("戻り先を1回だけエンコードして添える", () => {
        expect(loginWithNext("/users?id=u1")).toBe(`${ROUTES.LOGIN}?next=${encodeURIComponent("/users?id=u1")}`);
    });

    it("通らない戻り先は添えない（素のログイン画面へ）", () => {
        expect(loginWithNext("https://evil.example")).toBe(ROUTES.LOGIN);
        expect(loginWithNext(null)).toBe(ROUTES.LOGIN);
    });
});

// **前方一致で "//" を弾くだけでは足りなかった。** URL のパーサはタブ・
// 改行・CR を解釈の前に取り除くので、`/<TAB>/evil.com` は `//evil.com` と
// 同じ意味になる。`/login?next=%2F%09%2Fevil.com` を踏ませるだけで外部へ
// 飛ばせた（ログイン済みなら無操作で発火する＝ログイン画面が踏み台になる）。
describe("safeNextPath: 制御文字によるオリジン抜け", () => {
    it.each([
        ["/\t/evil.com", "タブ"],
        ["/\n/evil.com", "改行"],
        ["/\r/evil.com", "CR"],
        ["/\t\\evil.com", "タブ＋バックスラッシュ"],
    ])("%s（%s）は弾く", (raw) => {
        expect(safeNextPath(raw)).toBeNull();
    });

    it("弾けているかは、実際に解決したオリジンで確かめる", () => {
        for (const raw of ["/\t/evil.com", "//evil.com", "/\\evil.com"]) {
            const out = safeNextPath(raw);
            // 通してしまった場合、それが外部オリジンに解決しないこと
            if (out !== null) {
                expect(new URL(out, "https://journey-photo.com").origin)
                    .toBe("https://journey-photo.com");
            }
        }
    });

    it("ふつうのパスは意味を変えずに通す", () => {
        expect(safeNextPath("/users?id=u1")).toBe("/users?id=u1");
        expect(safeNextPath("/tag/%E6%97%85")).toBe("/tag/%E6%97%85");
        expect(safeNextPath("/")).toBe("/");
    });
});
