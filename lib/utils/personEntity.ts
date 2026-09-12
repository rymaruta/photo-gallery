import { siteConfig } from "./seo";
import { spacelessName } from "./nameVariants";
import { personNodeId } from "./personId";

/**
 * 人の構造化データ（schema.org の `Person`）。
 *
 * **人名で探されたとき、Google がするのは「このページは誰のことか」の同定。**
 * `/users/<id>` はこれまで **名前・URL・画像の3つだけ**だった（実ビルドで確認）。
 * 名前だけでは**同姓同名と区別が付かない**ので、次の2つを足す:
 *
 *   `description` … 何をしている人か（自己紹介）
 *   `sameAs`      … **他所の自分**。同じ実体を指す外部のURLで、
 *                    同定にいちばん効く（schema.org が sameAs に与えている役割）
 *
 * **出すのは公開プロフィールに既に出ている情報だけ。** メールも登録日時も
 * 出さない（材料は `scripts/sync-photos-from-ddb.js` が users テーブルから
 * `bio` / `website` / `instagram` / `username` に絞って書き出す）。
 */
export type PublicProfile = { bio?: string; website?: string; instagram?: string };

/**
 * `sameAs` に出してよい URL か。
 *
 * **`http(s)` だけ。** 保存側（`api-user/src/userProfile.ts`）も同じ判定で
 * 断っているが、**それは「これから保存する値」にしか効かない**——
 * 判定を入れる前に保存された行は残りうる（台帳が `mediaHosts` で
 * 一度踏んだ形）。構造化データは Google に読ませるものなので、
 * ここでももう一度確かめる。
 */
export function safeSameAs(url: string | undefined): string | undefined {
    const v = (url ?? "").trim();
    if (!v) return undefined;
    try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
    } catch {
        return undefined;
    }
}

/** Instagram の @名 または URL を、プロフィールの URL に正規化する */
export function instagramUrl(value: string | undefined): string | undefined {
    const v = (value ?? "").trim().replace(/^@/, "");
    if (!v) return undefined;
    // 既に URL で入っている場合はそのまま（ホストは見る）
    if (/^https?:\/\//i.test(v)) {
        const safe = safeSameAs(v);
        return safe && /(^|\.)instagram\.com$/i.test(new URL(safe).hostname) ? safe : undefined;
    }
    // **@名の形だけ通す。** 自由文字列をそのまま URL に混ぜない
    return /^[A-Za-z0-9._]{1,30}$/.test(v) ? `https://www.instagram.com/${v}/` : undefined;
}

export function personEntity(input: {
    id: string;
    displayName: string;
    profile?: PublicProfile;
}): Record<string, unknown> {
    const url = `${siteConfig.url}/users/${input.id}`;
    const sameAs = [safeSameAs(input.profile?.website), instagramUrl(input.profile?.instagram)]
        .filter((v): v is string => !!v);
    const bio = (input.profile?.bio ?? "").trim();
    const alt = spacelessName(input.displayName);
    return {
        "@type": "Person",
        // **写真ページ30枚の `creator` / `author` と同じ節点だと名乗る**
        "@id": personNodeId(url),
        name: input.displayName,
        ...(alt ? { alternateName: alt } : {}),
        url,
        // **このページがその人のページだ、と名乗る。** `mainEntityOfPage` が
        // 無いと「人の情報が載っているページ」と「その人のページ」を
        // 区別できない
        mainEntityOfPage: url,
        // **`image` は出さない。**
        //
        // 出していたのは `summary.latestPhotoSrc`＝**その人が最後に上げた
        // 写真**で、実ビルドでは白鳥の湖の風景だった。`Person.image` は
        // 「その人の画像」＝顔写真・アバターを指す語なので、風景写真を
        // 入れると**丸田竜平とはこういう見た目だ**と申告することになる。
        //
        // 正しい材料はアバター（`profiles/<uid>`）だが、**在るかどうかを
        // ビルド時に知る手段が無い**——`app/components/UserAvatar.tsx` は
        // 実際に取りに行って失敗したら人型アイコンに落ちる形で、
        // `scripts/sync-photos-from-ddb.js` が書き出す
        // `app/data/profiles.json` にもアバターの有無は入っていない
        // （`bio` / `website` / `instagram` / `username` だけ）。
        // **無い画像を申告するのは、違う画像を申告するのと同じくらい悪い。**
        //
        // SNS のカード画像（`og:image`）は最後に上げた写真のままで正しい
        // ——あちらは「このページを貼ったときに出る絵」で、人の顔ではない。
        ...(bio ? { description: bio } : {}),
        ...(sameAs.length > 0 ? { sameAs } : {}),
    };
}
