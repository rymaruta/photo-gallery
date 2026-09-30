import "@testing-library/jest-dom";

// バックエンドのモジュールは読み込み時に requireEnv() で必須の環境変数を確認する
// （未設定なら投げる＝本番へフォールバックしない）。テストでも値が要るので入れておく。
//
// 本番の名前はわざと使わない。もし何かの拍子にモックが外れて実際の AWS を
// 叩いてしまっても、存在しないテーブルに当たって失敗するようにしておく。
process.env.PHOTOS_TABLE ??= "test-photo-gallery-photos";
process.env.USERS_TABLE ??= "test-photo-gallery-users";
process.env.UPLOAD_BUCKET ??= "test-journey-photo-upload";
process.env.CLOUDFRONT_URL ??= "https://test.example.invalid";

// AWS の認証情報はテストから消す。
//
// 上と同じ考え方の続き。認証情報が残っていると、モックし忘れた
// 署名生成（getSignedUrl）が**手元でだけ成功する**。実際それで
// api-user の presign のテストが手元だけ通り、CI で
// CredentialsProviderError になって本番デプロイを止めた（386eeef）。
// 消しておけば、モックの外れたテストはどこでも同じ理由で落ちる。
for (const k of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
]) {
    delete process.env[k];
}
// 署名処理はリージョンが無いと別の理由で落ちるので、これだけは残す
// （リージョンは秘密ではない）。
process.env.AWS_REGION ??= "ap-northeast-1";

/**
 * **happy-dom を jsdom と同じ前提に揃える**（DOM のテストの既定は happy-dom・
 * `vitest.config.ts`）。揃えないと、テストが**黙って別のものを確かめる**:
 *
 * 1. **`matchMedia` を持たせない。** jsdom には無く、画面は「無ければスマホの形」に
 *    倒している（`NotificationsBell.tsx`・`MiniPlayer.tsx` など）。happy-dom は
 *    持っていて幅の既定が 1024 なので、`(min-width: 1024px)` が真になり、
 *    モックしていないテストが**PC の形を描く**ようになる（レビューで指摘）。
 *    テストが自分で `window.matchMedia` を置く場合はそちらが勝つ
 * 2. **フォーカスできない要素には `focus()` を効かせない。** happy-dom は
 *    `tabindex` の無い `div` にもフォーカスを入れる。jsdom は入れないので、
 *    本番で効かない `.focus()`（`tabIndex` の付け忘れ）をテストが見逃さなかった。
 *    判定は jsdom（HTML の「フォーカスできる領域」）に合わせる
 */
const happyWindow = typeof window !== "undefined"
    ? (window as unknown as { happyDOM?: unknown; matchMedia?: unknown; HTMLElement: typeof HTMLElement })
    : undefined;
if (happyWindow?.happyDOM !== undefined) {
    happyWindow.matchMedia = undefined;

    const focusable = (el: HTMLElement): boolean => {
        if (el.hasAttribute("tabindex")) return true;
        if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return true;
        switch (el.tagName) {
            case "A":
            case "AREA":
                return el.hasAttribute("href");
            case "INPUT":
                return (el as HTMLInputElement).type !== "hidden";
            case "BUTTON":
            case "SELECT":
            case "TEXTAREA":
            case "IFRAME":
            case "SUMMARY":
                return true;
            case "AUDIO":
            case "VIDEO":
                return el.hasAttribute("controls");
            default:
                return false;
        }
    };
    const proto = happyWindow.HTMLElement.prototype;
    const original = proto.focus;
    proto.focus = function (this: HTMLElement, options?: FocusOptions) {
        if (!focusable(this)) return;
        return original.call(this, options);
    };
}

/**
 * 🔴 **テストをまたいで漏れる `popstate` を、ここで受け取り切る。**
 *
 * `window.history.back()` は**非同期**——jsdom は `popstate` をあとのタスクで
 * 飛ばす。テストは**1つの history スタックを共有している**ので、あるテストが
 * 呼んだ `back()` の `popstate` は**次のテストの URL を巻き戻す**ことがある。
 *
 * 実際に記録した並び（`GalleryPageClient.scopeTabs.test.tsx`）:
 *
 *     BACK called  href=…/?photo=theirs   ← 前のテストがモーダルを閉じた
 *     --- TEST START href=…/
 *     --- SET href=…/?scope=following
 *     POPSTATE href=…/                    ← ここで巻き戻る
 *
 * 長いあいだ無害だった（画面が URL を一度しか読まなかったので、巻き戻っても
 * 表示は変わらない）。**`popstate` を購読する画面が出てきた今は効く**
 * ——`/?scope=following` で始めたテストが「新着」に落ちる。実測 **28回中9回**。
 *
 * **製品の欠陥ではない。** 実ブラウザでその `back()` が消すのは自分が積んだ
 * エントリだけで、別の画面には届かない。直すのは**テストが history を
 * 共有していること**の方。
 *
 * ## 置き場所が肝（2回間違えた）
 *
 *   - テストファイルの `afterEach` → **効かない**。vitest は後から登録した
 *     `afterEach` を先に走らせるので、そのあとの testing-library の cleanup が
 *     新しい `back()` を積む（実測 20回中11回 落ちたまま）
 *   - テストファイルの `beforeEach` で待つ → **足りない**（20回中8回／
 *     間隔を空けても 20回中1回）。**待ち時間の調整は「直した」ではない**
 *   - **setup ファイル**の `afterEach` → テストモジュールより**先に登録される**
 *     ので、逆順では**いちばん後**＝cleanup のあとに走る。ここが正しい
 *
 * ## ほぼ全部のテストでは1度も待たない
 *
 * `back()` / `forward()` / `go()` を呼んだ回数と `popstate` が届いた回数を
 * 数えて、**差がある間だけ**待つ。呼んでいないテスト（大多数）は素通り。
 */
if (typeof window !== "undefined") {
    let inFlight = 0;
    for (const m of ["back", "forward", "go"] as const) {
        const orig = window.history[m].bind(window.history);
        window.history[m] = ((...a: unknown[]) => {
            inFlight++;
            return (orig as (...x: unknown[]) => void)(...a);
        }) as typeof window.history.back;
    }
    // 同じ位置へ戻そうとした回は `popstate` が飛ばない。数が減らないまま
    // 次のテストを待たせ続けないよう、上限で必ず抜ける
    window.addEventListener("popstate", () => { if (inFlight > 0) inFlight--; });

    const { afterEach: afterEachHook } = await import("vitest");
    afterEachHook(async () => {
        for (let i = 0; i < 20 && inFlight > 0; i++) {
            await new Promise((r) => setTimeout(r, 0));
        }
        inFlight = 0;
    });
}
