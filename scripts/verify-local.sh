#!/usr/bin/env bash
#
# **別のブランチへ入れる前に通す関門。** 本番の CI（`deploy.yml`）が通すものを
# 手元で全部回す。GitHub Actions の枠を1分も使わない。
#
# なぜ要るか: `vitest` は**型を見ない**ので、全部緑でも `next build` が落ちる
# ことがある（`7276c2b8`——本番リリースがそこで止まった）。逆にビルドが通っても
# **実ブラウザでだけ落ちる**ことがある（`24f9df2c`——サムネが水和後に消えた）。
# 片方だけでは「落ちない」と言えない。
#
#     使い方:  npm run verify
#              SKIP_DERIV=1 npm run verify   # 派生ありのビルドを省く（速いが穴が空く）
#
# **各関門の終了コードを必ず画面に出す。** 「通ったつもり」で commit した事故が
# 台帳に2回記録されている（`7276c2b8` / `4c1feaeb` の周）。

set -o pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
WORK="$(mktemp -d)"
FAILED=()

# 退避したものは何があっても戻す。photos.json は**追跡されているファイル**なので、
# 途中で落ちると偽のデータが作業ツリーに残る。
cleanup() {
    [ -d "$ROOT/_api_build_backup" ] && { rm -rf "$ROOT/app/api"; mv "$ROOT/_api_build_backup" "$ROOT/app/api"; }
    [ -f "$WORK/photos.json" ] && cp "$WORK/photos.json" "$ROOT/app/data/photos.json"
    rm -rf "$WORK"
}
trap cleanup EXIT

gate() { # gate <名前> <コマンド...>
    # **名前は shift する前に控える。** shift したあとの `$1` はコマンド名なので、
    # 落ちた関門が「単体テスト」ではなく「npx」と報告されていた（自己確認で発覚）。
    local name="$1"
    echo ""
    echo "──────── $name ────────"
    shift
    "$@"
    local rc=$?
    echo "rc=$rc"
    [ $rc -ne 0 ] && FAILED+=("$name")
    return 0
}

# `api` / `api-user` はルートの tsconfig の exclude に入っているので、
# `npx tsc --noEmit` では**一度も見られない**。ルートから見ると依存が
# 解決できないぶんのエラーが元から出るので、**0件ではなく「増えていないこと」**
# で見る（CI はそれぞれのディレクトリで npm ci を打つので、あちらでは出ない）。
API_BASELINE=11
# 116 → 118: 通報のハンドラ（`report.ts`）を1つ足したぶん。
# 118 → 120: いいねした写真の一覧（`likes.getMyLikes`）を1つと、
#            対テスト（`userList.test.ts`）を1ファイル足したぶん。
# 中身は `Cannot find module 'aws-lambda'` と、その結果の implicit any で、
# **全ハンドラが同じ形**（`@types/aws-lambda` は package.json に在るが、
# ルートから見た型検査には入らない）。CI は api-user で npm ci を打つので出ない。
# ⚠️ **上げるのはハンドラかテストファイルを足したときだけ**（テストは
#    先頭の `await import` が1件になる）。それ以外で増えたら本物。
API_USER_BASELINE=120

check_side_tsc() { # check_side_tsc <dir> <baseline>
    local out; out=$(npx tsc --noEmit -p "$1/tsconfig.json" 2>&1)

    # **「数えたら少なかった」を成功と読まない。**
    # tsconfig が消えていると `tsc` は TS5058 を1行出すだけで終わり、
    # 件数は 1 になる——基準より少ないので**素通りしていた**（実測）。
    # 走れなかったのか、エラーが減ったのかを区別する。
    if grep -q "error TS5058\|error TS6053" <<< "$out"; then
        echo "::error:: $1 の tsconfig を読めなかった（関門が素通りするので失敗にする）"
        echo "$out" | head -3
        return 1
    fi
    # **依存が入っていないと基準がまるごと変わる。** `@types/aws-lambda` が
    # 無いと TS2307 と、その帰結の TS7006（暗黙 any）で数十件ぶれる。
    # 「増えていない」という判定が意味を持つのは、同じ土俵のときだけ。
    if [ ! -d "$1/node_modules" ]; then
        echo "::error:: $1/node_modules がありません。\`cd $1 && npm ci\` を打ってから測ってください"
        return 1
    fi
    # **`$1/node_modules` が在っても、土俵が同じとは限らない。**
    # `api` の package.json には `@types/node` も `vitest` も無く、モジュール解決の
    # 親ディレクトリ探索で**ルートの node_modules を拾っている**。ルート側が
    # 未インストールだと `console` / `process` / `require` が無い（TS2584/2580/2304）
    # と `Cannot find module 'vitest'`（TS2307）で数十件ぶれる。実測:
    #     ルートの node_modules 無し ＋ api/node_modules 有り → 97件
    #     両方有り                                       → 11件（基準ぴったり）
    # 11 の正体は TS1378（テストのトップレベル await）×10 と
    # `api/src/photos.ts:132` の TS2322 ×1。残り86件は全部「依存が解決できて
    # いないだけ」のノイズで、それを「本物の増加」と誤報していた。
    #
    # **エラーコードで判定しない。** api-user の基準120は `Cannot find module
    # 'aws-lambda'`（TS2307）で構成されているので、コードで落とすとあちらの
    # 関門が壊れる。代わりに「$1 から2つの依存が解決できるか」を先に見る。
    if ! (cd "$1" && node -e 'require.resolve("vitest/package.json"); require.resolve("@types/node/package.json")' 2>/dev/null); then
        echo "::error:: $1 から vitest / @types/node が解決できません（ルートで npm ci を打ってから測ってください）"
        return 1
    fi

    local n; n=$(grep -c 'error TS' <<< "$out")
    echo "$1 の型エラー: $n 件（基準 $2）"
    if [ "$n" -gt "$2" ]; then
        echo "::error:: $1 の型エラーが増えている（$2 → $n）"
        echo "$out" | grep 'error TS' | head -5
        return 1
    fi
    return 0
}

build_site() { # build_site  — 本番と同じ環境変数で建てる
    rm -rf "$ROOT/out"
    [ -d "$ROOT/app/api" ] && mv "$ROOT/app/api" "$ROOT/_api_build_backup"
    NEXT_PUBLIC_CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net \
    NEXT_PUBLIC_SITE_URL=https://journey-photo.com \
    NEXT_PUBLIC_ENV_NAME=prod \
        npx next build
    local rc=$?
    [ -d "$ROOT/_api_build_backup" ] && { rm -rf "$ROOT/app/api"; mv "$ROOT/_api_build_backup" "$ROOT/app/api"; }
    return $rc
}

# **本番のデータは派生（AVIF/WebP）を持つが、コミット済みの `photos.json` は
# 持たない。** そのまま建てると `<picture>` が1つも出ないので、
# **本番だけで落ちる形をスモークが一度も通らない**（実際それで本番が止まった）。
# 派生の名前は `generate-thumbnails.js` の variants に合わせる。
synthesize_derivatives() {
    node -e '
const fs = require("fs");
const p = "app/data/photos.json";
const photos = JSON.parse(fs.readFileSync(p, "utf8"));
const base = (u) => String(u).replace(/\.[^./]+$/, "");
let n = 0;
for (const ph of photos) {
    if (!ph.src) continue;
    const b = base(ph.src);
    ph.thumbSrc    = `${b}_thumb.webp`;
    ph.thumbAvif   = `${b}_thumb.avif`;
    ph.thumbSm     = `${b}_thumb_sm.webp`;
    ph.thumbSmAvif = `${b}_thumb_sm.avif`;
    ph.srcAvif     = `${b}_lg.avif`;
    n++;
}
fs.writeFileSync(p, JSON.stringify(photos, null, 2));
console.log(`派生を足した写真: ${n}枚`);
// **0枚なら失敗にする。** 黙って進むと「派生あり」と称して派生の無いビルドを
// 見ることになり、この関門を足した理由（`<picture>` が出る形を通す）が消える。
if (n === 0) { console.error("::error:: 派生を1枚も足せなかった"); process.exit(1); }
'
}

echo "関門をローカルで全部通す（GitHub Actions は使わない）"
cp "$ROOT/app/data/photos.json" "$WORK/photos.json"

gate "型検査（ルート）"        npx tsc --noEmit
gate "型検査（api）"           check_side_tsc api "$API_BASELINE"
gate "型検査（api-user）"      check_side_tsc api-user "$API_USER_BASELINE"
gate "lint"                    npx eslint .
gate "単体テスト"              npx vitest run
gate "ビルド（本番と同じ設定）" build_site
gate "実ブラウザのスモーク"     node scripts/e2e-smoke.mjs

if [ -z "$SKIP_DERIV" ]; then
    echo ""
    echo "──────── 本番のデータの形（派生あり）でもう一度 ────────"
    gate "本番の形にする（派生を足す）" synthesize_derivatives
    gate "ビルド（派生あり）"       build_site
    gate "スモーク（派生あり）"     node scripts/e2e-smoke.mjs
    cp "$WORK/photos.json" "$ROOT/app/data/photos.json"
fi

echo ""
echo "════════════════════════════════"
if [ ${#FAILED[@]} -eq 0 ]; then
    echo "✅ 全部通った。別のブランチへ入れてよい。"
    exit 0
fi
echo "❌ 落ちた関門: ${FAILED[*]}"
exit 1
