import { userFetch } from "../utils/api";
import { log } from "../utils/log";

/**
 * プッシュ通知の宛先（APNs の端末トークン）をサーバーに預ける・外す。
 *
 * **ネイティブの殻より先に置ける部分だけ**を切り出してある。Capacitor の
 * プラグインには一切触らないので、`ios/` ができる前に書いてテストできるし、
 * プラグインの API が変わってもここは動かない。ネイティブ側の仕事は
 * 「トークンを受け取って `registerPushToken` に渡す」だけ。
 *
 * サーバーは `api-user/src/devices.ts`。契約は `docs/ios-release-2026-09.md`。
 *
 * ## 呼ぶ場所
 *
 *   登録   プラグインが `registration` を出したとき（起動ごとに出る）
 *   解除   **ログアウトの `signOut()` より前**（`app/auth/context.tsx`）
 *
 * 🔴 **解除は `signOut()` の前。** `userFetch` は Cognito の ID トークンを
 * 付けるので、`signOut()` のあとでは「認証が必要です」で落ちる。後ろに
 * 置くと、**ログアウトしたのに宛先が残る**——次にその端末で別の人が
 * ログインするまで、前の人宛ての通知が届き続ける（サーバー側の
 * 持ち主の付け替えが救うのはそのログインの瞬間から）。
 *
 * ## 落ちても本筋を止めない
 *
 * どの関数も**投げない**。通知が届かないのは困るが、そのために
 * ログアウトが失敗する方がずっと困る。失敗は記録だけ残す。
 */

/**
 * 端末に覚えておく鍵。**ログアウトのときに「どの宛先を外すか」を知るため**
 * だけに使う。
 *
 * プラグインから取り直せるなら取り直す方が正しいが、ログアウトの瞬間に
 * プラグインへ聞けるとは限らない（権限を切られた・起動直後）。
 * **無くても壊れない**——読めなければ解除を飛ばすだけで、サーバー側の
 * 持ち主の付け替えが次のログインで拾う。
 */
const STORAGE_KEY = "jp_push_device_token";

/**
 * 宛先として受け付ける形。**サーバー（`isDeviceToken`）と対。**
 *
 * ずれると、画面は送ったつもりでサーバーが 400 を返す。突き合わせは
 * `scripts/__tests__/pushDeviceTokenParity.test.ts`（`STORY_REACTIONS` と同じ手）。
 */
export const DEVICE_TOKEN_RE = /^[0-9a-f]{32,200}$/i;

/**
 * 保存する形に揃える。**小文字に畳む。**
 *
 * 16進なので `AB…` と `ab…` は同じ端末だが、サーバーの集合（DynamoDB の Set）
 * では別のメンバーになる。サーバー側でも畳んでいるが、送る前に揃えておくと
 * 「登録した綴りと解除の綴りが違う」が起きない。
 */
export const normalizeToken = (v: string): string => v.trim().toLowerCase();

/** 宛先として送れる値か */
export function isValidDeviceToken(v: unknown): v is string {
    return typeof v === "string" && DEVICE_TOKEN_RE.test(v.trim());
}

/** 覚えている宛先（無ければ null）。localStorage が使えない環境でも投げない */
export function storedDeviceToken(): string | null {
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        return isValidDeviceToken(v) ? normalizeToken(v) : null;
    } catch {
        // プライベートウィンドウ・サイトデータを切っている・SSR
        return null;
    }
}

function remember(token: string): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, token);
    } catch {
        // 覚えられなくても登録そのものは済んでいる（解除を飛ばすだけ）
    }
}

function forget(): void {
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 同上 */
    }
}

/**
 * 覚えた印だけ捨てる（サーバーへは何も送らない）。
 *
 * **退会の経路のため。** サーバー側の宛先は `deleteAccount` が消すので
 * 外す必要は無いが、印を残すと**次にこの端末でログインした人**の
 * `registerPushToken` が「もう預けてある」と判断して送らない。
 */
export const forgetStoredDeviceToken = (): void => forget();

/**
 * 宛先を預ける。**成功したら覚える。**
 *
 * 起動ごとに呼ばれてよい（サーバーは Set に `ADD` するので、同じ宛先を
 * 二度登録しても増えない）。**同じ宛先を覚えているなら送らない**
 * ——起動のたびに1往復増やす意味が無い。
 *
 * @returns 送って 200 が返ったか。**覚えていて飛ばした回も true**
 *          （宛先は預かられている状態なので）
 */
export async function registerPushToken(raw: unknown): Promise<boolean> {
    if (!isValidDeviceToken(raw)) {
        log.warn("registerPushToken: 宛先の形が違うので送りません");
        return false;
    }
    const token = normalizeToken(raw);
    if (storedDeviceToken() === token) return true;
    try {
        const res = await userFetch("/user/devices", {
            method: "POST",
            body: JSON.stringify({ token }),
        });
        if (!res.ok) {
            log.warn("registerPushToken: 預けられませんでした", { status: res.status });
            return false;
        }
        remember(token);
        return true;
    } catch (e) {
        // 未ログイン・通信不能もここ（`userFetch` は投げる）
        log.warn("registerPushToken error:", e);
        return false;
    }
}

/**
 * 宛先を外す。**ログアウトの `signOut()` より前に呼ぶ**（冒頭の注記）。
 *
 * 引数を省くと覚えている宛先を使う。**覚えていなければ何もしない**
 * （ブラウザで開いているだけの人はここを通らない）。
 *
 * **覚えた印は、送信の成否に関わらず捨てる。** 残すと、次にこの端末で
 * 誰かがログインしたときに `registerPushToken` が「もう預けてある」と
 * 判断して送らない——実際には外れている（かもしれない）のに。
 */
export async function unregisterPushToken(raw?: unknown): Promise<boolean> {
    const candidate = raw === undefined ? storedDeviceToken() : raw;
    if (!isValidDeviceToken(candidate)) {
        forget();
        return false;
    }
    const token = normalizeToken(candidate);
    forget();
    try {
        const res = await userFetch("/user/devices", {
            method: "DELETE",
            body: JSON.stringify({ token }),
        });
        if (!res.ok) log.warn("unregisterPushToken: 外せませんでした", { status: res.status });
        return res.ok;
    } catch (e) {
        log.warn("unregisterPushToken error:", e);
        return false;
    }
}
