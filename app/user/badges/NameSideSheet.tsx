"use client";

/**
 * **名前の横**の設定（デザインの板 `BadgePicker.dc.html`。iOS で先に入れたものを Web に足す・2026-10-11）。
 *
 * - 飾るメダル（`displayBadge`）を1つ選ぶ。押し直すと外れる
 * - Pro の印の形（`proMarkStyle`）: 絞り羽根・PRO の札・外す。**Pro の人にだけ出す**（印は Pro の間しか出ない）
 * - 公式の印（`verifiedMarkOff`）を付ける／外す。**公式の人にだけ出す**（外しても資格は残る。付け直せる）
 *
 * 上に「プロフィールでの見え方」の下見。保存は「決める」で、**変わった項目だけ**送る
 * （`nameSideChanges`・口は `PUT /user/profile`）。
 *
 * 2026-10-11 判断: 板の「PRO 限定」の段（鍵の付いた Pro のメダルと「Pro で集める」）は置かない。
 * **Web では何も売らない**（`lib/data/badges.ts` の注記）ので、押しても行き先が無い。
 * Pro の印の形の選択肢に「外す」を足したのは iOS と同じ（サーバーの `"none"`）。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useEscapeKey } from "../../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../../lib/utils/scrollLock";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { badgeImage, badgeLabel, nameBadgeBox, ownedBadges } from "../../../lib/data/badges";
import {
    nameSideChanges, readNameSide,
    type NameSide, type NameSideMarkStyle, type NameSideProfile,
} from "../../../lib/data/badgeShelf";
import VerifiedBadge from "../../components/VerifiedBadge";
import { ProMark } from "../../components/ProfileNameMarks";
import { MedalName } from "../../components/MedalShelf";

type Locale = "ja" | "en";

const EYEBROW = "text-[11px] tracking-[0.12em] text-accent";
/** 選択肢の並び（Pro マークの形・公式の印で同じ。札の下の行に横いっぱい） */
const SEGMENTS = "flex gap-1.5 p-[3px] rounded-xl bg-white/[0.06] w-full";

export default function NameSideSheet({ profile, locale, onClose, onSaved, restoreRef, showToast }: {
    profile: NameSideProfile;
    locale: Locale;
    onClose: () => void;
    /** 保存できた。サーバーが返した姿（読めなければ送った分を重ねた姿） */
    onSaved: (next: NameSideProfile) => void;
    restoreRef: React.RefObject<HTMLButtonElement | null>;
    showToast: (msg: string, kind: "success" | "error") => void;
}) {
    const en = locale === "en";
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeRef = useRef<HTMLButtonElement | null>(null);
    const [draft, setDraft] = useState<NameSide>({
        displayBadge: profile.displayBadge,
        proMarkStyle: profile.proMarkStyle,
        verifiedMarkOff: profile.verifiedMarkOff,
    });
    const [saving, setSaving] = useState(false);
    useEscapeKey(!saving, onClose);
    useFocusTrap(true, dialogRef, restoreRef, closeRef);
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    const owned = useMemo(() => ownedBadges(profile.badges), [profile.badges]);
    const chosen = draft.displayBadge ? profile.badges?.[draft.displayBadge] : undefined;
    const chosenSrc = draft.displayBadge && chosen ? badgeImage(draft.displayBadge, chosen.tier, true) : null;
    const chosenBox = draft.displayBadge ? nameBadgeBox(draft.displayBadge) : null;
    const name = profile.displayName ?? (en ? "Your name" : "あなたの名前");

    const save = async () => {
        if (saving) return;
        const body = nameSideChanges(profile, draft, { verified: profile.verified });
        // 何も変えていなければ送らない（サーバーは空でも更新時刻を書き直す）
        if (Object.keys(body).length === 0) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            const res = await userFetch("/user/profile", { method: "PUT", body: JSON.stringify(body) });
            if (!res.ok) {
                showToast(await readApiError(res, en ? "Couldn't save." : "保存できませんでした"), "error");
                return;
            }
            const saved = readNameSide(await res.json().catch(() => null));
            // 返りが読めなければ、送った分を手元で重ねる
            onSaved(saved ? { ...saved, badges: saved.badges ?? profile.badges } : { ...profile, ...body });
            showToast(en ? "Saved." : "保存しました", "success");
            onClose();
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? (en ? "Couldn't save." : "保存できませんでした"), "error");
        } finally {
            setSaving(false);
        }
    };

    const markOptions: { value: NameSideMarkStyle; ja: string; en: string }[] = [
        { value: "iris", ja: "絞り羽根", en: "Iris" },
        { value: "plate", ja: "PRO の札", en: "Plate" },
        { value: "none", ja: "外す", en: "Off" },
    ];
    const verifiedOptions: { off: boolean; ja: string; en: string }[] = [
        { off: false, ja: "付ける", en: "Show" },
        { off: true, ja: "外す", en: "Hide" },
    ];
    const segmentClass = (on: boolean) =>
        `flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] px-2 text-[12px] ring-1 ring-inset transition cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
            on ? "ring-accent bg-[#17140E] text-white" : "ring-transparent text-white/75 hover:text-white"
        }`;

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-side-title"
            data-testid="name-side-sheet"
        >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={saving ? undefined : onClose} aria-hidden="true" />
            <div className="relative z-10 w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-[22px] sm:rounded-[22px] bg-[#0E0E0F] ring-1 ring-white/10 story-media-in">
                <div className="flex items-center justify-between pl-5 pr-2 pt-3">
                    <h2 id="name-side-title" className="text-xl font-bold text-white">{en ? "Next to your name" : "名前の横"}</h2>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        aria-label={en ? "Close" : "閉じる"}
                        className="inline-flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/[0.06] transition"
                        style={{ width: 44, height: 44 }}
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="overflow-y-auto overscroll-contain px-5 pb-2">
                    {/* 2026-10-11 判断: 文の切れ目で折る（390px で「す。」だけ次の行に落ちていた）。
                        1文ずつ inline-block にすると、収まらないときは文と文の間で折れる */}
                    <p className="text-[12px] leading-relaxed text-white/60" data-testid="name-side-lead">
                        {(en
                            ? ["Choose one medal to show next to your name.", " Tap it again to remove it."]
                            : ["名前の横に出すメダルを1つ選びます。", "もう一度押すと外れます。"]
                        ).map((t) => <span key={t} className="inline-block">{t}</span>)}
                    </p>

                    {/* 下見: プロフィールと同じ並び（名前 → 公式 → Pro の印 → メダル） */}
                    <div className="mt-3 rounded-2xl bg-white/[0.05] ring-1 ring-inset ring-white/[0.08] px-4 py-3 flex flex-col gap-1" data-testid="name-side-preview">
                        <span className={EYEBROW}>{en ? "On your profile" : "プロフィールでの見え方"}</span>
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-2xl font-bold text-white truncate">{name}</span>
                            <VerifiedBadge verified={profile.verified && !draft.verifiedMarkOff} size={20} locale={locale} />
                            {draft.proMarkStyle !== "none" && (
                                <ProMark pro={profile.pro} style={draft.proMarkStyle} size={20} locale={locale} />
                            )}
                            {chosenSrc && chosenBox && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={chosenSrc}
                                    alt=""
                                    width={chosenBox.size}
                                    height={chosenBox.size}
                                    className="shrink-0"
                                    style={{ width: chosenBox.size, height: chosenBox.size, margin: chosenBox.margin }}
                                    data-testid="name-side-preview-badge"
                                />
                            )}
                        </span>
                        <span className="text-[12px] text-white/60">
                            {draft.displayBadge && chosen
                                ? badgeLabel(draft.displayBadge, chosen.tier, locale)
                                : (en ? "No medal" : "メダルなし")}
                        </span>
                    </div>

                    {profile.pro && (
                        // 2026-10-11 判断: 札を上の行、選択肢を下の行に横いっぱい（iOS と同じ）。
                        // 札と同じ行に置くと 390px で選択肢が約 85px しかなく「絞り羽／根」「PRO／の札」と折れていた
                        <fieldset className="mt-3" data-testid="name-side-pro-mark">
                            <legend className="sr-only">{en ? "Pro mark" : "Pro マークの形"}</legend>
                            <span aria-hidden="true" className="block mb-1.5 text-[12px] text-white/75">{en ? "Pro mark" : "Pro マークの形"}</span>
                            <div className={SEGMENTS}>
                                {markOptions.map((o) => (
                                    <label key={o.value} className={segmentClass(draft.proMarkStyle === o.value)} style={{ minHeight: 44 }}>
                                        <input
                                            type="radio"
                                            name="pro-mark-style"
                                            value={o.value}
                                            checked={draft.proMarkStyle === o.value}
                                            onChange={() => setDraft((d) => ({ ...d, proMarkStyle: o.value }))}
                                            className="sr-only"
                                        />
                                        {o.value !== "none" && <ProMark pro style={o.value} size={16} locale={locale} />}
                                        {en ? o.en : o.ja}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}

                    {profile.verified && (
                        <fieldset className="mt-3" data-testid="name-side-verified">
                            <legend className="sr-only">{en ? "Official mark" : "公式の印"}</legend>
                            <span aria-hidden="true" className="mb-1.5 text-[12px] text-white/75 flex items-center gap-1.5">
                                <VerifiedBadge verified size={14} locale={locale} />
                                {en ? "Official mark" : "公式の印"}
                            </span>
                            <div className={SEGMENTS}>
                                {verifiedOptions.map((o) => (
                                    <label key={String(o.off)} className={segmentClass(draft.verifiedMarkOff === o.off)} style={{ minHeight: 44 }}>
                                        <input
                                            type="radio"
                                            name="verified-mark"
                                            value={o.off ? "off" : "on"}
                                            checked={draft.verifiedMarkOff === o.off}
                                            onChange={() => setDraft((d) => ({ ...d, verifiedMarkOff: o.off }))}
                                            className="sr-only"
                                        />
                                        {en ? o.en : o.ja}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}

                    <h3 className={`mt-4 ${EYEBROW}`}>{en ? "Your medals" : "持っているメダル"}</h3>
                    {owned.length === 0 ? (
                        <p className="mt-2 text-[13px] text-white/60" data-testid="name-side-empty">
                            {en ? "No medals yet. Post photos to earn them." : "まだメダルはありません。写真を載せると手に入ります。"}
                        </p>
                    ) : (
                        <div className="mt-1 -mx-1.5 grid grid-cols-4 gap-0.5">
                            {owned.map(({ key, tier }) => {
                                const on = draft.displayBadge === key;
                                const src = badgeImage(key, tier, false);
                                const label = badgeLabel(key, tier, locale);
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        aria-pressed={on}
                                        // 名前は段の部分を別の span に分けて組む（`MedalName`）。読み上げの名前は1続きで渡す
                                        aria-label={label}
                                        // 絵の無い年の季節の章は名前の横に出せない（`NameBadge` も出さない）
                                        disabled={!src}
                                        onClick={() => setDraft((d) => ({ ...d, displayBadge: d.displayBadge === key ? null : key }))}
                                        className="flex flex-col items-center gap-1 px-0.5 py-1.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{ minHeight: 88, touchAction: "manipulation" }}
                                    >
                                        <span
                                            className="block rounded-full"
                                            style={{ width: 56, height: 56, boxShadow: on ? "0 0 0 2px #0E0E0F, 0 0 0 4px var(--color-accent)" : "none" }}
                                        >
                                            {src && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={src} alt="" width={56} height={56} loading="lazy" style={{ width: 56, height: 56 }} />
                                            )}
                                        </span>
                                        <span className={`text-[12px] text-center leading-tight ${on ? "font-semibold text-white" : "text-white/75"}`}>
                                            <MedalName label={label} />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="px-5 pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))] flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving}
                        className="w-full rounded-full bg-accent-fill text-ink text-base font-bold hover:brightness-110 active:scale-[0.98] transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
                        style={{ minHeight: 50, touchAction: "manipulation" }}
                    >
                        {saving && <span aria-hidden="true" className="w-4 h-4 border-2 border-ink/30 border-t-ink rounded-full animate-spin" />}
                        {en ? "Done" : "決める"}
                    </button>
                    <span className="text-[12px] text-white/60 text-center">
                        {en
                            ? "One medal at a time. The Pro mark shows only while you're Pro."
                            : "メダルは1つ（Pro でも1つ）。Pro マークは Pro の間だけ出ます"}
                    </span>
                </div>
            </div>
        </div>
    );
}
