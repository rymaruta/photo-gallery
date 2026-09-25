"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef, Suspense } from "react";
import { usePageBarHeight } from "../../../lib/hooks/useBottomBarHeight";
import CropFramePicker from "../../components/CropFramePicker";
import { useRouter, useSearchParams } from "next/navigation";
import { PhotoIcon, XMarkIcon, MapPinIcon, CalendarIcon, PlusIcon, PaperAirplaneIcon, CheckCircleIcon, ExclamationTriangleIcon, CameraIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../../lib/hooks/useToast";
import { useAuth } from "../../auth/context";
import AddToHomeScreenHint from "../../components/AddToHomeScreenHint";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { createThumbnail, toUploadSafeFile, UnstrippableFileError, extractDominantColor, createBlurPlaceholder } from "../../../lib/utils/image";
import { extractExifFromFile, extractCameraExif, reverseGeocode } from "../../../lib/utils/exif";
import { readSharedResult, clearSharedPayload } from "../../../lib/utils/shareStore";
import { saveUploadDraft, readUploadDraft, clearUploadDraft, allowUploadDraft } from "../../../lib/utils/uploadDraft";
import { ROUTES } from "../../../lib/routes";
import { formatStoredDateTime } from "../../../lib/utils/photoDate";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import { userFacingUploadError, UPLOAD_FAILED_MESSAGE } from "./errorText";
import { CANCEL_DISCARD_WAIT_MS } from "./cancelWait";
import { unstrippableMessage, gifRejectedLabel } from "../../../lib/utils/uploadRejection";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import type { Photo } from "../../../lib/data/photos";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { collectOwnValues, toggleTag, hasTag, suggestTags, dropFragment, splitTags, TAG_SEPARATOR, type OwnValues } from "../../../lib/utils/ownValues";
import { tagKey } from "../../../lib/utils/collections";
import { presignAndPut } from "../../../lib/utils/uploadToS3";
import { CATEGORY_CHOICES, isChosenCategory, toggleCategory } from "../../../lib/utils/categoryChoices";
import { TAG_CHOICES } from "../../../lib/utils/tagChoices";
// 上限は lib/utils/uploadLimits.ts に置く（api-user 側と対。理由はあちらに書いた）
import { PHOTO_LIMIT_PER_USER, PHOTO_IMAGES_MAX } from "../../../lib/utils/uploadLimits";

/**
 * **最終版モック（`docs/mockups/07-post-create.jpg`）から測った寸法。**
 *
 * 測り方はモックの README のとおり——シートの端末画面の幅を 393 CSS px と
 * 置いて比を取る。この1枚は画面が **x=347..732（386画素）** なので
 * **1画素 ≈ 1.018 CSS px**（家の中の丸め誤差は ±1px）。
 *
 *     部品                    モックの画素        使う値
 *     左右の余白              12                  12px
 *     ヘッダーの中身の高さ     32                  バー全体 52px
 *     「下書き保存」のピル      93×32               高さ 32px・角丸 full
 *     ヒーロー                362×157             幅いっぱい・**16/7**（≒369×161）
 *     サムネ                  60×78               **64×80（4:5）**・間 6px
 *     題の入力欄（1行）        362×37              高さ 40px
 *     キャプション            362×80              高さ 80px
 *     チップ                  高さ 31             高さ 32px・角丸 full
 *     タグの入力欄            高さ 35             高さ 40px
 *     位置情報の行            高さ 44             高さ 44px
 *     「投稿する」            362×45              幅いっぱい・高さ 46px・角丸 full
 *     見出しの字（漢字 0.88em）字高 11.2          13px
 *     行のラベルの字           字高 12.2           14px
 *     カウンタの字             字高 10.2           12px
 *     「投稿する」の字         字高 15.3           17px
 *
 * **入力欄の中の字だけはモックより大きい 16px。** 16px 未満だと iOS が
 * 焦点を当てた瞬間に画面を拡大する（この画面は前から `fontSize: "16px"` を
 * 直書きしている）。モックの実測は約 15px。
 */

/**
 * 画面の幅。**モックは iPhone だけなので、PC は別に組む**（owner の指示）。
 * 1024px 未満は 560px で頭打ちにして横に伸ばさない（伸ばすとヒーローだけが
 * 巨大になり、モックの比が崩れる）。1024px 以上は「写真の列 ＋ 入力の列」の
 * 2段組み（`lg:` の指定）。
 */
const COLUMN = "mx-auto w-full max-w-[560px] lg:max-w-[980px] px-3";

type Status = "pending" | "uploading" | "done" | "error";

type Item = {
    id: string;
    file: File;
    preview: string;
    /**
     * 一覧（正方形）で写真のどこを中心に置くか（0〜1）。**中央が既定**。
     * `undefined` のまま送らなければ、サーバーは属性を書かない
     * ＝今までの写真と同じ見え方になる
     */
    focalPoint?: { x: number; y: number };
    title: string;
    description: string;
    location: string;
    dateTimeOriginal?: string;
    latitude?: number;
    longitude?: number;
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
const TAG_LEN_MAX = 50;
const DESC_STRING_MAX = 2000;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const CATEGORY_MAX = 100;


/** `p` を待つ。ただし `ms` を過ぎたら待つのをやめる（`p` は走ったまま） */
async function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([p, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
    } finally {
        clearTimeout(timer);
    }
}

function UploadPageInner() {
    const { isAuthenticated, isAdminUser, loading, userId } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const fromShare = searchParams?.get("from") === "share";
    /**
     * 共同アルバムに入れる場合の行き先（案C）。招待ページの
     * 「写真を追加する」が `?album=<id>` を付けて送ってくる。
     *
     * **付いていても、メンバーでなければサーバーが断る**（404）。ここは
     * 「どこに入れるつもりか」を運ぶだけで、権限の判断はしていない。
     */
    const albumId = searchParams?.get("album") || "";

    /** 下の帯の高さを `--page-bar-h` に出す（`body` がそのぶん下を空ける）。
     *  **`--bottom-bar-h` には書かない**——このファイルの下の帯のコメントが
     *  「この画面からは書かない」と言っているのはそちらの変数のこと */
    const pageBarRef = usePageBarHeight();
    const [items, setItems] = useState<Item[]>([]);
    /**
     * 認証ゲート。**取り込んだ写真があるときは送り返させない**——
     * `router.replace` は画面を作り直すので、選んだ写真も打った題名・説明も
     * 消える（取り込みには1枚 1.1秒かかっているし、共有シートから来た人は
     * 元のアプリへ戻って選び直すことになる）。
     * ログインが切れた側はどのみち上げられないが、**捨ててよい理由には
     * ならない**。送り返さない代わりに、下で伝える。
     */
    // **守る価値があるのは、まだ上げていないぶんだけ。** `items` は
    // 上げ終わっても `done` として残るので（1件でも失敗すると遷移しない）、
    // 件数で見ると「もう上がっている写真」について「まだ上げられません」と
    // 嘘をつくことになる
    const pendingWork = items.some((i) => i.status !== "done");
    const gate = useMemberGate(pendingWork);
    /** 送り返さずに留めている状態（未ログインだが、まだ上げていない写真がある） */
    const holdingWork = gate === "anonymous" && pendingWork;
    const [category, setCategory] = useState("");
    const [tags, setTags] = useState("");
    const [uploading, setUploading] = useState(false);
    /**
     * アップロード中の要求。「やめる」を押したら中断する。
     *
     * **止める手段が無かった。** 押している間は公開も下書き保存も
     * `disabled={uploading}` で、しかも **S3 への PUT は素の `fetch`**
     * （`userFetch` の20秒の打ち切りは経路外）。応答が返らない回線では
     * リロード以外に出る手段が無く、リロードすると S3 に孤児が残る。
     * ストーリーの投稿（`StoriesBar`）が同じ理由で先に直してある形を借りる
     */
    /**
     * **ログインが切れたことを伝える。** 送り返さないぶん、黙っていると
     * 「公開」を押しても失敗し続ける画面に取り残される。一度だけ出す
     */
    const toldSignedOut = useRef(false);
    useEffect(() => {
        // ログインし直したら札を下ろす（二度目を無言にしない）
        if (gate === "ok") { toldSignedOut.current = false; return; }
        if (!holdingWork || toldSignedOut.current) return;
        toldSignedOut.current = true;
        showToast(locale === "en"
            ? "You are signed out. These photos can't be uploaded yet — sign in again in another tab, then publish."
            : "ログインが切れました。この写真はまだ上げられません。別のタブでログインし直してから、もう一度お試しください", "error");
    }, [gate, holdingWork, locale, showToast]);

    const uploadAbortRef = useRef<AbortController | null>(null);
    /**
     * 「やめる」を押してから止まるまで。**ボタンを消さずに名前を変える**
     * ——押した瞬間に消すと、そこに居たフォーカスが `<body>` へ落ちる
     * （キーボード・読み上げの人は位置を失う）。手本の `StoriesBar` も
     * 同じボタンを残して名前だけ変えている
     */
    const [stopping, setStopping] = useState(false);
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
        // 切る向きのときは、保存できていないことを言う——黙っていると、
        // 次に開いたときに戻ってしまい、**切ったつもりの人の写真から
        // 撮影地が入って公開される**（容量不足・プライベートモードで起きる）。
        //
        // **入れ直す向きは黙る。** 理由は「既定がオンだから」ではない
        // ——保存済みが `"0"` なら次回もオフのままで、既定は関係ない
        // （レビューの指摘で気づいた）。黙るのは**戻らなかったときに
        // 倒れる先が安全側**（地名が入らない）だから。
        applyGpsAutofill(next);
        if (!saved && !next) {
            showToast(locale === "en"
                ? "Turned off here, but this device can't save the setting — check it again next time."
                : "この画面ではオフにしました。ただし設定を保存できないので、次に開いたときの状態は保証できません。", "error");
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
     * 枚数の上限（api-user/src/photoLimit.ts の PHOTO_LIMIT_PER_USER）は
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
    const [ownValues, setOwnValues] = useState<OwnValues>({ locations: [], categories: [] });
    // **候補は打ちかけの文字で絞る。** 枠は12個だが owner のタグは実データで
    // 59種あり、絞らないと上位12種しか選べない（残り47種は打つしかない＝
    // 打つから表記が割れる）。理由と実測は `suggestTags` に書いた
    const tagSuggestions = useMemo(() => suggestTags(TAG_CHOICES, tags, TAG_CHOICES.length), [tags]);
    /**
     * いま選んでいるタグ（モック④の「#サントリーニ ✕」の並び）。
     * **欄はカンマ区切りの文字列のまま**なので、ここで切り出すだけ——
     * 状態を2つ持つと「欄に打った字」と「チップ」がずれる。
     */
    const chosenTags = useMemo(() => {
        // **`tagKey` で畳む。** 生の綴りで並べると `桜, 桜` が React の
        // 同じ key で2つ並び（開発ビルドで警告・並び替えで壊れる）、
        // `自然, nature` は**2つ出るのに ✕ が両方消す**（`toggleTag` は
        // キーで外すため）。畳んだ結果は**最初に打った綴り**を残す
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of tags.split(TAG_SEPARATOR)) {
            const t = raw.trim();
            if (!t) continue;
            const key = tagKey(t) || t;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
        }
        return out;
    }, [tags]);

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
    /**
     * **選んだ写真を1件の投稿にまとめるか**（owner のモックの「1/10」）。
     *
     * 既定は off ＝ **今までどおり「N枚選ぶ → N件の投稿」**。owner は
     * まとめて上げる使い方をしているので、既定を変えると黙って挙動が変わる。
     *
     * on のとき: 1枚目が表紙（`src`）、残りが `extraImages`。題・説明・
     * 撮影地は**1枚目のもの**を使う（投稿が1件なので1組しか持てない）。
     */
    const [asOnePost, setAsOnePost] = useState(false);

    /**
     * **いま編集している写真**（モックのヒーローと、サムネ帯の「1/5」）。
     *
     * 題・説明・撮影地は**写真ごと**に持つ（`Item`）。前の画面は同じ名前の欄を
     * 枚数ぶん縦に並べていたので、5枚選ぶと「タイトル（任意）」が5つ並んだ。
     * モックは1枚ぶんの欄しか持たないので、**サムネで選んだ1枚の欄だけ**を出す。
     *
     * 消えた ID・未設定のときは**先頭に落とす**（下の `selected`）。ここで
     * `null` のままにすると、削除した直後に「どれも選ばれていない空白」が残る。
     */
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const remainingSlots = isAdminUser || usedSlots === null
        ? null
        : Math.max(0, PHOTO_LIMIT_PER_USER - usedSlots);

    // PWA Share Target で渡された写真の取り込み。
    // ログインのリダイレクトでは `?from=share` は保たれる（`safeNextPath` が
    // search ごと運ぶ）。それでも 1時間以内のペイロードを次回の表示で拾うのは、
    // **クエリを落としたあと**に開き直した場合の受け皿として。
    /**
     * **書きかけを端末に控える**（#8）。iOS はバックグラウンドのページを黙って
     * 捨てるので、カメラや写真の選択・別のアプリから戻ると読み込み直しになり、
     * 選んだ写真も打った題名・説明も消えていた。画面が隠れる瞬間に、まだ
     * 上げていない写真と入力を控え、開き直したときに戻す
     * （`lib/utils/uploadDraft.ts`）。上げ始めたら消し、上げ終わったら残り
     * （失敗した写真）で書き直す。上げている最中に画面を離れたら消す
     * （上げる処理は画面が閉じても続くので、残すと二重に上がる）。
     */
    const draftSourceRef = useRef({ items: [] as Item[], category: "", tags: "", asOnePost: false, uploading: false, userId: null as string | null });
    // **最後に分かっていた持ち主を覚えておく。** セッションが切れると userId は
    // null になるが、画面は写真を守ったまま「別のタブでログインし直して」と
    // 案内する（holdingWork）。その案内どおりに離れた瞬間に控えを消すと、
    // iOS がページを捨てたときに全部失う。明示的なログアウトは
    // forgetUploadDraftOnSignOut が書き込みを止める
    const lastUserIdRef = useRef<string | null>(null);
    /** 持ち主が入れ替わるたびに進む番号。待っている間に入れ替わった処理の結果を捨てる */
    const ownerGenRef = useRef(0);
    /**
     * **このタブが控えを書いた・読んだ持ち主。** 控えを消してよいのは、その人の
     * 控えだと分かっているときだけ。置き場は1つで、入れ替わったあと（凍っていた
     * タブが戻ってきた場合など）は別の人の控えが入っていることがある——写真0枚で
     * 隠れた・上げ始めた、のたびに無条件に消すと、それを消してしまう
     */
    const draftOwnedByRef = useRef<string | null>(null);
    const clearOwnDraft = useCallback(() => {
        const owner = draftSourceRef.current.userId;
        if (!owner || draftOwnedByRef.current !== owner) return;
        draftOwnedByRef.current = null;
        void clearUploadDraft();
    }, []);
    /** 入れ替わりで上げるのを止めた（新しい人に「やめました」を出さない） */
    const abortedBySwitchRef = useRef(false);
    // **別の人に入れ替わったら、前の人の写真を捨てる。** 投稿画面を開いたまま
    // 別のタブで A がログアウトし B がログインすると、このタブの userId は
    // A → null → B と変わる。前の人の写真（原本）を B の控えとして書いたり、
    // B がそのまま投稿したりしないよう、画面からも控えからも消す。
    // 持ち主の更新はこの effect だけで行う——描画の途中で B に変えると、
    // effect までの間に隠れたときに A の写真を B の名で控えてしまう
    useEffect(() => {
        if (!userId) return;
        const prev = lastUserIdRef.current;
        lastUserIdRef.current = userId;
        allowUploadDraft();
        if (prev && prev !== userId) {
            ownerGenRef.current++;
            // **上げている最中なら止める。** 止めないと、ループは前の人の写真を
            // 持ったまま進み、新しい人のログイン情報で置き場所の発行も保存も
            // 通って、前の人の写真が新しい人の名で公開される
            if (uploadAbortRef.current) {
                abortedBySwitchRef.current = true;
                uploadAbortRef.current.abort(new DOMException("owner switched", "AbortError"));
            }
            setItems((cur) => { for (const it of cur) URL.revokeObjectURL(it.preview); return []; });
            setCategory("");
            setTags("");
            // 控えは消さない: 置き場は1つだけで、いま入っているのが新しい人の
            // 控えのこともある（凍っていたタブが戻ってきた場合）。前の人の控えは
            // 読むときに持ち主の違いで捨てられる（readUploadDraft）
        }
    }, [userId]);
    // 控えの持ち主: 分かっている人と同じならその人。セッションが切れた（null）
    // なら最後に分かっていた人。**別の人に変わった直後は「分からない」**
    // （書かずに消す側に倒れる）
    const draftOwner = userId
        ? (lastUserIdRef.current === null || lastUserIdRef.current === userId ? userId : null)
        : lastUserIdRef.current;
    draftSourceRef.current = { items, category, tags, asOnePost, uploading, userId: draftOwner };
    /**
     * 控えを戻す判断が済んだか。**済むまでは書かない・消さない**——ログインの
     * 確認中（写真0枚に見える）に画面が隠れると、戻す前の控えを消してしまう
     */
    const draftReadyRef = useRef(false);
    /** 今の状態で控えを書き直す（上げ終わったとき、成功・失敗にかかわらず呼ぶ） */
    const persistDraftRef = useRef<() => void>(() => { /* 下の effect が差し替える */ });
    // **上げ始めたら控えを消し、上げ終わったら残り（失敗した写真）で書き直す。**
    // 全部成功したときしか消していなかったので、一部だけ上がった回は古い控えが
    // 残り、次に開くと公開済みの写真が戻っていた（二重投稿）
    const wasUploadingRef = useRef(false);
    useEffect(() => {
        if (uploading && !wasUploadingRef.current) clearOwnDraft();
        if (!uploading && wasUploadingRef.current) persistDraftRef.current();
        wasUploadingRef.current = uploading;
    }, [uploading, clearOwnDraft]);
    useEffect(() => {
        const persist = () => {
            const src = draftSourceRef.current;
            if (!draftReadyRef.current) return;
            // **上げている最中も書き直す。** 飛ばすと、上げている最中に離れた・
            // 一部だけ上がった回に古い控えが残り、次に開くと公開済みの写真が
            // 戻っていた（二重投稿）。**公開まで済んだ写真（done）だけ除く。**
            // 上げている途中・保存で落ちた写真も残す——除くと、iOS がページを
            // 捨てたときにその写真だけ投稿にも控えにも残らない。S3 まで
            // 上がったものは置き場所（uploaded）ごと控え、押し直したときに使い回す
            // 持ち主が分からない（入れ替わった直後）ときは触らない——消すと、
            // 置き場に入っている新しい人の控えまで消えることがある
            if (!src.userId) return;
            const keep = src.items.filter((i) => i.status !== "done");
            if (keep.length === 0) { clearOwnDraft(); return; }
            draftOwnedByRef.current = src.userId;
            void saveUploadDraft({
                t: Date.now(),
                userId: src.userId,
                category: src.category,
                tags: src.tags,
                asOnePost: src.asOnePost,
                items: keep.map((i) => ({
                    file: i.file, title: i.title, description: i.description, location: i.location,
                    focalPoint: i.focalPoint, dateTimeOriginal: i.dateTimeOriginal,
                    latitude: i.latitude, longitude: i.longitude,
                    uploaded: i.uploaded,
                })),
            });
        };
        persistDraftRef.current = persist;
        const onHidden = () => { if (document.visibilityState === "hidden") persist(); };
        document.addEventListener("visibilitychange", onHidden);
        window.addEventListener("pagehide", persist);
        return () => {
            document.removeEventListener("visibilitychange", onHidden);
            window.removeEventListener("pagehide", persist);
            // **画面の中の移動（タブバー・リンク）では隠れる合図が来ない。**
            // 離れるときにも今の状態で書き直す——でないと、写真を全部外して
            // 離れたのに、前に隠れたときの控えが残り、次に開くと外した写真が戻る。
            // **上げている最中に離れたら消す。** 上げる処理は画面が閉じても続くので、
            // 控えに残した写真はこのあと上がる＝次に開くと二重に投稿される
            if (draftSourceRef.current.uploading) clearOwnDraft();
            else persist();
        };
    }, [clearOwnDraft]);

    const restoreDraft = useCallback(async () => {
        const uid = draftSourceRef.current.userId;
        if (!uid) return;
        const gen = ownerGenRef.current;
        const d = await readUploadDraft(uid);
        if (!d) return;
        // 読んでいる間に別の人へ入れ替わったら、戻さない
        if (gen !== ownerGenRef.current) return;
        // この人の控えがある（戻さなかったとしても、あとで消してよい）
        draftOwnedByRef.current = uid;
        // 読み込み中に選び直していたら、その写真を上書きしない（反映前の一瞬も
        // 下の関数形の setItems で守る）
        const restored: Item[] = d.items.map((it) => ({
            id: makeId(),
            file: it.file,
            preview: URL.createObjectURL(it.file),
            focalPoint: it.focalPoint,
            title: it.title,
            description: it.description,
            location: it.location,
            dateTimeOriginal: it.dateTimeOriginal,
            latitude: it.latitude,
            longitude: it.longitude,
            uploaded: it.uploaded,
            status: "pending",
            progress: 0,
        }));
        // もう選び直していたら上書きしない
        if (draftSourceRef.current.items.length > 0) {
            for (const r of restored) URL.revokeObjectURL(r.preview);
            return;
        }
        setItems((prev) => (prev.length > 0 ? prev : restored));
        setCategory(d.category);
        setTags(d.tags);
        setAsOnePost(d.asOnePost);
        showToast(locale === "en"
            ? `Restored what you were writing (${restored.length} photo(s)).`
            : `書きかけを戻しました（${restored.length}枚）`, "info");
    }, [locale, showToast]);

    const shareImportedRef = useRef(false);
    useEffect(() => {
        if (loading || !isAuthenticated || shareImportedRef.current) return;
        shareImportedRef.current = true;
        void (async () => {
            try {
                await importSharedOrDraft();
            } finally {
                // ここから先の「隠れた・離れた」で控えを書いてよい
                draftReadyRef.current = true;
            }
        })();
        async function importSharedOrDraft() {
            const gen = ownerGenRef.current;
            const res = await readSharedResult();
            // 読んでいる間に別の人へ入れ替わったら、取り込まない
            if (gen !== ownerGenRef.current) return;
            // **`from=share` は使い終わったら URL から落とす。**
            // 残っていると (a) 戻る・進む・リロードのたびに同じ話をする
            // (b)「受け皿が空」を失敗と呼べない——共有の直後に空なら、
            // それは **Service Worker が保存に失敗した**ということなのに、
            // 「取り込み済みの再表示」と区別が付かなかった（レビュー指摘）。
            // **`history.state` は必ず引き継ぐ**——`replaceState({})` で
            // Next の内部キーを潰し、戻るが `location.reload()` に落ちた
            // 事故がある（`aadd283`）。
            if (fromShare && typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.searchParams.delete("from");
                window.history.replaceState(window.history.state, "", url.toString());
            }
            // **黙って空の画面にしない。** 共有シートから送ると SW がここへ
            // 飛ばすので、利用者は「送ったのに写真が入っていない」画面を見る。
            // 受け皿を開けない端末（プライベートモード・ストレージ拒否）も、
            // SW が保存に失敗した場合も、見た目は同じ
            if (!res.ok || (fromShare && !res.payload)) {
                if (fromShare) {
                    showToast(locale === "en"
                        ? "Couldn't read the shared photos on this device. Please pick them from the button below."
                        : "共有された写真をこの端末から読み取れませんでした。下のボタンから選んでください。", "error");
                }
                return;
            }
            const payload = res.payload;
            if (!payload) {
                // 共有で来たのでなければ、前に控えた書きかけを戻す（#8）
                await restoreDraft();
                return;
            }
            // 空のペイロード（共有シートがファイル無しで来た）も捨てる。
            // 残すと IndexedDB に居座り続ける（他の分岐は必ず消している）。
            if (payload.files.length === 0) {
                await clearSharedPayload();
                return;
            }
            // **負の経過時間は「新しい」にしない**（`public/sw.js` の
            // `isFreshEnough` と同じ判断）。刻んだのも読むのも同じ端末の時計
            // なので、巻き戻すと差が負になって何日前の控えでも通ってしまう
            const age = Date.now() - payload.t;
            const isFresh = age >= 0 && age < 60 * 60 * 1000;
            if (!fromShare && !isFresh) {
                await clearSharedPayload();
                return;
            }
            await addFiles(payload.files, { title: payload.title, text: payload.text });
            await clearSharedPayload();
            showToast(locale === "en" ? `${payload.files.length} photo(s) imported` : `${payload.files.length} 枚を取り込みました`, "success");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromShare, loading, isAuthenticated]);

    // **プロフィール写真の欄はこの画面から外した**（2026-09-22・最終版モック）。
    // モックの「投稿作成画面」には無く、同じ操作が `/user/profile` に
    // 丸ごとある（アバターもカバーも・presigned URL も同じ
    // `POST /profile/avatar/presigned-url`）。投稿を作る画面に「自分の顔を
    // 変える」欄が同居していたのは、この画面が「マイページ代わり」だった
    // 名残りで、**同じものを二度持っていた**。

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
            // **位置情報が1枚も無かったら、そう言う。** iPhone の「写真を撮る」で
            // 撮った写真は、iOS が位置情報を外して渡す（写真ライブラリからでも
            // 設定次第で外れる）。黙っていると、自動入力が壊れているのか
            // 写真に無いのか分からない（#10）。画面を離れていたら言わない
            // （全画面共通のトーストなので、よその画面に出る）。長めに出す
            if (!leftPageRef.current && exifResults.length > 0
                && exifResults.every((r) => r.meta.latitude === undefined || r.meta.longitude === undefined)) {
                showToast(locale === "en"
                    ? "No location data in the photo(s), so the place wasn't filled in. (Photos taken with the camera from this screen often have location removed.)"
                    : "写真に位置情報が無かったので、撮影地は入れていません（この画面のカメラで撮った写真は、位置情報が外れていることがあります）", "info", 6000);
            }
            for (const r of exifResults) {
                if (leftPageRef.current) break;   // 画面を離れた。続きは投げない
                // **毎回トグルを見る。** 入るときに1回見るだけだと、待っている
                // 途中で切っても止まらず、公開ボタンが解放されない（実測）
                if (!gpsAutofillRef.current) break;
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
    }, [locale, showToast]);

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
        abortedBySwitchRef.current = false;
        setStopping(false);
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        const { signal } = controller;
        // **押した状態から必ず抜ける。** ここから下で何が投げても `finally` が
        // `uploading` を下ろす。手本にした `StoriesBar` は最初からこの形で、
        // そこだけ借りていなかった（台帳 D-9 もこれで閉じる）
        try {
            // 管理者でもユーザーAPIを使う。管理APIの savePhoto は published を見ずに
            // 常に true で保存するため、「下書き保存」を押しても即公開になっていた
            // （しかも撮影日・サムネURL・代表色・ぼかしも受け取らないので全部捨てられる）。
            // ユーザーAPI側は isAdmin を見て100枚制限だけ免除している。
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const apiFetch = userFetch;

            const tagList = tags ? splitTags(tags) : undefined;
            // 編集画面と同じ理由（`app/user/edit/page.tsx` を見よ）。
            // 上限は画面に対応物が無く、超えた分は 200 のまま消える
            if (tagList && tagList.length > TAGS_MAX) {
                showToast(locale === "en"
                    ? `Up to ${TAGS_MAX} tags (${tagList.length}). The rest won't be saved`
                    : `タグは${TAGS_MAX}個までです（${tagList.length}個）。超えた分は保存されません`, "error");
            }
            // **タグ1つの長さも切られる**（件数だけ見ていた）。欄に
            // `maxLength` は置けない——上限は**タグ1つあたり**なので、
            // カンマ区切りの1入力に当てると「サーバーは受け付けるのに
            // 入力できない」に倒れる。編集画面と同じ扱いで告げるだけ
            const longTag = tagList?.reduce((n, t) => Math.max(n, t.length), 0) ?? 0;
            if (longTag > TAG_LEN_MAX) {
                showToast(locale === "en"
                    ? `Up to ${TAG_LEN_MAX} characters per tag (${longTag}). The rest won't be saved`
                    : `タグ1つは${TAG_LEN_MAX}字までです（${longTag}字）。超えた分は保存されません`, "error");
            }
            // **文字数で見る**（この画面は説明を文字列で送るので、段落数は効かない）
            const longDesc = pending.find((it) => it.description.trim().length > DESC_STRING_MAX);
            if (longDesc) {
                showToast(locale === "en"
                    ? `Up to ${DESC_STRING_MAX} characters in the description. The rest won't be saved`
                    : `説明は${DESC_STRING_MAX}字までです。超えた分は保存されません`, "error");
            }

            /**
             * **1件の投稿にまとめるか。** 2枚以上あるときだけ意味を持つ。
             * 枚数が上限（`PHOTO_IMAGES_MAX`）を超えるときは、まとめずに
             * 今までどおり1枚ずつにする——**黙って11枚目以降を落とさない**
             * （押せないようにボタン側でも止めているが、ここでも見る）
             */
            const groupMode = asOnePost && pending.length > 1 && pending.length <= PHOTO_IMAGES_MAX;
            /** まとめる回に、S3 へ上げ終わったぶんを控える（1枚目が表紙） */
            // 寸法（`width`/`height`）はこの画面が持っていないので送らない
            // ——ビルド（`generate-thumbnails.js`）が埋める
            const group: Array<{
                item: Item; key: string; publicUrl: string; thumbUrl?: string;
                dominantColor?: string | null; blurDataURL?: string | null;
            }> = [];

            let successCount = 0;
            // **失敗は別に数える。** やめたときは「上げていない残り」が出るので
            // `pending.length - successCount` は使えない（手を付けていない
            // 写真まで「失敗」に数えてしまう）
            let failCount = 0;
            let cancelled = false;
            for (const item of pending) {
                // **1枚ごとに見る。** 5枚選んで2枚目でやめたとき、残りを上げ始めない
                if (signal.aborted) { cancelled = true; break; }
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
                        failCount++;
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
                        // **presign と PUT は共有の関数へ。** 差し替え
                        // （`/user/edit`）も同じ手順を通るので、写すと
                        // 片方だけ古くなる（鍵の控え・署名した種別・
                        // 文言の決まりごとは `uploadToS3.ts` に書いてある）
                        const put = await presignAndPut(uploadFile, {
                            signal,
                            startFailed: locale === "en" ? "Could not start the upload." : "アップロードを開始できませんでした。",
                            putFailed: UPLOAD_FAILED_MESSAGE,
                            onKeyReserved: (k) => {
                                reservedKey = k;
                                updateItem(item.id, { progress: 40 });
                            },
                            onUploaded: () => { reservedKey = undefined; },
                        });
                        key = put.key;
                        publicUrl = put.publicUrl;
                    }
                    updateItem(item.id, { progress: 70 });

                    // 一覧グリッド用の 512px WebP サムネイルを併せてアップロードする。
                    // グリッドがフル画像（〜1920px）を落とすのが読み込みの遅さの主因。
                    // サムネ生成/アップロードに失敗しても本体の投稿は成立させる。
                    try {
                        if (thumbUrl) throw new SkipThumb(); // 前回上げた分を使う
                        // **縮めた方から作る。** 原寸（24〜48MP）を読み直すと、1枚ごとに
                        // 4回デコードすることになり、iPhone でタブが落ちやすかった（#26）。
                        // 縮めた方は向きも反映済み（または EXIF の向きを残している）
                        const thumb = await createThumbnail(uploadFile);
                        if (thumb) {
                            const thumbPresign = await apiFetch("/upload/presigned-url", {
                                method: "POST",
                                signal,
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
                                    signal,
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
                        // **中断はここで握らない。** サムネの失敗は「無しで続ける」
                        // 設計だが、やめたときまで続けると原寸のデコードを3回と
                        // セッションの待ち（最大10秒）を通ってからようやく止まる
                        if ((e as { name?: string } | null)?.name === "AbortError" || signal.aborted) throw e;
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
                    const dominantColor = await extractDominantColor(uploadFile);

                    // ぼかしプレビュー（blur-up 用の極小画像）。失敗しても続行
                    const blurDataURL = await createBlurPlaceholder(uploadFile);

                    // 撮影情報（カメラ・レンズ・絞り等）: 圧縮で EXIF が失われる前に
                    // 元ファイルから抽出して保存する。GPS は含めない（coords で別管理）
                    const cameraExif = await extractCameraExif(item.file);

                    // **重い処理のあとにもう一度見る。** 代表色・ぼかしのデコードと
                    // EXIF の読み取りは、どれも `signal` を見ない。その間に
                    // 押した「やめる」は保存まで効かず、写真が1枚できあがる
                    // （実 `userFetch` はセッション取得に最大10秒使うので、
                    //   保存の口に届いてから止まるのでは遅い）
                    if (signal.aborted) throw new DOMException("cancelled", "AbortError");

                    // **1件にまとめる回は、ここでは保存しない。** 2枚目以降は
                    // `extraImages` として最後の1回の保存に乗せる。
                    // **控えるのは S3 に上がったもの**（`item.uploaded` と同じ
                    // 中身）なので、保存に失敗しても押し直せば使い回せる
                    // ——1枚ずつの経路と同じ扱い
                    if (groupMode) {
                        group.push({ item, key, publicUrl, thumbUrl, dominantColor, blurDataURL });
                        updateItem(item.id, { progress: 90 });
                        continue;
                    }

                    const saveResponse = await apiFetch("/upload/save", {
                        method: "POST",
                        signal,
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
                            // 一覧での切り抜き位置。**動かしていなければ送らない**
                            // ——中央は既定なので、属性を持たない今までの写真と
                            // 同じ形で保存される
                            ...(item.focalPoint ? { focalPoint: item.focalPoint } : {}),
                            ...(dominantColor ? { dominantColor } : {}),
                            ...(blurDataURL ? { blurDataURL } : {}),
                            ...(thumbUrl ? { thumbUrl } : {}),
                            ...(Object.keys(cameraExif).length > 0 ? { exif: cameraExif } : {}),
                            // 共同アルバム（案C）。メンバーでなければサーバーが断る
                            ...(albumId ? { albumId } : {}),
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
                    // **やめたときは待つ。** 投げっぱなしだと、利用者は DELETE が
                    // 飛ぶ前に離脱できる（タブを閉じる・戻る）——この修正が目的に
                    // している孤児がそのまま残る。手本も `await` している
                    if (stale.length) {
                        // **待つが、待ち続けない。** `discardKeys` は
                        // `userFetch`（セッション最大10秒＋要求20秒）を
                        // キーごとに直列で回すので、返らない回線では
                        // 本体＋サムネで最悪60秒。**その回線こそ「やめる」が
                        // 要る場面**なので、上限を切って画面を先に返す
                        // （要求は投げたまま。捨て損ねても記録は残る）
                        if (signal.aborted) await waitAtMost(discardKeys(stale), CANCEL_DISCARD_WAIT_MS);
                        else void discardKeys(stale);
                    }
                    // **やめたのは失敗ではない。** 中断は利用者の操作なので、
                    // その写真を「エラー」にせず「待ち」に戻して畳む
                    // （ストーリー側と同じ扱い。あちらは下書きごと閉じる）
                    // **`err` は null でも来る。** `(err as {…}).name` と書くと
                    // そこで TypeError になり catch の外へ抜けて `uploading` が
                    // 下りない——「押しても何も起きないボタンだけが残る」状態を、
                    // それを直すための修正で作っていた
                    if ((err as { name?: string } | null)?.name === "AbortError" || signal.aborted) {
                        updateItem(item.id, { status: "pending", progress: 0, error: undefined });
                        cancelled = true;
                        break;
                    }
                    // オフラインの fetch は "Failed to fetch" を投げる。そのまま
                    // 出していたので、画面に英語の技術文字列が並んでいた。
                    // 見せてよいのは、こちらが日本語で組み立てたものだけ
                    updateItem(item.id, { status: "error", error: userFacingUploadError(err) });
                    failCount++;
                }
            }

            // **まとめる回は、ここで1回だけ保存する。**
            //
            // 1枚目が表紙（`src`）、2枚目以降が `extraImages`。題・説明・撮影地は
            // 1枚目のものを使う（投稿が1件なので1組しか持てない）。
            //
            // **途中でやめた回は保存しない**——半端な枚数で1件できてしまうと、
            // 「やめた」のに投稿が世に出る。上げ終わったぶんは `item.uploaded` に
            // 残るので、押し直せば使い回せる（1枚ずつの経路と同じ）。
            if (groupMode && group.length > 0 && !cancelled && !signal.aborted) {
                const [cover, ...rest] = group;
                const c = cover.item;
                try {
                    const coords = gpsAutofill && c.latitude !== undefined && c.longitude !== undefined
                        ? { lat: Math.round(c.latitude * 100) / 100, lng: Math.round(c.longitude * 100) / 100 }
                        : undefined;
                    const cameraExif = await extractCameraExif(c.file);
                    const saveResponse = await apiFetch("/upload/save", {
                        method: "POST",
                        signal,
                        body: JSON.stringify({
                            key: cover.key, publicUrl: cover.publicUrl,
                            published,
                            ...(c.dateTimeOriginal ? { date: c.dateTimeOriginal } : {}),
                            title: c.title || undefined,
                            description: c.description || undefined,
                            location: c.location || undefined,
                            category: category || undefined,
                            tags: tagList,
                            ...(coords ? { coords } : {}),
                            ...(c.focalPoint ? { focalPoint: c.focalPoint } : {}),
                            ...(cover.dominantColor ? { dominantColor: cover.dominantColor } : {}),
                            ...(cover.blurDataURL ? { blurDataURL: cover.blurDataURL } : {}),
                            ...(cover.thumbUrl ? { thumbUrl: cover.thumbUrl } : {}),
                            ...(Object.keys(cameraExif).length > 0 ? { exif: cameraExif } : {}),
                            ...(albumId ? { albumId } : {}),
                            // **2枚目以降。** サーバーは表紙とまったく同じ厳しさで
                            // 確かめる（`api-user/src/photoImages.ts`）ので、
                            // 通らなかったぶんは黙って落ちる——だから枚数は
                            // こちらでも上限内に収めてある
                            extraImages: rest.map((g) => ({
                                src: g.publicUrl, key: g.key,
                                ...(g.thumbUrl ? { thumbSrc: g.thumbUrl } : {}),
                                ...(g.dominantColor ? { dominantColor: g.dominantColor } : {}),
                                ...(g.blurDataURL ? { blurDataURL: g.blurDataURL } : {}),
                            })),
                        }),
                    });
                    if (!saveResponse.ok) {
                        throw new Error(await readApiError(saveResponse,
                            locale === "en" ? "Could not save the photo." : "写真を保存できませんでした。"));
                    }
                    for (const g of group) updateItem(g.item.id, { status: "done", progress: 100 });
                    successCount = group.length;
                    // **枠は1件ぶんしか減らない**（投稿が1件なので）。
                    // ここを枚数ぶん引くと「あと N 枚」が実際より少なく出る
                    setUsedSlots((n) => (n === null ? n : n + 1));
                } catch (err) {
                    log.error("grouped upload save failed:", err);
                    const msg = userFacingUploadError(err);
                    for (const g of group) updateItem(g.item.id, { status: "error", error: msg });
                    failCount = group.length;
                }
            }

            // **`signal.aborted` も見る。** `abort()` は決着済みの Promise を
            // 巻き戻せないので、押した時点で保存の応答が届いていた回は
            // `cancelled` が立たず、「アップロードしました」と出してトップへ
            // 移していた（やめたのに遷移する）
            if (cancelled || signal.aborted) {
                // 別の人に入れ替わって止めた回は、新しい人に前の人の話をしない
                if (abortedBySwitchRef.current) { abortedBySwitchRef.current = false; return; }
                // 上げ終わったぶんは残る（画面にも「完了」で出ている）。
                // やめたことだけ伝えて、この画面に留まる（遷移しない）
                showToast(locale === "en"
                    ? (successCount > 0 ? `Stopped. ${successCount} uploaded.` : "Stopped uploading")
                    : (successCount > 0 ? `やめました（${successCount}枚は完了）` : "アップロードをやめました"), "info");
                // **失敗したことは、やめても伝える。** ここは `return` で抜けるので、
                // 下の「N 件失敗しました」に届かない——本当に落ちた写真が
                // あった回だけ、その通知が静かに消えていた
                if (failCount > 0) {
                    showToast(locale === "en" ? `${failCount} upload(s) failed` : `${failCount} 件失敗しました`, "error");
                }
                return;
            }
            if (successCount > 0) {
                // **まとめた回は「1件の投稿」と言う。** 「5枚アップロード
                // しました」だと5件できたように読める（枠も1つしか減らない）。
                // **ここで `return` しない**——下の「N 件失敗しました」に
                // 届かなくなる（上げ損ねた写真があった回だけ、その通知が
                // 静かに消える。`2a90081e` で一度踏んだ形）
                showToast(
                    groupMode
                        ? (published
                            ? (locale === "en"
                                ? `Posted 1 photo set (${successCount} photos)`
                                : `${successCount}枚を1件の投稿にしました`)
                            : (locale === "en"
                                ? `Saved 1 draft (${successCount} photos). Fill in details later and publish.`
                                : `${successCount}枚を1件の下書きにしました。あとで編集して公開できます`))
                        : (published
                            ? (locale === "en" ? `${successCount} photo(s) uploaded` : `${successCount} 枚アップロードしました`)
                            : (locale === "en"
                                ? `Saved ${successCount} draft(s). Fill in details later and publish.`
                                : `${successCount} 枚を下書き保存しました。あとで編集して公開できます`)),
                    "success",
                );
                // 全件成功時に遷移（items はループ開始時のクロージャなのでカウントで判定する）。
                // 公開はトップへ、下書きは下書き一覧へ。
                if (successCount === pending.length) {
                    // 全部上がったので、書きかけの控えは要らない
                    clearOwnDraft();
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
        } finally {
            setUploading(false);
            setStopping(false);
            uploadAbortRef.current = null;
        }
    }, [items, category, tags, gpsAutofill, locale, router, showToast, updateItem, discardKeys, albumId, asOnePost, clearOwnDraft]);

    // 権限が無い人はログイン画面へ送り返さない（/login が押し返して往復する）
    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    // **送り返さないと決めた回は、画面も出す。** ここでスピナーに落とすと
    // 「取り込んだ写真を消さない」ために送り返さなかった意味が無い
    // （見えないまま止まるだけで、選び直すのと同じことになる）
    if (gate !== "ok" && !holdingWork) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-3xl mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const doneCount = items.filter((i) => i.status === "done").length;
    const pendingCount = items.filter((i) => i.status === "pending" || i.status === "error").length;
    /**
     * 1件にまとめるには多すぎるか。**まとめずに1枚ずつへ倒す**——
     * ここで黙って先頭10枚だけにすると、11枚目以降が消えたことに
     * 気づけない（保存は成功して、あとで開くと足りない）
     */
    const tooManyToGroup = pendingCount > PHOTO_IMAGES_MAX;
    /** 押したときに1件の投稿になるか（ボタンの文言に出す） */
    const willBeOnePost = pendingCount <= 1 || (asOnePost && !tooManyToGroup);
    const isJa = locale !== "en";

    /** サムネで選んでいる写真（ヒーローに出る）。消えた ID・未設定のときは先頭 */
    const selected: Item | undefined = items.find((i) => i.id === selectedId) ?? items[0];
    /** 読み上げる名前に入れる「何枚目か」。1 始まり */
    const selectedNo = selected ? items.findIndex((i) => i.id === selected.id) + 1 : 0;

    /**
     * **まとめる回に、題・説明・撮影地が実際に保存される1枚。**
     *
     * `handleUploadAll` は `pending`（まだ上げていない写真）の**先頭**を表紙に
     * して、その1枚の題・説明・撮影地を投稿に載せる（投稿が1件なので1組しか
     * 持てない）。前の画面は全部の欄が同時に見えていたので気づけたが、
     * **1枚ぶんしか描かない今の形では、3枚目に書いたキャプションが黙って
     * 捨てられる**（レビューで出た）。だから**まとめる回は欄も表紙の1枚に
     * 固定する**——ヒーローはサムネで選んだ写真のまま切り替わる。
     *
     * 「1枚目」と決め打ちにしない。1枚目が上げ終わっている（`done`）回は、
     * 表紙になるのは**次に残っている写真**なので、番号も数え直す。
     */
    const coverItem = items.find((i) => i.status === "pending" || i.status === "error");
    const groupMode = asOnePost && pendingCount > 1 && !tooManyToGroup;
    const editing: Item | undefined = groupMode ? (coverItem ?? selected) : selected;
    const editingNo = editing ? items.findIndex((i) => i.id === editing.id) + 1 : 0;
    /** 上げ終わった写真の欄は触らせない（サーバーの値と食い違う） */
    const fieldsLocked = uploading || editing?.status === "done";

    /**
     * 欄の見た目（モックの実測）。**入力の字だけ 16px**——それ未満だと
     * iOS が焦点を当てた瞬間に画面を拡大する。
     */
    const fieldCls = "w-full px-3 bg-surface-2 border border-line rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-accent transition-colors disabled:opacity-50";
    const fieldStyle: React.CSSProperties = { fontSize: "16px" };
    const labelStyle: React.CSSProperties = { fontSize: "13px" };
    const labelCls = "block font-semibold text-white/80 mb-2";
    const counterCls = "mt-1 text-right text-white/50";
    const counterStyle: React.CSSProperties = { fontSize: "12px" };
    /** チップ（モック 高さ32・角丸 full）。`chipTapSpacing.test.tsx` が高さの前提を持つ */
    const chipCls = "px-3 rounded-full ring-1 inline-flex items-center transition-colors disabled:opacity-40";
    const chipStyle: React.CSSProperties = { minHeight: "32px", fontSize: "13px", touchAction: "manipulation" };

    /**
     * ヘッダーの ✕。**確認を挟まない**——ブラウザの戻るボタンで前からできる
     * ことと同じで、ここだけ関門を作っても抜け道が残る。
     *
     * ⚠️ **「何も残らない」わけではない。** S3 への PUT は通ったが
     * `/upload/save` で落ちた写真は `item.uploaded` に控えてあり（押し直せば
     * 使い回せるように、わざと消していない）、この画面を離れると
     * **誰も辿れない実体として S3 に残る**。掃除しているのは「✕ で1枚消した」
     * 回だけ（`removeItem` → `discardUploaded`）で、それは**この差分より前から
     * そう**——閉じ際にまとめて捨てるのは振る舞いの追加なので、ここでは
     * 事実だけ書き残す。
     *
     * 履歴が無いとき（共有シートから直接開いた回）だけトップへ逃がす。
     */
    const closeComposer = () => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(ROUTES.HOME);
    };

    return (
        <main className="min-h-screen bg-bg text-white">
            {/* ── ヘッダー（モック①⑧）。✕ ／ 題 ／ 下書き保存 ──
                高さ52px・下書き保存は青のピル（93×32画素 → 32px・角丸 full）。
                共通ヘッダー（`app/layout.tsx` の `sticky top-0`）の下に重ねる
                ので、こちらは `sticky` にしない——2本のバーが同時に貼り付くと
                狭い画面で本文が 116px ぶん隠れる */}
            <div className="border-b border-line bg-bar">
                <div className={`${COLUMN} grid grid-cols-[44px_1fr_auto] items-center gap-2`} style={{ minHeight: "52px" }}>
                    <button
                        type="button"
                        onClick={closeComposer}
                        aria-label={isJa ? "投稿の作成をやめる" : "Close"}
                        className="justify-self-start inline-flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                        style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                    >
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-center font-semibold" style={{ fontSize: "16px" }}>
                        {isJa ? "新しい投稿を作成" : "New post"}
                    </h1>
                    {/* 下書き保存: 必須項目なしで非公開保存。あとで編集して公開できる。
                        **地名の引き当てを待たない**——下書きは公開ではないので、
                        場所は後から編集画面で足せる。公開だけが待つ
                        （場所の無いまま公開される事故を過去に踏んでいるため） */}
                    <button
                        type="button"
                        onClick={() => handleUploadAll(false)}
                        disabled={uploading || pendingCount === 0}
                        className="justify-self-end px-4 rounded-full bg-accent-fill text-white font-semibold hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ minHeight: "32px", fontSize: "13px", touchAction: "manipulation" }}
                    >
                        {isJa ? "下書き保存" : "Save draft"}
                    </button>
                </div>
            </div>

            {/* iOS向け「ホーム画面に追加」ヒント（該当時のみ表示） */}
            <div className={COLUMN}>
                <AddToHomeScreenHint />
            </div>

            {/* 1024px 以上は「写真の列 ／ 入力の列」の2段組み（モックは iPhone
                だけなので、横に引き伸ばさず別に組む）。写真の列は貼り付けて
                おく——右の欄を打っている間も、どの写真の話かが見えている */}
            <div className={`${COLUMN} pb-40 lg:grid lg:grid-cols-[minmax(0,392px)_minmax(0,1fr)] lg:gap-8 lg:items-start`}>

                {/* ───────── 写真（モック①②） ───────── */}
                <div className="pt-3 lg:sticky lg:top-[calc(var(--header-h)_+_16px)]">
                    {selected ? (
                        <>
                            {/* ヒーロー（モック①）。中身は `CropFramePicker`
                                ——一覧に出る範囲をドラッグで決める既存の機能で、
                                焦点は写真ごとに保存される。
                                **モックの比（362×157画素＝ほぼ 16/7）に切り詰めない。**
                                あの枠に `object-contain` で入れると、縦長でも 3:2 でも
                                左右が黒帯になる（実ブラウザで確認した）。切り抜きの
                                白枠は**写真そのものの形**の上に描く道具なので、
                                写真を歪めない側を採る */}
                            <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-line">
                                <CropFramePicker
                                    key={selected.preview}
                                    src={selected.preview}
                                    hint={isJa
                                        ? "白い枠が一覧に表示されます（ドラッグで移動）"
                                        : "White frame = shown in the grid (drag to move)"}
                                    focalPoint={selected.focalPoint}
                                    onChange={(focalPoint) => updateItem(selected.id, { focalPoint })}
                                    // **このブラウザで開けなかった写真**（PC の Chrome で選んだ
                                    // HEIC など。`addFiles` が断るのは「画像でない」「GIF」
                                    // 「50MB超」だけなので、種別が画像で開けないファイルは
                                    // ここまで来る）。文言は公開を押したときに出るものと
                                    // 同じにする（画面ごとに書き分けない）
                                    fallback={
                                        <div className="relative bg-black flex flex-col items-center justify-center gap-2 h-40 px-6 text-center text-white/60">
                                            <PhotoIcon className="w-8 h-8" />
                                            <p style={{ fontSize: "12px" }}>{unstrippableMessage(new UnstrippableFileError("", "undecodable"), locale)}</p>
                                        </div>
                                    }
                                />
                                {/* 「1/5」（モック①）。**枚数は選んだ実数**で、絵ではない。
                                    **モックは左下だが、ここは左上に置く**——切り抜きの
                                    説明（`CropFramePicker` の帯・中央下）と実測で重なった
                                    （393px 幅で帯は左端 35px から・バッジは 12〜54px）。
                                    帯は編集画面と共有の部品なので、こちらが避ける */}
                                {items.length > 1 && (
                                    <span
                                        className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-white"
                                        style={{ fontSize: "12px" }}
                                    >
                                        {selectedNo}/{items.length}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeItem(selected.id)}
                                    disabled={uploading || selected.status === "uploading"}
                                    className="absolute top-3 right-3 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors disabled:opacity-30 z-10"
                                    aria-label={isJa ? "表示中の写真を外す" : "Remove the photo shown above"}
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <XMarkIcon className="w-5 h-5" />
                                </button>
                            </div>

                            {/* サムネ帯（モック①）。64×80（4:5・実測 60×78画素）・間6px。
                                10枚でも収まらないので横に流す */}
                            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={isJa ? "選んだ写真" : "Selected photos"}>
                                {items.map((it, i) => (
                                    <div key={it.id} className="relative flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(it.id)}
                                            aria-current={it.id === selected.id}
                                            aria-label={isJa ? `${i + 1}枚目を選ぶ` : `Select photo ${i + 1}`}
                                            className={`block overflow-hidden rounded-[10px] ring-2 transition-colors ${it.id === selected.id ? "ring-accent" : "ring-transparent hover:ring-white/30"}`}
                                            style={{ width: "64px", height: "80px", touchAction: "manipulation" }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={it.preview} alt="" className="w-full h-full object-cover" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(it.id)}
                                            disabled={uploading || it.status === "uploading"}
                                            // **語は変えない**（元から「削除」）。足すのは何枚目かだけ
                                            aria-label={isJa ? `${i + 1}枚目を削除` : `Remove photo ${i + 1}`}
                                            // **24px を下回らない**（WCAG 2.5.8・AA）。
                                            // この的は 64×80 の「選ぶ」ボタンの上に乗るので、
                                            // 小さい的に許される「間隔の例外」は使えない
                                            // ——大きさそのもので満たす
                                            className="absolute top-0.5 right-0.5 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors disabled:opacity-30 inline-flex items-center justify-center"
                                            style={{ width: "24px", height: "24px", touchAction: "manipulation" }}
                                        >
                                            <XMarkIcon className="w-3.5 h-3.5" />
                                        </button>
                                        {/* 状態（上げている最中・完了・失敗）はこの1枚の下に出す */}
                                        {it.status === "uploading" && (
                                            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                                                <div className="h-full bg-accent transition-all" style={{ width: `${it.progress}%` }} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {/* 「追加する（1-10枚）」（モック①）。**枚数はサーバーと
                                    同じ定数**（`PHOTO_IMAGES_MAX`）から出す */}
                                <label
                                    htmlFor="files-input"
                                    className="flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line text-white/70 cursor-pointer hover:border-accent focus-within:border-accent transition-colors"
                                    style={{ width: "64px", height: "80px", touchAction: "manipulation" }}
                                >
                                    <PlusIcon className="w-5 h-5" />
                                    {/* **枚数は書かない。** モックは「（1-10枚）」だが、
                                        `PHOTO_IMAGES_MAX` は**1件の投稿に入る枚数**の上限で、
                                        選べる枚数ではない（既定は N枚 → N件の投稿）。
                                        10枚の話は「1件の投稿にまとめる」の説明が持つ */}
                                    <span className="text-center leading-tight" style={{ fontSize: "11px" }}>
                                        {isJa ? "追加する" : "Add"}
                                    </span>
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
                            </div>
                        </>
                    ) : (
                        /* 1枚も選んでいないとき。モックに「空の状態」は無いので、
                           ヒーローと同じ枠に選ぶ導線を置く。
                           **入力は sr-only にする（hidden にしない）。**
                           `hidden` は display:none なので、その input は**フォーカス
                           できない**——`<label>` 自体もタブ順に入らないので、
                           キーボードだけの人は写真を選ぶ手段が無く、このページで
                           何もできなかった（ドロップも貼り付けも `ref.click()` も無い）。
                           sr-only なら見た目はそのままで、Tab で届き Enter で開ける。 */
                        <label
                            htmlFor="files-input"
                            className="flex flex-col items-center justify-center w-full rounded-2xl border-2 border-dashed border-line cursor-pointer hover:border-accent focus-within:border-accent transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "180px" }}
                        >
                            <PhotoIcon className="w-10 h-10 text-white/40 mb-2" />
                            <p className="font-semibold text-white/70" style={{ fontSize: "14px" }}>
                                {isJa ? "タップして写真を選ぶ" : "Tap to choose photos"}
                            </p>
                            <p className="text-white/50 mt-1" style={{ fontSize: "12px" }}>
                                {isJa ? "複数選択OK・各50MBまで" : "Multiple selection supported (max 50MB each)"}
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
                    )}

                    {/* カメラ直撮り（スマホで背面カメラを直接起動）。ギャラリー選択とは別入力にする */}
                    <label
                        htmlFor="camera-input"
                        className="mt-2 flex items-center justify-center gap-2 w-full rounded-xl bg-surface-2 ring-1 ring-line hover:brightness-125 focus-within:ring-accent transition cursor-pointer text-white/80"
                        style={{ touchAction: "manipulation", minHeight: "44px", fontSize: "14px" }}
                    >
                        <CameraIcon className="w-5 h-5 text-white/60" />
                        {isJa ? "写真を撮る" : "Take a photo"}
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

                    {/* 残り枚数。**上限に当たるまで見えなかった**ので、選ぶ前に出す。
                        取れていなければ何も出さない（推測した数字は見せない）。 */}
                    {remainingSlots !== null && (
                        <p className={`mt-2 ${remainingSlots === 0 ? "text-amber-400/90" : "text-white/50"}`} style={{ fontSize: "12px" }}>
                            {remainingSlots === 0
                                ? (isJa
                                    ? `アップロードの上限（${PHOTO_LIMIT_PER_USER}枚）に達しています。写真を削除すると空きができます。`
                                    : `Upload limit reached (${PHOTO_LIMIT_PER_USER}). Delete a photo to make room.`)
                                : (isJa
                                    ? `あと${remainingSlots}枚アップロードできます（${PHOTO_LIMIT_PER_USER}枚まで）`
                                    : `${remainingSlots} of ${PHOTO_LIMIT_PER_USER} uploads left`)}
                        </p>
                    )}

                    {fileError && <p role="alert" className="mt-2 text-red-400" style={{ fontSize: "13px" }}>{fileError}</p>}

                    {/* **1件の投稿にまとめる**（モックは1投稿＝複数枚だが、この画面の
                        既定は今までどおり「N枚選ぶ → N件の投稿」。既定を変えると
                        owner の使い方が黙って変わるので owner 判断のまま据え置き）。
                        **2枚以上あるときだけ出す**——1枚のときは押せる物が増えるだけ */}
                    {pendingCount > 1 && (
                        <div className="mt-3 rounded-xl bg-surface ring-1 ring-line p-3">
                            <label
                                className={`flex items-center gap-2 select-none ${tooManyToGroup ? "opacity-50" : "cursor-pointer"}`}
                                style={{ touchAction: "manipulation" }}
                            >
                                <input
                                    type="checkbox"
                                    checked={asOnePost && !tooManyToGroup}
                                    onChange={(e) => setAsOnePost(e.target.checked)}
                                    disabled={uploading || tooManyToGroup}
                                    aria-describedby="group-hint"
                                    className="w-4 h-4 accent-[#2080f6]"
                                />
                                <span className="text-white/80" style={{ fontSize: "13px" }}>
                                    {isJa
                                        ? `この${pendingCount}枚を1件の投稿にまとめる`
                                        : `Post these ${pendingCount} photos as one post`}
                                </span>
                            </label>
                            <p id="group-hint" className="mt-1 text-white/50" style={{ fontSize: "12px" }}>
                                {tooManyToGroup
                                    ? (isJa
                                        ? `1件の投稿に入れられるのは${PHOTO_IMAGES_MAX}枚までです（${pendingCount}枚を選んでいます）。`
                                        : `One post can hold up to ${PHOTO_IMAGES_MAX} photos (${pendingCount} selected).`)
                                    : (asOnePost
                                        ? (isJa
                                            ? "題・説明・撮影地は1枚目のものを使います。"
                                            : "Title, description and location come from the first photo.")
                                        : (isJa
                                            ? "オフのときは、1枚ずつ別々の投稿になります。"
                                            : "Off: each photo becomes its own post."))}
                            </p>
                        </div>
                    )}
                </div>

                {/* ───────── 入力（モック③④⑤） ───────── */}
                <div className="pt-4 lg:pt-3">
                    {/* 前に使った値を候補に出す（選ばずに自由入力もできる） */}
                    <datalist id="own-categories">
                        {ownValues.categories.map((v) => <option key={v} value={v} />)}
                    </datalist>
                    <datalist id="own-locations">
                        {ownValues.locations.map((v) => <option key={v} value={v} />)}
                    </datalist>

                    {editing ? (
                        <>
                            {/* ── タイトル（モック③） ── */}
                            <div>
                                <label htmlFor="post-title" className={labelCls} style={labelStyle}>
                                    {isJa ? "タイトル（任意）" : "Title (optional)"}
                                </label>
                                <input
                                    id="post-title"
                                    type="text"
                                    value={editing.title}
                                    onChange={(e) => updateItem(editing.id, { title: e.target.value })}
                                    maxLength={TITLE_MAX}
                                    // **見えている placeholder と同じ言葉にする。**
                                    // `aria-label` は placeholder を上書きするので、
                                    // 違う語を書くと**見えている言葉と読み上げる言葉が
                                    // 別物**になる（音声操作は読み上げる名前で当てるので、
                                    // 「場所をタップ」が効かなくなる）。`（任意）` も
                                    // 落とすと、任意であることが読み上げにだけ届かない
                                    aria-label={isJa
                                        ? `${editingNo}枚目のタイトル（任意）`
                                        : `Title of photo ${editingNo} (optional)`}
                                    placeholder={isJa ? "タイトル（任意）" : "Title (optional)"}
                                    className={fieldCls}
                                    style={{ ...fieldStyle, height: "40px" }}
                                    disabled={fieldsLocked}
                                />
                                {/* 文字数カウンタ（モック③）。**上限はこの実装の本物の数**
                                    ——モックの「16/50」は絵で、サーバーは 200 まで受ける
                                    （`scripts/__tests__/limitParity.test.ts` が対で見張る） */}
                                <p className={counterCls} style={counterStyle}>{editing.title.length}/{TITLE_MAX}</p>
                            </div>

                            {/* ── キャプション（モック③） ── */}
                            <div className="mt-3">
                                <label htmlFor="post-caption" className={labelCls} style={labelStyle}>
                                    {isJa ? "キャプション" : "Caption"}
                                </label>
                                <textarea
                                    id="post-caption"
                                    value={editing.description}
                                    onChange={(e) => updateItem(editing.id, { description: e.target.value })}
                                    // **見えているラベル（「キャプション」）を名前に含める。**
                                    // WCAG 2.5.3（Label in Name）——音声操作は見えている
                                    // 言葉で当てるので、「キャプション」と読める欄が
                                    // 「説明」としか名乗らないと、その欄にだけ当たらない。
                                    // placeholder も同じ語に揃える（下の見張りが対で見る）
                                    aria-label={isJa
                                        ? `${editingNo}枚目のキャプション（任意）`
                                        : `Caption of photo ${editingNo} (optional)`}
                                    placeholder={isJa ? "キャプション（任意）" : "Caption (optional)"}
                                    className={`${fieldCls} resize-none py-2.5 break-words`}
                                    style={{ ...fieldStyle, height: "80px" }}
                                    disabled={fieldsLocked}
                                />
                                <p className={counterCls} style={counterStyle}>{editing.description.length}/{DESC_STRING_MAX}</p>
                            </div>
                        </>
                    ) : null}

                    {/* ── カテゴリ・タグ（モック④）。**全写真に共通** ──
                        「全写真に適用」は見えている文にしか書いていなかった。
                        読み上げでは箱の外の独立した1文なので、中のカテゴリ・タグが
                        「この1枚ぶん」なのか「全部ぶん」なのか分からない */}
                    {items.length > 0 && (
                        <div role="group" aria-labelledby="upload-common" className="mt-4">
                            <p id="upload-common" className="text-white/50 mb-3" style={{ fontSize: "12px" }}>
                                {isJa ? "カテゴリとタグは全写真に適用されます" : "Category and tags are applied to all photos"}
                            </p>

                            <p className={labelCls} style={labelStyle}>
                                {isJa ? "カテゴリ（テーマ）" : "Category (theme)"}
                            </p>
                            {/* **カテゴリは決まった選択肢から選ぶ**（owner の
                                「風景、建築、人物、動物など狭めた選択肢にしたい」）。
                                すぐ下のタグのチップと同じ形（`role="switch"`・選択中は
                                青地 ＋ 押し直すと外れる）だが、**カテゴリは1つしか
                                持てない**ので別のチップを押すと置き換わる。
                                **語彙はモックと違う**（モックは 絶景/グルメ/街歩き/
                                文化・歴史/自然/人物）。入れ替えると `/category/<slug>` の
                                集約ページと既に保存された写真の付け直しが要るので、
                                ここは owner 判断のまま据え置き（`docs/redesign-2026-09.md` P4）。
                                **自由入力は残す**（owner の判断）＝下の欄は消していない */}
                            <div className="flex flex-wrap gap-2" role="group" aria-label={isJa ? "カテゴリを選ぶ" : "Choose a category"}>
                                {CATEGORY_CHOICES.map((c) => {
                                    const on = isChosenCategory(category, c);
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setCategory((cur) => toggleCategory(cur, c))}
                                            disabled={uploading}
                                            role="switch"
                                            aria-checked={on}
                                            // 名前を種別で分ける（すぐ下のタグのチップと綴りが
                                            // 重なる語がある。見えている語はそのまま含める）
                                            aria-label={isJa ? `カテゴリ: ${c}` : `Category: ${c}`}
                                            className={`${chipCls} ${on ? "bg-accent-fill text-white font-medium ring-accent" : "bg-surface-2 ring-line text-white/80 hover:brightness-125"}`}
                                            style={chipStyle}
                                        >
                                            {c}
                                        </button>
                                    );
                                })}
                            </div>
                            <input
                                type="text"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                maxLength={CATEGORY_MAX}
                                placeholder={isJa ? "カテゴリ（一覧に無い語はここに）" : "Category: something else"}
                                className={`${fieldCls} mt-2`}
                                list="own-categories"
                                style={{ ...fieldStyle, height: "40px" }}
                                disabled={uploading}
                            />

                            <p className={`${labelCls} mt-4`} style={labelStyle}>
                                {isJa ? `タグ（最大${TAGS_MAX}個）` : `Tags (up to ${TAGS_MAX})`}
                            </p>
                            {/* 選んでいるタグ（モック④の「#サントリーニ ✕」）。
                                **押すと外れる**（`toggleTag` は入っていれば外す） */}
                            {chosenTags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label={isJa ? "選んでいるタグ" : "Chosen tags"}>
                                    {chosenTags.map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTags((cur) => toggleTag(cur, t))}
                                            disabled={uploading}
                                            aria-label={isJa ? `タグ「${t}」を外す` : `Remove tag ${t}`}
                                            className={`${chipCls} gap-1 bg-chip ring-line text-chip-text hover:brightness-125`}
                                            style={chipStyle}
                                        >
                                            #{t}
                                            <XMarkIcon className="w-3.5 h-3.5" />
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* **タグはカンマ区切りの1欄のまま**（モックは1つずつ足す形）。
                                サーバーの上限は**タグ1つあたり**なので、欄に `maxLength` を
                                置くと「サーバーは受け付けるのに入力できない」に倒れる。
                                Enter で1つ確定する形にすると、日本語の変換確定の Enter を
                                拾う（`app/__tests__/imeEnterGuard.test.ts` の題材）ので、
                                **入力の仕組みは変えずに見た目だけモックに寄せた** */}
                            <input
                                type="text"
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                                // iPhone が先頭を大文字にし（`Nature`）、自動修正で綴りを変える
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={isJa ? "タグ（カンマ区切り）" : "Tags (comma-separated)"}
                                className={fieldCls}
                                style={{ ...fieldStyle, height: "40px" }}
                                disabled={uploading}
                            />
                            {/* タグはカンマ区切りなので datalist が効かない（欄全体を
                                置き換えてしまう）。**押して選ぶチップにする**——押し直すと外れ、
                                選んでいるものは青地で出す（一覧の絞り込みと同じ `role="switch"`）。 */}
                            {tagSuggestions.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2" role="group" aria-label={isJa ? "タグの候補" : "Tag choices"}>
                                    {tagSuggestions.map((t: string) => {
                                        const on = hasTag(tags, t);
                                        return (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setTags((cur) => toggleTag(dropFragment(TAG_CHOICES, cur), t))}
                                                disabled={uploading}
                                                role="switch"
                                                aria-checked={on}
                                                className={`${chipCls} ${on ? "bg-accent-fill text-white font-medium ring-accent" : "bg-chip ring-line text-chip-text hover:brightness-125"}`}
                                                style={chipStyle}
                                            >
                                                #{t}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── 位置情報（モック⑤） ──
                        モックは「地図から検索して候補から選ぶ」形だが、**この画面に
                        その仕組みは無い**（`docs/redesign-2026-09.md` P5。地名検索は
                        編集画面の `searchPlaces` にしかなく、移植は機能の追加＝
                        デザインの範囲を越える）。**動かない「>」は置かない**——
                        いまある撮影地の欄を、モックの行の形で出す */}
                    {editing && (
                        <div className="mt-4">
                            <label htmlFor="post-location" className={labelCls} style={labelStyle}>
                                {isJa ? "位置情報" : "Location"}
                            </label>
                            <div className="flex items-center gap-2 rounded-xl bg-surface-2 border border-line px-3 focus-within:border-accent transition-colors" style={{ minHeight: "44px" }}>
                                <MapPinIcon className="w-5 h-5 text-accent flex-shrink-0" />
                                <input
                                    id="post-location"
                                    type="text"
                                    value={editing.location}
                                    onChange={(e) => updateItem(editing.id, { location: e.target.value })}
                                    maxLength={LOCATION_MAX}
                                    // 見えているラベル（「位置情報」）を名前に含める（上と同じ理由）
                                    aria-label={isJa
                                        ? `${editingNo}枚目の位置情報（任意）`
                                        : `Location of photo ${editingNo} (optional)`}
                                    placeholder={isJa ? "位置情報（任意）" : "Location (optional)"}
                                    className="flex-1 min-w-0 bg-transparent text-white placeholder:text-white/40 focus:outline-none disabled:opacity-50"
                                    list="own-locations"
                                    style={fieldStyle}
                                    disabled={fieldsLocked}
                                />
                                {editing.location && (
                                    <button
                                        type="button"
                                        onClick={() => updateItem(editing.id, { location: "" })}
                                        disabled={fieldsLocked}
                                        aria-label={isJa ? "撮影地を空にする" : "Clear location"}
                                        className="flex-shrink-0 -m-1 p-1 text-white/60 hover:text-white transition-colors"
                                        style={{ touchAction: "manipulation" }}
                                    >
                                        <XMarkIcon className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                            {/* 撮影日（EXIF から読めたときだけ）。読めなければ**欄ごと出さない** */}
                            {editing.dateTimeOriginal && (
                                <p className="mt-2 inline-flex items-center gap-1 text-white/50" style={{ fontSize: "12px" }}>
                                    <CalendarIcon className="w-4 h-4" />
                                    {/* 保存されている通りに出す。toLocaleDateString だと
                                        UTC より西の端末で**保存される日付より1日前**が
                                        確認画面に出て、写真ページの表示とも食い違う。 */}
                                    {formatStoredDateTime(editing.dateTimeOriginal, isJa ? "ja" : "en")}
                                </p>
                            )}
                        </div>
                    )}

                    {/* GPS 自動入力トグル。**写真を選ぶ前から見えている**必要がある
                        （取り込みの瞬間に効く設定なので、選んでから出しても遅い） */}
                    <label className="flex items-center gap-2 mt-3 cursor-pointer select-none" style={{ touchAction: "manipulation" }}>
                        <input
                            type="checkbox"
                            checked={gpsAutofill}
                            onChange={toggleGpsAutofill}
                            disabled={uploading}
                            className="w-4 h-4 accent-[#2080f6]"
                        />
                        <span className="text-white/60" style={{ fontSize: "12px" }}>
                            <MapPinIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
                            {isJa
                                ? "写真のGPSから撮影地を自動入力（市区町村レベル）"
                                : "Auto-fill shooting location from photo GPS (city level)"}
                        </span>
                    </label>

                    {/* **BGM と公開範囲の行は置かない**（モック⑥⑦）。
                        - BGM: 投稿時に曲を付ける口が無い（`/upload/save` は `song` を
                          受け取らない）。公開したあと写真ページで付ける経路だけがある
                        - 公開範囲: いまの写真は `published` の真偽しか持たない。
                          「フォロワーのみ」「自分のみ」は**データにもAPIにも無い**
                          （`docs/redesign-2026-09.md` P6・P7）。2択は
                          「下書き保存」と「投稿する」の2つのボタンがそのまま担う
                        どちらも `api-user/**` を触らないと動かないので、
                        **動かないボタンとしては出さない**（owner の指示 2026-09-22）。
                        同じ理由で、モックの「人気」「評価」の類はこの画面に無い */}

                    {/* 上げ終わった・失敗した写真の状態。
                        ここは role="alert" にしない。逐次ループなので、
                        50枚失敗すれば assertive な割り込みが50回起きる。
                        まとめは「N 件失敗しました」のトーストが出していて、
                        Toast は元から role="alert" を持っている。 */}
                    {items.some((i) => i.status === "done" || i.status === "error") && (
                        <ul className="mt-4 space-y-1">
                            {items.map((it, i) => (
                                it.status === "done" ? (
                                    <li key={it.id} className="text-green-400 inline-flex items-center gap-1" style={{ fontSize: "12px" }}>
                                        <CheckCircleIcon className="w-4 h-4" />{i + 1}{isJa ? "枚目: アップロード完了" : ": Uploaded"}
                                    </li>
                                ) : it.status === "error" ? (
                                    <li key={it.id} className="text-red-400 inline-flex items-center gap-1 break-words" style={{ fontSize: "12px" }}>
                                        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />{i + 1}{isJa ? "枚目: " : ": "}{it.error ?? (isJa ? "失敗" : "Failed")}
                                    </li>
                                ) : null
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* ── 投稿する（モック⑨）。画面の下に固定 ──
                **常駐のタブバー（`BottomNav`）の上に置く。** 同じ `bottom-0` に
                並べると、DOM で後ろにいるあちら（z-40）が覆いかぶさって
                **「投稿する」が押せない位置**にあった。かといって `z-50` で
                覆い返すと、隠れたタブバーの5つのボタンが**フォーカスだけ
                受け取れる**状態になる（WCAG 2.4.11・Enter で投稿シートが開き、
                書きかけが消える）。だから覆わずに**上へ逃がす**。
                高さはタブバー自身が `--bottom-bar-h` に実測値（safe-area 込み）を
                出しているので、それを読む。**この画面からは書かない**
                ——両方が同じ変数に書くと、あとから描いた方の高さで
                `MiniPlayer` が浮く。落とし先の `env(safe-area-inset-bottom)` は
                タブバーが無い状況（将来そのページが出たとき）の受け皿 */}
            {items.length > 0 && (
                <div ref={pageBarRef} className="fixed left-0 right-0 bg-bar border-t border-line p-3 z-50"
                    style={{ bottom: "var(--bottom-bar-h, env(safe-area-inset-bottom, 0px))" }}>
                    <div className={`${COLUMN} flex items-center gap-2`}>
                        {/* **アップロード中にやめられるようにする。** 押している間は
                            公開も下書き保存も無効で、しかも S3 への PUT は素の `fetch`
                            （`userFetch` の20秒の打ち切りは経路外）なので、応答が返らない
                            回線では**リロード以外に出る手段が無かった**——しかもリロード
                            すると S3 に孤児が残る。ストーリーの投稿が同じ理由で先に
                            直してある形（`StoriesBar`）を借りる。
                            上げ終わったぶんはそのまま残す（画面にも「完了」で出ている） */}
                        {uploading && (
                            <button
                                onClick={() => {
                                    if (stopping) return;
                                    setStopping(true);
                                    uploadAbortRef.current?.abort(new DOMException("cancelled", "AbortError"));
                                }}
                                // **`disabled` にしない。** 実ブラウザは focus 中の
                                // 要素が disabled になると blur するので、
                                // 「消さずに残す」理由（フォーカスを失わせない）を
                                // 自分で潰していた。手本の `StoriesBar` も
                                // disabled にせず名前だけ変えている
                                aria-disabled={stopping}
                                className={`px-4 text-white/80 hover:text-white font-semibold rounded-full ring-1 ring-line transition-colors flex-shrink-0${stopping ? " opacity-50" : ""}`}
                                style={{ touchAction: "manipulation", minHeight: "46px", fontSize: "15px" }}
                            >
                                {stopping
                                    ? (isJa ? "中断中…" : "Stopping…")
                                    : (isJa ? "やめる" : "Stop")}
                            </button>
                        )}
                        <button
                            onClick={() => handleUploadAll(true)}
                            disabled={uploading || metaLoading || pendingCount === 0}
                            className="flex-1 lg:flex-none lg:w-[420px] lg:ml-auto inline-flex items-center justify-center gap-2 bg-accent-fill text-white font-semibold rounded-full hover:brightness-110 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ touchAction: "manipulation", minHeight: "46px", fontSize: "17px" }}
                        >
                            <PaperAirplaneIcon className="w-5 h-5" aria-hidden="true" />
                            {uploading
                                ? (isJa ? "アップロード中..." : "Uploading...")
                                : metaLoading
                                    ? (isJa ? "撮影情報を読み取り中…" : "Reading photo info...")
                                    : willBeOnePost
                                        ? (isJa ? "投稿する" : "Post")
                                        : (isJa ? `${pendingCount}件を投稿する` : `Post ${pendingCount} items`)}
                        </button>
                    </div>
                    {doneCount > 0 && (
                        <p className={`${COLUMN} mt-1 text-white/50`} style={{ fontSize: "12px" }}>
                            {isJa ? `${doneCount}/${items.length} 枚がアップロード済み` : `${doneCount}/${items.length} uploaded`}
                        </p>
                    )}
                </div>
            )}
        </main>
    );
}

export default function UploadPage() {
    return (
        <Suspense fallback={
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-3xl mx-auto w-full flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの fallback。** JS が走る前に見えるのは
                    ここなので、ランドマークと見出しを持たせる
                    （`sr-only` は position:absolute で描画に影響しない） */}
                <h1 className="sr-only">新しい投稿を作成</h1>
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        }>
            <UploadPageInner />
        </Suspense>
    );
}
