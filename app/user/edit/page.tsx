"use client";

import { usablePhotoRows } from "../../../lib/utils/apiRows";
import { dedupeCameraName } from "../../../lib/utils/cameraName";
import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useBottomBarHeight } from "../../../lib/hooks/useBottomBarHeight";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon, PhotoIcon } from "@heroicons/react/24/outline";
import type { Photo, LocalizedParagraphs } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";
import { toastWithStaticPage } from "../../../lib/utils/staticPage";
import { sessionErrorMessage } from "../../../lib/utils/api";
import { toDateInputValue, mergeDate, todayForDateInput, PHOTO_DATE_MIN } from "../../../lib/utils/dateInput";
import { formatStoredDateTime } from "../../../lib/utils/photoDate";
import { changedFields } from "../../../lib/utils/changedFields";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import { useEscapeKey } from "../../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { collectOwnValues, appendTag, type OwnValues } from "../../../lib/utils/ownValues";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";
const labelCls = "block text-sm text-white/60 mb-1";

// title/description は string か {ja,en}/{ja:[],en:[]} の両対応。
// 編集欄は日本語だけを扱うが、保存時に英語側を残す（消すと JSON-LD と
// sr-only の英語併記まで失われるため）。
function titleToText(t: Photo["title"]): string {
    if (!t) return "";
    if (typeof t === "string") return t;
    const o = t as Record<string, string>;
    return o.ja || o.en || "";
}
/**
 * その項目が「英語しか無い」状態か。
 *
 * `titleToText` は `ja || en` なので、日本語が無い写真を開くと**英語が
 * 日本語欄に入る**。そのまま保存すると、英語がそのまま日本語タイトルとして
 * 定着する（本人は「元からこう入っていた」と思っている）。欄を空にすると
 * 中身が画面から見えなくなり、英語を消す手段はどこにも無いので、
 * **見せたうえで注記する**。
 */
function isEnglishOnly(v: Photo["title"] | Photo["description"]): boolean {
    if (!v || typeof v === "string") return false;
    const o = v as Record<string, unknown>;
    // **`titleToText` / `descToText` と同じ数え方にする。** あちらは
    // `o.ja || o.en` で、空白だけの `ja` は truthy なので**日本語として
    // 採用される**。ここだけ `trim()` して見ていたので、欄には空白が
    // 入っているのに「英語しか持っていません」という**事実と違う注記**が
    // 出ていた。
    const has = (x: unknown) => (Array.isArray(x) ? x.length > 0 : typeof x === "string" && x.length > 0);
    return !has(o.ja) && has(o.en);
}

function descToText(d: Photo["description"]): string {
    if (!d) return "";
    if (typeof d === "string") return d;
    const o = d as LocalizedParagraphs;
    const arr = o.ja && o.ja.length ? o.ja : o.en;
    return Array.isArray(arr) ? arr.join("\n") : "";
}

/**
 * 日本語だけ差し替え、英語側は元のまま残す。
 *
 * **ただし日本語を空にしたら、英語ごと消す。** 残していた頃は
 * `{ en: "Morning Sea" }` が保存され、表示は `getLocalized` の
 * フォールバックで**英語が出た**（`lib/data/photos.ts`。日本語が無ければ
 * 英語に落ちる）。消したつもりの説明が英訳のまま出続けるので、
 * 個人情報を消す目的だと実害になる。しかも**英語を編集・削除する画面は
 * どこにも無い**（この画面も /admin/edit も日本語欄しか描かない）ので、
 * 利用者には直す手段が無かった。
 *
 * 言語切替の UI は `6d72bfb` で削除済みで、英語が出るのは JSON-LD・
 * `sr-only` の併記・画像サイトマップだけ——「消した」の方を優先する。
 */
export function mergeLocalizedTitle(original: Photo["title"], ja: string): Photo["title"] {
    if (!ja) return "";   // 空にした＝消したい（サーバーは空を REMOVE に倒す）
    const en = original && typeof original === "object" ? (original as Record<string, string>).en : undefined;
    if (!en) return ja;
    return { ja, en };
}

/**
 * サーバーが黙って切る分があれば、その文言を返す（無ければ null）。
 *
 * **送る形に効く上限だけを見る。** 文字列は全体2000字（段落数は見ない）、
 * 配列は50段落。`api-user/src/sanitize.ts` の `sanitizeDescription` と対。
 */
export function describeOverLimit(
    tags: string[] | undefined,
    description: Photo["description"] | undefined,
    isJa: boolean,
): string | null {
    const say = (ja: string, en: string) =>
        isJa ? `${ja}。超えた分は保存されません` : `${en}. The rest won't be saved`;

    if (tags && tags.length > TAGS_MAX) {
        return say(`タグは${TAGS_MAX}個までです（${tags.length}個）`,
            `Up to ${TAGS_MAX} tags (${tags.length})`);
    }
    if (typeof description === "string") {
        if (description.trim().length > DESC_STRING_MAX) {
            return say(`説明は${DESC_STRING_MAX}字までです（${description.trim().length}字）`,
                `Up to ${DESC_STRING_MAX} characters (${description.trim().length})`);
        }
    } else if (description && typeof description === "object" && !Array.isArray(description)) {
        const ja = Array.isArray(description.ja) ? description.ja : [];
        if (ja.length > DESC_PARAGRAPHS_MAX) {
            return say(`説明は${DESC_PARAGRAPHS_MAX}段落までです（${ja.length}段落）`,
                `Up to ${DESC_PARAGRAPHS_MAX} paragraphs (${ja.length})`);
        }
        // **段落ごとの文字数も切られる。** 件数だけ見ていたので、英語説明を
        // 持つ写真で長い段落を1つ書くと**警告なしで黙って切られた**
        // ——同じ文章でも、英語を持たない写真（文字列経路）なら
        // 「2000字までです」と出る。**写真によって言ったり言わなかったり**
        // していた。「効く上限を見ていなかった」の残り半分。
        const longest = ja.reduce((n, p) => Math.max(n, p.trim().length), 0);
        if (longest > DESC_STRING_MAX) {
            return say(`説明は1段落${DESC_STRING_MAX}字までです（${longest}字）`,
                `Up to ${DESC_STRING_MAX} characters per paragraph (${longest})`);
        }
    }
    return null;
}

/** 説明も同様。日本語を空にしたら英語ごと消す */
export function mergeLocalizedDescription(original: Photo["description"], ja: string): Photo["description"] {
    const lines = ja.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return "";
    const en = original && typeof original === "object" && !Array.isArray(original)
        ? (original as LocalizedParagraphs).en
        : undefined;
    if (!en || en.length === 0) return ja;
    return { ja: lines, en };
}

// **サーバーの上限と同じ数字を入れる。** 入れないと、超えた分は
// `sanitizeText` / `sanitizeTitle` が黙って切る——保存は成功したように見えて、
// あとで開くと末尾が無い。上限を告げる文言も出していなかった。
//
// 説明とタグには入れていない。タグはカンマ区切りの1入力で、上限は
// **タグ1つあたり** 50 なので、欄全体に入れると
// 「サーバーは受け付けるのに入力できない」が生まれる。
//
// 説明は**送る形で上限が変わる**ので、`maxLength` を1つ選べない
// （文字列＝全体2000字 / `{ja,en}`＝段落ごと2000字・50段落まで）。
// 英語説明を持つ写真では 2000 を入れると短すぎる。
// **ここは `describeOverLimit` が保存の前に告げる側で受けている。**
// **黙って切られる上限のうち、画面に出す先が無いもの。**
//
// すぐ上のコメントは「説明とタグに `maxLength` を入れない」理由を書いて
// いるが、それは**1件あたりの文字数**（タグ50字）の話。件数と全体量の
// 上限は別にあり、そちらは画面側に対応物も警告も無かった。
//
// **説明の上限は、送る形で変わる**（`sanitizeDescription`）:
//   文字列で送る       → **全体で 2000字**（段落数は一切見ない）
//   {ja:[],en:[]} で送る → 段落ごと2000字 かつ **50段落まで**
// `mergeLocalizedDescription` は、元の写真に英語説明が無ければ**文字列を
// そのまま返す**。日本語だけの写真（このサイトの大半）は文字列経路。
//
// **一度ここを取り違えた。** 文字列経路にも50段落が効くと思い込んで
// 「50段落まで」と警告を出したが、文字列では段落数を見ていないので
// **ほぼ常に誤報**で、しかも本物の上限（全体2000字）は野放しのままだった
// ——直したかった形をそのまま残して、嘘の警告を足していた。
//
// 入力は塞がない（塞ぐと「サーバーは受け付けるのに入力できない」に倒れる）。
// **送る形を見てから、その形に効く上限だけ**を告げる。値は
// `api-user/src/sanitize.ts` と対で、`scripts/__tests__/limitParity.test.ts`
// がずれを止める。
const TAGS_MAX = 30;
const DESC_PARAGRAPHS_MAX = 50;
const DESC_STRING_MAX = 2000;
const TITLE_MAX = 200;
const LOCATION_MAX = 200;
const CATEGORY_MAX = 100;

function EditContent() {
    // 画面下の固定バーの実測値を CSS 変数に出す（MiniPlayer が読む）
    const bottomBarRef = useRef<HTMLDivElement | null>(null);
    useBottomBarHeight(bottomBarRef);
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const isJa = locale === "ja";

    const photoId = searchParams.get("id");

    /**
     * 取得の effect が **`router` / `showToast` の同一性に依存しないようにする。**
     *
     * どちらもフックが返す値で、参照が変わりうる（Next の useRouter は
     * 実際には安定だが、それに寄りかかっている状態だった）。deps に入れたまま
     * effect の中で「毎回新しいオブジェクト」を state に入れると、
     * **再描画 → deps が変わる → 再取得 → …** で回り続ける。
     * 入力候補（collectOwnValues）を足したときに実際に踏んだ
     * （既存の staleResponse テストは router を安定なオブジェクトに固定して
     *  いて、それで避けていただけだった）。
     */
    const routerRef = useRef(router);
    const showToastRef = useRef(showToast);
    routerRef.current = router;
    showToastRef.current = showToast;

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    // 読み込みに失敗したか。トーストは数秒で消えるので、画面にも残す。
    const [loadFailed, setLoadFailed] = useState(false);
    // 写真そのものが取れなかった（削除済み・403）。枠ごと消さないための印
    const [imageError, setImageError] = useState(false);
    // **入るたびに下ろす。** 「止める印」を足したら「入るたびに下ろす」も
    // 一緒に書く（台帳の型0の派生。`StoryViewer` の `mediaError` が手本）。
    // この画面はクエリ（`?id=`）だけが変わる遷移でも作り直されないので、
    // 下ろさないと**次に開いた正常な写真が「読み込めません」に固定**される。
    // 一時的な失敗（電波の瞬断・機内モード）から回線が戻っても同じ。
    // 見るのは実際に出す src——保存で写真が差し替わる経路にも効く
    const shownSrc = photo?.thumbSrc || photo?.src;
    useEffect(() => { setImageError(false); }, [shownSrc]);
    // 読み込んだ元データ。編集欄に出していない項目（英語のタイトル・説明、
    // 撮影日の時刻）を保存時に失わないために持っておく。
    const [original, setOriginal] = useState<Photo | null>(null);
    const [saving, setSaving] = useState(false);
    // 自分がこれまでに使った撮影地・カテゴリ・タグ（入力候補）
    const [ownValues, setOwnValues] = useState<OwnValues>({ locations: [], categories: [], tags: [] });
    // 削除は取り消せないので、確認を1枚挟む（ストーリー削除と同じ形）
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    /**
     * **地図に出す位置。撮影者本人が選ぶ。**
     *
     * 地名は自由入力なので、機械では「福岡」が福岡市か富山県の福岡町か
     * 決められない（実測でどちらも起きた）。当てに行くのをやめて、
     * **地名で候補を出して本人に選んでもらう**。選んだものは「おおよそ」では
     * なく本人の指定なので、写真ページの「地図で見る」もそのまま出る。
     * 精度は約1km に丸めたまま（サーバー側で丸める）。
     */
    const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
    /**
     * **本人がこの画面で位置を触ったか。**
     *
     * 触ったなら、値が保存済みと同じでも送る。機械が当てた座標
     * （`geoApprox: true`）と**同じ候補を本人が選んだとき**、値が等しいので
     * 差分が出ず、サーバーは「おおよそ」の印を落とす分岐に入らない
     * ——「機械の当て推量を本人が確定する」という、この機能が一番効く場面が
     * 丸ごと無効になっていた（レビューが実測）。
     */
    const [coordsTouched, setCoordsTouched] = useState(false);
    const [placeResults, setPlaceResults] = useState<{ label: string; lat: number; lng: number }[] | null>(null);
    const [placeSearching, setPlaceSearching] = useState(false);
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");
    /**
     * `dirty`（下で計算する）を effect から読むための写し。
     * **依存に `dirty` を入れない**——入れると打鍵のたびに写真を取り直す
     */
    const dirtyRef = useRef(false);


    // 対象写真の取得: 公開 /photos/{id} は下書きを404にするため、認証済み /user/photos から探す
    useEffect(() => {
        // ?id が無いまま開かれたら、待っても何も来ない。
        // 以前はここで return するだけだったので loadingPhoto が true のまま
        // スピナーが永久に回り、戻る導線も出なかった。
        if (!photoId) { setLoadingPhoto(false); return; }
        if (!isAuthenticated || (!isAdminUser && !isGeneralUser)) return;
        // 中断ガード。取得は非同期なので、遅い回線で下書き A を開いて戻り B を
        // 開くと、A の応答が後から届く。無かった頃はフォームが A の内容で埋まり、
        // save() は現在の photoId（= B）を送るので、**B の写真に A のタイトル・
        // 説明・タグ・撮影日が上書き保存された**。
        // 同じ形を /admin/edit に入れてある（app/admin/edit/page.tsx）。
        let aborted = false;
        const load = async () => {
            setLoadingPhoto(true);
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch("/user/photos");
                if (res.ok) {
                    const all = await res.json() as Photo[];
                    if (aborted) return;
                    // **配列だと確かめてから使う。** `collectOwnValues` は
                    // `for...of` で回すので、`{}` が返ると投げる（ガードの
                    // 手前で呼んでいた）。読めない行も落とす——1件の巻き添えで
                    // 編集画面が開かなくなるのを防ぐ。
                    const rows = usablePhotoRows<Photo>(all, "GET /user/photos");
                    if (!rows) {
                        // **「配列でない」から「写真が無い」は言えない。**
                        // 一度ここを `found = null` に流して、下の
                        // 「写真が見つかりません」＋下書き一覧への `replace`
                        // に落としてしまった——取得の失敗なのに**存在しない**と
                        // 言い切り、しかも画面から追い出す（`replace` なので
                        // 戻れない）。取得の失敗は失敗として出す。
                        showToastRef.current(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                        setLoadFailed(true);
                        return;
                    }
                    // 同じ取得から入力候補も作る（追加の往復はしない）。
                    // 候補が無いせいで同じ場所が別々の名前に散っていた。
                    setOwnValues(collectOwnValues(rows));
                    const found = rows.find((p) => p.id === photoId) ?? null;
                    if (found) {
                        setPhoto(found);
                        setOriginal(found);
                        // **打ちかけがあるなら、欄は上書きしない。**
                        // この取得は `isAuthenticated` が変わるたびに走る——
                        // つまり**別のタブでログインし直した瞬間**にも走り、
                        // 打ちかけをサーバーの値で塗り潰していた。
                        // 「ログインが切れたので、ログインし直してから保存して
                        // ください」と案内しておきながら、そのとおりに動いた人の
                        // 文章を消す形だった（送り返さないようにした意味が無い）。
                        // `original` は比較先なので**常に**入れ替える
                        if (!dirtyRef.current) {
                            setTitle(titleToText(found.title));
                            setDescription(descToText(found.description));
                            setLocation(found.location ?? "");
                            setCoords(found.coords ?? null);
                            setCategory(found.category ?? "");
                            // <input type="date"> は YYYY-MM-DD しか受け付けない。
                            // 保存値は ISO 文字列なので、そのまま入れると空欄になる。
                            setDate(toDateInputValue(found.date));
                            setTagsInput(Array.isArray(found.tags) ? found.tags.join(", ") : "");
                        }
                    } else {
                        showToastRef.current(isJa ? "写真が見つかりません" : "Photo not found", "error");
                        // **replace。** もう無い写真の編集画面を履歴に残すと、
                        // 戻るたびにここへ着地して赤いトーストを出し、また
                        // 下書き一覧へ送り返す——**前の画面に二度と戻れない**。
                        // 直後の削除（下の handleDelete）で必ずこの形になる
                        routerRef.current.replace(ROUTES.DRAFTS);
                    }
                } else {
                    if (aborted) return;
                    showToastRef.current(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                    setLoadFailed(true);
                }
            } catch (e) {
                if (aborted) return;
                log.error("edit load error:", e);
                showToastRef.current(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                setLoadFailed(true);
            } finally {
                if (!aborted) setLoadingPhoto(false);
            }
        };
        void load();
        return () => { aborted = true; };
    }, [photoId, isAuthenticated, isAdminUser, isGeneralUser, isJa]);

    /**
     * 写真を消す。**これまで一般ユーザーには消す手段が無かった**——
     * できるのは非公開にすることだけで、S3 の実体（GPS 入りの原本を含む）は
     * 残っていた。サーバー側は DELETE /photos/{id}（api-user）。
     */
    const handleDelete = useCallback(async () => {
        if (!photoId) return;
        setDeleting(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
            if (!res.ok) {
                // サーバーは理由を返す（「画像の削除を完了できませんでした」など）。
                // 押し直せば続きから消えるので、そう読める文言のまま出す。
                showToast(await readApiError(res, isJa ? "削除に失敗しました" : "Failed to delete"), "error");
                return;
            }
            toastWithStaticPage(showToast,
                isJa ? "写真を削除しました" : "Photo deleted",
                await res.json().catch(() => null), isJa);
            // 消した写真の編集画面は履歴に残さない（戻ると上の
            // 「写真が見つかりません」に落ちる）
            router.replace(ROUTES.DRAFTS);
        } catch (e) {
            // **保存と同じ見分けを通す。** ここだけ裸の catch で、押し直しても
            // 直らない失敗（セッション切れ・通信できない）を「通信に失敗
            // しました」に塗り潰していた。未ログインのまま画面に留めるように
            // したぶん、削除ボタンは素直に押せる位置にある
            showToast(sessionErrorMessage(e)
                ?? (isJa ? "通信に失敗しました" : "Network error"), "error");
        } finally {
            setDeleting(false);
            // **失敗しても閉じない。** サーバーは「押し直せば続きから消える」と
            // 読める理由を返すのに、閉じてしまうとトーストが数秒で消えたあと
            // 最初からやり直すことになる。閉じるのは成功したときだけ
            // （成功時はこの行に来る前に遷移している）。
        }
    }, [photoId, isJa, showToast, router]);

    /**
     * 保存で送る値と、開いた時点の値。
     *
     * **保存と「未保存か」の判定で同じものを使う。** 別々に組むと、片方だけ
     * 直したときに「変えていないのに毎回聞く」（読まずに押すようになる）か
     * 「変えたのに黙って捨てる」のどちらかへ静かにずれる。
     *
     * **実際に変えた項目だけ送る**理由: 開いた時点の値を毎回全部送っていたので、
     * 同じ写真を2タブで開いて片方で直したあと、もう片方で保存すると
     * **先の編集が黙って消えた**（サーバーは部分更新だが、こちらが全項目を
     * 送れば同じこと）。published はボタンの選択そのものなので常に送る。
     */
    const buildFields = useCallback(() => {
        const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
        const nextDescription = mergeLocalizedDescription(original?.description, description);
        const nextFields: Record<string, unknown> = {
            // 英語側が入っていれば残したまま日本語だけ差し替える
            title: mergeLocalizedTitle(original?.title, title),
            description: nextDescription,
            location,
            category,
            // 日付だけを編集させているので、元の時刻を保つ
            date: mergeDate(original?.date, date),
            tags,
            coords,
        };
        // **比較先も同じ道を通す。** `changedFields` の相手は「保存されている姿」
        // ではなく「触らなかったらこの画面が送る姿」でなければならない。
        // `mergeLocalizedDescription` は英語が空なら**素の文字列**を返すので、
        // `{ja:[…], en:[]}` で保存されている写真（実データ30枚のうち2枚）は
        // 直接比べると**毎回「変わった」**になり、触っていない説明を毎回
        // 送っていた——差分送信が防いでいたもの（2タブで開いて片方で説明を
        // 直したあと、もう片方でタイトルだけ直して保存すると、先に書いた
        // 説明が古い写しで上書きされる）がそこだけ効いていなかった。
        // タイトルも同じ形（`en: ""` を持つ行）で起きうる——今の30枚には無い。
        const originalFields: Record<string, unknown> = {
            title: mergeLocalizedTitle(original?.title, titleToText(original?.title)),
            description: mergeLocalizedDescription(original?.description, descToText(original?.description)),
            location: original?.location ?? "",
            category: original?.category ?? "",
            date: original?.date ?? "",
            tags: Array.isArray(original?.tags) ? original.tags : [],
            coords: original?.coords ?? null,
        };
        return { tags, nextDescription, nextFields, originalFields };
    }, [original, title, description, location, category, date, tagsInput, coords]);

    /**
     * 保存していない変更があるか。
     *
     * この画面には未保存を知らせる仕組みが1つも無く、左上の矢印を押すと
     * 黙って捨てていた（「保存する」は画面のいちばん下、矢印は上）。
     * 座標は**触ったなら値が同じでも**未保存に数える——同じ候補を選び直すと
     * サーバーが「おおよそ」の印を落とすので、保存の有無で結果が変わる。
     */
    const dirty = React.useMemo(() => {
        if (!original) return false;
        if (coordsTouched) return true;
        // **日付だけは「欄に出した値と、いま欄にある値」で見る。**
        // 保存の側は `mergeDate` を通すが、あれは捏造の UTC 0時（C-12）を
        // わざと日付だけへ移行するので、**移行が要る行は開いた瞬間から
        // 「変わった」**になる。触っていないのに毎回聞かれると、利用者は
        // 読まずに押すようになり、確認そのものが意味を失う。
        // 「送るべきか」と「触ったか」は別の問いなので、ここだけ分ける。
        if (date !== toDateInputValue(original.date)) return true;
        const { nextFields, originalFields } = buildFields();
        const changed = changedFields(nextFields, originalFields);
        delete changed.date;
        return Object.keys(changed).length > 0;
    }, [original, coordsTouched, date, buildFields]);
    useEffect(() => { dirtyRef.current = dirty; }, [dirty]);


    // 認証ゲート（一般ユーザー or 管理者）。upload ページと同じ方針。
    // **打ちかけがあるときは送り返させない**——`router.replace` は画面を
    // 作り直すので、上の未保存の確認を通らずに文章ごと消える。
    // 送り返さない代わりに、保存できないことを下で伝える
    const gate = useMemberGate(dirty);

    // **ログインが切れたことを伝える。** 送り返さないぶん、黙っていると
    // 「保存する」を押しても失敗し続ける画面に取り残される。
    // 一度だけ出す（描画のたびに出すと読めない）
    const toldSignedOut = useRef(false);
    useEffect(() => {
        // **ログインし直したら札を下ろす。** 下ろさないと「切れる →
        // ログインし直す → また切れる」の二度目が無言になる
        if (gate === "ok") { toldSignedOut.current = false; return; }
        if (gate !== "anonymous" || !dirty) { return; }
        if (toldSignedOut.current) return;
        toldSignedOut.current = true;
        showToast(isJa
            ? "ログインが切れました。この内容は保存できません。別のタブでログインし直してから、もう一度保存してください"
            : "You are signed out. This can't be saved yet — sign in again in another tab, then save.", "error");
    }, [gate, dirty, isJa, showToast]);

    const save = useCallback(async (published: boolean) => {
        if (!photoId) return;
        setSaving(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const { tags, nextDescription, nextFields, originalFields } = buildFields();
            const changed = changedFields(nextFields, originalFields);
            // **触ったなら、値が同じでも送る。** 差分だけに任せると、機械が
            // 当てた座標と同じ候補を本人が選んだときに何も送られず、
            // サーバーは「おおよそ」の印を落とす分岐に入らない
            // （画面は「保存しました」と出すのに、地図の扱いは変わらない）
            if (coordsTouched) changed.coords = coords;
            const body = { published, ...changed };

            // **黙って切られる前に告げる。**
            //
            // **送る項目についてだけ言う。** `changedFields` は変えた項目しか
            // 送らないので、説明を触っていない保存で「超えた分は保存されません」
            // と出すのは嘘になる（タイトルだけ直しても毎回出ていた）。
            //
            // 見る上限は**送る形で変わる**（上の定数のコメントを見よ）。
            // 保存は止めない——伝えたうえで、残す分はサーバーが決める。
            const over = describeOverLimit(
                "tags" in changed ? tags : undefined,
                "description" in changed ? nextDescription : undefined,
                isJa,
            );
            if (over) showToast(over, "error");

            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify(body),
            });
            if (res.ok) {
                // **もともと下書きなら「非公開にしました」とは言わない**——
                // 公開したことが無い写真に「非公開に」は、何かを取り下げたように
                // 読める。公開中の写真を下げたときだけその文言
                const wasPublished = original?.published !== false;
                const base = published
                    ? (isJa ? "保存しました" : "Saved")
                    : wasPublished
                        ? (isJa ? "非公開にしました" : "Unpublished")
                        : (isJa ? "下書きを保存しました" : "Draft saved");
                // サーバーが「静的ページはまだ残る」と言ってきたら、そう伝える
                // （`lib/utils/staticPage.ts`。本番はトークン未設定で毎回残る）。
                // **ここで動的 import しない**——保存が済んだあとに投げると、
                // チャンクを取れなかっただけで catch に落ち、「保存に失敗しました」＋
                // 遷移なしになる（実際は保存済み）
                toastWithStaticPage(showToast, base, await res.json().catch(() => null), isJa);
                // 公開したままの保存は写真ページへ戻す。下書き一覧へ落とすと、
                // 直したものを確かめられない（そこには公開写真が出ない）。
                router.push(published && photoId ? ROUTES.PHOTO(photoId) : ROUTES.DRAFTS);
            } else {
                // readApiError に寄せる。自前で本文を読むと、API Gateway の
                // {"message":"Unauthorized"} を拾えず「保存に失敗しました」になる
                showToast(await readApiError(res, isJa ? "保存に失敗しました" : "Save failed"), "error");
            }
        } catch (e) {
            log.error("edit save error:", e);
            // **catch の中で動的 import しない。** その import 自体が失敗して
            // ここへ来た場合、もう一度失敗して**トーストが1つも出ない**まま終わる
            // （`save` は `void save(...)` で呼ばれるので誰も拾わない）
            // こちらが組み立てた文言（セッション切れ・通信できない）は
            // そのまま出す。**2つ目が増えたときに書き足し忘れない**よう1か所へ
            const known = sessionErrorMessage(e);
            showToast(known ?? (isJa ? "保存に失敗しました" : "Save failed"), "error");
        } finally {
            setSaving(false);
        }
    }, [photoId, buildFields, original, coords, coordsTouched, isJa, router, showToast]);

    /**
     * 地名から位置の候補を出す。**押したときだけ1回投げる**——Nominatim は
     * 打鍵ごとの検索を規約で禁じている。サーバー越しに叩くのは、利用者の IP を
     * 相手に渡さず、規約が求める User-Agent をこちらで名乗るため
     * （`api-user/src/geocodeSearch.ts`）。
     */
    const searchPlaces = useCallback(async () => {
        const q = location.trim();
        if (!q || placeSearching) return;
        setPlaceSearching(true);
        setPlaceResults(null);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const { usableRows } = await import("../../../lib/utils/apiRows");
            const res = await userFetch(`/geocode/search?q=${encodeURIComponent(q)}`);
            if (!res.ok) {
                showToast(await readApiError(res, isJa ? "位置を探せませんでした" : "Could not find the place"), "error");
                return;
            }
            const data = await res.json() as { results?: { label: string; lat: number; lng: number }[] };
            const rows = usableRows<{ label: string; lat: number; lng: number }>(data.results, "GET /geocode/search") ?? [];
            setPlaceResults(rows);
            if (rows.length === 0) {
                showToast(isJa
                    ? "その地名では見つかりませんでした。市区町村を足すと見つかることがあります。"
                    : "No place found. Adding the city or prefecture often helps.", "info");
            }
        } catch (e) {
            showToast(e instanceof Error && e.message ? e.message : (isJa ? "位置を探せませんでした" : "Could not find the place"), "error");
        } finally {
            setPlaceSearching(false);
        }
    }, [location, placeSearching, isJa, showToast]);

    // Escape でも閉じる。「StoryViewer と同じ形」と書いておきながら、
    // あちらが持っている Escape の振り分けだけ移していなかった。
    // 閉じられないと、フォーカスは押した「削除」ボタンに残ったままなので、
    // Tab で進むと**オーバーレイの裏にある「保存する」**に届いてしまう。
    useEscapeKey(confirmDelete && !deleting, () => setConfirmDelete(false));
    // 未保存のまま戻ろうとしたときの確認。削除確認と同じ作り（Escape・
    // Tab の閉じ込め・最初のフォーカスは安全な側）
    const [confirmLeave, setConfirmLeave] = useState(false);
    useEscapeKey(confirmLeave, () => setConfirmLeave(false));
    const leaveRef = useRef<HTMLDivElement | null>(null);
    const leaveStayRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(confirmLeave, leaveRef, undefined, leaveStayRef);
    // **裏は「保存する」**。Tab で抜けると、見えないまま Enter で公開できる
    const confirmRef = useRef<HTMLDivElement | null>(null);
    // 最初に当てるのはキャンセル（DOM 順の先頭は赤い「削除」）
    const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(confirmDelete, confirmRef, undefined, confirmCancelRef);

    // 権限が無い人はログイン画面へ送り返さない（/login が押し返して往復する）
    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    if (loading || loadingPhoto) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        );
    }
    // 写真が無いまま何も描かないと、真っ白な画面だけが残る
    // （トーストは消えるので、何が起きたのかも分からない）。
    if (!photo) {
        const message = !photoId
            ? (isJa ? "編集する写真が指定されていません。" : "No photo was specified.")
            : loadFailed
                ? (isJa ? "写真を読み込めませんでした。" : "Could not load this photo.")
                : (isJa ? "写真が見つかりません。" : "Photo not found.");
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
                <div className="text-center">
                    <p className="text-sm text-white/70 mb-4">{message}</p>
                    <Link
                        href={ROUTES.DRAFTS}
                        className="inline-block px-4 py-2.5 text-sm bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "下書き一覧へ" : "Back to drafts"}
                    </Link>
                </div>
            </main>
        );
    }

    const isDraft = photo.published === false;
    // **公開済みの写真は下書き一覧に戻さない。** この画面は下書き一覧から
    // しか来ない前提で作られていたが、写真ページからも来るようになった。
    // 公開写真を編集したあと「（空かもしれない）下書き一覧」に落とされると、
    // 直したものを確かめられない。
    const backHref = isDraft ? ROUTES.DRAFTS : ROUTES.PHOTO(photo.id);
    const ex = photo.exif ?? {};
    // 撮影日時は生の保存値ではなく整形して出す（他の3か所と同じ）。
    // ここだけ抜けていて "2024-11-01T07:30:00" がそのまま並んでいた。
    // 機材名は保存済みの値に二重のメーカー名が混じる（表示だけ直す。
    // **入力欄には当てない**——落とした値が保存の差分の比較先に入る）
    const exifSummary = [dedupeCameraName(ex.camera), ex.lens,
        formatStoredDateTime(ex.dateTimeOriginal, locale === "en" ? "en" : "ja")]
        .filter(Boolean).join(" · ");

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8 pb-28">
                <div className="flex items-center gap-4 mb-6">
                    {/* **名前を付ける。** 中身はアイコンだけ（`aria-hidden`）なので、
                        読み上げでは名前の無いリンクとして読まれていた */}
                    <Link
                        href={backHref}
                        aria-label={isJa ? "戻る" : "Back"}
                        onClick={(e) => {
                            // **直したものを黙って捨てない。** 押す前に一度だけ聞く
                            if (!dirty) return;
                            e.preventDefault();
                            setConfirmLeave(true);
                        }}
                        className="text-white/60 hover:text-white transition-colors"
                    >
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isDraft ? (isJa ? "下書きを編集" : "Edit draft") : (isJa ? "写真を編集" : "Edit photo")}
                    </h1>
                </div>

                {photo.src && (
                    // **取れなかったときに枠ごと消えないようにする。**
                    // `w-full max-h-64 object-contain` は高さを予約しないので、
                    // 画像が 403/404 になると**高さが 0 に潰れる**（Chromium 実測・
                    // 390x844: 成功 358x256 → 失敗 358x0。`alt=""` の失敗画像は
                    // 何も表さないので、幅が残るかは周りの指定で変わる——
                    // 高さが 0 になる方は `w-full` の有無に関わらず同じだった）。
                    // 編集画面から「どの写真を触っているか」の手がかりが消える。
                    // 文言は写真ページ・モーダル・ストーリーと同じ
                    imageError ? (
                        <div className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-lg mb-3 bg-white/5 text-white/50">
                            <PhotoIcon className="w-8 h-8" />
                            <p className="text-xs">{isJa ? "画像を読み込めません" : "Couldn't load image"}</p>
                        </div>
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={photo.thumbSrc || photo.src}
                            alt=""
                            className="w-full max-h-64 object-contain rounded-lg mb-3 bg-white/5"
                            onError={() => setImageError(true)}
                        />
                    )
                )}
                {exifSummary && (
                    <p className="text-xs text-white/50 mb-6">{isJa ? "撮影情報（自動）: " : "EXIF (auto): "}{exifSummary}</p>
                )}

                <form onSubmit={(e) => { e.preventDefault(); void save(true); }} className="space-y-5">
                    <div>
                        <label className={labelCls}>{isJa ? "タイトル" : "Title"}</label>
                        {isEnglishOnly(photo?.title) && (
                            <p className="text-[11px] text-amber-300/80 mb-1">
                                {isJa
                                    ? "この写真は英語のタイトルしか持っていません。この欄の文字はそのまま日本語タイトルとして保存されます。"
                                    : "This photo only has an English title. What you see here will be saved as the Japanese title."}
                            </p>
                        )}
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                            maxLength={TITLE_MAX}
                            className={inputCls} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意" : "Optional"} />
                    </div>

                    <div>
                        <label className={labelCls}>{isJa ? "説明" : "Description"}</label>
                        {isEnglishOnly(photo?.description) && (
                            <p className="text-[11px] text-amber-300/80 mb-1">
                                {isJa
                                    ? "この写真は英語の説明しか持っていません。この欄の文字はそのまま日本語の説明として保存されます。"
                                    : "This photo only has an English description. What you see here will be saved as the Japanese description."}
                            </p>
                        )}
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            rows={5} className={inputCls + " resize-y"} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意（改行で段落）" : "Optional (newline = paragraph)"} />
                    </div>

                    <div className="grid grid-cols-2 gap-4 [&>div]:min-w-0">
                        <div>
                            <label className={labelCls}>{isJa ? "場所" : "Location"}</label>
                            <input type="text" value={location}
                                // **地名を変えたら候補を捨てる。** 残すと「福岡」で出した
                                // 候補を、撮影地を「京都」に直したあとに押せてしまう
                                onChange={(e) => { setLocation(e.target.value); setPlaceResults(null); }}
                                maxLength={LOCATION_MAX}
                                list="own-locations"
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "任意" : "Optional"} />
                            {/* 前に使った値を候補に出す（選ばずに自由入力もできる） */}
                            <datalist id="own-locations">
                                {ownValues.locations.map((v) => <option key={v} value={v} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                                maxLength={CATEGORY_MAX}
                                list="own-categories"
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "例: 風景" : "e.g. Landscape"} />
                            <datalist id="own-categories">
                                {ownValues.categories.map((v) => <option key={v} value={v} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "撮影日" : "Date"}</label>
                            {/* カレンダーの選択肢を絞るだけ（打てば範囲外も入る）。断るのはサーバー
                                （`dateWasRejected`）。保存ボタンは form の外の
                                `type="button"` なので、範囲外でも押せる */}
                            <input type="date" min={PHOTO_DATE_MIN} max={todayForDateInput()} value={date} onChange={(e) => setDate(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タグ（カンマ区切り）" : "Tags (comma separated)"}</label>
                            <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "自然, 山" : "nature, mountain"} />
                            {/* タグはカンマ区切りなので datalist が効かない（欄全体を
                                置き換えてしまう）。押して足せるチップにする。 */}
                            {ownValues.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {ownValues.tags.slice(0, 12).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTagsInput((cur) => appendTag(cur, t))}
                                            className="px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 撮影地の位置（地図に出す場所）。**本人が選ぶ。**
                        地名は自由入力なので、機械では「福岡」が福岡市か富山県の
                        福岡町か決められない（実測でどちらも起きた）。候補を出して
                        選んでもらう */}
                    <div>
                        <label className={labelCls}>{isJa ? "地図に出す位置" : "Location on the map"}</label>
                        <div className="rounded-xl ring-1 ring-white/10 bg-white/5 p-3 space-y-2">
                            <p className="text-xs text-white/70" data-testid="coords-state">
                                {coords
                                    ? (isJa
                                        // 本人が触ったあとは「おおよそ」ではない（保存でサーバーが印を落とす）
                                        ? `設定済み（${coords.lat}, ${coords.lng}）${photo?.geoApprox && !coordsTouched ? "・地名から引いたおおよその位置" : ""}`
                                        : `Set (${coords.lat}, ${coords.lng})${photo?.geoApprox && !coordsTouched ? " · approximate, from the place name" : ""}`)
                                    : (isJa ? "未設定（地図には出ません）" : "Not set (not shown on the map)")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void searchPlaces()}
                                    disabled={!location.trim() || placeSearching}
                                    className="px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {placeSearching
                                        ? (isJa ? "探しています…" : "Searching…")
                                        : (isJa ? "この場所名で候補を出す" : "Find from the location name")}
                                </button>
                                {coords && (
                                    <button
                                        type="button"
                                        onClick={() => { setCoords(null); setCoordsTouched(true); setPlaceResults(null); }}
                                        className="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-sm text-white/70"
                                        style={{ touchAction: "manipulation" }}
                                    >
                                        {isJa ? "地図に出さない" : "Remove from the map"}
                                    </button>
                                )}
                            </div>
                            {placeResults && placeResults.length > 0 && (
                                <ul className="space-y-1" aria-label={isJa ? "位置の候補" : "Place candidates"}>
                                    {placeResults.map((r) => (
                                        <li key={`${r.lat},${r.lng},${r.label}`}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setCoords({ lat: r.lat, lng: r.lng });
                                                    setCoordsTouched(true);
                                                    setPlaceResults(null);
                                                    showToast(isJa ? "位置を選びました（保存すると反映されます）" : "Location chosen (save to apply)", "success");
                                                }}
                                                className="w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-sm break-words"
                                                style={{ touchAction: "manipulation" }}
                                            >
                                                {r.label}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="text-[11px] text-white/50">
                                {isJa
                                    ? "位置は約1km の粒度に丸めて保存します。撮った場所そのものではなく、街のあたりが分かる程度です。"
                                    : "Saved rounded to about 1 km — the neighbourhood, not the exact spot."}
                            </p>
                        </div>
                    </div>
                </form>
            </div>

            {/* 未保存のまま戻る確認。削除確認と同じ形（別の見た目を増やさない）。
                **既定は「編集を続ける」**——捨てる方に指が乗っていると、
                聞いた意味が無い */}
            {confirmLeave && (
                <div
                    ref={leaveRef}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:pb-0"
                    onClick={() => setConfirmLeave(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={isJa ? "保存していない変更があります" : "You have unsaved changes"}
                >
                    <div className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl overflow-hidden">
                            <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">
                                {isJa
                                    ? "保存していない変更があります。戻ると、直した内容は失われます。"
                                    : "You have unsaved changes. If you go back, your edits will be lost."}
                            </p>
                            <button
                                type="button"
                                onClick={() => { setConfirmLeave(false); router.push(backHref); }}
                                className="w-full py-3.5 border-t border-white/10 text-[#ff453a] text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition"
                                style={{ touchAction: "manipulation" }}
                            >
                                {isJa ? "破棄して戻る" : "Discard and go back"}
                            </button>
                        </div>
                        <button
                            ref={leaveStayRef}
                            type="button"
                            onClick={() => setConfirmLeave(false)}
                            className="w-full py-3.5 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition"
                            style={{ touchAction: "manipulation" }}
                        >
                            {isJa ? "編集を続ける" : "Keep editing"}
                        </button>
                    </div>
                </div>
            )}

            {/* 削除確認。取り消せない操作なので、装飾を減らして文字で選ばせる
                （app/components/stories/StoryViewer.tsx と同じ形） */}
            {/* safe-area は**クラスで**足す（`pb-[calc(env(...)+0.75rem)]`）。
                インライン style にするとどの utility より強く、`sm:pb-0` が
                効かなくなって 640px 以上で中央寄せのカードが 6px ずれる */}
            {confirmDelete && (
                <div
                    ref={confirmRef}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:pb-0"
                    onClick={() => !deleting && setConfirmDelete(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={isJa ? "この写真を削除しますか？" : "Delete this photo?"}
                >
                    <div className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl overflow-hidden">
                            <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">
                                {isJa
                                    ? "この写真を削除します。画像とコメントも消え、この操作は取り消せません。"
                                    : "This photo will be deleted along with its image, comments and likes. This can't be undone."}
                            </p>
                            <button
                                type="button"
                                onClick={() => void handleDelete()}
                                disabled={deleting}
                                className="w-full py-3.5 border-t border-white/10 text-[#ff453a] text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ touchAction: "manipulation" }}
                            >
                                {deleting && <div className="w-3.5 h-3.5 border-2 border-[#ff453a]/40 border-t-[#ff453a] rounded-full animate-spin" />}
                                {isJa ? "削除" : "Delete"}
                            </button>
                        </div>
                        <button
                            ref={confirmCancelRef}
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                            className="w-full py-3.5 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50"
                            style={{ touchAction: "manipulation" }}
                        >
                            {isJa ? "キャンセル" : "Cancel"}
                        </button>
                    </div>
                </div>
            )}

            {/* 固定アクションバー: 削除 / 下書き保存 / 公開する */}
            {/* `env(safe-area-inset-bottom)`: ホームインジケーター帯に
                ボタンが入らないようにする（`globals.css` の body 側の
                padding は `position: fixed` には効かない） */}
            <div ref={bottomBarRef} className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
                <div className="max-w-2xl mx-auto flex items-center gap-2">
                    {/* 削除は左端に離して置く。保存系と並べると押し間違える */}
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={saving || deleting}
                        className="px-4 py-3 text-[#ff453a] text-sm font-semibold rounded-full ring-1 ring-[#ff453a]/30 hover:bg-[#ff453a]/10 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "削除" : "Delete"}
                    </button>
                    <div className="flex-1" />
                    {/* **公開済みの写真に「下書き保存」を出さない。**
                        一番「保存」に見えるボタンが published:false を送るので、
                        押すと**公開中の写真が黙って非公開になり検索から消える**
                        （作り直しまで走る）。下書きのときだけ出す。 */}
                    <button
                        type="button"
                        onClick={() => void save(false)}
                        disabled={saving}
                        className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isDraft ? (isJa ? "下書き保存" : "Save draft") : (isJa ? "非公開にする" : "Unpublish")}
                    </button>
                    <button
                        type="button"
                        onClick={() => void save(true)}
                        disabled={saving}
                        className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {saving
                            ? (isJa ? "保存中…" : "Saving…")
                            : isDraft ? (isJa ? "公開する" : "Publish") : (isJa ? "保存する" : "Save")}
                    </button>
                </div>
            </div>
        </main>
    );
}

export default function UserEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        }>
            <EditContent />
        </Suspense>
    );
}
