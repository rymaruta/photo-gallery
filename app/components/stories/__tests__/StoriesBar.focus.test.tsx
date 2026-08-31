import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 投稿プレビューは `fixed inset-0 z-[95]` の全画面で、裏にはストーリーの
// リングとギャラリーの写真リンクが全部ある。`aria-modal="true"` と言いながら
// Tab で外へ出られた（`aria-modal` を持つ8つのうち、ここと StoryViewer
// だけ管理が無かった）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

// 画像の縮小は canvas を使うので jsdom では通らない。
// ここは「保存に失敗したあとの後始末」を見るテストなので素通しにする。
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));

import StoriesBar from "../StoriesBar";
// **セレクタは実装から取る。** 写しをテストに書くと、フックの側から
// `video[controls]` を落としても items の並びが変わらず、穴が開いたことに
// 気づけない（実際に変異させて素通りした）。
import { FOCUSABLE } from "../../../../lib/hooks/useFocusTrap";

const KEY = "uploads/me/story.jpg";
const PUBLIC_URL = `https://cdn.example.com/${KEY}`;

/** presign と S3 の PUT を成功させる既定の応答（保存の結果は呼び出し側で差し替える） */
function api() {
    return (url: string) => {
        if (url === "/stories") {
            // 一覧の取得（GET）は空で返す
            return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
            });
        }
        if (url === "/user/profile") return Promise.resolve({ ok: true, json: async () => ({}) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
    };
}

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation(api());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

const tab = (shift = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey: shift });

/**
 * 動画の下書きは長さの判定に `<video>` の `loadedmetadata` を待つ。
 * jsdom はメディアを読まないので永久に来ない。`createElement("video")` だけ
 * 差し替えて、`src` を入れた時点で発火させる。
 */
function stubVideoMetadata(seconds = 5) {
    const real = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
        const el = real(tag, opts);
        if (tag === "video") {
            Object.defineProperty(el, "duration", { value: seconds, configurable: true });
            // **同期で発火させる。** `setTimeout` にしていた頃は、
            // フルスイートを並列で回すと `findByRole` の既定の待ち（1秒）を
            // 超えて**たまに落ちる**テストになっていた（単体では必ず通るので
            // 気づきにくい）。`getVideoDuration` は `onloadedmetadata` を
            // 代入してから `src` を入れるので、ここで直接呼んでよい。
            Object.defineProperty(el, "src", {
                configurable: true,
                set() { (el as HTMLVideoElement).onloadedmetadata?.(new Event("loadedmetadata")); },
                get() { return "blob:x"; },
            });
        }
        return el;
    });
    return () => spy.mockRestore();
}

/** ファイルを選んで下書きを開く（本番相当: hidden な input に change だけ飛ぶ） */
function selectFile(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
}

/** 「あなた」からファイルを選んで下書きを開く */
async function openDraft() {
    const { container } = render(
        <div>
            <button>裏のリンク</button>
            <StoriesBar />
        </div>,
    );
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "story.jpg", { type: "image/jpeg" }));
    return screen.findByRole("dialog");
}

/**
 * **中身も MP4 にする。** 動画は選んだ時点で `toUploadSafeVideo` を通る
 * （位置情報を落とす関門）ので、`new File(["x"], …)` のような中身では
 * 「解釈できない＝上げない」で弾かれ、下書きが開かない。
 * 最小の ISO-BMFF（ftyp + moov/mvhd + mdat）を渡す。
 */
function mp4Bytes(): number[] {
    const enc = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
    const box = (type: string, payload: number[] = []) => {
        const size = 8 + payload.length;
        return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...enc(type), ...payload];
    };
    return [
        ...box("ftyp", enc("isom")),
        ...box("moov", box("mvhd", new Array(8).fill(0))),
        ...box("mdat", new Array(16).fill(0x11)),
    ];
}

const videoFile = () => new File([Uint8Array.from(mp4Bytes())], "story.mp4", { type: "video/mp4" });

describe("ストーリーの投稿プレビュー: Tab が外へ漏れない", () => {
    // **前に「開いた瞬間の位置は主張できない」と書いたが、誤りだった。**
    // 「押せる要素は0で、容器に tabIndex=-1 が付く」と書いていたが、実際に
    // 測ると `tabindex` は付いておらず、フォーカスはちゃんとキャンセルに
    // 当たっている。file input に戻って見えたのは `userEvent.upload` の
    // 副作用で、本番の input は `hidden` なのでクリックでフォーカスされない。
    // 下の `fireEvent.change`（＝OS のダイアログから戻って change だけ飛ぶ
    // 本番相当）で測ると、フォーカスはキャンセルのまま。
    it("開いたらキャンセル（✕）にフォーカスが入る", async () => {
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        selectFile(container, new File(["x"], "story.jpg", { type: "image/jpeg" }));

        const dialog = await screen.findByRole("dialog");
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(screen.getByLabelText("キャンセル"));
    });

    // 動画の下書きでは `<video controls>` が容器の DOM 順の先頭に来る。
    // `video[controls]` を巡回に入れたので、指名しないと初期フォーカスが
    // そちらへ移る（＝画像と動画で挙動が変わる）。
    it("動画の下書きでも、最初のフォーカスはキャンセル", async () => {
        const restore = stubVideoMetadata();
        try {
            const { container } = render(<StoriesBar />);
            await screen.findByText("あなた");
            selectFile(container, videoFile());

            const dialog = await screen.findByRole("dialog");
            expect(dialog.querySelector("video")).not.toBeNull();
            expect(document.activeElement).toBe(screen.getByLabelText("キャンセル"));
        } finally {
            restore();
        }
    });

    // **動画を巡回から外すと、閉じ込めが穴になる。** 前向きには一周しても
    // 届かず（トラップを付ける前は文書を一周すれば届いた）、動画に
    // フォーカスがある状態の Shift+Tab はどの分岐にも当たらず外へ抜ける。
    it("動画も巡回に入る（一周しても届かない、にならない）", async () => {
        const restore = stubVideoMetadata();
        try {
            const { container } = render(<StoriesBar />);
            await screen.findByText("あなた");
            selectFile(container, videoFile());

            const dialog = await screen.findByRole("dialog");
            // **下書きが出そろうまで待つ。** `findByRole("dialog")` が返るのは
            // 容器が現れた時点で、閉じ込め（`useFocusTrap`）が `document` に
            // キー購読を付けるのはそのあと。待たずに Tab を投げると、
            // **まだ誰も聞いていないので `preventDefault` されない**
            // ——実測で10回中3回落ちていた（待ちを入れて 0/10）。
            // 実機では「ダイアログが出た同じティックに Tab を押す」ことは
            // できないので、これは試験側の競合。
            await screen.findByRole("button", { name: /ストーリーに投稿/ });
            const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
            // 巡回の先頭が動画であること＝閉じ込めの対象に入っている
            expect(items[0]?.tagName).toBe("VIDEO");

            // 末尾から Tab したとき、トラップが割り込む（既定の Tab を止める）。
            // **jsdom では `<video>` に focus() が効かない**ので「動画に
            // フォーカスが移った」までは見られない。見られるのは
            // 「外へ出さずに折り返そうとした」ところまで。
            items[items.length - 1].focus();
            const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
            document.dispatchEvent(ev);
            expect(ev.defaultPrevented, "末尾から既定の Tab がそのまま通っている").toBe(true);
        } finally {
            restore();
        }
    });

    it("裏のボタンにフォーカスを当てて Tab すると、中へ引き戻す", async () => {
        const dialog = await openDraft();
        screen.getByText("裏のリンク").focus();
        tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it("最後の要素から Tab すると中の先頭へ戻る", async () => {
        const dialog = await openDraft();
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        expect(items.length).toBeGreaterThan(1);
        items[items.length - 1].focus();
        tab();
        expect(document.activeElement).toBe(items[0]);
    });

    // 読み上げで「何のダイアログか」が分かるように（見出しと結ぶ）
    it("ダイアログに名前がある", async () => {
        const dialog = await openDraft();
        expect(dialog).toHaveAccessibleName("新しいストーリー");
    });
});
