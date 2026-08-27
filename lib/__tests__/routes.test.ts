import { describe, it, expect } from "vitest";
import { safeNextPath, loginWithNext, ROUTES } from "../routes";

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
