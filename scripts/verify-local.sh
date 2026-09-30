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

# 退避したものは何があっても戻す。`app/data/*.json` は**追跡されている
# ファイル**なので、途中で落ちると偽のデータが作業ツリーに残る。
#
# ⚠️ **控えるのは `photos.json` だけでは足りない。**
# `photo-index.json` も、この関門の中で**わざと空にされる**
# ——`scripts/__tests__/photoIndexParity.slow.test.ts` の「索引が空でも型が通る」が
# 空の索引を書いて `tsc` を走らせ、`finally` で戻す。その戻しは
# **SIGKILL では走らない**（`finally` ごと飛ぶ）。
#
# 空のまま残ると何が起きるか（実測・2026-09-22）:
#
#     空の索引で `npx next build`      → **rc=0（緑）**
#     out/location/パリ.html の
#       href="/photo/…"                → **0本**（本来9本）
#       href="/?photo=…"               → **10本**
#
# `lib/routes.ts` の `ROUTES.PHOTO()` が索引に無い id を
# 「静的ページがまだ無い写真」と読んで控えの URL に落とすため。
# **ビルドは緑のまま、内部リンクが全部差し替わる。**
#
# なお**この関門自身はそれを緑と読まない**——単体テストがビルドより先で、
# `photoIndexParity.test.ts` が3件落ちる（実測）。ここで控えるのは
# 「偽の中身を作業ツリーに残さない」ためで、`photos.json` を控えている
# 理由とまったく同じ。**名指しではなく `app/data/*.json` を丸ごと**控える
# ——4つ目が足された日に、また1つだけ漏れる形にしない。
backup_data() {
    for f in "$ROOT"/app/data/*.json; do
        [ -f "$f" ] && cp "$f" "$WORK/data-$(basename "$f")"
    done
}
restore_data() {
    for b in "$WORK"/data-*.json; do
        [ -f "$b" ] && cp "$b" "$ROOT/app/data/$(basename "${b#"$WORK"/data-}")"
    done
}

cleanup() {
    [ -d "$ROOT/_api_build_backup" ] && { rm -rf "$ROOT/app/api"; mv "$ROOT/_api_build_backup" "$ROOT/app/api"; }
    restore_data
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
# 120 → 129: 行きたい場所（`savedSpots.ts`）のハンドラ3つ（TS2307 が1・
#            その帰結の暗黙 any が3）と、対テスト2ファイル（先頭の
#            `await import` が 1 + 4）。**中身を1件ずつ確かめた**
#            ——`main` の姿を作り直して差分を取り、9件とも既知の形
#            （`aws-lambda` の型がルートから見えないぶん）であることを見た。
# 中身は `Cannot find module 'aws-lambda'` と、その結果の implicit any で、
# **全ハンドラが同じ形**（`@types/aws-lambda` は package.json に在るが、
# ルートから見た型検査には入らない）。CI は api-user で npm ci を打つので出ない。
# ⚠️ **上げるのはハンドラかテストファイルを足したときだけ**（テストは
#    先頭の `await import` が1件になる）。それ以外で増えたら本物。
#
# ⚠️ **この 120 は測り方が変わったあとの残り香で、実測はずっと少ない。**
# 2026-09-21 に `api-user/node_modules` を入れて測ると **49 件**
# （`api` は 11 でちょうど基準）。上の「中身は Cannot find module
# 'aws-lambda'」という説明は **node_modules が無い状態**の話で、
# `check_side_tsc` は今その状態を失敗にする（80行）ので、基準が意味を持つ
# 土俵では出ない。つまり **120 は緩すぎて、71件ぶんの増加を見逃す**。
# 下げるのは別の作業（並行しているブランチも同じ関門を通るため、
# ここでは測った数だけ書き残す）。
# 2026-09-21（夜）: 129 → 142。develop に入った PR #73（保存）と #80（アーカイブ）の
# 新ファイル4つぶん——`saves.ts` 5・`storyArchive.ts` 2・`storyArchive.test.ts` 5・
# `saves.test.ts` 1（`git cat-file -e 33cafc66:<path>` で「基準を決めた断面に無い
# ファイル」だけを数えて 13 = 142 − 129 と一致）。中身は上と同じ
# `Cannot find module 'aws-lambda'`（TS2307）・implicit any（TS7006）・
# テストのトップレベル await（TS1378）。
# ⚠️ **並行するブランチが各自の木で関門を通しても、合流した develop で
# 基準を超える**（9/21 の 120 → 129 と同じ形）。develop を取り込んだら
# この関門を一度は通すこと。
# 2026-09-22: 149 → 142 に**戻した**。149 へ上げたのは私の測り違い——この容れ物の
# `api-user/node_modules` がほぼ空で `@types/aws-lambda` を引けず、TS2307 と
# その帰結の TS7006 で膨らんだ数を「develop で増えた」と読んでいた。
# `cd api-user && npm ci` を打つと **57件**（別のセッションの実測「57/142」と一致）。
# 下の「型定義が入っているか」の見張りが、この読み違いを次から止める。
API_USER_BASELINE=142

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
    # **`$1/package.json` が挙げている型定義が、そこに入っているか。**
    # 上の2つはルートの node_modules で満たせてしまうので、`$1` 自身の
    # devDependencies が空でも素通りする。実際に踏んだ（2026-09-22）——
    # `api-user/node_modules` は在るのに中身がほぼ空で、`@types/aws-lambda` が
    # 引けず **TS2307 と、その帰結の TS7006 で 57 → 151 に膨らんでいた**。
    # それを「develop で増えた」と読んで基準を上げかけた（＝本物の増加を
    # 隠す方向）。**土俵が違うだけなのか、本当に増えたのかを先に切り分ける。**
    local miss
    if ! miss=$(cd "$1" && node -e 'const p=require("./package.json");const ns=Object.keys({...p.dependencies,...p.devDependencies}).filter(n=>n.startsWith("@types/"));const m=ns.filter(n=>{try{require.resolve(n+"/package.json");return false}catch{return true}});if(m.length){console.log(m.join(", "));process.exit(1)}'); then
        echo "::error:: $1 の型定義が入っていません（$miss）。\`cd $1 && npm ci\` を打ってから測ってください"
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

# **本番のビルドと同じ `NEXT_PUBLIC_*` を渡す。**
#
# 🔴 ここが3本しか無かったので、**この関門で建てた site は「誰もログインできない
# site」**だった——`NEXT_PUBLIC_COGNITO_CLIENT_ID` が空だと
# `lib/auth/config.ts` が投げ、`lookupSession` は必ず未ログインを返す。
# 実測（2026-09-22・`out/user/highlights` を実ブラウザで開いた）:
#
#     本文 = "ログイン / 写真をアップロードするにはログインが必要です …"
#
# つまり `/user/**` の11画面は**どれ1つとして中身が描かれていない**。
# 今日いちばん大きかった2件（ハイライトの「保存」が押せない・`/user/edit` の
# 下バーが全部押せない）が全関門を素通りしたのは、これが理由。
# スモークを足しても、この env が欠けている限り**ログイン画面を見に行くだけ**になる。
#
# 値は全部公開値（`deploy.yml` が同じものを平文で渡している）。
# 見張りは `scripts/__tests__/verifyBuildEnv.test.ts`——`deploy.yml` が渡す
# 名前を全部ここでも渡しているかを突き合わせる。
PROD_BUILD_ENV=(
    "NEXT_PUBLIC_CLOUDFRONT_URL=https://d1s3dwwzgxf5ni.cloudfront.net"
    "NEXT_PUBLIC_SITE_URL=https://journey-photo.com"
    "NEXT_PUBLIC_ENV_NAME=prod"
    "NEXT_PUBLIC_API_BASE_URL=https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com"
    "NEXT_PUBLIC_USER_API_BASE_URL=https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com"
    "NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_ZbuhDQsWz"
    "NEXT_PUBLIC_COGNITO_CLIENT_ID=21cs4cd8dkttmg3snloj72u8mu"
    "NEXT_PUBLIC_CONTACT_EMAIL=journey.photo.official@gmail.com"
    # **`NEXT_PUBLIC_GA_ID` だけは空のまま。** 入れると手元のスモークの
    # 全ページが Google へ計測を送る（本番の数字が汚れる）。
    # 本番では `G-7TFN1YPBE3` が入る
)

# **スモークも Client ID を要る**（ログイン済みの画面を開くのに
# `localStorage` の鍵 `CognitoIdentityServiceProvider.<clientId>.*` が要る）。
# 一覧から取り出して使う（同じ値を2か所に書かない）。
#
# 🔴 **`export` しない。** 最初 `export` で通したら、**単体テストにも
# 漏れて 55件が落ちた**（実測。`lib/auth/config.ts` は Pool ID と Client ID の
# 両方が揃っているかで分岐するので、片方だけ立つと**テストが前提にしている
# 失敗の形が変わる**——`UserProfileClient.*` の10ファイルと
# `lib/utils/apiTimeout` ほか）。しかも `npx vitest run` を手で叩くと緑なので、
# **関門でしか出ない**形だった（この台帳が今日2回踏んだ「手元と CI で環境が
# 違う」の、もう1つの向き）。**要るプロセスにだけ渡す。**
SMOKE_ENV=()
for _kv in "${PROD_BUILD_ENV[@]}"; do
    case "$_kv" in NEXT_PUBLIC_COGNITO_CLIENT_ID=*) SMOKE_ENV+=("$_kv") ;; esac
done

build_site() { # build_site  — 本番と同じ環境変数で建てる
    rm -rf "$ROOT/out"
    [ -d "$ROOT/app/api" ] && mv "$ROOT/app/api" "$ROOT/_api_build_backup"
    env "${PROD_BUILD_ENV[@]}" npx next build
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
backup_data

gate "型検査（ルート）"        npx tsc --noEmit
gate "型検査（api）"           check_side_tsc api "$API_BASELINE"
gate "型検査（api-user）"      check_side_tsc api-user "$API_USER_BASELINE"
gate "lint"                    npx eslint .
gate "単体テスト"              npx vitest run
# 重いテスト（`*.slow.test.ts`）は `npm test`（Actions）では流さず、ここでだけ流す（`vitest.config.ts`）。
# **ほかのテストと並べない。** `photoIndexParity.slow.test.ts` は `photo-index.json` を
# 約30秒のあいだ空にするので、それを読むテストと重なると落ちうる（レビューで指摘）
gate "重いテスト（単独で）"     env RUN_SLOW_TESTS=1 npx vitest run .slow.test.
gate "ビルド（本番と同じ設定）" build_site
gate "実ブラウザのスモーク"     env "${SMOKE_ENV[@]}" node scripts/e2e-smoke.mjs

if [ -z "$SKIP_DERIV" ]; then
    echo ""
    echo "──────── 本番のデータの形（派生あり）でもう一度 ────────"
    gate "本番の形にする（派生を足す）" synthesize_derivatives
    gate "ビルド（派生あり）"       build_site
    gate "スモーク（派生あり）"     env "${SMOKE_ENV[@]}" node scripts/e2e-smoke.mjs
    restore_data
fi

echo ""
echo "════════════════════════════════"
if [ ${#FAILED[@]} -eq 0 ]; then
    echo "✅ 全部通った。別のブランチへ入れてよい。"
    exit 0
fi
echo "❌ 落ちた関門: ${FAILED[*]}"
exit 1
