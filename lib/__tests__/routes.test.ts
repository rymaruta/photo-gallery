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

// **判定した値と、返す値が違っていた。**
// URL のパーサは**オリジンを決めたあとにパスを正規化する**ので、
// `..` で先頭のセグメントを潰すと `//evil.example` が残る:
//
//     new URL("/..//evil.example", base).origin   → base（＝同一オリジンに見える）
//     new URL("/..//evil.example", base).pathname → "//evil.example"（スキーム相対）
//
// `safeNextPath` は判定を `raw` に、返すのを `pathname` にしていたので、
// **「同一オリジンだと確かめた値」ではなく「外部を指す値」を返していた**。
// `https://journey-photo.com/login?next=%2F..%2F%2Fevil.example` を踏ませる
// だけで外部へ飛ぶ（ログイン済みなら無操作、未ログインでもパスワードを
// 入れた直後）。正規ドメインのリンクなので、フィッシングの踏み台になる。
describe("safeNextPath: 正規化でスキーム相対に化ける形", () => {
    it.each([
        "/..//evil.example",
        // **ドット1個でも潰れる**。`..` だけを負例にしていると、
        // 再確認を `..`/`%2e` に絞る変異が通ってしまう（同じ穴が復活する）
        "/.//evil.example",
        "/./..//evil.example",
        "/../..//evil.example/pwn?a=1",
        "/photo/../..//evil.example",
        "/%2e%2e//evil.example",
        "/..\\\\evil.example",   // バックスラッシュ2つ（1つだと自サイトの `/evil.example` になるだけ）
        "/a/..//evil.example",
    ])("%s は通さない", (raw) => {
        expect(safeNextPath(raw)).toBeNull();
    });

    // **返した値をそのまま解決しても、外へ出ないこと。**
    // 「`//` で始まらない」のような一点狙いだと、次の言い回しで抜かれる
    it.each([
        "/photo/abc", "/", "/user/edit?id=1#x", "/photo/a/../b",
        "/..//evil.example", "/%2e%2e//evil.example", "//evil.example",
        "/\tevil", "/users?id=%2F%2Fevil",
    ])("%s: 返る値は必ずこのサイトの中を指す", (raw) => {
        const out = safeNextPath(raw);
        if (out === null) return;
        expect(new URL(out, "https://journey-photo.com").origin).toBe("https://journey-photo.com");
    });

    // 正常系: 普通のパスは今までどおり通る（塞ぎすぎない）
    it.each([
        ["/photo/abc", "/photo/abc"],
        ["/user/upload?from=share", "/user/upload?from=share"],
        ["/photo/a/../b", "/photo/b"],
        // **ハッシュも落とさない**（`+ u.hash` を消す変異が素通りしていた）
        ["/users?id=u1#top", "/users?id=u1#top"],
        ["/photo/abc#comments", "/photo/abc#comments"],
        // 日本語のスラッグ（`location.pathname` は既にエンコード済みで渡る）
        ["/location/%E4%BA%AC%E9%83%BD", "/location/%E4%BA%AC%E9%83%BD"],
    ])("%s は通す", (raw, expected) => {
        expect(safeNextPath(raw)).toBe(expected);
    });

    // **投げない。** `safeNextPath` は `/login` のコンポーネント本体から
    // 呼ばれるので、投げると**ログイン画面が描画ごと落ちる**。
    // 正規化したあとの値が URL として壊れている入力が実際にある
    it.each(["/../\\.", "/.\\\\@%2f\t", "/.\t\\/[@"])("%s は投げずに null", (raw) => {
        expect(() => safeNextPath(raw)).not.toThrow();
        expect(safeNextPath(raw)).toBeNull();
    });
});
