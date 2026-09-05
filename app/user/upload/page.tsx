"use client";

import React, { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useBottomBarHeight } from "../../../lib/hooks/useBottomBarHeight";
import { useRouter, useSearchParams } from "next/navigation";
import { PhotoIcon, XMarkIcon, UserCircleIcon, MapPinIcon, CalendarIcon, ChevronDownIcon, CheckCircleIcon, ExclamationTriangleIcon, CameraIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import AddToHomeScreenHint from "../../components/AddToHomeScreenHint";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { getCurrentSession } from "../../../lib/auth/cognito";
import { createThumbnail, toUploadSafeFile, UnstrippableFileError, extractDominantColor, createBlurPlaceholder, AVATAR_MAX_PX } from "../../../lib/utils/image";
import { extractExifFromFile, extractCameraExif, reverseGeocode } from "../../../lib/utils/exif";
import { readSharedResult, clearSharedPayload } from "../../../lib/utils/shareStore";
import { ROUTES } from "../../../lib/routes";
import { formatStoredDateTime } from "../../../lib/utils/photoDate";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import { userFacingUploadError, UPLOAD_FAILED_MESSAGE } from "./errorText";
import { unstrippableMessage, gifRejectedMessage, gifRejectedLabel } from "../../../lib/utils/uploadRejection";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import type { Photo, Locale } from "../../../lib/data/photos";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { collectOwnValues, appendTag, type OwnValues } from "../../../lib/utils/ownValues";

// 1人あたりのアップロード上限。**api-user/src/upload.ts の
// PHOTO_LIMIT_PER_USER と対**。片方だけ変えると、画面の残り枚数が嘘になる。
const PHOTO_LIMIT_PER_USER = 100;

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

type Status = "pending" | "uploading" | "done" | "error";

type Item = {
    id: string;
    file: File;
    preview: string;
    title: string;
    description: string;
    location: string;
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
    expanded: boolean;
    status: Status;
    progress: number;
    error?: string;
    // S3 へ上げ終わったが保存に失敗したときの置き場所。
    // 捨てて presign を取り直すと、再試行のたびに参照されない
    // オブジェクトが増える（どの削除経路も DynamoDB の項目からキーを
    // 引くので、項目の無いオブジェクトには永久に手が届かない）。
    uploaded?: { key: string; publicUrl: string; thumbUrl?: string };
};

/** 前回のサムネを使い回すときにアップロード処理を飛ばすための合図 */
class SkipThumb extends Error {}

function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// アップロード写真のプレビュー。写真全体を表示しつつ、ギャラリー一覧で
// 表示される「中央の正方形」を白枠で示し、枠外を暗くして
// "どこまで反映されるか" を明示する。
function CropPreview({ src, hint, locale }: { src: string; hint: string; locale: Locale }) {
    const imgRef = useRef<HTMLImageElement>(null);
    const [box, setBox] = useState<{ side: number; left: number; top: number } | null>(null);
    // **このブラウザで開けなかった写真**（PC の Chrome で選んだ HEIC など。
    // `addFiles` が断るのは「画像でない」「GIF」「50MB超」だけなので、
    // 種別が画像で開けないファイルはここまで来る）。
    // `block w-auto max-h-56` は高さを予約しないので、`onError` を持たない
    // 頃は**プレビューが高さ 0 に潰れ**（Chromium 実測 390x224 → 390x0）、
    // 切り抜きの白枠も出ないまま「公開」を押して初めて断られていた。
    // 文言は `unstrippableMessage` の「開けなかった」と同じものを使う
    // ——公開を押したときに出るのと同じ文にする（画面ごとに書き分けない）
    // 下ろす側は書かない——`src` は項目ごとに1回だけ作られ（`addFiles` の
    // `URL.createObjectURL`）、同じ instance で差し替わらない。念のため
    // 呼び出し側で `key={it.preview}` にしてあるので、変わったら作り直される。
    // 「入るたびに下ろす」の effect を足すと**踏まれない分岐**になり、
    // このリポジトリが避けている死にコードになる
    const [failed, setFailed] = useState(false);

    const measure = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        const side = Math.min(w, h);
        setBox({ side, left: (w - side) / 2, top: (h - side) / 2 });
    }, []);

    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    if (failed) {
        return (
            <div className="relative bg-black flex flex-col items-center justify-center gap-2 h-40 px-6 text-center text-white/60">
                <PhotoIcon className="w-8 h-8" />
                <p className="text-xs">{unstrippableMessage(new UnstrippableFileError("", "undecodable"), locale)}</p>
            </div>
        );
    }

    return (
        <div className="relative bg-black flex justify-center">
            <div className="relative inline-block overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    ref={imgRef}
                    src={src}
                    alt=""
                    onLoad={measure}
                    onError={() => setFailed(true)}
                    className="block w-auto max-h-56 max-w-full"
                    draggable={false}
                />
                {box && (
                    <div
                        className="absolute border-2 border-white/90 pointer-events-none"
                        style={{
                            width: box.side,
                            height: box.side,
                            left: box.left,
                            top: box.top,
                            // 枠外を暗くする（コンテナで overflow-hidden 済み）
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                        }}
                    >
                        <span className="absolute -top-px left-0 right-0 h-px bg-white/40" />
                    </div>
                )}
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 text-[11px] text-white/90 pointer-events-none whitespace-nowrap">
                {hint}
            </span>
        </div>
    );
}

// **サーバーの上限と同じ数字。** 入れないと、超えた分は保存時に黙って
// 切られる（保存は成功したように見えて、あとで開くと末尾が無い）。
// 説明とタグに入れていない理由は /user/edit と同じ——説明はサーバーが
// **段落ごと**に切り、タグはカンマ区切りの1入力で上限が**タグ1つあたり**
// なので、欄全体に上限を入れると「サーバーは受け付けるのに入力できない」に
// なる。
// **黙って切られる上限のうち、画面に出す先が無いもの。**
//
// **この画面は説明を必ず文字列で送る**（`description: item.description`）。
// `sanitizeDescription` は文字列を**全体2000字で切るだけ**で、段落数は
// 一切見ない——50段落の上限は `{ja:[],en:[]}` の形にしか効かない。
// 一度ここを取り違えて「50段落まで」と警告を出したが、この画面では
// **必ず誤報**だった（しかも本物の上限は野放しのままだった）。
//
// 入力は塞がない（塞ぐと「サーバーは受け付けるのに入力できない」に倒れる）。
// 値は `api-user/src/sanitize.ts` と対で、
// `scripts/__tests__/limitParity.test.ts` がずれを止める。
const TAGS_MAX = 30;
const DESC_STRING_MAX = 2000;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const CATEGORY_MAX = 100;

function UploadPageInner() {
    // 画面下の固定バーの実測値を CSS 変数に出す（MiniPlayer が読む）
    const bottomBarRef = useRef<HTMLDivElement | null>(null);
    useBottomBarHeight(bottomBarRef);
    const { isAuthenticated, isAdminUser, loading } = useAuth();
    const gate = useMemberGate();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const fromShare = searchParams?.get("from") === "share";

    const [items, setItems] = useState<Item[]>([]);
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [uploading, setUploading] = useState(false);
    // EXIF の読み取りと撮影地の逆引きが終わるまで公開させない。
    // これらは写真を選んだ後に非同期で入るので、すぐ「公開」を押すと
    // 撮影日・撮影地・座標が入る前の状態で保存されていた
    // （日付が無いと投稿日が使われ、年表の並びが狂う）。
    // 走っている EXIF/位置情報の解析の本数。真偽値だと、1回目の解析中に
    // 2回目の追加をしたとき、短い方の finally が先に false を書いてしまい、
    // まだ場所を引けていない写真のまま「公開」が押せた。
    const [metaJobs, setMetaJobs] = useState(0);
    const metaLoading = metaJobs > 0;
    const [fileError, setFileError] = useState<string | null>(null);
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // GPS からの撮影地自動入力（プライバシー配慮でオフにできる。設定は保持）
    //
    // **現在値は ref からも読めるようにしておく。** 取り込み処理（addFiles）が
    // state を直接見ていた頃、iOS の共有シート経由だけ設定が効かなかった:
    // 共有の effect は deps を絞ってあるので、**マウント時の addFiles を
    // 掴んだまま**呼ぶ。localStorage からの復元は effect なのでその後に走り、
    // 掴まれた addFiles の中では gpsAutofill が恒久的に true のままになる。
    // 漏れるのは逆ジオコーディングで得た地名だけだが、それは公開される。
    //
    // state を同期的に初期化する手もあるが、静的書き出し（SSR）では
    // localStorage が無く、サーバーとクライアントで初期値が食い違って
    // チェックボックスがハイドレーション不一致になる。ref なら描画に
    // 関わらないので、その副作用が無い。
    const [gpsAutofill, setGpsAutofill] = useState(true);
    const gpsAutofillRef = useRef(true);
    const applyGpsAutofill = useCallback((next: boolean) => {
        gpsAutofillRef.current = next;
        setGpsAutofill(next);
    }, []);
    useEffect(() => {
        const read = () => {
            try { applyGpsAutofill(localStorage.getItem("jp_gps_autofill") !== "0"); } catch { /* ignore */ }
        };
        read();
        // **別タブで切ったら、こちらでも切る。** 読むのがマウント時1回だけだと、
        // 「タブBで切ったのにタブAでは効かない」——タブAで写真を足すと
        // 逆ジオコーディングが走り、地名が入って公開される。トグルの見た目も
        // オンのままなので、切ったつもりの人には気づけない。
        const onStorage = (e: StorageEvent) => {
            if (e.key === null || e.key === "jp_gps_autofill") read();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [applyGpsAutofill]);
    const toggleGpsAutofill = useCallback(() => {
        const next = !gpsAutofillRef.current;
        let saved = true;
        try { localStorage.setItem("jp_gps_autofill", next ? "1" : "0"); } catch { saved = false; }
        // **この画面では効かせる**（切ったのに埋まる方が悪い）。ただし
        // 保存できていないことは言う——黙っていると、次に開いたときは
        // 既定のオンに戻り、**切ったつもりの人の写真から撮影地が入って
        // 公開される**（容量が足りない端末・プライベートモードで起きる）
        applyGpsAutofill(next);
        if (!saved && !next) {
            showToast(locale === "en"
                ? "Turned off for now, but this device can't remember it — check it again next time."
                : "今回はオフにしました。ただしこの端末に記憶できないので、次に開いたときは入り直します。", "error");
        }
    }, [applyGpsAutofill, showToast, locale]);

    // アンマウント時の Object URL 解放用に最新の items を ref で保持
    // （useEffect([]) のクロージャは初期の空配列しか見えないため）
    const itemsRef = useRef<Item[]>([]);
    itemsRef.current = items;

    /**
     * この画面を離れたか。**取り込みのループを止めるため**に要る。
     *
     * GPS→地名は Nominatim の 1req/s に合わせて1件ずつ 1.1 秒空けて回す。
     * 画面を離れても誰も止めないので、30枚なら**離れたあと約35秒**、
     * 見てもいない画面のために問い合わせ続けていた（書き込み先の `setItems`
     * はもう無いので、戻ってきても撮影地は空のまま＝全部無駄）。
     * 相手は 1req/s で運用されている公共のサービスなので、無駄な連投は
     * こちらの都合だけの話ではない。
     */
    const leftPageRef = useRef(false);

    useEffect(() => {
        // **入るたびに下ろす。** 立てるだけだと、効果が付け直される場面
        // （StrictMode の「setup → cleanup → setup」、Fast Refresh）で
        // **立ちっぱなし**になる。ref はインスタンスに残るので、以後の
        // 取り込みは初回からループ先頭で break——`npm run dev` では
        // 撮影地の自動入力が丸ごと死ぬ（本番ビルドでは二重実行は
        // 起きないが、開発で機能が死ぬと次の回帰が見えなくなる）。
        leftPageRef.current = false;
        return () => {
            leftPageRef.current = true;
            if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
            itemsRef.current.forEach((it) => { try { URL.revokeObjectURL(it.preview); } catch { /* ignore */ } });
        };
    }, []);

    /**
     * 残りアップロード可能枚数。**上限に当たるまで見えなかった。**
     * 100枚の上限（api-user/src/upload.ts の PHOTO_LIMIT_PER_USER）は
     * 押して初めて 403 で伝わり、しかも数え上げ失敗の 503 と文言が違うだけで、
     * 利用者には「上限なのか障害なのか」も分からなかった。
     *
     * 数え方はサーバーと同じ（/user/photos は listMyPhotos ＝ 下書きを含み
     * ストーリーを除く）。取れなければ**何も出さない**——推測した数字を
     * 見せる方が悪い。
     */
    const [usedSlots, setUsedSlots] = useState<number | null>(null);
    /**
     * 自分がこれまでに使った撮影地・カテゴリ・タグ。
     * **候補が出ないせいで、同じ場所が別々の名前に散っていた**
     * （「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」…）。
     * datalist で「前に何と書いたか」を出す。選ばずに自由入力もできる。
     */
    const [ownValues, setOwnValues] = useState<OwnValues>({ locations: [], categories: [], tags: [] });
    useEffect(() => {
        if (loading || !isAuthenticated) return;
        let aborted = false;
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch("/user/photos");
                if (!res.ok) return;
                // 読めない行は落とす。`collectOwnValues` は `for...of` で回すので
                // 1件の `null` で投げ、`catch {}` が握って**入力候補が出なく
                // なる**（残り枚数は `setUsedSlots` が先にあるので出る。
                // 一度「残り枚数ごと消える」と書いたが誤りだった）
                const raw = await res.json();
                const all = usablePhotoRows<Photo>(raw, "GET /user/photos");
                if (aborted || !all) return;
                // **枠はサーバーの数え方に合わせる。** `countUserPhotos` は
                // `Select: "COUNT"` で、`id` の無い行も**上限に数える**。
                // ふるいを通したあとの件数で表示すると、「あと3枚」と出て
                // いるのに 403 になる（同じ上限を片方だけ守る、の型）。
                // 表示から落とすのと、枠を数えるのは別。
                // `Array.isArray(raw)` はここだけの門。`usablePhotoRows` が
                // 配列以外に null を返さなくなったときに `.length` が
                // undefined になり「あと NaN 枚」と出るのを止める
                // （壊れるなら出ない方へ倒す）。
                // **守れるのは数字だけ**——そのとき `collectOwnValues` は
                // `for...of` で投げ、下の `catch {}` が握るので候補は
                // どのみち出ない（反復できる非配列を返すようになった場合
                // だけ、候補も生き残る）。それでも門をこちらに寄せるのは、
                // 「あと NaN 枚」を出さない責任がこの行にしか無いから
                if (Array.isArray(raw)) setUsedSlots(raw.length);
                // 同じ取得から入力候補も作る（追加の往復はしない）
                setOwnValues(collectOwnValues(all));
            } catch { /* 出さないだけ。アップロード自体は止めない */ }
        })();
        return () => { aborted = true; };
    }, [isAuthenticated, loading]);
    // 管理者は上限の対象外（サーバーも isAdmin を見て免除している）
    const remainingSlots = isAdminUser || usedSlots === null
        ? null
        : Math.max(0, PHOTO_LIMIT_PER_USER - usedSlots);

    // PWA Share Target で渡された写真の取り込み。
    // ログインリダイレクトで ?from=share が失われても、IndexedDB に残った
    // 新しいペイロード（1時間以内）は次回のページ表示時に取り込む。
    const shareImportedRef = useRef(false);
    useEffect(() => {
        if (loading || !isAuthenticated || shareImportedRef.current) return;
        shareImportedRef.current = true;
        void (async () => {
            const res = await readSharedResult();
            // **受け皿を開けなかったときは黙らない。** 共有シートから送ると
            // Service Worker がここへ飛ばすので、利用者は「送ったのに写真が
            // 入っていない」画面を見る。IndexedDB が使えない端末
            // （プライベートモード・ストレージ拒否）では毎回これになる。
            // **`?from=share` で来たときだけ**言う——取り込んだ後に
            // リロードすると受け皿は空なので、それを失敗と呼ばない
            if (!res.ok) {
                if (fromShare) {
                    showToast(locale === "en"
                        ? "Couldn't read the shared photos on this device. Please pick them from the button below."
                        : "共有された写真をこの端末から読み取れませんでした。下のボタンから選んでください。", "error");
                }
                return;
            }
            const payload = res.payload;
            if (!payload) return;
            // 空のペイロード（共有シートがファイル無しで来た）も捨てる。
            // 残すと IndexedDB に居座り続ける（他の分岐は必ず消している）。
            if (payload.files.length === 0) {
                await clearSharedPayload();
                return;
            }
            const isFresh = Date.now() - payload.t < 60 * 60 * 1000;
            if (!fromShare && !isFresh) {
                await clearSharedPayload();
                return;
            }
            await addFiles(payload.files, { title: payload.title, text: payload.text });
            await clearSharedPayload();
            showToast(locale === "en" ? `${payload.files.length} photo(s) imported` : `${payload.files.length} 枚を取り込みました`, "success");
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromShare, loading, isAuthenticated]);

    // プロフィール写真
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarCacheBust, setAvatarCacheBust] = useState(Date.now());

    useEffect(() => {
        getCurrentSession().then((session) => {
            const sub = session?.getIdToken()?.payload?.sub as string | undefined;
            if (sub) setCurrentUserId(sub);
        }).catch(() => { /* ignore */ });
    }, []);

    const addFiles = useCallback(async (files: File[], shared?: { title?: string; text?: string }) => {
        setFileError(null);

        const accepted: File[] = [];
        // 弾いたファイルは黙って捨てない。
        // 以前は画像以外を無言で continue していたので、HEIC が読めない端末や
        // 動画を選んだときに「何も起きない」ように見えた（原因が分からない）。
        // 理由ごとに分けて集める。**別々に setFileError していた頃は、
        // あとから出した非画像の警告が「50MBを超える」を上書きしていた**
        // ——落ちた枚数が伝わらず、利用者は「なぜか1枚少ない」まま公開する。
        const notImage: string[] = [];
        const tooLarge: string[] = [];
        // **GIF はここで断る。** 受け口は `accept="image/*"` なので選べるが、
        // `toUploadSafeFile` は GIF を必ず `UnstrippableFileError` にする
        // （アニメーションを保つため再エンコードせず、バイト除去は JPEG だけ）。
        // これまでは**プレビューを見てタイトルまで書いたあと、公開を押して
        // 初めて必ず失敗**していた。断るなら選んだ時点で断る。
        const cannotStrip: string[] = [];
        for (const f of files) {
            if (!f.type.startsWith("image/")) {
                notImage.push(f.name);
                continue;
            }
            if (f.type === "image/gif") {
                cannotStrip.push(f.name);
                continue;
            }
            if (f.size > 50 * 1024 * 1024) {
                tooLarge.push(f.name);
                continue;
            }
            accepted.push(f);
        }
        // 1件ずつ出すと連打になるのでまとめて1つ。理由が2つあれば両方並べる。
        const names = (list: string[]) =>
            list.slice(0, 3).join(locale === "en" ? ", " : "、")
            + (list.length > 3 ? (locale === "en" ? ` and ${list.length - 3} more` : ` ほか${list.length - 3}件`) : "");
        const reasons: string[] = [];
        if (tooLarge.length > 0) {
            reasons.push(locale === "en"
                ? `over 50MB: ${names(tooLarge)}`
                : `50MBを超える: ${names(tooLarge)}`);
        }
        if (notImage.length > 0) {
            reasons.push(locale === "en"
                ? `not an image: ${names(notImage)}`
                : `画像ではない: ${names(notImage)}`);
        }
        if (cannotStrip.length > 0) {
            reasons.push(`${gifRejectedLabel(locale)}: ${names(cannotStrip)}`);
        }
        if (reasons.length > 0) {
            // **理由を足したら、ここも足す。** 数え漏らすと
            // 「0件をスキップしました（GIF は…: cat.gif）」になる
            // ——すぐ上のコメントが書いている「落ちた枚数が伝わらない」に戻る
            const skipped = tooLarge.length + notImage.length + cannotStrip.length;
            setFileError(locale === "en"
                ? `Skipped ${skipped} file(s) — ${reasons.join(" / ")}`
                : `${skipped}件をスキップしました（${reasons.join(" / ")}）`);
        }
        if (accepted.length === 0) return;

        // 共有シート経由のタイトルは単一ファイルのときのみ適用、テキストは全ファイルの説明に適用
        const sharedTitle = shared?.title?.trim() && accepted.length === 1 ? shared.title.trim() : "";
        const sharedText = shared?.text?.trim() ?? "";

        const newItems: Item[] = accepted.map((file) => ({
            id: makeId(),
            file,
            preview: URL.createObjectURL(file),
            title: sharedTitle,
            description: sharedText,
            location: "",
            expanded: false,
            status: "pending",
            progress: 0,
        }));
        setItems((prev) => [...prev, ...newItems]);

        // EXIF を順次抽出（並列）。GPS リバースジオコードはレート制限のため直列。
        //
        // 真偽値ではなく本数で持つ。1回目の解析中に2回目の追加をすると、
        // 短い方の finally が先に false を書いて「公開」が押せるようになり、
        // まだ場所を引けていない写真が location 無しで保存されていた。
        setMetaJobs((n) => n + 1);
        try {
        const exifResults = await Promise.all(
            newItems.map(async (it) => ({ id: it.id, meta: await extractExifFromFile(it.file) }))
        );
        setItems((prev) => prev.map((it) => {
            const found = exifResults.find((r) => r.id === it.id);
            if (!found) return it;
            return {
                ...it,
                dateTimeOriginal: found.meta.dateTimeOriginal,
                latitude: found.meta.latitude,
                longitude: found.meta.longitude,
            };
        }));

        // GPS → 場所名（Nominatim 1秒/req のため直列）。トグルOFF時はスキップ。
        // state ではなく ref を読む——共有シート経由の呼び出しは
        // マウント時の addFiles を掴んでいるので、state だと復元前の
        // 初期値（true）に張り付く。
        if (gpsAutofillRef.current) {
            for (const r of exifResults) {
                if (leftPageRef.current) break;   // 画面を離れた。続きは投げない
                if (r.meta.latitude !== undefined && r.meta.longitude !== undefined) {
                    const place = await reverseGeocode(r.meta.latitude, r.meta.longitude, locale);
                    if (place) {
                        setItems((prev) => prev.map((it) => (it.id === r.id && !it.location ? { ...it, location: place } : it)));
                    }
                    await new Promise((res) => setTimeout(res, 1100));
                }
            }
        }
        } finally {
            setMetaJobs((n) => Math.max(0, n - 1));
        }
    }, [locale]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;
        void addFiles(files);
        e.target.value = "";
    }, [addFiles]);

    const updateItem = useCallback((id: string, patch: Partial<Item>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    }, []);

    /**
     * 指定したキーの実体を消す（best effort）。
     * 「上げたが使わないもの」の後始末はここに集約する。
     *
     * 消せなくても画面は進める（次に同じ写真を選べば上書きされるし、
     * ここで止めると「消せないから閉じられない」になる）。
     * ただし**消せなかったことは記録する**——`userFetch` は非 2xx でも
     * 投げないので、`catch` に入るのは通信断だけ。403（自分の領域外）や
     * 503（使用中か確認できなかった＝安全側に倒して消さない）は
     * 何も出さずに素通りし、孤児が残ったことに誰も気づけなかった。
     */
    const discardKeys = useCallback(async (keys: string[]) => {
        if (keys.length === 0) return;
        const { userFetch } = await import("../../../lib/utils/api");
        for (const key of keys) {
            try {
                const res = await userFetch("/upload/discard", { method: "DELETE", body: JSON.stringify({ key }) });
                if (!res.ok) log.warn("discard rejected (leaving orphan):", res.status, key);
            } catch (e) {
                log.warn("discard upload failed (leaving orphan):", e);
            }
        }
    }, []);

    /**
     * S3 に上がったが保存に至らなかったキーを片付ける。
     *
     * 投稿は「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目を
     * そのまま捨てると**実体だけが S3 に残る**。どの削除経路も DynamoDB の
     * 項目からキーを引くので、項目の無いオブジェクトには誰も手が届かない
     * ——退会しても、写真を消しても残り続ける（原本は GPS 入りのまま
     * 公開URLで取れる）。
     */
    const discardUploaded = useCallback(async (uploaded: Item["uploaded"]) => {
        if (!uploaded) return;
        const keys = [uploaded.key];
        // サムネは別キー。本体だけ消すと 512px WebP が孤児として残る。
        if (uploaded.thumbUrl) {
            try {
                const path = new URL(uploaded.thumbUrl).pathname.replace(/^\//, "");
                if (path.startsWith("uploads/")) keys.push(decodeURIComponent(path));
            } catch { /* URL でなければ諦める */ }
        }
        await discardKeys(keys);
    }, [discardKeys]);

    // 副作用（`/upload/discard` の DELETE）を setItems の updater の中で
    // 呼んでいる。React の規約としては純粋関数であるべきだが、**ここは
    // 意図的にこのまま**にしている:
    //  - React 19 + StrictMode で二重呼び出しを実際に試したが、DELETE は
    //    1回しか飛ばなかった（＝この React では観測できない）
    //  - updater の中なら `prev` が「まだ消していない一覧」なので、
    //    連打しても2回目は項目が見つからず DELETE を投げない。外に出して
    //    ref から引くと、同じ tick の2回目が**古い一覧を見て二重に投げる**
    //    ——直すつもりの症状を自分で作ることになる
    const removeItem = useCallback((id: string) => {
        setItems((prev) => {
            const it = prev.find((x) => x.id === id);
            if (it) {
                try { URL.revokeObjectURL(it.preview); } catch { /* ignore */ }
                // 保存まで通った項目のキーは写真が使っているので触らない
                if (it.status !== "done") void discardUploaded(it.uploaded);
            }
            return prev.filter((x) => x.id !== id);
        });
    }, [discardUploaded]);

    const handleUploadAll = useCallback(async (published: boolean) => {
        const pending = items.filter((it) => it.status === "pending" || it.status === "error");
        if (pending.length === 0) {
            showToast(locale === "en" ? "Nothing to upload" : "アップロードする写真がありません", "error");
            return;
        }

        setUploading(true);
        // 管理者でもユーザーAPIを使う。管理APIの savePhoto は published を見ずに
        // 常に true で保存するため、「下書き保存」を押しても即公開になっていた
        // （しかも撮影日・サムネURL・代表色・ぼかしも受け取らないので全部捨てられる）。
        // ユーザーAPI側は isAdmin を見て100枚制限だけ免除している。
        const { userFetch, readApiError } = await import("../../../lib/utils/api");
        const apiFetch = userFetch;

        const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
        // 編集画面と同じ理由（`app/user/edit/page.tsx` を見よ）。
        // 上限は画面に対応物が無く、超えた分は 200 のまま消える
        if (tagList && tagList.length > TAGS_MAX) {
            showToast(locale === "en"
                ? `Up to ${TAGS_MAX} tags (${tagList.length}). The rest won't be saved`
                : `タグは${TAGS_MAX}個までです（${tagList.length}個）。超えた分は保存されません`, "error");
        }
        // **文字数で見る**（この画面は説明を文字列で送るので、段落数は効かない）
        const longDesc = pending.find((it) => it.description.trim().length > DESC_STRING_MAX);
        if (longDesc) {
            showToast(locale === "en"
                ? `Up to ${DESC_STRING_MAX} characters in the description. The rest won't be saved`
                : `説明は${DESC_STRING_MAX}字までです。超えた分は保存されません`, "error");
        }

        let successCount = 0;
        for (const item of pending) {
            updateItem(item.id, { status: "uploading", progress: 0, error: undefined });
            // **成否を確認できていないキー。** 失敗したらここに残るので
            // catch で消す（残すと誰にも辿れない実体になる）。
            // catch から見える必要があるので try の外に置く
            let reservedKey: string | undefined;
            let reservedThumbKey: string | undefined;
            try {
                // メタデータを除去できたものだけ上げる（消せない形式は上げない）
                let uploadFile: File;
                try {
                    uploadFile = await toUploadSafeFile(item.file);
                } catch (e) {
                    log.error("could not strip metadata, skipping upload:", e);
                    // **理由ごとに書き分ける。** 以前は全部「この形式は…JPEG か
                    // PNG で保存し直してください」だったが、読めない／大きすぎる
                    // 場合は**形式が正しい JPEG** なので、言われたとおりに
                    // 保存し直しても同じ結果になる（袋小路だった）。
                    updateItem(item.id, { status: "error", error: unstrippableMessage(e, locale) });
                    continue;
                }
                updateItem(item.id, { progress: 20 });

                // 前回この写真の S3 アップロードまでは成功していたら、それを使い回す。
                //
                // 以前は失敗のたびに presign を取り直していたので、再試行するたびに
                // 参照されないオブジェクトが2つ（本体＋サムネ）増えていた。
                // どの削除経路（写真削除・退会・ストーリー掃除）も DynamoDB の
                // 項目からキーを引くので、項目の無いオブジェクトには永久に手が届かない。
                let key = item.uploaded?.key;
                let publicUrl = item.uploaded?.publicUrl;
                let thumbUrl = item.uploaded?.thumbUrl;

                if (!key || !publicUrl) {
                    const presignedResponse = await apiFetch("/upload/presigned-url", {
                        method: "POST",
                        body: JSON.stringify({
                            fileName: uploadFile.name,
                            fileType: uploadFile.type,
                            fileSize: uploadFile.size,
                        }),
                    });
                    if (!presignedResponse.ok) {
                        // サーバーは日本語の理由を返す（例: アップロード上限に達しています）。
                        // 生のJSONを80文字で切って出していたので、肝心の一文が
                        // 途中で切れたクラッシュログのように見えていた。
                        throw new Error(await readApiError(presignedResponse,
                            locale === "en" ? "Could not start the upload." : "アップロードを開始できませんでした。"));
                    }
                    const presigned = await presignedResponse.json();
                    key = presigned.key as string;
                    publicUrl = presigned.publicUrl as string;
                    // **サーバーが署名した種別で送る。** `content-type` は
                    // 署名対象なので、違う文字列だと S3 が 403 にする。
                    // 返ってこない古い API 相手でも動くよう、無ければ従来どおり
                    const putType = (presigned.contentType as string | undefined) ?? uploadFile.type;
                    // **PUT の前に控える。** ここで控えていなかったので、
                    // `fetch` が **reject** したとき（本文は上がりきったが
                    // 応答が返らない——モバイル回線でよくある）にキーが
                    // どこにも残らず、再試行は presign を取り直して
                    // **別のキー**へ上げ直していた。前の実体は
                    // DynamoDB に行が無いので、写真削除・退会・discard の
                    // どの経路からも辿れない。再試行のたびに1つずつ増える。
                    reservedKey = key;
                    updateItem(item.id, { progress: 40 });

                    const uploadResponse = await fetch(presigned.presignedUrl, {
                        method: "PUT",
                        body: uploadFile,
                        headers: { "Content-Type": putType, "Cache-Control": "max-age=31536000" },
                    });
                    // **番号だけの文字列を投げない。** catch は e.message を
                    // そのまま画面に出すので、利用者に「S3 403」が見えていた
                    // （StoriesBar が同じ理由で先に直している）。
                    if (!uploadResponse.ok) throw new Error(UPLOAD_FAILED_MESSAGE);
                    // 上がったことが確認できた。以後この実体は使う
                    reservedKey = undefined;
                }
                updateItem(item.id, { progress: 70 });

                // 一覧グリッド用の 512px WebP サムネイルを併せてアップロードする。
                // グリッドがフル画像（〜1920px）を落とすのが読み込みの遅さの主因。
                // サムネ生成/アップロードに失敗しても本体の投稿は成立させる。
                try {
                    if (thumbUrl) throw new SkipThumb(); // 前回上げた分を使う
                    const thumb = await createThumbnail(item.file);
                    if (thumb) {
                        const thumbPresign = await apiFetch("/upload/presigned-url", {
                            method: "POST",
                            body: JSON.stringify({ fileName: thumb.name, fileType: thumb.type, fileSize: thumb.size }),
                        });
                        if (thumbPresign.ok) {
                            const t = await thumbPresign.json() as { presignedUrl: string; publicUrl: string; key?: string; contentType?: string };
                            // 本体と同じ理由で PUT の前に控える。ここは
                            // 失敗しても「サムネ無しで続行」なので、控えて
                            // いないと **本体が保存できても** その 512px WebP は
                            // 永久に誰も消せない（写真を消しても、退会しても残る）
                            if (t.key) reservedThumbKey = t.key;
                            const thumbPut = await fetch(t.presignedUrl, {
                                method: "PUT",
                                body: thumb,
                                headers: { "Content-Type": t.contentType ?? thumb.type, "Cache-Control": "max-age=31536000" },
                            });
                            if (thumbPut.ok) {
                                thumbUrl = t.publicUrl;
                                reservedThumbKey = undefined;   // 使うので消さない
                            } else if (reservedThumbKey) {
                                // **`!ok` もここで消す。** 本体の PUT は `!ok` で
                                // throw して外側の catch が消すが、サムネは
                                // 「無しで続行」なので投げない——`else` が無かった
                                // ので、403（署名切れ）や 5xx で上がった実体が
                                // 誰にも辿れず残っていた。控える意味が半分しか
                                // 無かった（コメントは全部塞いだように書いていた）
                                void discardKeys([reservedThumbKey]);
                                reservedThumbKey = undefined;
                            }
                        }
                    }
                } catch (e) {
                    if (!(e instanceof SkipThumb)) log.error("thumbnail upload failed (continuing without thumb):", e);
                    // **ここで消す。** サムネの失敗は握って本体の保存へ進むので、
                    // 下の catch には来ない。控えたまま進むと、本体が保存
                    // できても そのサムネだけが誰にも辿れず残る
                    if (reservedThumbKey) {
                        void discardKeys([reservedThumbKey]);
                        reservedThumbKey = undefined;
                    }
                }
                // ここまでで S3 には上がっている。保存に失敗しても捨てないよう控える
                updateItem(item.id, { uploaded: { key, publicUrl, ...(thumbUrl ? { thumbUrl } : {}) }, progress: 85 });

                // 撮影地座標: GPS自動入力がONのときのみ、約1km精度に丸めて保存
                const coords = gpsAutofill && item.latitude !== undefined && item.longitude !== undefined
                    ? { lat: Math.round(item.latitude * 100) / 100, lng: Math.round(item.longitude * 100) / 100 }
                    : undefined;

                // 代表色: グリッドの読み込みプレースホルダーに使う（失敗しても続行）
                const dominantColor = await extractDominantColor(item.file);

                // ぼかしプレビュー（blur-up 用の極小画像）。失敗しても続行
                const blurDataURL = await createBlurPlaceholder(item.file);

                // 撮影情報（カメラ・レンズ・絞り等）: 圧縮で EXIF が失われる前に
                // 元ファイルから抽出して保存する。GPS は含めない（coords で別管理）
                const cameraExif = await extractCameraExif(item.file);

                const saveResponse = await apiFetch("/upload/save", {
                    method: "POST",
                    body: JSON.stringify({
                        key, publicUrl,
                        published,
                        // 撮影日: EXIF から読み取った日時。年表を「撮った順」で並べるために必須。
                        // 送らないと createdAt（アップロード日）にフォールバックしてしまう。
                        ...(item.dateTimeOriginal ? { date: item.dateTimeOriginal } : {}),
                        title: item.title || undefined,
                        description: item.description || undefined,
                        location: item.location || undefined,
                        category: category || undefined,
                        tags: tagList,
                        ...(coords ? { coords } : {}),
                        ...(dominantColor ? { dominantColor } : {}),
                        ...(blurDataURL ? { blurDataURL } : {}),
                        ...(thumbUrl ? { thumbUrl } : {}),
                        ...(Object.keys(cameraExif).length > 0 ? { exif: cameraExif } : {}),
                    }),
                });
                if (!saveResponse.ok) {
                    throw new Error(await readApiError(saveResponse,
                        locale === "en" ? "Could not save the photo." : "写真を保存できませんでした。"));
                }
                updateItem(item.id, { status: "done", progress: 100 });
                successCount++;
                // 残り枚数はマウント時に1回取るだけだった。3枚上げても
                // 「あと5枚」のままで、押して初めて 403 に戻ってしまう。
                // 成功した分をその場で引く（取れていない＝null のときは触らない）。
                setUsedSlots((n) => (n === null ? n : n + 1));
            } catch (err) {
                log.error(`Upload failed for ${item.file.name}:`, err);
                // **上げたかもしれない実体を捨てる。** `fetch` が reject した
                // 場合、本文は上がりきっているかもしれない。上がっていれば
                // ここで消える。上がっていなくても S3 の DeleteObject は
                // 成功するので、サーバーは 200 を返す（**404 にはならない**）
                // ——空振りしても害は無い。消し損ねても画面は進める。
                const stale = [reservedKey, reservedThumbKey].filter((k): k is string => !!k);
                if (stale.length) void discardKeys(stale);
                // オフラインの fetch は "Failed to fetch" を投げる。そのまま
                // 出していたので、画面に英語の技術文字列が並んでいた。
                // 見せてよいのは、こちらが日本語で組み立てたものだけ
                updateItem(item.id, { status: "error", error: userFacingUploadError(err) });
            }
        }

        setUploading(false);
        if (successCount > 0) {
            showToast(
                published
                    ? (locale === "en" ? `${successCount} photo(s) uploaded` : `${successCount} 枚アップロードしました`)
                    : (locale === "en"
                        ? `Saved ${successCount} draft(s). Fill in details later and publish.`
                        : `${successCount} 枚を下書き保存しました。あとで編集して公開できます`),
                "success",
            );
            // 全件成功時に遷移（items はループ開始時のクロージャなのでカウントで判定する）。
            // 公開はトップへ、下書きは下書き一覧へ。
            if (successCount === pending.length) {
                const dest = published ? "/" : ROUTES.DRAFTS;
                redirectTimerRef.current = setTimeout(() => router.push(dest), 1500);
            }
        }
        if (successCount < pending.length) {
            showToast(
                locale === "en"
                    ? `${pending.length - successCount} upload(s) failed`
                    : `${pending.length - successCount} 件失敗しました`,
                "error",
            );
        }
    }, [items, category, tags, gpsAutofill, locale, router, showToast, updateItem, discardKeys]);

    // 権限が無い人はログイン画面へ送り返さない（/login が押し返して往復する）
    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    if (gate !== "ok") {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const inputCls = "w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";
    const doneCount = items.filter((i) => i.status === "done").length;
    const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full pb-32">
            <div className="flex items-start justify-between gap-3 mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">
                    {locale === "en" ? "Upload Photos" : "写真をアップロード"}
                </h1>
            </div>

            {/* iOS向け「ホーム画面に追加」ヒント（該当時のみ表示） */}
            <AddToHomeScreenHint />

            {/* 残り枚数。**上限に当たるまで見えなかった**ので、選ぶ前に出す。
                取れていなければ何も出さない（推測した数字は見せない）。 */}
            {remainingSlots !== null && (
                <p className={`text-xs mb-3 ${remainingSlots === 0 ? "text-amber-400/90" : "text-white/40"}`}>
                    {remainingSlots === 0
                        ? (locale === "en"
                            ? `Upload limit reached (${PHOTO_LIMIT_PER_USER}). Delete a photo to make room.`
                            : `アップロードの上限（${PHOTO_LIMIT_PER_USER}枚）に達しています。写真を削除すると空きができます。`)
                        : (locale === "en"
                            ? `${remainingSlots} of ${PHOTO_LIMIT_PER_USER} uploads left`
                            : `あと${remainingSlots}枚アップロードできます（${PHOTO_LIMIT_PER_USER}枚まで）`)}
                </p>
            )}

            {/* ファイル選択 */}
            {/* **入力は sr-only にする（hidden にしない）。**
                `hidden` は display:none なので、その input は**フォーカスできない**
                ——`<label>` 自体もタブ順に入らないので、キーボードだけの人は
                写真を選ぶ手段が無く、このページで何もできなかった
                （ドロップも貼り付けも `ref.click()` も無い）。
                sr-only なら見た目はそのままで、Tab で届き Enter で開ける。
                枠が光るように focus-within も付ける（どこにいるか分かるように）。 */}
            <label
                htmlFor="files-input"
                className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-white/40 focus-within:border-white/60 transition-colors mb-4"
                style={{ touchAction: "manipulation", minHeight: "120px" }}
            >
                <PhotoIcon className="w-10 h-10 text-white/40 mb-2" />
                <p className="text-sm text-white/70 font-semibold">
                    {locale === "en" ? "Tap to choose photos" : "タップして写真を選ぶ"}
                </p>
                <p className="text-xs text-white/40 mt-1">
                    {locale === "en" ? "Multiple selection supported (max 50MB each)" : "複数選択OK・各50MBまで"}
                </p>
                <input
                    id="files-input"
                    type="file"
                    multiple
                    className="sr-only"
                    accept="image/*"
                    onChange={handleFileSelect}
                    disabled={uploading}
                />
            </label>

            {/* カメラ直撮り（スマホで背面カメラを直接起動）。ギャラリー選択とは別入力にする */}
            <label
                htmlFor="camera-input"
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-white/5 ring-1 ring-white/10 hover:bg-white/10 focus-within:ring-white/60 transition-colors mb-4 cursor-pointer text-sm text-white/80"
                style={{ touchAction: "manipulation", minHeight: "44px" }}
            >
                <CameraIcon className="w-5 h-5 text-white/60" />
                {locale === "en" ? "Take a photo" : "写真を撮る"}
                <input
                    id="camera-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={handleFileSelect}
                    disabled={uploading}
                />
            </label>

            {/* GPS 自動入力トグル */}
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none" style={{ touchAction: "manipulation" }}>
                <input
                    type="checkbox"
                    checked={gpsAutofill}
                    onChange={toggleGpsAutofill}
                    disabled={uploading}
                    className="w-4 h-4 accent-white"
                />
                <span className="text-xs text-white/60">
                    <MapPinIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
                    {locale === "en"
                        ? "Auto-fill shooting location from photo GPS (city level)"
                        : "写真のGPSから撮影地を自動入力（市区町村レベル）"}
                </span>
            </label>

            {fileError && <p role="alert" className="text-sm text-red-400 mb-3">{fileError}</p>}

            {/* 共通設定 */}
            {items.length > 0 && (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-3.5 mb-4 space-y-2">
                    <p className="text-xs text-white/50 uppercase tracking-wide">
                        {locale === "en" ? "Common settings (applied to all)" : "共通設定（全写真に適用）"}
                    </p>
                    {/* 前に使った値を候補に出す（選ばずに自由入力もできる） */}
                    <datalist id="own-categories">
                        {ownValues.categories.map((v) => <option key={v} value={v} />)}
                    </datalist>
                    <datalist id="own-locations">
                        {ownValues.locations.map((v) => <option key={v} value={v} />)}
                    </datalist>
                    <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        maxLength={CATEGORY_MAX}
                        placeholder={locale === "en" ? "Category (e.g. Landscape)" : "カテゴリ（例: 風景）"}
                        className={inputCls}
                        list="own-categories"
                        style={{ fontSize: "16px" }}
                        disabled={uploading}
                    />
                    <input
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder={locale === "en" ? "Tags (comma-separated)" : "タグ（カンマ区切り）"}
                        className={inputCls}
                        style={{ fontSize: "16px" }}
                        disabled={uploading}
                    />
                    {/* タグはカンマ区切りなので datalist が効かない（欄全体を
                        置き換えてしまう）。押して足せるチップにする。 */}
                    {ownValues.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {ownValues.tags.slice(0, 12).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTags((cur) => appendTag(cur, t))}
                                    disabled={uploading}
                                    className="px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors disabled:opacity-40"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 写真リスト */}
            <div className="space-y-3 mb-6">
                {items.map((it) => (
                    <div key={it.id} className="border border-white/10 rounded-lg overflow-hidden bg-white/5">
                        {/* トリミングプレビュー（一覧表示範囲を白枠で明示） */}
                        <div className="relative">
                            <CropPreview
                                key={it.preview}
                                src={it.preview}
                                hint={locale === "en" ? "White frame = shown in the grid" : "白い枠が一覧に表示されます"}
                                locale={locale}
                            />
                            <button
                                type="button"
                                onClick={() => removeItem(it.id)}
                                disabled={uploading || it.status === "uploading"}
                                className="absolute top-2 right-2 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors disabled:opacity-30 z-10"
                                aria-label={locale === "en" ? "Remove" : "削除"}
                                style={{ touchAction: "manipulation" }}
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3">
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <input
                                    type="text"
                                    value={it.title}
                                    onChange={(e) => updateItem(it.id, { title: e.target.value })}
                                    maxLength={TITLE_MAX}
                                    placeholder={locale === "en" ? "Title (optional)" : "タイトル（任意）"}
                                    className={inputCls}
                                    style={{ fontSize: "16px" }}
                                    disabled={uploading || it.status === "done"}
                                />
                                {/* EXIF メタ表示 */}
                                <div className="flex flex-wrap gap-2 text-xs text-white/40">
                                    {it.dateTimeOriginal && (
                                        <span className="inline-flex items-center gap-0.5">
                                            <CalendarIcon className="w-3 h-3" />
                                            {/* 保存されている通りに出す。toLocaleDateString だと
                                                UTC より西の端末で**保存される日付より1日前**が
                                                確認画面に出て、写真ページの表示とも食い違う。 */}
                                            {formatStoredDateTime(it.dateTimeOriginal, locale === "en" ? "en" : "ja")}
                                        </span>
                                    )}
                                    {it.location && (
                                        <span className="inline-flex items-center gap-0.5 truncate max-w-[200px]">
                                            <MapPinIcon className="w-3 h-3" />
                                            {it.location}
                                        </span>
                                    )}
                                </div>
                                {/* 詳細フォーム（折り畳み） */}
                                {it.expanded ? (
                                    <div className="space-y-1.5 pt-1">
                                        <textarea
                                            value={it.description}
                                            onChange={(e) => updateItem(it.id, { description: e.target.value })}
                                            placeholder={locale === "en" ? "Description (optional)" : "説明（任意）"}
                                            rows={2}
                                            className={`${inputCls} resize-none`}
                                            style={{ fontSize: "16px" }}
                                            disabled={uploading || it.status === "done"}
                                        />
                                        <input
                                            type="text"
                                            value={it.location}
                                            onChange={(e) => updateItem(it.id, { location: e.target.value })}
                                            maxLength={LOCATION_MAX}
                                            placeholder={locale === "en" ? "Location (optional)" : "場所（任意）"}
                                            className={inputCls}
                                            list="own-locations"
                                            style={{ fontSize: "16px" }}
                                            disabled={uploading || it.status === "done"}
                                        />
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => updateItem(it.id, { expanded: !it.expanded })}
                                    className="text-xs text-white/40 hover:text-white/70 inline-flex items-center gap-0.5"
                                    disabled={uploading}
                                >
                                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${it.expanded ? "rotate-180" : ""}`} />
                                    {locale === "en" ? "Details" : "詳細"}
                                </button>
                            </div>
                        </div>
                        {/* ステータス */}
                        {it.status !== "pending" && (
                            <div className="px-3 pb-3">
                                {it.status === "uploading" && (
                                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                        <div className="h-full rounded-full bg-gradient-to-r from-white/70 to-white transition-all" style={{ width: `${it.progress}%` }} />
                                    </div>
                                )}
                                {it.status === "done" && (
                                    <p className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" />{locale === "en" ? "Uploaded" : "アップロード完了"}</p>
                                )}
                                {/* ここは role="alert" にしない。逐次ループなので、
                                    50枚失敗すれば assertive な割り込みが50回起きる。
                                    まとめは「N 件失敗しました」のトーストが出していて、
                                    Toast は元から role="alert" を持っている。 */}
                                {it.status === "error" && (
                                    <p className="text-xs text-red-400 inline-flex items-center gap-1"><ExclamationTriangleIcon className="w-4 h-4" />{it.error ?? (locale === "en" ? "Failed" : "失敗")}</p>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* アップロードバー（固定）。
                **`env(safe-area-inset-bottom)` を足す。** `viewportFit: "cover"` なので、
                ホームインジケーターのある端末では下 34px がインジケーター帯に入る。
                `globals.css` の `body { padding-bottom: env(...) }` は
                **`position: fixed` には効かない**（fixed は body の padding box の外）。
                実測で、高さ44pxのボタンの下に14pxしか空いていなかった。
                `StoryViewer` / `StoriesBar` / `MiniPlayer` は既にこの形。 */}
            {items.length > 0 && (
                <div ref={bottomBarRef} className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
                    <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
                        <p className="hidden sm:block text-sm text-white/70 flex-shrink-0">
                            {doneCount > 0 ? `${doneCount}/${items.length} ` : ""}
                            {locale === "en" ? `${pendingCount} ready` : `${pendingCount} 枚待ち`}
                        </p>
                        <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end">
                            {/* 下書き保存: 必須項目なしで非公開保存。あとで編集して公開できる */}
                            <button
                                onClick={() => handleUploadAll(false)}
                                disabled={uploading || metaLoading || pendingCount === 0}
                                className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {locale === "en" ? "Save draft" : "下書き保存"}
                            </button>
                            <button
                                onClick={() => handleUploadAll(true)}
                                disabled={uploading || metaLoading || pendingCount === 0}
                                className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {uploading
                                    ? (locale === "en" ? "Uploading..." : "アップロード中...")
                                    : metaLoading
                                        ? (locale === "en" ? "Reading photo info..." : "撮影情報を読み取り中…")
                                        : (locale === "en" ? `Publish ${pendingCount}` : `${pendingCount}枚を公開`)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* プロフィール写真 */}
            <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-4 mt-8">
                <h2 className="text-sm font-medium text-white/70">
                    {locale === "en" ? "Profile Photo" : "プロフィール写真"}
                </h2>
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
                        {avatarPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                        ) : currentUserId && CLOUDFRONT_URL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(currentUserId)}?v=${avatarCacheBust}`}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                        ) : (
                            <UserCircleIcon className="w-10 h-10 text-white/40" />
                        )}
                    </div>
                    <div className="space-y-2">
                        {/* focus-within は**input を包む側**に付ける。
                            span は input の兄弟なので、そこに付けても永久に
                            発火しない（:focus-within は自分自身か子孫にしか
                            当たらない）。Tab で止まるようになったのに何も
                            光らない＝フォーカスが行方不明、という新しい
                            壊れ方を作っていた。 */}
                        <label className="inline-block cursor-pointer rounded-lg focus-within:ring-2 focus-within:ring-white/60">
                            <span className="px-3.5 py-2 text-sm bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-lg transition inline-flex items-center"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}>
                                {locale === "en" ? "Choose photo" : "写真を選択"}
                            </span>
                            <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                disabled={avatarUploading}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (!f || !f.type.startsWith("image/")) return;
                                    // **写真グリッドと同じく、選んだ時点で断る。**
                                    // ここだけ残っていたので、プレビューを見て
                                    // 「保存」を押してから必ず失敗していた。
                                    if (f.type === "image/gif") {
                                        showToast(gifRejectedMessage(locale), "error");
                                        e.target.value = "";
                                        return;
                                    }
                                    setAvatarFile(f);
                                    const reader = new FileReader();
                                    reader.onloadend = () => setAvatarPreview(reader.result as string);
                                    reader.readAsDataURL(f);
                                    e.target.value = "";
                                }}
                            />
                        </label>
                        {avatarFile && (
                            <button
                                onClick={async () => {
                                    if (!avatarFile) return;
                                    setAvatarUploading(true);
                                    try {
                                        // 消せない形式は上げない（アイコンも公開URLで配信される）
                                        const compressed = await toUploadSafeFile(avatarFile, AVATAR_MAX_PX, 0.9);
                                        // アイコンのアップロードは管理APIに経路が無い
                                        // （/profile/avatar/presigned-url はユーザーAPIだけ）。
                                        // 管理者だと 404 になって「Presigned URL fail」で終わっていた。
                                        const { userFetch } = await import("../../../lib/utils/api");
                                        const res = await userFetch("/profile/avatar/presigned-url", {
                                            method: "POST",
                                            body: JSON.stringify({ fileType: compressed.type }),
                                        });
                                        if (!res.ok) throw new Error("Presigned URL fail");
                                        const { presignedUrl, contentType } = await res.json() as { presignedUrl: string; contentType?: string };
                                        const upload = await fetch(presignedUrl, {
                                            method: "PUT",
                                            body: compressed,
                                            // Cache-Control は署名対象外ヘッダなので presigned URL 側では
                                            // 指定できない。クライアントが送らないと S3 に何も付かず、
                                            // CDN の既定TTLで配信されてアイコンを変えても反映されない。
                                            headers: { "Content-Type": contentType ?? compressed.type, "Cache-Control": "no-store" },
                                        });
                                        if (!upload.ok) throw new Error("S3 upload fail");
                                        setAvatarFile(null);
                                        setAvatarCacheBust(Date.now());
                                        showToast(locale === "en" ? "Profile photo updated!" : "プロフィール写真を更新しました");
                                    } catch (e) {
                                        log.error("avatar upload error:", e);
                                        showToast(
                                            e instanceof UnstrippableFileError
                                                ? unstrippableMessage(e, locale)
                                                : (locale === "en" ? "Upload failed" : "アップロードに失敗しました"),
                                            "error",
                                        );
                                    } finally {
                                        setAvatarUploading(false);
                                    }
                                }}
                                disabled={avatarUploading}
                                className="px-3 py-2 text-sm bg-white text-black rounded-full font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {avatarUploading
                                    ? (locale === "en" ? "Uploading..." : "アップロード中...")
                                    : (locale === "en" ? "Save" : "保存")}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}

export default function UploadPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        }>
            <UploadPageInner />
        </Suspense>
    );
}
