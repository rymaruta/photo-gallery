"use client";

import { usablePhotoRows } from "../../../lib/utils/apiRows";
import React, { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon, PhotoIcon } from "@heroicons/react/24/outline";
import type { Photo, LocalizedParagraphs } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";
import { toDateInputValue, mergeDate, todayForDateInput, PHOTO_DATE_MIN } from "../../../lib/utils/dateInput";
import { changedFields } from "../../../lib/utils/changedFields";

// text-base（16px）にする。iOS Safari は 16px 未満の入力欄にフォーカスすると
// ページを拡大し、blur しても戻さない。他のページでは inline style で
// 16px を当てて回避しているが、ここは共通クラスなのでクラス側で揃える。
const inputCls = "w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-white/50";
const labelCls = "block text-sm text-white/60 mb-1";
const sectionCls = "border-t border-white/10 pt-5";

function parseParagraphs(desc: Photo["description"], lang: "ja" | "en"): string {
    if (!desc) return "";
    // 素の文字列は「日本語のみ・英語版なし」。以前は lang を見ずに両方へ
    // 返していて、保存時に {ja, en} の**両方へ同じ日本語**が入り、
    // JSON-LD や英語併記に日本語が焼き込まれた（/user/edit の
    // mergeLocalizedDescription は英語版なしを守っている——対の乖離）。
    if (typeof desc === "string") return lang === "ja" ? desc : "";
    const arr = (desc as LocalizedParagraphs)[lang];
    return Array.isArray(arr) ? arr.join("\n") : "";
}

function AdminEditContent() {
    const { isAuthenticated, isAdminUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();

    const photoId = searchParams.get("id");

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    // 写真そのものが取れなかった（削除済み・403）。枠ごと消さないための印
    const [imageError, setImageError] = useState(false);
    // **入るたびに下ろす**（`app/user/edit` と同じ理由。台帳の型0の派生）。
    // クエリ（`?id=`）だけが変わる遷移では作り直されないので、下ろさないと
    // 次に開いた正常な写真が「読み込めません」に固定される
    useEffect(() => { setImageError(false); }, [photo?.src]);
    const [saving, setSaving] = useState(false);

    // Basic
    // 読み込んだ時点の日本語（「この編集で空にした」の判定に使う）
    const loadedRef = useRef<{ titleJa: string; descJa: string }>({ titleJa: "", descJa: "" });
    const [titleJa, setTitleJa] = useState("");
    const [titleEn, setTitleEn] = useState("");
    // Description
    const [descJa, setDescJa] = useState("");
    const [descEn, setDescEn] = useState("");
    // Metadata
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");
    const [published, setPublished] = useState(true);
    // EXIF
    const [exifCamera, setExifCamera] = useState("");
    const [exifLens, setExifLens] = useState("");
    const [exifAperture, setExifAperture] = useState("");
    const [exifExposure, setExifExposure] = useState("");
    const [exifIso, setExifIso] = useState("");
    const [exifFocalLength, setExifFocalLength] = useState("");
    const [exifWhiteBalance, setExifWhiteBalance] = useState("");

    // 通せなかった／もう用の無い画面は履歴に残さない（replace）。
    // push にすると、送り先から戻ったときにこの画面へ着地し、ここが
    // また送り返すので**戻るで抜けられなくなる**。
    useEffect(() => {
        if (!loading) {
            if (!isAuthenticated) {
                router.replace("/admin/login");
            } else if (!isAdminUser) {
                router.replace("/");
            }
        }
    }, [isAuthenticated, isAdminUser, loading, router]);

    // 取得は非同期なので、遅い回線で A を開いて戻り B を開くと、
    // A の応答が後から届く。中断ガードが無かった頃はフォームが A の内容で
    // 埋まり、URL と photoId は B のままだったので、保存すると
    // **B の写真に A のタイトル・説明・タグ・撮影日・公開状態が書き込まれた**。
    //
    // 「保存時に photoId とフォームの出どころを突き合わせる」二重の守りも
    // 書いてみたが、**UI から到達できない**ので入れていない——写真を
    // 切り替えると取得の開始と同時にスピナーへ変わり、保存ボタンが消える。
    // 到達しない守りはテストも書けず、次に読む人を迷わせるだけになる。
    useEffect(() => {
        // ?id が無いまま開かれたら待っても何も来ない。
        // 以前はここで return するだけだったので、スピナーが永久に回り、
        // 戻る導線も出なかった（ブックマークからクエリが落ちた場合など）。
        if (!photoId) { setLoadingPhoto(false); return; }
        if (!isAuthenticated || !isAdminUser) return;

        let aborted = false;

        const fetchPhoto = async () => {
            setLoadingPhoto(true);
            try {
                // 公開API（/photos/{id}）は下書きを404にするため、非公開にした
                // 写真をこの画面で開けず、公開に戻す手段が無くなっていた。
                // 管理専用の一覧から引く（下書きも含まれる）。
                const { authenticatedFetch } = await import("../../../lib/utils/api");
                const res = await authenticatedFetch("/admin/photos", { cache: "no-store" });
                if (res.ok) {
                    // 読めない行は落とす。1件の `null` で `find` が投げると
                    // 下の catch が拾い、**目的の写真は無事なのに**
                    // 「写真の読み込みに失敗しました」＋管理一覧への `replace`
                    // になる（`not found` の文字列は画面に出ない。一度そう
                    // 書いたが誤りだった）
                    const all = usablePhotoRows<Photo>(await res.json(), "GET /admin/photos");
                    const data = all?.find((p) => p.id === photoId);
                    if (!data) throw new Error("not found");
                    // 別の写真に切り替わったあとの応答は捨てる
                    if (aborted) return;
                    setPhoto(data);

                    const t = data.title;
                    const titleJaVal = typeof t === "object" && t !== null
                        ? (t as Record<string, string>).ja ?? ""
                        : typeof t === "string" ? t : "";
                    // 素の文字列は英語版なし（en 欄には入れない）。ここに同じ
                    // 文字列を入れると保存で en に日本語が焼き込まれる。
                    // 保存時の en:"" はサーバー（sanitizeTitle）が落とす
                    const titleEnVal = typeof t === "object" && t !== null
                        ? (t as Record<string, string>).en ?? ""
                        : "";
                    setTitleJa(titleJaVal);
                    setTitleEn(titleEnVal);

                    const descJaVal = parseParagraphs(data.description, "ja");
                    setDescJa(descJaVal);
                    setDescEn(parseParagraphs(data.description, "en"));

                    // **「この編集で空にした」と「もともと空」を分ける。**
                    // 日本語が無く英語だけの写真（旧実装で日本語を消した分）は
                    // この画面で最初から空欄に見える。状態だけを見て「空なら
                    // 消す」に倒すと、**タイトルに触らず場所だけ直した保存で
                    // 英語が消える**（しかも英語欄が無いので戻せない。
                    // 触っていない項目で `metaChanged` が立ち、8分の再ビルドも走る）。
                    loadedRef.current = { titleJa: titleJaVal, descJa: descJaVal };

                    setLocation(data.location ?? "");
                    setCategory(data.category ?? "");
                    // 保存値は ISO 文字列。そのまま <input type="date"> に入れると
                    // 黙って空欄になり、「撮影日が無い」と誤解した人が選び直して
                    // 時刻を落としてしまう。
                    setDate(toDateInputValue(data.date));
                    setTagsInput(Array.isArray(data.tags) ? data.tags.join(", ") : "");
                    setPublished(data.published !== false);

                    const ex = data.exif ?? {};
                    setExifCamera(ex.camera ?? "");
                    setExifLens(ex.lens ?? "");
                    setExifAperture(ex.aperture ?? "");
                    setExifExposure(ex.exposure ?? "");
                    setExifIso(ex.iso != null ? String(ex.iso) : "");
                    setExifFocalLength(ex.focalLength ?? "");
                    setExifWhiteBalance(ex.whiteBalance ?? "");
                } else {
                    if (aborted) return;
                    showToast(locale === "en" ? "Photo not found" : "写真が見つかりません", "error");
                    // **replace。** 見つからない写真の編集画面を履歴に残すと、
                    // 戻るたびに同じトーストを出してまた送り返す
                    router.replace(ROUTES.ADMIN);
                }
            } catch (e) {
                if (aborted) return;
                // ここに来ると photo が null のままで、下の `if (!photo) return null`
                // が真っ白な画面を返していた（ヘッダーも戻るリンクも無い）。
                // res.ok === false の分岐と同じく管理画面へ戻す。
                log.error("fetchPhoto error:", e);
                showToast(locale === "en" ? "Failed to load photo" : "写真の読み込みに失敗しました", "error");
                router.replace(ROUTES.ADMIN);
            } finally {
                if (!aborted) setLoadingPhoto(false);
            }
        };

        void fetchPhoto();
        return () => { aborted = true; };
    }, [photoId, isAuthenticated, isAdminUser, showToast, router, locale]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!photoId) return;

        setSaving(true);
        try {
            const { authenticatedFetch } = await import("../../../lib/utils/api");
            const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

            // サーバーは exif を丸ごと置き換える。このフォームは7項目しか扱わないので、
            // 組み直すと imageSize や dateTimeOriginal など画面に出ない項目が消える
            // （撮影情報カードから解像度と撮影時刻が失われていた）。
            // 既存の値の上にフォームの内容を重ねる。
            const exif: Record<string, string | number> = { ...(photo?.exif ?? {}) };
            const setExifField = (key: string, value: string | number, filled: boolean) => {
                if (filled) exif[key] = value;
                else delete exif[key]; // 空にしたら消せるようにする
            };
            setExifField("camera", exifCamera, !!exifCamera);
            setExifField("lens", exifLens, !!exifLens);
            setExifField("aperture", exifAperture, !!exifAperture);
            setExifField("exposure", exifExposure, !!exifExposure);
            setExifField("iso", Number(exifIso), !!exifIso);
            setExifField("focalLength", exifFocalLength, !!exifFocalLength);
            setExifField("whiteBalance", exifWhiteBalance, !!exifWhiteBalance);

            const descJaParagraphs = descJa.split("\n").map((s) => s.trim()).filter(Boolean);
            const descEnParagraphs = descEn.split("\n").map((s) => s.trim()).filter(Boolean);

            // **実際に変えた項目だけ送る**（/user/edit と同じ理由）。
            // 開いた時点の値を毎回全部送っていたので、同じ写真を2タブで開いて
            // 片方で直したあと、もう片方で保存すると先の編集が消えた。
            // こちらは exif も丸ごと送っていたので、撮影日時や画像サイズまで
            // 古い姿に巻き戻っていた。空文字は「クリアの意思」なので送る
            // （undefined はキーごと落ちて「触らない」になる——下のコメント参照）。
            const nextFields: Record<string, unknown> = {
                // **日本語を空にしたら、英語ごと消す。** `{ja:"", en:"..."}` を
                // 送ると、サーバーは英語だけを残し、表示は `getLocalized` の
                // フォールバックで**英語が出る**——この画面には英語の入力欄が
                // 無いので、消したつもりの文字列を戻す手段が無くなる
                // （/user/edit の `mergeLocalizedTitle` と同じ判断）。
                // 空にした（＝もとは入っていた）ときだけクリア。もともと
                // 空なら `undefined`＝キーごと落として「触らない」にする
                title: titleJa
                    ? { ja: titleJa, en: titleEn }
                    : (loadedRef.current.titleJa ? "" : undefined),
                description: descJaParagraphs.length
                    ? { ja: descJaParagraphs, en: descEnParagraphs }
                    : (loadedRef.current.descJa ? "" : undefined),
                // 空文字で送る。undefined だと JSON.stringify がキーごと落とし、
                // サーバーの部分更新が「指定なし＝触らない」と解釈するため、
                // 一度入れた場所やカテゴリを空にできなかった。
                location,
                category,
                // 日付だけ編集させているので、元の値が持っていた時刻は戻す
                // （落とすと同じ日に撮った写真の並びが崩れる）
                date: mergeDate(photo?.date, date),
                tags,
                exif,
            };
            // 比較先は「保存されている姿」。素の文字列も {ja,en} の形に
            // 揃えてから比べる（sameFieldValue は空の en を無視するので、
            // {ja:"湖"} と {ja:"湖", en:""} は同じと判定される）。
            const prevTitle = photo?.title;
            const originalFields: Record<string, unknown> = {
                title: typeof prevTitle === "object" && prevTitle !== null
                    ? prevTitle
                    : { ja: typeof prevTitle === "string" ? prevTitle : "", en: "" },
                description: photo?.description,
                location: photo?.location ?? "",
                category: photo?.category ?? "",
                date: photo?.date ?? "",
                tags: Array.isArray(photo?.tags) ? photo.tags : [],
                exif: photo?.exif,
            };
            const body = { published, ...changedFields(nextFields, originalFields) };

            const res = await authenticatedFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify(body),
            });

            if (res.ok) {
                showToast(locale === "en" ? "Saved" : "保存しました", "success");
                router.push(ROUTES.ADMIN);
            } else {
                const err = await res.json().catch(() => ({})) as { error?: string };
                showToast(err.error ?? (locale === "en" ? "Save failed" : "保存に失敗しました"), "error");
            }
        } catch (e) {
            log.error("savePhoto error:", e);
            showToast(locale === "en" ? "Save failed" : "保存に失敗しました", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading || loadingPhoto) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        );
    }

    // 指定が無い / 見つからない場合は、真っ白ではなく戻る導線を出す
    // （見つからない・失敗の経路は上で /admin に戻している）。
    if (!photo) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
                <div className="text-center">
                    <p className="text-sm text-white/70 mb-4">
                        {locale === "en" ? "No photo was specified." : "編集する写真が指定されていません。"}
                    </p>
                    <Link
                        href={ROUTES.ADMIN}
                        className="inline-block px-4 py-2.5 text-sm bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {locale === "en" ? "Back to admin" : "管理画面へ"}
                    </Link>
                </div>
            </div>
        );
    }

    const isJa = locale === "ja";

    return (
        <div className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8">
                <div className="flex items-center gap-4 mb-8">
                    <Link href={ROUTES.ADMIN} className="text-white/60 hover:text-white transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isJa ? "写真を編集" : "Edit Photo"}
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
                        <div className="w-full h-40 flex flex-col items-center justify-center gap-2 rounded-lg mb-6 bg-white/5 text-white/50">
                            <PhotoIcon className="w-8 h-8" />
                            <p className="text-xs">{isJa ? "画像を読み込めません" : "Couldn't load image"}</p>
                        </div>
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={photo.src}
                            alt=""
                            className="w-full max-h-64 object-contain rounded-lg mb-6 bg-white/5"
                            onError={() => setImageError(true)}
                        />
                    )
                )}

                {/* **`noValidate`。** 撮影日に `min`/`max` を出したので、範囲外の値が
                    入っている写真では **submit そのものが発火しなくなる**——保存ボタンが
                    無反応になり、タイトルもタグも直せない（Chromium で実測）。
                    範囲は「カレンダーで選びにくくする」目的にとどめ、断るのはサーバー */}
                <form noValidate onSubmit={(e) => void handleSave(e)} className="space-y-5">

                    {/* タイトル。英語欄は廃止（サイト表示は日本語のみ）。
                        既存の英語テキストは保存時に引き継ぐが、**日本語を
                        空にしたら英語ごと消す**（残すと表示が英語に化けるうえ、
                        この画面から戻せない）。もともと空の写真は触らない。 */}
                    <div>
                        <label className={labelCls}>{isJa ? "タイトル" : "Title"}</label>
                        <input type="text" value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className={inputCls} />
                    </div>

                    {/* 説明 */}
                    <div className={sectionCls}>
                        <label className={labelCls}>{isJa ? "説明（1行 = 1段落）" : "Description (1 line = 1 paragraph)"}</label>
                        <textarea
                            value={descJa}
                            onChange={(e) => setDescJa(e.target.value)}
                            rows={5}
                            className={inputCls + " resize-y"}
                            placeholder={isJa ? "段落ごとに改行" : "One paragraph per line"}
                        />
                    </div>

                    {/* メタデータ */}
                    <div className={sectionCls + " grid grid-cols-2 gap-4 [&>div]:min-w-0"}>
                        <div>
                            <label className={labelCls}>{isJa ? "場所" : "Location"}</label>
                            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "撮影日" : "Date"}</label>
                            {/* カレンダーの選択肢を絞るだけ（打てば範囲外も入る）。断るのはサーバー
                                （`dateWasRejected`）。form は `noValidate` なので保存は止まらない */}
                            <input type="date" min={PHOTO_DATE_MIN} max={todayForDateInput()} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タグ（カンマ区切り）" : "Tags (comma separated)"}</label>
                            <input
                                type="text"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                                placeholder={isJa ? "自然, 日本, 山" : "nature, japan, mountain"}
                                className={inputCls}
                            />
                        </div>
                    </div>

                    {/* EXIF */}
                    <div className={sectionCls}>
                        <p className="text-xs text-white/40 mb-3">EXIF</p>
                        <div className="grid grid-cols-2 gap-4 [&>div]:min-w-0">
                            <div>
                                <label className={labelCls}>{isJa ? "カメラ" : "Camera"}</label>
                                <input type="text" value={exifCamera} onChange={(e) => setExifCamera(e.target.value)} className={inputCls} placeholder="Sony α7IV" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "レンズ" : "Lens"}</label>
                                <input type="text" value={exifLens} onChange={(e) => setExifLens(e.target.value)} className={inputCls} placeholder="FE 24-70mm F2.8 GM" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "絞り" : "Aperture"}</label>
                                <input type="text" value={exifAperture} onChange={(e) => setExifAperture(e.target.value)} className={inputCls} placeholder="f/2.8" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "シャッタースピード" : "Exposure"}</label>
                                <input type="text" value={exifExposure} onChange={(e) => setExifExposure(e.target.value)} className={inputCls} placeholder="1/250s" />
                            </div>
                            <div>
                                <label className={labelCls}>ISO</label>
                                <input type="number" value={exifIso} onChange={(e) => setExifIso(e.target.value)} className={inputCls} placeholder="400" min="0" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "焦点距離" : "Focal Length"}</label>
                                <input type="text" value={exifFocalLength} onChange={(e) => setExifFocalLength(e.target.value)} className={inputCls} placeholder="50mm" />
                            </div>
                            <div>
                                <label className={labelCls}>{isJa ? "ホワイトバランス" : "White Balance"}</label>
                                <input type="text" value={exifWhiteBalance} onChange={(e) => setExifWhiteBalance(e.target.value)} className={inputCls} placeholder="Auto" />
                            </div>
                        </div>
                    </div>

                    {/* 公開設定 */}
                    <div className={sectionCls + " flex items-center gap-3"}>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={published}
                            onClick={() => setPublished((v) => !v)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${published ? "bg-blue-500" : "bg-white/20"}`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${published ? "translate-x-6" : "translate-x-1"}`}
                            />
                        </button>
                        <span className="text-sm">{isJa ? "公開" : "Published"}</span>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-2 bg-white text-black rounded-lg font-medium text-sm hover:bg-white/90 disabled:opacity-50 transition-colors"
                        >
                            {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "保存" : "Save")}
                        </button>
                        <Link
                            href={ROUTES.ADMIN}
                            className="flex-1 py-2 bg-white/10 text-white rounded-lg font-medium text-sm hover:bg-white/20 transition-colors text-center"
                        >
                            {isJa ? "キャンセル" : "Cancel"}
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function AdminEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        }>
            <AdminEditContent />
        </Suspense>
    );
}
